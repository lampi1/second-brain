// The agent run store (A5): strict reading, the pure lifecycle steps, bounds that prune only ended runs, refused links.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRunStore, ROLLUP_BYTES, RUNS_MAX, STALE_MS, addTurn, endRun, fitRollups, readRun, readTally, reopenRun, staleDue, type RunStart } from '../../src/main/agents/runs';
import { SAMPLE_MAX, emptyTally } from '../../src/main/agents/run-metrics';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runs-')); roots.push(dir); return dir; };
const start = (o: Partial<RunStart> = {}): RunStart => ({ chatId: 'c1', agentId: 'reviewer', version: 2, goal: '  Rivedi  ', startedBy: 'user', startedAt: 1000, costKnown: true, ...o });

describe('agent run store', () => {
  it('starts, saves and reads back a run', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const run = s.start(start());
    expect(run).toMatchObject({ goal: 'Rivedi', costUsd: 0, tokens: { input: 0 }, counters: { reopened: 0, contextPeak: null } });
    expect(run.runId).toMatch(/^r_[a-f0-9]{12}$/);
    expect(new AgentRunStore(dir).get(run.runId)).toEqual(run);
    expect(s.start(start({ costKnown: false })).costUsd).toBeNull();
  });

  it('preserves launch snapshots and canonical evidence, and refuses a result for a different run', () => {
    const run = new AgentRunStore(tmp()).start(start());
    run.taskId = 't1'; run.taskVersion = 1;
    run.skillSuggestions = { at: 1, suggested: ['review'], used: ['review'] };
    run.report = { at: 2, outcome: 'done', verified: 'yes', summary: 'short', canonical: {
      at: 2, taskId: 't1', taskVersion: 1, runId: run.runId, outcome: 'done', summary: 'short', output: 'full answer',
      doneWhen: [{ criterion: 'checked', met: true, evidence: 'source.txt' }],
    } };
    expect(readRun(run)).toEqual(run);
    run.report.canonical!.runId = 'r_ffffffffffff';
    expect(readRun(run)).toBeNull();
  });

  it('never labels legacy aggregate silence proxies as verified', () => {
    const tally = emptyTally('coder', 1);
    delete tally.verdictSchema;
    tally.ended = 5; tally.verdicts.success = 5;
    const restored = readTally(tally)!;
    expect(restored.ended).toBe(5);
    expect(restored.verdicts.success).toBe(0);
    expect(restored.verdictSchema).toBe(2);
  });

  it('roundtrips delivery observations and rejects impossible or incomplete submission metadata', () => {
    const run = new AgentRunStore(tmp()).start(start());
    run.delivery = { policy: 'synthesize', reportedAt: 10, attempts: 2, deliveredAt: 20, synthesisBatchId: 'batch1', synthesisSubmittedAt: 20 };
    expect(readRun(run)?.delivery).toEqual(run.delivery);
    for (const bad of [{ attempts: -1 }, { deliveredAt: 9 }, { synthesisBatchId: undefined }, { policy: 'display' }]) {
      expect(readRun({ ...run, delivery: { ...run.delivery, ...bad } })).toBeNull();
    }
    delete run.delivery;
    expect(readRun(run)?.delivery).toBeUndefined();
  });

  it('refuses a malformed run field by field', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(readRun(run)).toEqual(run);
    for (const bad of [{ runId: 'x' }, { agentId: 'Bad Id' }, { version: -1 }, { startedBy: 'agent' }, { endedAt: 5 }, { endReason: 'done', endedAt: 5 },
      { counters: { ...run.counters, questions: 1.5 } }, { costUsd: -1 }, { tokens: { input: 1 } }, { outcome: { verdict: 'ok', basis: 'human', at: 1, by: 'user' } }])
      expect(readRun({ ...run, ...bad })).toBeNull();
  });

  it('a damaged file is kept, nothing is recorded and saving refuses', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json');
    fs.writeFileSync(file, '{"version":2,"runs":[]}');
    const s = new AgentRunStore(dir);
    expect(s.problem).toMatch(/non è leggibile/);
    expect(() => s.start(start())).toThrow(/non è leggibile/);
    expect(() => s.save()).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{"version":2,"runs":[]}');
  });

  it('the first end wins; a reopen clears the end and the verdict and counts', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(endRun(run, 'completed', 5)).toBe(true);
    expect(endRun(run, 'closed', 6)).toBe(false);
    expect(run).toMatchObject({ endedAt: 5, endReason: 'completed' });
    run.outcome = { verdict: 'success', basis: 'human', at: 5, by: 'user' };
    expect(reopenRun(run)).toBe(true);
    expect(run.endedAt ?? run.endReason ?? run.outcome).toBeUndefined();
    expect(run.counters.reopened).toBe(1);
    expect(reopenRun(run)).toBe(false);
  });

  it('stale only when idle long enough and nothing waits', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(staleDue(run, 0, false, STALE_MS)).toBe(true);
    expect(staleDue(run, 0, true, STALE_MS)).toBe(false);
    expect(staleDue(run, 1, false, STALE_MS)).toBe(false);
  });

  it('cost and tokens: null stays null, an ended run takes nothing', () => {
    const run = new AgentRunStore(tmp()).start(start());
    addTurn(run, 0.1, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    addTurn(run, 0.2, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    expect(run).toMatchObject({ costUsd: 0.3, tokens: { input: 2, output: 2 } });
    addTurn(run, null, undefined);
    addTurn(run, 1, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    expect(run).toMatchObject({ costUsd: null, tokens: null });
    const other = new AgentRunStore(tmp()).start(start());
    endRun(other, 'closed', 2);
    addTurn(other, 5, undefined);
    expect(other).toMatchObject({ costUsd: 0, tokens: { input: 0 } });
  });

  it('refuses unknown links and lists a parent’s open children', () => {
    const s = new AgentRunStore(tmp());
    const a = s.start(start());
    expect(() => s.start(start({ reworkOf: 'r_000000000000' }))).toThrow(/non trovata/);
    const k = s.start(start({ parentRunId: a.runId }));
    expect(k.parentRunId).toBe(a.runId);
    expect(s.children(a.runId)).toEqual([k]);
    endRun(k, 'closed', 3);
    expect(s.children(a.runId)).toEqual([]);
  });

  it('past the count it prunes only ended runs, oldest end first', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const open = s.start(start(), false);
    const ended = Array.from({ length: RUNS_MAX }, (_, i) => { const r = s.start(start({ startedAt: i }), false); endRun(r, 'closed', 10_000 - i); return r; });
    s.save();
    expect(s.list()).toHaveLength(RUNS_MAX);
    expect(s.get(open.runId)).toBe(open);
    expect(s.get(ended.at(-1)!.runId)).toBeUndefined(); // the oldest end (10000 - (MAX-1))
    expect(s.get(ended[0]!.runId)).toBeDefined();
    expect(new AgentRunStore(dir).list()).toHaveLength(RUNS_MAX);
  });

  it('a failed write stays pending: the next flush writes it', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json');
    const s = new AgentRunStore(dir);
    const run = s.start(start());
    fs.linkSync(file, path.join(dir, 'link.json')); // a linked file: the local store refuses to write it
    endRun(run, 'closed', 9);
    expect(() => s.save()).toThrow(/collegato/);
    fs.rmSync(path.join(dir, 'link.json'));
    s.flush();
    expect(new AgentRunStore(dir).get(run.runId)?.endReason).toBe('closed');
  });

  it('adopt takes back a lost run once', () => {
    const s = new AgentRunStore(tmp());
    const run = new AgentRunStore(tmp()).start(start());
    expect(s.adopt(run)).toBe(run);
    expect(s.adopt({ ...run })).toBe(run);
  });
});

