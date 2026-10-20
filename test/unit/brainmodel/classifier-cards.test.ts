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
      outcomes: new Map([['app:c', { success: false, verified: true, source: 'human' }], ['app:d', { success: true, verified: true, source: 'agent-user' }]]),
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
      { id: 'app:b', domain: 'routing', outcome: { known: false, source: 'measured' } }, // a measured line never undoes it
      { id: 'app:c', domain: 'routing', outcome: { known: true, success: true, source: 'proxy' } },
      { id: 'app:c', domain: 'routing', outcome: { known: false, source: 'expired' } }, // an explicit retraction does
    ].map(x => JSON.stringify(x)).join('\n'));
    expect([...readLedger(d).outcomes]).toEqual([['app:a', { success: true, verified: false, source: '' }], ['app:b', { success: false, verified: false, source: '' }]]);
  });

  it('puts the cards in the Classificatori state', async () => {
    const routing: RoutingInfo = { table: null, registry: null, kinds: [], error: null, history: [] };
    const s = await classifiersState({ root: null, routing, runs: [], profiles: [], suggest: async () => [], jobs: () => [{ at: NOW, kind: 'fix', usd: 1 }] }, NOW);
    expect(s.cards?.map(c => [c.id, c.decisions])).toEqual([['kind', 0], ['model', 0], ['skills', 0], ['jobkind', 1]]);
    const broken = await classifiersState({ root: null, routing, runs: [], profiles: [], suggest: async () => [], jobs: () => { throw new Error('x'); } }, NOW);
    expect(broken.cards?.[3]!.decisions).toBe(0);
  });
});

