// Collector regression coverage: real event boundaries, missing evidence and restart-safe deduplication.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../src/shared/contract';
import { AgentAnalyticsCollector } from '../../src/main/agents/collector';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-collector-')); dirs.push(dir);
  let now = 100;
  return { dir, tick: (n: number) => { now = n; }, create: () => new AgentAnalyticsCollector(dir, () => now) };
}
const chat = (sessionId = 'one', harness = 'claude'): ChatSummary => ({ id: `${harness}-${sessionId}`, sessionId, harness, agent: { id: 'a', revision: 1, name: 'Agent' } } as ChatSummary);
const result = (id: string, at: number) => ({ kind: 'result' as const, id, at, costUsd: 999, durationMs: 999, turns: 1, isError: false });

it('keeps list equivalents distinct, namespaces native IDs and never borrows selected models', () => {
  const s = setup(), c = s.create();
  c.patch(chat(), { sessionId: 'one', model: 'selected', turnCostUsd: 2 });
  c.item(chat(), result('r1', 100), false);
  c.patch(chat('one', 'cursor'), { sessionId: 'one', turnCostUsd: 0, costKnown: false });
  c.item(chat('one', 'cursor'), result('r2', 100), false);
  const report = c.readModel(), a = report.agents[0]!;
  expect(a.sessions).toBe(2);
  expect(a.costs.actualUsd.total).toBeNull();
  expect(a.costs.listPriceUsd).toMatchObject({ total: null, knownSubtotal: 2, unknownSessions: 1 });
  expect(a.evidence.map(e => e.sessionKey)).toEqual(['claude:one', 'cursor:one']);
  expect(report.modelCoverage.observedModelKnown).toBe(0);
  expect(report.cohorts).toEqual([]);
});

it('records only explicit intervals and pending categories, never result duration', () => {
  const s = setup(), c = s.create(), ch = chat();
  c.patch(ch, { sessionId: 'one', state: 'running', modelObserved: 'observed' });
  s.tick(120);
  c.pending(ch, { id: 'p', type: 'permission' } as Omit<PendingRequest, 'chatId'>);
  s.tick(150); c.resolved(ch, 'p');
  s.tick(160); c.patch(ch, { state: 'running' });
  s.tick(180); c.item(ch, result('r', 180), false);
  const a = c.readModel().agents[0]!;
  expect(a.timing.execution).toMatchObject({ total: null, observedPartialMs: 40 });
  expect(a.timing['permission-wait'].observedPartialMs).toBe(30);
  expect(a.timing.unknown.observedPartialMs).toBe(10);
  expect(a.elapsed.total).toBeNull();
  expect(a.evidence[0]!.provenance.modelObserved).toBe('observed');
});

it('deduplicates results, rejects historical replay and does not bridge restart timing', () => {
  const s = setup(), c = s.create();
  c.patch(chat(), { sessionId: 'one', turnCostUsd: 2, state: 'running' });
  s.tick(110); c.item(chat(), result('r', 110), false);
  c.item(chat(), result('r', 110), false);
  expect(c.readModel().agents[0]!.costs.listPriceUsd.total).toBe(2);
  s.tick(200); const restored = s.create();
  restored.item(chat(), result('old', 90), false);
  restored.patch(chat(), { sessionId: 'one', state: 'running', turnCostUsd: 3 });
  s.tick(210); restored.item(chat(), result('new', 210), false);
  expect(restored.readModel().agents[0]!.costs.listPriceUsd.total).toBeNull();
  expect(restored.readModel().agents[0]!.timing.execution.observedPartialMs).toBe(20);
});

it('preserves corrupt archives and exposes failure through readModel without crashing construction', () => {
  const s = setup(), file = path.join(s.dir, 'agent-analytics.json');
  fs.writeFileSync(file, '{broken');
  const c = s.create();
  expect(() => c.readModel()).toThrow();
  expect(() => c.patch(chat(), { state: 'running' })).toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
});

