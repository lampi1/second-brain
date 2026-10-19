// Agent-first routing (ADR 0078, issues #70/#72): an agent's profile decides engine, model and effort and the table
// only fills a missing model; a row's reason is refreshed from the ledger's counts; an agent run's verdict becomes the
// known outcome of its chat's ledger line and survives the next measured line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentStatsLine, freshReason, knownOutcome, predictionLine, routeChat, Routing, statsLine, validRoute, type AgentChoice, type RouteRequest } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';
import type { RoutingRow, RoutingTable } from '../../../src/shared/contract';

const row = (p: Partial<RoutingRow>): RoutingRow => ({ kind: '*', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'w', since: '2026-10-13', evidence: 'e', ...p });
const table = (routes: RoutingRow[]): RoutingTable => ({ version: 4, appliedAt: null, by: null, exploration: 0.5, costWeight: 7, routes });
const base: RouteRequest = { title: 'Ordini · Fix totale', prompt: 'fix the bug', kind: 'bug-fix', ask: {}, defaults: { harness: 'claude', models: { claude: null, cursor: null }, effort: 'high' }, counts: () => new Map(), rnd: () => 0 };
const agent = (p: Partial<AgentChoice> = {}): AgentChoice => ({ id: 'agent-fix', name: 'Correzione bug', version: 3, harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', chosenBy: 'orchestrator', ...p });

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-first-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('agent first', () => {
  const t = table([row({ kind: 'bug-fix', model: 'claude-opus-5-5', effort: 'high', why: 'scelta di Davide, nessun dato ancora' })]);

  it('takes the profile as it is: no override, no exploration, no reason asked', () => {
    const r = routeChat({ ...base, agent: agent({ stats: '12 run, 9 con esito, 78% riuscite' }) }, t, REG, null);
    expect(r).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', route: { source: 'agent', version: null, agent: { id: 'agent-fix', version: 3, chosenBy: 'orchestrator', modelFrom: 'profile' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toContain('agente «Correzione bug» v3');
    expect(r.route.reason).toContain('78% riuscite');
    // a profile with max effort is the user's own choice: no reason needed
    expect(routeChat({ ...base, agent: agent({ effort: 'max' }) }, t, REG, null)).toMatchObject({ effort: 'max', route: { source: 'agent' } });
  });

  it('fills a missing model (and effort) from the row on the same engine only, as a default', () => {
    const r = routeChat({ ...base, agent: agent({ model: null, effort: null, chosenBy: 'classifier', score: 72, threshold: 60, mode: 'hybrid' }) }, t, REG, null);
    expect(r).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', route: { source: 'agent', version: 4, agent: { modelFrom: 'table', chosenBy: 'classifier', score: 72, threshold: 60, mode: 'hybrid' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toMatch(/punteggio 72\/60.*modello dalla tabella/);
    // the profile's own effort wins over the row's
    expect(routeChat({ ...base, agent: agent({ model: null, effort: 'low' }) }, t, REG, null)).toMatchObject({ model: 'claude-opus-5-5', effort: 'low' });
    // a row on another engine never changes the agent's engine: the engine's default model
    const cursorRow = table([row({ kind: 'bug-fix', harness: 'cursor', model: 'grok-4.7', effort: null })]);
    expect(routeChat({ ...base, agent: agent({ model: null, effort: null }) }, cursorRow, REG, null)).toMatchObject({ harness: 'claude', model: null, route: { agent: { modelFrom: 'engine' } } });
  });

  it('refuses a profile whose model belongs to another engine', () => {
    expect(routeChat({ ...base, agent: agent({ harness: 'cursor', model: 'claude-opus-5-5', effort: null }) }, t, REG, null)).toHaveProperty('error');
  });

  it('keeps the agent on the route read back from chats.json, and drops a malformed one', () => {
    const r = routeChat({ ...base, agent: agent() }, t, REG, null);
    if ('error' in r) throw new Error(r.error);
    expect(validRoute(JSON.parse(JSON.stringify(r.route)))).toEqual(r.route);
    expect(validRoute({ ...r.route, agent: { id: 'BAD ID', version: 1, chosenBy: 'orchestrator' } })).not.toHaveProperty('agent');
  });
});

describe('fresh reasons (#72)', () => {
  it('writes the counts and drops a stale "nessun dato ancora"', () => {
    expect(statsLine({ chats: 0, known: 0, ok: 0 })).toBeNull();
    expect(statsLine({ chats: 5, known: 0, ok: 0 })).toBe('5 chat, nessuna con esito');
    expect(statsLine({ chats: 16, known: 10, ok: 7 })).toBe('16 chat, 10 con esito, 70% riuscite');
    expect(freshReason('scelta di Davide, nessun dato ancora', { chats: 16, known: 10, ok: 7 })).toBe('scelta di Davide · 16 chat, 10 con esito, 70% riuscite');
    expect(freshReason('scelta di Davide, nessun dato ancora', { chats: 0, known: 0, ok: 0 })).toBe('scelta di Davide, nessun dato ancora');
    expect(agentStatsLine({ ended: 12, successRate: { value: 0.78, n: 9 } })).toBe('12 run, 9 con esito, 78% riuscite');
    expect(agentStatsLine({ ended: 0, successRate: { value: null, n: 0 } })).toBeNull();
  });

  it('routes a table chat with the refreshed reason', () => {
    const t = table([row({ kind: 'bug-fix', why: 'scelta di Davide, nessun dato ancora' })]);
    const r = routeChat({ ...base, counts: undefined, stats: () => ({ chats: 20, known: 12, ok: 9 }) }, t, REG, null);
    expect(r).toMatchObject({ route: { source: 'table', reason: 'scelta di Davide · 20 chat, 12 con esito, 75% riuscite' } });
  });
});

describe('verdicts in the ledger (#72)', () => {
  it('maps verdicts that count and skips the rest', () => {
    const run = (verdict: string, basis: string) => ({ runId: 'r1', outcome: { verdict, basis, at: 5 } });
    expect(knownOutcome(run('success', 'human'))).toEqual({ known: true, success: true, source: 'agent-user', runId: 'r1', at: 5 });
    expect(knownOutcome(run('partial', 'reviewed-evidence'))).toEqual({ known: true, success: false, partial: true, source: 'agent-review', runId: 'r1', at: 5 });
    expect(knownOutcome(run('fail', 'orchestrator-opinion'))).toMatchObject({ success: false, source: 'agent-orchestrator' });
    expect(knownOutcome(run('success', 'self-report'))).toBeNull();
    expect(knownOutcome(run('unknown', 'human'))).toBeNull();
    expect(knownOutcome({ runId: 'r2' })).toBeNull();
  });

  it('writes a known outcome with the last actuals, keeps it on later measured lines, and counts it per kind', () => {
    const root = tmp(), r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 1, source: 'agent' as const, reason: null, kind: 'bug-fix' as const, area: 'Ordini', at: 1 };
    const measured = (usd: number) => ({ id: 'app:c1', domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    r.observe(predictionLine(route, { id: 'app:c1', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(predictionLine({ ...route, kind: 'writing' }, { id: 'app:c2', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(measured(0.5));
    expect(r.kindStats('bug-fix')).toEqual({ chats: 1, known: 0, ok: 0 });
    r.observeOutcome('app:c1', knownOutcome({ runId: 'r1', outcome: { verdict: 'success', basis: 'human', at: 2 } })!);
    r.observe(measured(0.9));
    const lines = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { outcome?: { known: boolean }; actual?: { usd: number } });
    expect(lines.at(-2)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.5 } });
    expect(lines.at(-1)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.9 } });
    expect(r.kindStats('bug-fix')).toEqual({ chats: 1, known: 1, ok: 1 });
    // a new process reads the known outcome back from the file
    const again = new Routing(() => root);
    again.observe(measured(1.2));
    expect(again.kindStats('bug-fix')).toEqual({ chats: 1, known: 1, ok: 1 });
    expect(again.kindStats('writing')).toEqual({ chats: 1, known: 0, ok: 0 });
    expect(again.info().kindStats).toEqual({ 'bug-fix': { chats: 1, known: 1, ok: 1 }, writing: { chats: 1, known: 0, ok: 0 } });
  });
});