// Issue #110: a brain whose ledger holds the outcomes (the brain's settlement: human and proxy) while agent-runs.json
// restarted after a reinstall. Shaped like the real file: predictions, measured lines at every turn end (some written
// after the brain's verdict with a stale `known: false`), settlement lines with and without `known`/`domain`, the
// app's own verdicts, a sub-agent line and a torn line.
describe('the ledger’s outcomes reach the cards (issue #110)', () => {
  const at = NOW - 2 * DAY;
  const pred = (c: string, kind: string, source = 'agent', model = 'claude-opus-5-5') => ({ id: `app:${c}`, at, domain: 'routing', item: { harness: 'claude', model, effort: 'high', area: 'App', kind, promptChars: 300 }, predicted: { policy: 'routing', version: 7, value: { harness: 'claude', model, effort: 'high', source, reason: null } }, ts: at });
  const measured = (c: string, usd: number) => ({ id: `app:${c}`, domain: 'routing', actual: { usd, minutes: 4, turns: 3, ctxPeak: 80000, handoffs: 0 }, outcome: { known: false, source: 'measured' }, ts: at + 3600e3 });
  const settled = (c: string, source: string, success = true, extra: object = {}) => ({ id: `app:${c}`, domain: 'routing', outcome: { known: true, success, source, work: `chat:app:${c}` }, ts: at + 86400e3, ...extra });
  function ledger(): string {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'ops/state/improve'), { recursive: true });
    const lines: object[] = [
      { id: 'est:1', domain: 'estimates', predicted: { minutes: 3 } },
      pred('h1', 'bug-fix'), measured('h1', 1.2), settled('h1', 'human'), measured('h1', 1.5), // stale measured line after the verdict
      pred('h2', 'bug-fix', 'table'), measured('h2', 0.8), settled('h2', 'human', false),
      pred('h3', 'writing'), measured('h3', 0.3), { id: 'app:h3', outcome: { success: true, source: 'human' } }, // no `known`, no domain
      pred('p1', 'bug-fix'), measured('p1', 0.4), settled('p1', 'proxy'),
      pred('p2', 'writing', 'table', 'claude-sonnet-5-5'), measured('p2', 0.2), settled('p2', 'proxy'),
      pred('p3', 'writing'), settled('p3', 'human'), settled('p3', 'proxy'), // the proxy never demotes a human verdict
      pred('o1', 'review'), measured('o1', 0.6), settled('o1', 'agent-orchestrator'),
      pred('j1', 'review'), settled('j1', 'judge', false),
      pred('both', 'bug-fix'), settled('both', 'agent-user'), // the same verdict as its agent run: counted once
      pred('none', 'bug-fix'), measured('none', 0.1),
      { id: 'sub:abc', domain: 'routing', outcome: { known: true, success: true, source: 'proxy' } },
    ];
    fs.writeFileSync(path.join(d, 'ops/state/improve/outcomes.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n{"id":"app:h1","dom');
    return d;
  }
  const routing: RoutingInfo = { table: { version: 7, appliedAt: '2026-10-10T08:00:00Z', by: 'user', exploration: 0, costWeight: 7, routes: [
    { kind: 'bug-fix', harness: 'claude', model: 'claude-opus-5-5', effort: 'high', why: 'x', since: '2026-10-01', evidence: '' },
    { kind: '*', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', why: 'y', since: '2026-10-01', evidence: '' },
  ] }, registry: null, kinds: [], error: null, history: [] };

  it('folds the ledger: verified human and judge, unverified proxy and opinion, measured lines change nothing', () => {
    const o = readLedger(ledger()).outcomes;
    expect(Object.fromEntries([...o].map(([k, v]) => [k, [v.success, v.verified, v.source]]))).toEqual({
      'app:h1': [true, true, 'human'], 'app:h2': [false, true, 'human'], 'app:h3': [true, true, 'human'],
      'app:p1': [true, false, 'proxy'], 'app:p2': [true, false, 'proxy'], 'app:p3': [true, true, 'human'],
      'app:o1': [true, false, 'agent-orchestrator'], 'app:j1': [false, true, 'judge'], 'app:both': [true, true, 'agent-user'],
    });
  });

  it('counts the ledger’s verified outcomes with no agent runs, keeps the proxy apart, and never counts a chat twice', async () => {
    const root = ledger();
    // the reinstall left agent-runs.json with one run, the same chat the ledger already settled
    const runs = [run('both', 'artisan', 'success', 'human', { tags: { skills: ['fix'], app: null, repo: null } })];
    const s = await classifiersState({ root, routing, runs, profiles: [], suggest: async () => ['fix'] }, NOW);
    const kind = s.cards!.find(c => c.id === 'kind')!, model = s.cards!.find(c => c.id === 'model')!, skills = s.cards!.find(c => c.id === 'skills')!;
    // verified: h1 h2 h3 p3 j1 both = 6 (4 succeeded); unverified: p1 p2 o1 = 3; none has no outcome
    expect(kind.decisions).toBe(10);
    expect(kind.success).toEqual({ value: 4 / 6, n: 6 });
    expect(kind.unverified).toEqual({ value: 1, n: 3 });
    expect(model.success.n).toBe(6);
    expect(kind.slices.find(x => x.key === 'bug-fix')).toMatchObject({ count: 5, known: 3, ok: 2 });
    expect(skills.success).toEqual({ value: 1, n: 1 });
    // the table's rows: only the table's predictions (h2, p2); h2 verified failed, p2 only a proxy
    expect(s.routing.routes[0]!.result).toMatchObject({ runs: 1, success: { value: 0, n: 1 } });
    expect(s.routing.routes[1]!.result).toMatchObject({ runs: 1, success: { value: null, n: 0 } });
  });

  it('a run’s verified verdict wins over the ledger’s for the same chat', () => {
    const cards = classifierCards(base({
      predictions: [{ id: 'app:x', at: NOW - DAY, kind: 'bug-fix', model: 'm', source: 'agent' }],
      outcomes: new Map([['app:x', { success: true, verified: true, source: 'human' }]]),
      runs: [run('x', 'artisan', 'fail')],
    }));
    expect(cards[0]!.success).toEqual({ value: 0, n: 1 });
    expect(cards[0]!.unverified).toEqual({ value: null, n: 0 });
  });
});