describe('agent run store: A6 fields and rollups', () => {
  it('reads back the report, corrections, execution time and continuation, and refuses them out of shape', () => {
    const s = new AgentRunStore(tmp());
    const prev = s.start(start());
    const run = { ...s.start(start()), continuedFrom: prev.runId, report: { at: 5, outcome: 'done' as const, verified: 'yes' as const, summary: 'ok', findings: 2, blocking: 1 }, corrections: { tagged: 1, afterReport: 0 }, executionMs: 1500 };
    expect(run.executionMs).toBe(1500);
    expect(readRun(run)).toEqual(run);
    const { report: _r, ...bare } = run; void _r;
    expect(readRun({ ...run, report: { ok: false, at: 5 } })).toEqual(bare);
    for (const bad of [{ continuedFrom: 'x' }, { report: { at: 5, outcome: 'great', verified: 'yes', summary: 'ok' } }, { report: { ...run.report, summary: 'x'.repeat(141) } },
      { report: { ...run.report, blocking: 3 } }, { corrections: { tagged: -1, afterReport: 0 } }, { corrections: { tagged: 0 } }, { executionMs: -1 }, { executionMs: null }])
      expect(readRun({ ...run, ...bad })).toBeNull();
    const older: Record<string, unknown> = { ...run };
    delete older.corrections; delete older.executionMs; delete older.report; delete older.continuedFrom;
    expect(readRun(older)).toEqual(older); // runs recorded before these fields: unknown, not refused
  });

  it('a pruned run is folded into its rollup, which survives a reload; a review whose target stays is kept', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const target = s.start(start({ agentId: 'coder' }), false);
    endRun(target, 'completed', 100);
    const review = s.start(start({ agentId: 'reviewer', version: 3, reviewOf: target.runId }), false);
    review.report = { at: 2, outcome: 'done', verified: 'yes', summary: 's', findings: 4 };
    endRun(review, 'completed', 1); // the oldest end, but its target is kept: it stays with it
    const old = s.start(start({ agentId: 'coder', startedAt: 0 }), false);
    old.costUsd = 0.25;
    endRun(old, 'completed', 2);
    for (let i = 0; i < RUNS_MAX - 2; i++) endRun(s.start(start({ startedAt: 10 }), false), 'closed', 1000 + i);
    s.save();
    expect(s.get(old.runId)).toBeUndefined();
    expect(s.get(review.runId)).toBeDefined();
    const rolled = new AgentRunStore(dir).rolledUp();
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ agentId: 'coder', version: 2, ended: 1, cost: { n: 1, values: [0.25] }, corrections: { runs: 1, tagged: 0, afterReport: 0 } });
  });

  it('a pruned run is never adopted back from a chat mirror, and its mirror owner is told', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const pruned: string[][] = [];
    s.onPrune = ids => pruned.push([...ids]);
    const old = s.start(start({ agentId: 'coder' }), false);
    endRun(old, 'completed', 1);
    const mirror = structuredClone(old);
    for (let i = 0; i < RUNS_MAX; i++) endRun(s.start(start({ startedAt: 10 }), false), 'closed', 1000 + i);
    s.save();
    expect(pruned).toEqual([[old.runId]]);
    const again = new AgentRunStore(dir);
    expect(again.adopt(mirror)).toBeUndefined();
    expect(again.get(old.runId)).toBeUndefined();
    const lost = { ...structuredClone(old), runId: 'r_00000000beef', endedAt: 5000 };
    expect(again.adopt(lost)).toBe(lost); // ended after the pruned ones: a lost run, taken back
  });

  it('a target whose review is still open is not pruned first', () => {
    const s = new AgentRunStore(tmp());
    const target = s.start(start({ agentId: 'coder' }), false);
    endRun(target, 'completed', 1);
    s.start(start({ agentId: 'reviewer', reviewOf: target.runId }), false); // open
    const next = s.start(start({ agentId: 'coder' }), false);
    endRun(next, 'completed', 2);
    for (let i = 0; i < RUNS_MAX - 2; i++) endRun(s.start(start({ startedAt: 10 }), false), 'closed', 1000 + i);
    s.save();
    expect(s.get(target.runId)).toBeDefined();
    expect(s.get(next.runId)).toBeUndefined();
  });

  it('a pruned target takes its reviews along, their findings counted on it', () => {
    const s = new AgentRunStore(tmp());
    const target = s.start(start({ agentId: 'coder' }), false);
    endRun(target, 'completed', 1);
    const review = s.start(start({ agentId: 'reviewer', version: 3, reviewOf: target.runId }), false);
    review.report = { at: 2, outcome: 'done', verified: 'yes', summary: 's', findings: 4, blocking: 1 };
    endRun(review, 'completed', 5000);
    for (let i = 0; i < RUNS_MAX - 1; i++) endRun(s.start(start({ startedAt: 10 }), false), 'closed', 1000 + i);
    s.save();
    expect(s.get(target.runId)).toBeUndefined();
    expect(s.get(review.runId)).toBeUndefined();
    expect(s.list()).toHaveLength(RUNS_MAX - 1);
    const coder = s.rolledUp().find(t => t.agentId === 'coder')!;
    expect(coder.reviews).toEqual({ 'reviewer/3': { runs: 1, findings: 4, blockingRuns: 1, blocking: 1 } });
    expect(s.rolledUp().find(t => t.agentId === 'reviewer')).toMatchObject({ version: 3, ended: 1 });
  });

  it('refuses a rollup out of shape and two rollups of the same version', () => {
    const t = emptyTally('coder', 1);
    expect(readTally(t)).toEqual(t);
    for (const bad of [{ agentId: 'Bad' }, { version: -1 }, { verdicts: { success: 1 } }, { cost: { n: 0, values: [1] } }, { cost: { n: 1, values: [-1] } },
      { reviews: { 'reviewer/x': { runs: 1, findings: 0, blockingRuns: 0, blocking: 0 } } }, { reviews: { 'reviewer/1': { runs: 0, findings: 0, blockingRuns: 0, blocking: 0 } } }])
      expect(readTally({ ...t, ...bad })).toBeNull();
    const dir = tmp(), file = path.join(dir, 'agent-runs.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, runs: [], rollups: [t, t] }));
    expect(new AgentRunStore(dir).problem).toMatch(/non è leggibile/);
    fs.writeFileSync(file, JSON.stringify({ version: 1, runs: [], rollups: [t] }));
    expect(new AgentRunStore(dir).rolledUp()).toEqual([t]);
  });

  it('past their budget the largest rollup samples are halved, counts kept', () => {
    const big = Array.from({ length: 60 }, (_, i) => {
      const t = emptyTally(`agent-${i}`, 1);
      for (const s of [t.cost, t.contextPeak, t.elapsed, t.execution, ...Object.values(t.tokens)]) { s.n = 1000; s.values = Array.from({ length: SAMPLE_MAX }, (_, j) => 1_000_000 + j + 0.123456789); }
      return t;
    });
    const fit = fitRollups(big);
    expect(Buffer.byteLength(JSON.stringify(fit, null, 2), 'utf8')).toBeLessThanOrEqual(ROLLUP_BYTES);
    expect(fit.every(t => t.cost.n === 1000)).toBe(true);
    expect(fit.some(t => t.cost.values.length < SAMPLE_MAX)).toBe(true);
    expect(fit[0]!.cost.values.at(-1)).toBe(big[0]!.cost.values.at(-1)); // the newest stay
  });
});
