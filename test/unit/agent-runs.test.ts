// The agent run store (A5): strict record reading with partial recovery, the pure lifecycle steps, bounds that prune only ended runs, refused links.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRunStore, ROLLUP_BYTES, RUNS_MAX, STALE_MS, addTurn, endRun, fitRollups, readRun, readTally, reopenRun, staleDue, type RunStart } from '../../src/main/agents/runs';
import { ONE_SHOT_PURPOSES } from '../../src/shared/agents';
import { log } from '../../src/main/log';
import { SAMPLE_MAX, emptyTally } from '../../src/main/agents/run-metrics';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
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

  it('counts actual settled turns only and preserves legacy unknown turn coverage', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(run.turns).toBe(0);
    addTurn(run, null, undefined); addTurn(run, null, undefined);
    expect(readRun(run)?.turns).toBe(2);
    endRun(run, 'completed', 20); addTurn(run, null, undefined);
    expect(run.turns).toBe(2);
    expect(readRun({ ...run, turns: -1 })).toBeNull();
    delete run.turns;
    expect(readRun(run)?.turns).toBeUndefined();
  });

  it('persists explicit notify and pending synthesis policy without inventing an acknowledgment', () => {
    const run = new AgentRunStore(tmp()).start(start());
    run.delivery = { policy: 'notify', reportedAt: 10, attempts: 0 };
    expect(readRun(run)?.delivery).toEqual(run.delivery);
    run.delivery = { policy: 'synthesize', reportedAt: 10, attempts: 0, synthesisRequestedAt: 12, synthesisPending: true };
    expect(readRun(run)?.delivery).toEqual(run.delivery);
    expect(readRun({ ...run, delivery: { ...run.delivery, synthesisRequestedAt: 9 } })).toBeNull();
  });

  it('preserves exact brain/project scope and refuses relative or malformed scope', () => {
    const run = new AgentRunStore(tmp()).start(start());
    run.scope = { brainRoot: tmp(), projectRoot: tmp() };
    run.taskContract = { goal: 'Replay', doneWhen: ['Check'], reportExpected: true, deliveryPolicy: 'display' };
    expect(readRun(run)).toEqual(run);
    expect(readRun({ ...run, scope: { ...run.scope, projectRoot: '../outside' } })).toBeNull();
    expect(readRun({ ...run, taskContract: { ...run.taskContract, deliveryPolicy: 'invalid' } })).toBeNull();
    expect(readRun({ ...run, taskContract: { ...run.taskContract, reportExpected: 'true' } })).toBeNull();
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

  it.each(ONE_SHOT_PURPOSES)('roundtrips the %s one-shot purpose through the run reader and store', job => {
    const dir = tmp(), s = new AgentRunStore(dir), run = s.start(start());
    run.source = 'oneshot';
    run.oneshot = { engine: 'claude', job, fallback: false, costBasis: 'reported' };
    expect(readRun(run)).toEqual(run);
    s.save();
    const restored = new AgentRunStore(dir);
    expect(restored.problem).toBeNull();
    expect(restored.get(run.runId)).toEqual(run);
    expect(readRun({ ...run, oneshot: { ...run.oneshot, job: 'future-job' } })).toBeNull();
  });

  it('recovers valid runs around malformed and duplicate records, logs once, and keeps recording', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json'), seed = new AgentRunStore(dir);
    const first = seed.start(start()), last = seed.start(start({ chatId: 'c2' }));
    const tally = emptyTally('reviewer', 1);
    const stored = { version: 1, runs: [null, first, { ...first, goal: 'duplicate' },
      { ...first, runId: 'r_ffffffffffff', oneshot: { engine: 'claude', job: 'future-job', fallback: false, costBasis: 'unknown' } },
      { ...last, tokens: { input: -1 } }, last, 42], rollups: [tally], prunedThrough: 500 };
    fs.writeFileSync(file, JSON.stringify(stored));
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const recovered = new AgentRunStore(dir);
    expect(recovered.problem).toBeNull();
    expect(recovered.list()).toEqual([first, last]);
    expect(recovered.rolledUp()).toEqual([tally]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('agents', 'invalid agent run records skipped', {
      data: { skipped: 5, kept: 2 }, hint: expect.any(String),
    });
    // Loading alone never writes; the next normal flush persists the repair once.
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(stored);
    recovered.flush();
    const copies = fs.readdirSync(dir).filter(name => name.startsWith('agent-runs-recovery-'));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, copies[0]!), 'utf8')).toBe(JSON.stringify(stored));
    expect(new AgentRunStore(dir).list()).toEqual([first, last]);
    expect(warn).toHaveBeenCalledTimes(1);
    const next = recovered.start(start({ chatId: 'c3', startedBy: 'orchestrator' }));
    const reloaded = new AgentRunStore(dir);
    expect(reloaded.list()).toEqual([first, last, next]);
    expect(reloaded.rolledUp()).toEqual([tally]);
    expect(fs.readdirSync(dir).filter(name => name.startsWith('agent-runs-recovery-'))).toEqual(copies);
    expect(reloaded.adopt({ ...first, runId: 'r_eeeeeeeeeeee', endedAt: 500, endReason: 'closed' })).toBeUndefined();
  });

  it('does not replace malformed source when preserving its original bytes fails', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json'), source = '{"version":1,"runs":[null]}';
    fs.writeFileSync(file, source);
    const recovered = new AgentRunStore(dir), open = fs.openSync;
    const spy = vi.spyOn(fs, 'openSync').mockImplementation(((filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (String(filePath).includes('agent-runs-recovery-')) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return open(filePath, flags, mode);
    }) as typeof fs.openSync);
    expect(() => recovered.flush()).toThrow('Denied');
    expect(fs.readFileSync(file, 'utf8')).toBe(source);
    spy.mockRestore(); recovered.flush();
    expect(new AgentRunStore(dir).problem).toBeNull();
  });

  it('an all-invalid run list still permits new runs', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'agent-runs.json'), JSON.stringify({ version: 1, runs: [null, {}] }));
    const recovered = new AgentRunStore(dir);
    expect(recovered.problem).toBeNull();
    expect(recovered.list()).toEqual([]);
    const run = recovered.start(start());
    expect(new AgentRunStore(dir).get(run.runId)).toEqual(run);
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

  it('reads an older rollup with the dropped counters and leaves them out (ADR 0182)', () => {
    const t = emptyTally('coder', 1);
    const old = { ...t, permissions: 4, contextPeak: { n: 1, values: [10] }, aiErrors: { runs: 2, lines: 1 } };
    expect(readTally(old)).toEqual(t);
    expect(readTally({ ...t, aiErrors: { runs: -1, lines: 0 } })).toBeNull();
  });

  it('past their budget the largest rollup samples are halved, counts kept', () => {
    const big = Array.from({ length: 60 }, (_, i) => {
      const t = emptyTally(`agent-${i}`, 1);
      for (const s of [t.cost, t.elapsed, t.execution, ...Object.values(t.tokens)]) { s.n = 1000; s.values = Array.from({ length: SAMPLE_MAX }, (_, j) => 1_000_000 + j + 0.123456789); }
      return t;
    });
    const fit = fitRollups(big);
    expect(Buffer.byteLength(JSON.stringify(fit, null, 2), 'utf8')).toBeLessThanOrEqual(ROLLUP_BYTES);
    expect(fit.every(t => t.cost.n === 1000)).toBe(true);
    expect(fit.some(t => t.cost.values.length < SAMPLE_MAX)).toBe(true);
    expect(fit[0]!.cost.values.at(-1)).toBe(big[0]!.cost.values.at(-1)); // the newest stay
  });
});