it('settles adapters that report result before costs and does not shift the next turn', () => {
  const s = setup(), c = s.create();
  c.patch(chat(), { sessionId: 'one' });
  c.item(chat(), result('first', 100), false);
  c.patch(chat(), { turnCostUsd: 2, turnTokens: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 } });
  s.tick(120); c.item(chat(), result('second', 120), false);
  c.patch(chat(), { turnCostUsd: 3, turnTokens: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 } });
  expect(c.readModel().agents[0]!.costs.listPriceUsd.total).toBe(5);
  expect(c.readModel().agents[0]!.tokens.input.total).toBe(12);
});

it('requires native session confirmation and retains only explicit provider model context', () => {
  const s = setup(), c = s.create(), ch = chat();
  c.patch(ch, { modelObserved: 'too-early' });
  expect(c.readModel().agents).toEqual([]);
  c.patch({ ...ch, sessionId: 'allocated' }, { sessionId: 'one', modelObserved: 'provider' });
  expect(c.origin(ch)).toMatchObject({ modelObserved: 'provider', sessionId: 'one', source: 'chat-provider-event' });
  c.patch(ch, { modelObserved: null });
  expect(c.origin(ch).modelObserved).toBeNull();
});

it('retains missing earlier usage and a prior explicit costKnown false', () => {
  const s = setup(), c = s.create();
  c.patch(chat(), { sessionId: 'one', costKnown: false });
  c.item(chat(), result('missing', 100), false);
  s.tick(110); c.item(chat(), result('next', 110), false);
  c.patch(chat(), { turnCostUsd: 0 });
  expect(c.readModel().agents[0]!.costs.listPriceUsd.total).toBeNull();
});

it('when full, evicts only the oldest row already rolled up into its ended run, never a live one', () => {
  const s = setup(), c = s.create();
  c.patch(chat(), { sessionId: 'one', turnCostUsd: 1 });
  c.rolledUp(chat('nope'));
  c.rolledUp(chat());
  c.rolledUp({ ...chat(), agent: { id: 'other', revision: 1, name: 'Other' } } as ChatSummary);
  const file = path.join(s.dir, 'agent-analytics.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.rows[0].rolledUp).toBe(true);
  const row = (key: string, rolledUp: boolean) => ({ ...saved.rows[0], observation: { ...saved.rows[0].observation, sessionKey: `claude:${key}`, provenance: { ...saved.rows[0].observation.provenance, sessionId: `claude:${key}` } }, ...(rolledUp ? { rolledUp } : { rolledUp: undefined }) });
  const fill = (rolled: number[]) => fs.writeFileSync(file, JSON.stringify({ version: 1, rows: Array.from({ length: 1000 }, (_, i) => row(`s${i}`, rolled.includes(i))) }));
  const sessions = (x: AgentAnalyticsCollector) => x.readModel().agents[0]!.sessions;

  fill([]);
  const none = s.create();
  none.patch(chat('new'), { sessionId: 'new', turnCostUsd: 1 });
  expect(sessions(none)).toBe(1000);
  expect(none.readModel().agents[0]!.evidence.some(e => e.sessionKey === 'claude:new')).toBe(false);

  fill([5, 7]);
  const live = s.create();
  live.patch(chat('s5'), { sessionId: 's5', state: 'running' }); // s5 is live again: not evictable
  live.patch(chat('new'), { sessionId: 'new', turnCostUsd: 1 });
  const keys = live.readModel().agents[0]!.evidence.map(e => e.sessionKey);
  expect(keys).toContain('claude:new');
  expect(keys).toContain('claude:s5');
  expect(keys).not.toContain('claude:s7');
  expect(sessions(live)).toBe(1000);

  fs.writeFileSync(file, JSON.stringify({ version: 1, rows: [{ ...saved.rows[0], rolledUp: 'yes' }] }));
  expect(() => s.create().readModel()).toThrow();
});
