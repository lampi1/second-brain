// The app's sampled independent reviews (src/main/agents/judge-sample.ts, ADR 0083; a Sentinel runs them since ADR
// 0100): which finished runs are picked (reported, recent, unjudged, not a review itself, not reviewed yet), the switch
// (on since a moment: no backlog) and the cap on reviews running at once, what the switch costs a day, the contract the reviewer gets, and the review's verdict turned into the run's
// feedback (none without a verdict; a Judge review started before ADR 0100 still counts).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRun, AgentRunReceipts } from '../../../src/shared/agents';
import type { AgentFeedbackArgs } from '../../../src/shared/agent-lifecycle';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import { AUDIT_EVERY, auditPicked, gradeReceipt, JudgeSampler, judgeSamplingOn, judgingEstimate, MAX_RUNNING, pickAudits, pickReceiptAudits, pickSamples, RECEIPTS_WAIT_MS, reviewPrompt, REVIEW_CRITERIA } from '../../../src/main/agents/judge-sample';
import { emptyReceipts, noteTool, noteTurnFiles, receiptVerdict } from '../../../src/main/agents/receipts';

const NOW = Date.UTC(2026, 9, 19, 12);
const run = (id: string, over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${id.padStart(12, '0')}`, chatId: `c_${id}`, agentId: 'scout', version: 1, goal: 'Trova gli errori',
  startedBy: 'user', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed', counters: {} as AgentRun['counters'], costUsd: 0.1, tokens: null,
  report: { at: NOW - 3600_000, outcome: 'done', verified: 'yes', summary: 'Trovati 3 errori' }, model: 'opus', ...over });
const chat = (id: string): ChatSummary => ({ id, harness: 'claude', origin: 'app', title: `Chat ${id}`, cwd: '/w', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: 'Ecco i 3 errori: a, b, c', updatedAt: 1, browserTabIds: [] });

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('pickSamples', () => {
  it('takes reported, recent, unjudged runs that no review covered, at most n', () => {
    const runs = [
      run('1'), run('2'),
      run('3', { endedAt: undefined }),                                                      // still running
      run('4', { endReason: 'stale' }),                                                      // no result
      run('5', { endedAt: NOW - 8 * 86_400_000 }),                                           // too old
      run('6', { agentId: 'judge' }),                                                        // a retired Judge's own
      run('14', { agentId: 'sentinel', reviewOf: 'r_000000000099' }),                        // a review itself
      run('7', { outcome: { verdict: 'success', basis: 'human', by: 'user', at: 1 } }),      // the user judged it
      run('8', { outcome: { verdict: 'success', basis: 'orchestrator-opinion', by: 'p', at: 1 } }), // its parent did
      run('9', { report: undefined }),
      run('10'), run('11', { reviewOf: 'r_000000000010', agentId: 'judge' }),                // reviewed already
      run('13', { parentRunId: 'r_000000000099' }),                                          // a delegated child's: its parent's content
    ];
    const picked = pickSamples(runs, new Set(['r_000000000002']), NOW, 5).map(r => r.runId);
    expect(picked).toEqual(['r_000000000001']);
    expect(pickSamples(runs, new Set(), NOW, 0)).toEqual([]);
    expect(pickSamples([run('1'), run('2'), run('12')], new Set(), NOW, 2)).toHaveLength(2);
  });
  it('gives the reviewer a self-contained contract with the goal, the report, the answer and how to answer', () => {
    const p = reviewPrompt(run('1'), chat('c_1'));
    expect(p).toContain('finished run of Scout «Chat c_1»');
    expect(p).toContain('Goal of that run: Trova gli errori');
    expect(p).toContain('Trovati 3 errori');
    expect(p).not.toContain('Ecco i 3 errori');
    expect(p).toContain('unavailable: legacy run');
    const r = run('1');
    r.taskId = 'task-1'; r.taskVersion = 2;
    r.report!.canonical = { taskId: 'task-1', taskVersion: 2, runId: r.runId, at: NOW, outcome: 'done', summary: 'short', output: 'long'.repeat(3000) + 'FINAL EVIDENCE', doneWhen: [{ criterion: 'check', met: true, evidence: 'source.txt' }] };
    const full = reviewPrompt(r, chat('c_1'));
    expect(full).toContain(r.report!.canonical.output);
    expect(full).toContain('source.txt');
    expect(full).toContain('task version: 2');
    expect(p).toContain('"verdict":"success|partial|fail"');
    expect(p).toContain('Finish with agent_report');
    expect(p).toContain(REVIEW_CRITERIA[0]);
  });
});

describe('JudgeSampler', () => {
  // on = the switch; since = when it was turned on
  const make = (runs: AgentRun[], on: boolean | number = true, refusal: string | null = null, chatOf: (id: string) => ChatSummary = chat, since = 0) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-judge-')); dirs.push(dir);
    const created: NewChat[] = [], fed: [AgentFeedbackArgs, string][] = [];
    let now = NOW, n = 0;
    const s = new JudgeSampler({ file: path.join(dir, 'judge-samples.json'), runs: () => runs, chat: id => chatOf(id),
      create: async req => { created.push(req); return { ...chat(`j${++n}`), id: `j${n}` }; }, judging: () => ({ on: !!on, since }), judgeEngine: () => 'codex',
      refusal: () => refusal, feedback: async (a, by) => { fed.push([a, by]); }, now: () => now });
    return { s, created, fed, later: (ms: number) => { now += ms; } };
  };
  it('reviews every finished run, as Sentinel chats linked to it, at most MAX_RUNNING at once', async () => {
    const { s, created } = make([run('1'), run('2'), run('3')]);
    expect(await s.tick()).toBe(MAX_RUNNING);
    expect(created[0]).toMatchObject({ harness: 'codex', roleId: 'sentinel', cwd: '/w', doneWhen: REVIEW_CRITERIA });
    expect(created[0]).not.toHaveProperty('independentOf'); // a new session is the review's independence (ADR 0091)
    expect(created.map(c => c.reviewOf).every(id => id?.startsWith('r_'))).toBe(true);
    expect(await s.tick()).toBe(0);                 // two running already
    const [a] = s.list();
    await s.ended(run('97', { agentId: 'sentinel', chatId: a!.chatId, reviewOf: a!.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'Ok', verdict: 'success' } }));
    expect(await s.tick()).toBe(1);                 // the one left, never one reviewed already
    expect(new Set(created.map(c => c.reviewOf)).size).toBe(3);
  });
  it('turning it on starts no backlog: only runs that ended since then', async () => {
    const { s, created } = make([run('1', { endedAt: NOW - 7200_000 }), run('2', { endedAt: NOW - 60_000 })], true, null, chat, NOW - 600_000);
    expect(await s.tick()).toBe(1);
    expect(created.map(c => c.reviewOf)).toEqual(['r_000000000002']);
  });
  it('the daily cost of the switch: runs a day times what a review cost; unknown without data', () => {
    const roots = Array.from({ length: 14 }, (_, i) => run(String(i + 1)));
    const reviews = [0.2, 0.4, 0.3].map((c, i) => run(String(50 + i), { agentId: 'sentinel', reviewOf: roots[i]!.runId, costUsd: c }));
    expect(judgingEstimate([...roots, ...reviews], NOW)).toEqual({ runsPerDay: 2, receiptsPerDay: 0, auditsPerDay: 0.2, reviewUsd: 0.3, perDayUsd: 0.66, basis: 3 });
    expect(judgingEstimate(roots, NOW)).toMatchObject({ runsPerDay: 2, reviewUsd: null, perDayUsd: null });
  });
  it('never puts a delegated child\'s answer in a root review chat (the Orchestrator would read it)', async () => {
    const { s, created } = make([run('1')], true, null, id => ({ ...chat(id), parentId: 'c_parent' }));
    expect(await s.tick()).toBe(0);
    expect(created).toEqual([]);
  });
  it('reviews a pruned root only with its canonical result and absolute saved project scope', async () => {
    const saved = run('1');
    saved.scope = { brainRoot: path.resolve('/brain'), projectRoot: path.resolve('/original') };
    saved.report!.canonical = { taskId: saved.runId, taskVersion: 1, runId: saved.runId, at: NOW, outcome: 'done', summary: 'Saved', output: 'Original evidence', doneWhen: [] };
    const missing = () => undefined as unknown as ChatSummary;
    const good = make([saved], true, null, missing);
    expect(await good.s.tick()).toBe(1);
    expect(good.created[0]).toMatchObject({ cwd: saved.scope.projectRoot, doneWhen: REVIEW_CRITERIA });
    expect(good.created[0]!.prompt).toContain('Original evidence');
    const unsafe = { ...saved, scope: { ...saved.scope, projectRoot: 'relative' } };
    expect(await make([unsafe], true, null, missing).s.tick()).toBe(0);
    expect(await make([run('2', { scope: saved.scope })], true, null, missing).s.tick()).toBe(0);
  });
  it('starts nothing when off or when the engine is refused', async () => {
    expect(await make([run('1')], false).s.tick()).toBe(0);
    const r = make([run('1')], true, 'engine switched off');
    expect(await r.s.tick()).toBe(0);
    expect(r.created).toEqual([]);
  });
  it('turns the review\'s verdict into the run\'s feedback, with the review as evidence; none without a verdict', async () => {
    const { s, fed } = make([run('1'), run('2')]);
    await s.tick();
    const [a, b] = s.list();
    const judge = (target: string, chatId: string, verdict?: 'fail', agentId = 'sentinel'): AgentRun => run('99', { agentId, chatId, reviewOf: target,
      report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'Manca il terzo errore', ...(verdict ? { verdict } : {}) } });
    await s.ended(judge(a!.runId, a!.chatId, 'fail'));
    expect(fed).toEqual([[{ runId: a!.runId, verdict: 'fail', notes: 'Sentinel: Manca il terzo errore', evidence: [{ kind: 'run', ref: 'r_000000000099', at: NOW - 3600_000 }] }, 'judge-sample']]);
    await s.ended(judge(b!.runId, b!.chatId));
    expect(fed).toHaveLength(1);
    expect(s.list().map(r => r.state)).toEqual(['recorded', 'no-verdict']);
    await s.ended(judge(a!.runId, 'c_other', 'fail'));  // not the chat we started: ignored
    expect(fed).toHaveLength(1);
  });
  it('still records a Judge review started before ADR 0100 when it ends, under its successor\'s name', async () => {
    const { s, fed } = make([run('1')]);
    await s.tick();
    const [a] = s.list();
    await s.ended(run('98', { agentId: 'judge', chatId: a!.chatId, reviewOf: a!.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'Ok', verdict: 'success' } }));
    expect(fed).toMatchObject([[{ runId: a!.runId, verdict: 'success', notes: 'Sentinel: Ok' }, 'judge-sample']]);
  });
  it('passes over a run whose chat is gone or is a delegated child\'s and still fills the day (issue #112)', async () => {
    const { s, created } = make([run('1'), run('2'), run('3')], true, null, id => id === 'c_1' ? undefined as unknown as ChatSummary : id === 'c_2' ? { ...chat(id), parentId: 'p' } : chat(id));
    expect(await s.tick()).toBe(1);
    expect(created.map(c => c.reviewOf)).toEqual(['r_000000000003']);
  });
});

describe('judgeSamplingOn (issue #112)', () => {
  it('a root chat the Orchestrator opened (app_create_chat: no parent run, agent_report, ended completed) is a candidate', () => {
    const opened = run('1', { startedBy: 'orchestrator', source: 'chat', report: { at: NOW - 3600_000, outcome: 'done', verified: 'partial', summary: 'Fatto' } });
    expect(pickSamples([opened], new Set(), NOW, 3)).toEqual([opened]);
  });

  it('runs in the user\'s own app, stable or built from a clone, never in tests or an agent\'s hidden run', () => {
    expect(judgeSamplingOn({})).toEqual({ on: true, why: "the user's app" });
    expect(judgeSamplingOn({ SB_RELEASE: '2026.10.19' }).on).toBe(true);
    expect(judgeSamplingOn({ SB_TEST: '1' }).on).toBe(false);
    expect(judgeSamplingOn({ SB_HIDDEN: '1' }).on).toBe(false);
    expect(judgeSamplingOn({ SB_TEST: '1', SB_JUDGE_SAMPLE: '1' }).on).toBe(true);
    expect(judgeSamplingOn({ SB_JUDGE_SAMPLE: '0' }).on).toBe(false);
  });
});

// ADR 0125: the judge is judged. One reviewed run in AUDIT_EVERY gets a second independent review that grades the first
// (standing.ts earnedVerdict, 'graded' by 'audit'); the audit never becomes the run's feedback.
describe('audits of the reviews (ADR 0125)', () => {
  const ids = Array.from({ length: 400 }, (_, i) => String(i + 1));
  const picked = ids.find(i => auditPicked(`r_${i.padStart(12, '0')}`))!, skipped = ids.find(i => !auditPicked(`r_${i.padStart(12, '0')}`))!;
  const reviewOf = (target: AgentRun, id: string, over: Partial<AgentRun> = {}) => run(id, { agentId: 'sentinel', startedBy: 'app', reviewOf: target.runId, endedAt: NOW - 600_000,
    report: { at: NOW - 600_000, outcome: 'done', verified: 'yes', summary: 'Ok', verdict: 'success' }, ...over });
  it('picks a fixed share of the runs with one verified review, never one the user judged, a child\'s or one checked already', () => {
    const share = ids.filter(i => auditPicked(`r_${i.padStart(12, '0')}`)).length / ids.length;
    expect(share).toBeGreaterThan(0.5 / AUDIT_EVERY);
    expect(share).toBeLessThan(2 / AUDIT_EVERY);
    const x = run(picked), y = run(skipped);
    expect(pickAudits([x, reviewOf(x, '900'), y, reviewOf(y, '901')], new Set(), NOW, 5)).toEqual([x]);
    expect(pickAudits([x], new Set(), NOW, 5)).toEqual([]);                                              // not reviewed yet
    expect(pickAudits([x, reviewOf(x, '900'), reviewOf(x, '902')], new Set(), NOW, 5)).toEqual([]);      // two reviews already
    expect(pickAudits([x, reviewOf(x, '900')], new Set([x.runId]), NOW, 5)).toEqual([]);                 // audited
    expect(pickAudits([x, reviewOf(x, '900', { report: { at: NOW, outcome: 'done', verified: 'partial', summary: 'Ok', verdict: 'success' } })], new Set(), NOW, 5)).toEqual([]);
    expect(pickAudits([{ ...x, outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' } }, reviewOf(x, '900')], new Set(), NOW, 5)).toEqual([]);
    expect(pickAudits([{ ...x, parentRunId: 'r_000000000777' }, reviewOf(x, '900')], new Set(), NOW, 5)).toEqual([]);
    expect(pickAudits([x, reviewOf(x, '900', { endedAt: NOW - 8 * 86_400_000 })], new Set(), NOW, 5)).toEqual([]);
    expect(pickAudits([x, reviewOf(x, '900')], new Set(), NOW, 0)).toEqual([]);
  });
  it('starts the audit after the first review was recorded, in a new Sentinel chat, and never feeds it back to the run', async () => {
    const x = run(picked), runs: AgentRun[] = [x];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-judge-')); dirs.push(dir);
    const created: NewChat[] = [], fed: AgentFeedbackArgs[] = [];
    let n = 0;
    const s = new JudgeSampler({ file: path.join(dir, 'judge-samples.json'), runs: () => runs, chat, create: async req => { created.push(req); return { ...chat(`j${++n}`), id: `j${n}` }; },
      judging: () => ({ on: true, since: 0 }), judgeEngine: () => 'claude', refusal: () => null, feedback: async a => { fed.push(a); }, now: () => NOW });
    expect(await s.tick()).toBe(1);
    const first = reviewOf(x, '900', { chatId: s.list()[0]!.chatId });
    runs.push(first);
    expect(await s.tick()).toBe(0);                 // the first review has not recorded its verdict yet
    await s.ended(first);
    expect(fed).toHaveLength(1);
    expect(await s.tick()).toBe(1);
    expect(created[1]).toMatchObject({ roleId: 'sentinel', reviewOf: x.runId });
    expect(created[1]!.prompt).not.toContain('Ok');  // the audit never sees the first verdict
    const audit = s.list()[1]!;
    expect(audit).toMatchObject({ runId: x.runId, audit: true, state: 'running' });
    const second = reviewOf(x, '901', { chatId: audit.chatId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'No', verdict: 'fail' } });
    runs.push(second);
    await s.ended(second);
    expect(fed).toHaveLength(1);                    // the run keeps the first verdict
    expect(s.list()[1]!.state).toBe('recorded');
    expect(await s.tick()).toBe(0);                 // audited once
  });
});

// ADR 0130: the receipts first. A run whose repo checks passed after its last change (and whose report agrees) is
// decided with no review; unknown or contradicted receipts go to the Sentinel; receipt verdicts are audited too.
describe('receipts before reviews (ADR 0130)', () => {
  const ids = Array.from({ length: 400 }, (_, i) => String(i + 1));
  const picked = ids.find(i => auditPicked(`r_${i.padStart(12, '0')}`))!;
  const receipts = (exit: number | null, settled = true): AgentRunReceipts => {
    const rc = emptyReceipts();
    noteTool(rc, { kind: 'tool', id: 'e', at: 100, name: 'Edit', summary: '', input: { file_path: 'src/a.ts' }, status: 'ok' });
    noteTurnFiles(rc, ['src/a.ts'], 50, 150);
    if (exit !== null) noteTool(rc, { kind: 'tool', id: 'b', at: 200, name: 'Bash', summary: '', input: { command: 'npm test' }, status: exit ? 'error' : 'ok', exitCode: exit });
    if (settled) rc.verdict = { ...receiptVerdict({ receipts: rc }), at: 300 };
    return rc;
  };
  const sampler = (runs: AgentRun[], withReceipts = true) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-judge-')); dirs.push(dir);
    const created: NewChat[] = [], fed: AgentFeedbackArgs[] = [], decided: [string, string][] = [];
    let now = NOW, n = 0;
    const s = new JudgeSampler({ file: path.join(dir, 'judge-samples.json'), runs: () => runs, chat, create: async req => { created.push(req); return { ...chat(`j${++n}`), id: `j${n}` }; },
      judging: () => ({ on: true, since: 0 }), judgeEngine: () => 'claude', refusal: () => null, feedback: async a => { fed.push(a); }, now: () => now,
      ...(withReceipts ? { receipts: (runId: string, verdict: 'success' | 'fail', note: string) => {
        decided.push([runId, verdict]);
        const r = runs.find(x => x.runId === runId)!;
        r.outcome = { verdict, basis: 'receipts', by: 'receipts', at: now, note };
        return true;
      } } : {}) });
    return { s, created, fed, decided, later: (ms: number) => { now += ms; } };
  };
  it('a green receipt the report agrees with skips the review; unknown or contradicted receipts are reviewed, with the receipts in the prompt', async () => {
    const green = run('1', { receipts: receipts(0) });
    const unknown = run('2', { receipts: receipts(null) });
    const contradicted = run('3', { receipts: receipts(0), report: { at: NOW, outcome: 'partial', verified: 'partial', summary: 'Manca un caso' } });
    const { s, created, decided } = sampler([green, unknown, contradicted]);
    expect(await s.tick()).toBe(2);
    expect(decided).toEqual([[green.runId, 'success']]);
    expect(green.outcome).toMatchObject({ verdict: 'success', basis: 'receipts' });
    expect(created.map(c => c.reviewOf).sort()).toEqual([unknown.runId, contradicted.runId]);
    for (const c of created) expect(c.prompt).toMatch(/What the app recorded while it ran.*receipts: (unknown \(no-check-after-change\)|pass \(checks-passed\))/);
    expect(s.list().find(r => r.runId === green.runId)).toMatchObject({ state: 'receipts', receipt: 'success', chatId: green.chatId });
    expect(await s.tick()).toBe(0);                 // decided once
    expect(decided).toHaveLength(1);
  });
  it('a failed check the report admits is a fail with no review; without the receipts every run is reviewed', async () => {
    const red = run('1', { receipts: receipts(1), report: { at: NOW, outcome: 'blocked', verified: 'no', summary: 'I test falliscono' } });
    const a = sampler([red]);
    expect(await a.s.tick()).toBe(0);
    expect(a.decided).toEqual([[red.runId, 'fail']]);
    const b = sampler([run('2', { receipts: receipts(0) })], false);
    expect(await b.s.tick()).toBe(1);
  });
  it('waits for a run whose last turn\'s files are still being read, then decides it', async () => {
    const late = run('1', { endedAt: NOW - 60_000, receipts: receipts(0, false) });
    const { s, created, decided, later } = sampler([late]);
    expect(await s.tick()).toBe(0);
    expect(created).toEqual([]); expect(decided).toEqual([]);
    later(RECEIPTS_WAIT_MS);
    await s.tick();
    expect(decided).toEqual([[late.runId, 'success']]);
  });
  it('audits a receipt verdict like a review: its verdict becomes the run\'s feedback and grades the receipt', async () => {
    const x = run(picked, { receipts: receipts(0) });
    const runs = [x];
    const { s, created, fed } = sampler(runs);
    expect(await s.tick()).toBe(1);                 // decided by the receipts, then audited in the free slot
    expect(x.outcome?.basis).toBe('receipts');
    expect(created).toHaveLength(1);
    const audit = s.list().find(r => r.audit)!;
    expect(audit).toMatchObject({ runId: x.runId, receipt: 'success', state: 'running' });
    expect(pickReceiptAudits(runs, new Set([x.runId]), NOW, 5)).toEqual([]);
    await s.ended(run('900', { agentId: 'sentinel', chatId: audit.chatId, reviewOf: x.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'Manca un caso', verdict: 'partial' } }));
    expect(fed).toMatchObject([{ runId: x.runId, verdict: 'partial' }]);
    expect(s.list().find(r => r.audit)).toMatchObject({ state: 'recorded', graded: 'partial' });
    expect(gradeReceipt('success', 'success')).toBe('agree');
    expect(gradeReceipt('fail', 'success')).toBe('disagree');
  });
  it('the daily cost counts only the runs still reviewed; the receipts\' are free, the audits cover both', () => {
    const roots = Array.from({ length: 14 }, (_, i) => run(String(i + 1), i < 7 ? { receipts: receipts(0) } : {}));
    const reviews = [0.2, 0.4, 0.3].map((c, i) => run(String(50 + i), { agentId: 'sentinel', reviewOf: roots[13 - i]!.runId, costUsd: c }));
    expect(judgingEstimate([...roots, ...reviews], NOW)).toEqual({ runsPerDay: 1, receiptsPerDay: 1, auditsPerDay: 0.2, reviewUsd: 0.3, perDayUsd: 0.36, basis: 3 });
  });
});
