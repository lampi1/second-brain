// The Classificatori grid's numbers (src/main/brainmodel/classifier-cards.ts) and the inputs classifiers.ts reads for
// them: per card the decisions, its hit measure, the verified success (the user's or a review's verdict, else the
// ledger's known outcome; never a self-report), the average cost, 8 ISO weeks, the slices with their most frequent
// role, and success when it hit versus missed. A missing value is null, never zero. Temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifierCards, isoWeek, lastIsoWeeks, type CardInputs } from '../../../src/main/brainmodel/classifier-cards';
import { classifiersState, readJobs, readLedger } from '../../../src/main/brainmodel/classifiers';
import type { AgentRun } from '../../../src/shared/agents';
import type { RoutingInfo } from '../../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cls-cards-')); dirs.push(d); return d; };
const NOW = Date.parse('2026-10-19T09:00:00Z'), DAY = 86400e3;
const run = (chatId: string, agentId: string, verdict: 'success' | 'fail' | null, basis: 'human' | 'self-report' = 'human', extra: Partial<AgentRun> = {}): AgentRun => ({
  runId: `r-${chatId}`, chatId, agentId, version: 1, goal: `goal ${chatId}`, startedBy: 'orchestrator', startedAt: NOW - DAY,
  counters: {} as AgentRun['counters'], costUsd: 1, tokens: null, ...(verdict ? { outcome: { verdict, basis, at: NOW, by: 'u' } } : {}), ...extra,
});
const base = (o: Partial<CardInputs> = {}): CardInputs => ({ now: NOW, predictions: [], actuals: new Map(), outcomes: new Map(), runs: [], launches: [], jobs: [], skillThreshold: 60, ...o });

describe('classifier cards', () => {
  it('has four cards with no data: nulls, never zeros, and 8 empty weeks', () => {
    const cards = classifierCards(base());
    expect(cards.map(c => c.id)).toEqual(['kind', 'model', 'skills', 'jobkind']);
    for (const c of cards) {
      expect(c).toMatchObject({ decisions: 0, hit: { value: null, n: 0 }, success: { value: null, n: 0 }, avgCostUsd: null, compare: null, lastAt: null, slices: [] });
      expect(c.weeks).toHaveLength(8);
    }
    expect(cards[2]!.threshold).toBe(60);
    expect(lastIsoWeeks(NOW).at(-1)).toBe(isoWeek(NOW));
  });

  it('measures the kind and model cards from the ledger, the runs and the known outcomes', () => {
    const p = (id: string, kind: string, model: string, source: string, at = NOW - DAY) => ({ id: `app:${id}`, at, kind, model, source });
    const cards = classifierCards(base({
      predictions: [p('a', 'bug-fix', 'opus', 'agent'), p('b', 'bug-fix', 'opus', 'table'), p('c', 'bug-fix', 'sonnet', 'agent'), p('d', 'altro', 'sonnet', 'table', NOW - 20 * DAY)],
      actuals: new Map([['app:a', { usd: 2 }], ['app:b', { usd: 4 }], ['app:d', { usd: 1 }]]),
      outcomes: new Map([['app:c', false], ['app:d', true]]),
      runs: [run('a', 'artisan', 'success'), run('b', 'artisan', 'success', 'self-report'), run('c', 'scout', null)],
    }));
    const kind = cards[0]!, model = cards[1]!;
    expect(kind.decisions).toBe(4);
    expect(kind.hit).toEqual({ value: 0.75, n: 4 });
    // a: run verdict (human) ok; b: self-report does not count; c: ledger known false; d: ledger known true
    expect(kind.success).toEqual({ value: 2 / 3, n: 3 });
    expect(kind.avgCostUsd).toBeCloseTo(7 / 3);
    expect(kind.slices[0]).toMatchObject({ key: 'bug-fix', count: 3, known: 2, ok: 1, top: { key: 'artisan', count: 2 } });
    expect(kind.compare).toEqual({ hit: { value: 0.5, n: 2 }, miss: { value: 1, n: 1 } });
    expect(kind.weeks.at(-1)!.decisions + kind.weeks.at(-2)!.decisions).toBeGreaterThanOrEqual(3);
    expect(kind.lastAt).toBe(NOW - DAY);
    expect(model.hit).toEqual({ value: 0.5, n: 4 }); // decided by the table: b and d
    expect(model.slices.map(s => [s.key, s.count])).toEqual([['opus', 2], ['sonnet', 2]]);
  });

  it('scores the skill launches against the suggestions and the cost-ledger kinds', () => {
    const cards = classifierCards(base({
      launches: [
        { at: NOW - DAY, chatId: 'x', agentId: 'scribe', suggested: ['mail', 'tone'], used: ['mail'] },
        { at: NOW - DAY, chatId: 'y', agentId: 'scribe', suggested: ['mail'], used: ['tone'] },
        { at: NOW - DAY, chatId: 'z', agentId: 'scout', suggested: [], used: [] },
      ],
      runs: [run('x', 'scribe', 'success'), run('y', 'scribe', 'fail')],
      jobs: [{ at: NOW - DAY, kind: 'fix', usd: 2 }, { at: NOW - DAY, kind: 'question', usd: 0.2 }, { at: NOW - DAY, kind: 'other', usd: null }],
    }));
    const skills = cards[2]!, job = cards[3]!;
    expect(skills.hit).toEqual({ value: 1 / 3, n: 3 }); // nothing suggested is never a hit
    expect(skills.success).toEqual({ value: 0.5, n: 2 });
    expect(skills.compare).toEqual({ hit: { value: 1, n: 1 }, miss: { value: 0, n: 1 } });
    expect(job.hit).toEqual({ value: 2 / 3, n: 3 });
    expect(job.avgCostUsd).toBeCloseTo(1.1);
    expect(job.success).toEqual({ value: null, n: 0 });
  });
});

