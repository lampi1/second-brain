// The Classificatori section's data (src/main/brainmodel/classifiers.ts, ADR 0077; a section of Qualità since ADR
// 0210), read-only: per kind of work, the app's chats in the improvement ledger with their verified outcomes, and the
// grid's cards. The routing table, its history and its quality by route left with the table (ADR 0210): an old ledger
// line with a `source` still loads and is never counted by it. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifiersState, readLedger } from '../../../src/main/brainmodel/classifiers';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const NOW = Date.parse('2026-10-19T09:00:00Z'), DAY = 86400e3;
const run = (chatId: string, at: number, verdict: 'success' | 'fail' | null, extra: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${chatId.padStart(12, '0')}`, chatId, agentId: 'scribe', version: 1, goal: `Scrivi la mail ${chatId}`, startedBy: 'user', startedAt: at,
  counters: {} as AgentRun['counters'], costUsd: 0.5, tokens: null, ...(verdict ? { outcome: { verdict, basis: 'human' } as AgentRun['outcome'] } : {}), ...extra });
const profiles = [{ id: 'scribe', name: 'Scribe' }, { id: 'scout', name: 'Scout' }] as AgentProfile[];

function brain(lines: object[]): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-classifiers-')); dirs.push(d);
  fs.mkdirSync(path.join(d, 'ops/state/improve'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ops/state/improve/outcomes.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n{torn');
  return d;
}
const pred = (chat: string, at: number, kind: string, source = 'table') => ({ id: `app:${chat}`, at, domain: 'routing', item: { kind, area: 'Italia', harness: 'claude', model: 'm' }, predicted: { version: 4, value: { source } } });
const actual = (chat: string, usd: number) => ({ id: `app:${chat}`, domain: 'routing', actual: { usd } });

describe('classifiers', () => {
  it('reads the ledger: one prediction per chat, the latest actual, only the app chats', () => {
    const d = brain([pred('c1', NOW, 'writing'), pred('c1', NOW + 1, 'code'), actual('c1', 0.2), actual('c1', 0.3), { id: 'ext:x', domain: 'routing', predicted: {}, item: { kind: 'x' } }]);
    const l = readLedger(d);
    expect(l.predictions).toEqual([{ id: 'app:c1', at: NOW, kind: 'writing' }]);
    expect(l.actuals.get('app:c1')).toEqual({ usd: 0.3 });
    expect(readLedger(null).predictions).toEqual([]);
  });

  it('counts each kind\'s chats and verified outcomes; an old table line loads like any other', async () => {
    const d = brain([pred('c1', NOW - DAY, 'writing'), pred('c2', NOW - 2 * DAY, 'writing'), pred('c3', NOW - 3 * DAY, 'writing', 'override'), pred('c5', NOW - DAY, 'bug-fix', 'explore'), actual('c1', 0.4), actual('c2', 0.2)]);
    const runs = [run('c1', NOW - DAY, 'success'), run('c2', NOW - 2 * DAY, 'fail'), run('c4', NOW - 2 * DAY, 'fail')];
    const s = await classifiersState({ root: d, runs, profiles }, NOW);
    expect(s.kinds).toEqual([{ kind: 'writing', chats: 3, known: 2, ok: 1 }, { kind: 'bug-fix', chats: 1, known: 0, ok: 0 }]); // verified outcomes only (ADR 0186)
    expect(s.cards?.map(c => c.id)).toEqual(['kind', 'jobkind']);
    expect(s).not.toHaveProperty('routing');
    expect(s).not.toHaveProperty('history');
    expect(s).not.toHaveProperty('quality');
    expect(s).not.toHaveProperty('sources');
  });

  it('no ledger: empty, never a crash; a failing kind model leaves its card out', async () => {
    const s = await classifiersState({ root: null, runs: [], profiles, jobs: () => { throw new Error('torn'); }, kindModel: () => Promise.reject(new Error('x')) }, NOW);
    expect(s.kinds).toEqual([]);
    expect(s.kindModel).toBeUndefined();
    expect(s.cards?.length).toBe(2);
  });
});
