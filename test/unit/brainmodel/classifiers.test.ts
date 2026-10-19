// The Classificatori page's data (src/main/brainmodel/classifiers.ts, ADR 0077), read-only: the routing table with the
// measured results of the chats each row routed (runs, verified success, average cost) from the improvement ledger, the
// table's change history, the agent suggested now versus the one used for recent runs, and the weekly quality per route
// and per agent-choice channel, where a week without runs has no value (null), never zero. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifiersState, readLedger, rowOf, weekOf } from '../../../src/main/brainmodel/classifiers';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import type { RoutingInfo, RoutingRow } from '../../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const NOW = Date.parse('2026-10-19T09:00:00Z'), DAY = 86400e3;
const row = (kind: RoutingRow['kind'], model: string, area?: string): RoutingRow => ({ kind, ...(area ? { area } : {}), harness: 'claude', model, effort: 'high', why: `perché ${kind}`, since: '2026-10-01', evidence: '' });
const routing = (routes: RoutingRow[]): RoutingInfo => ({ table: { version: 4, appliedAt: '2026-10-10T08:00:00Z', by: 'user', exploration: 0, costWeight: 7, routes }, registry: null, kinds: [], error: null,
  history: [{ at: '2026-10-10T08:00:00Z', from: 3, to: 4, by: 'user', reason: 'meno costi', evidence: '12 chat', stored: true }] });
const run = (chatId: string, at: number, verdict: 'success' | 'fail' | null, extra: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${chatId.padStart(12, '0')}`, chatId, agentId: 'default-writer', version: 1, goal: `Scrivi la mail ${chatId}`, startedBy: 'user', startedAt: at,
  counters: {} as AgentRun['counters'], costUsd: 0.5, tokens: null, ...(verdict ? { outcome: { verdict, basis: 'human' } as AgentRun['outcome'] } : {}), ...extra });
const profiles = [{ id: 'default-writer', name: 'Redattore' }, { id: 'default-general', name: 'Generale' }] as AgentProfile[];

function brain(lines: object[]): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-classifiers-')); dirs.push(d);
  fs.mkdirSync(path.join(d, 'ops/state/improve'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ops/state/improve/outcomes.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n{torn');
  return d;
}
const pred = (chat: string, at: number, kind: string, source = 'table') => ({ id: `app:${chat}`, at, domain: 'routing', item: { kind, area: 'Italia', harness: 'claude', model: 'm' }, predicted: { value: { source } } });
const actual = (chat: string, usd: number) => ({ id: `app:${chat}`, domain: 'routing', actual: { usd } });

describe('classifiers', () => {
  it('reads the ledger: one prediction per chat, the latest actual, only the app chats', () => {
    const d = brain([pred('c1', NOW, 'writing'), pred('c1', NOW + 1, 'code'), actual('c1', 0.2), actual('c1', 0.3), { id: 'ext:x', domain: 'routing', predicted: {}, item: { kind: 'x' } }]);
    const l = readLedger(d);
    expect(l.predictions.map(p => [p.id, p.kind])).toEqual([['app:c1', 'writing']]);
    expect(l.actuals.get('app:c1')).toEqual({ usd: 0.3 });
    expect(readLedger(null).predictions).toEqual([]);
  });
  it('matches a prediction to the first row of its kind and area, else the catch-all', () => {
    const routes = [row('writing', 'a', 'Prodotto'), row('writing', 'b'), row('*', 'c')];
    expect(rowOf(routes, { kind: 'writing', area: 'Prodotto' })).toBe(0);
    expect(rowOf(routes, { kind: 'writing', area: 'Italia' })).toBe(1);
    expect(rowOf(routes, { kind: 'code', area: 'Italia' })).toBe(2);
    expect(weekOf(Date.parse('2026-10-19T09:00:00Z'))).toBe('2026-W43');
  });
  it('measures each route, shows the history and the agent choices, and marks weeks without data', async () => {
    const d = brain([pred('c1', NOW - DAY, 'writing'), pred('c2', NOW - 2 * DAY, 'writing'), pred('c3', NOW - 3 * DAY, 'writing', 'override'), actual('c1', 0.4), actual('c2', 0.2)]);
    const runs = [
      run('c1', NOW - DAY, 'success', { routing: { mode: 'words', score: 72.4, rank: 1 } as AgentRun['routing'] }),
      run('c2', NOW - 2 * DAY, 'fail', { routing: { mode: 'hybrid', score: null, rank: null } as AgentRun['routing'] }),
    ];
    const s = await classifiersState({ root: d, routing: routing([row('writing', 'sonnet'), row('bug-fix', 'opus')]), runs, profiles, top: async goal => (goal.endsWith('c1') ? { id: 'default-general', score: 61.6 } : null) }, NOW);
    expect(s.routing).toMatchObject({ version: 4, by: 'user', error: null });
    expect(s.routing.routes[0]).toMatchObject({ kind: 'writing', model: 'sonnet', effort: 'high', why: 'perché writing', result: { runs: 2, success: { value: 0.5, n: 2 }, avgCostUsd: expect.closeTo(0.3) } });
    expect(s.routing.routes[1]!.result).toEqual({ runs: 0, success: { value: null, n: 0 }, avgCostUsd: null }); // no data yet
    expect(s.history).toEqual([{ at: '2026-10-10T08:00:00Z', from: 3, to: 4, by: 'user', reason: 'meno costi', evidence: '12 chat' }]);
    expect(s.choices.map(c => [c.chatId, c.suggested?.name ?? null, c.used.name, c.used.score, c.used.mode])).toEqual([['c1', 'Generale', 'Redattore', 72, 'words'], ['c2', null, 'Redattore', null, 'hybrid']]);
    const writing = s.quality.find(q => q.key === 'route:0')!;
    expect(writing.weeks).toHaveLength(6);
    expect(writing.weeks.at(-2)).toMatchObject({ week: '2026-W42', runs: 2, success: 0.5 }); // Sunday and Saturday
    expect(writing.weeks.at(-1)).toEqual({ week: '2026-W43', runs: 0, success: null, avgCostUsd: null }); // this Monday: no data yet
    expect(writing.weeks[0]).toEqual({ week: weekOf(NOW - 35 * DAY), runs: 0, success: null, avgCostUsd: null });
    expect(s.quality.map(q => q.key)).toEqual(['route:0', 'route:1', 'agent:words', 'agent:hybrid']);
  });
  it('no table and no ledger: empty, with the routing error passed through', async () => {
    const s = await classifiersState({ root: null, routing: { table: null, registry: null, kinds: [], error: 'manca la tabella', history: [] }, runs: [], profiles, top: async () => null }, NOW);
    expect(s.routing).toEqual({ version: null, appliedAt: null, by: null, routes: [], error: 'manca la tabella' });
    expect(s.choices).toEqual([]);
    expect(s.quality.every(q => q.weeks.every(w => w.success === null && w.runs === 0))).toBe(true);
  });
});