describe('the cards’ inputs', () => {
  it('reads the job ledger (last line of an id wins, torn lines skipped) and the ledger’s known outcomes', () => {
    const d = tmp(), f = path.join(d, 'jobs.jsonl');
    fs.writeFileSync(f, [{ id: 'j1', at: 1, kind: 'fix', actual: null }, { id: 'j1', at: 1, kind: 'fix', actual: { usd: 0.5 } }, { id: 'j2', at: 2, kind: 'qa', actual: { usd: 1 } }].map(x => JSON.stringify(x)).join('\n') + '\n{torn');
    expect(readJobs(f)).toEqual([{ at: 1, kind: 'fix', usd: 0.5 }, { at: 2, kind: 'qa', usd: 1 }]);
    expect(readJobs(path.join(d, 'missing.jsonl'))).toEqual([]);
    fs.mkdirSync(path.join(d, 'ops/state/improve'), { recursive: true });
    fs.writeFileSync(path.join(d, 'ops/state/improve/outcomes.jsonl'), [
      { id: 'app:a', domain: 'routing', outcome: { known: true, success: true } },
      { id: 'app:b', domain: 'routing', outcome: { known: true, success: false } },
      { id: 'app:b', domain: 'routing', outcome: { known: false, source: 'measured' } },
    ].map(x => JSON.stringify(x)).join('\n'));
    expect([...readLedger(d).outcomes]).toEqual([['app:a', true]]);
  });

  it('puts the cards in the Classificatori state', async () => {
    const routing: RoutingInfo = { table: null, registry: null, kinds: [], error: null, history: [] };
    const s = await classifiersState({ root: null, routing, runs: [], profiles: [], suggest: async () => [], jobs: () => [{ at: NOW, kind: 'fix', usd: 1 }] }, NOW);
    expect(s.cards?.map(c => [c.id, c.decisions])).toEqual([['kind', 0], ['model', 0], ['skills', 0], ['jobkind', 1]]);
    const broken = await classifiersState({ root: null, routing, runs: [], profiles: [], suggest: async () => [], jobs: () => { throw new Error('x'); } }, NOW);
    expect(broken.cards?.[3]!.decisions).toBe(0);
  });
});