describe('Flash outcomes and plan records in the run store (ADR 0131)', () => {
  it('keeps Flash\'s answer outcomes across a restart; a flash block out of shape never refuses the file', () => {
    const dir = tmp(), s = new AgentRunStore(dir);
    s.start(start());
    s.flashEvent({ kind: 'asked', text: 'quanto costa il piano Pro di Claude?', at: 1000 });
    s.flashEvent({ kind: 'answered', at: 2000 });
    s.flashEvent({ kind: 'asked', text: 'no, è sbagliato', at: 3000 });
    s.flush();
    const again = new AgentRunStore(dir);
    expect(again.problem).toBeNull();
    expect(again.flashLog().done).toEqual([{ at: 3000, verdict: 'fail', why: 'corrected' }]);
    const file = path.join(dir, 'agent-runs.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(JSON.stringify(raw.flash)).not.toContain('piano');
    fs.writeFileSync(file, JSON.stringify({ ...raw, flash: { version: 1, open: 'x', done: [{ at: 'no' }] } }));
    const lenient = new AgentRunStore(dir);
    expect(lenient.problem).toBeNull();
    expect(lenient.list()).toHaveLength(1);
    expect(lenient.flashLog().done).toEqual([]);
  });
  it('reads a run\'s plan record, dropping one out of shape without refusing the run', () => {
    const run = new AgentRunStore(tmp()).start(start());
    run.plan = { proposals: 2, changes: 1, approvedAt: 5000 };
    expect(readRun(run)!.plan).toEqual({ proposals: 2, changes: 1, approvedAt: 5000 });
    expect(readRun({ ...run, plan: { proposals: -1, changes: 0 } })).not.toBeNull();
    expect(readRun({ ...run, plan: { proposals: -1, changes: 0 } })!.plan).toBeUndefined();
  });
});
