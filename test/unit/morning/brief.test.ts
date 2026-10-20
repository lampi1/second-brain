// The morning block's pure parts (src/main/morning/brief.ts, src/shared/morning.ts, ADR 0102): when a presence opens it
// (first of the day, after 4 h away, never again the day it was dismissed), what the brief holds from the app's own
// data, yesterday's spend from the brain's cost report, and Ctrl+J's priority when nothing is pending.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import type { BrainChange } from '../../../src/shared/brain-model';
import type { ChatSummary, TasksState } from '../../../src/shared/contract';
import { briefEmpty, nextPriority } from '../../../src/shared/morning';
import { buildBrief, dismissStep, emptyPresence, isOpen, MORNING_GAP_MS, outcomeOf, presenceStep, runsSpend, spendOfDay, type BriefInput, type PresenceState } from '../../../src/main/morning/brief';

const H = 3600_000, MIN = 60_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const T = Date.UTC(2026, 9, 20, 7); // 07:00 UTC

describe('presence', () => {
  it('the first presence ever opens the block over the last 24 h', () => {
    const st = presenceStep(emptyPresence(), T, day);
    expect(st).toMatchObject({ lastPresentAt: T, openSince: T - 24 * H, openDay: '2026-10-20' });
    expect(isOpen(st, T, day)).toBe(true);
  });
  it('a new day opens it from the last presence; presences within 4 h keep it as it is', () => {
    let st: PresenceState = { ...emptyPresence(), lastPresentAt: T - 14 * H }; // yesterday evening
    st = presenceStep(st, T, day);
    expect(st.openSince).toBe(T - 14 * H);
    st = dismissStep(st, T + MIN, day);
    st = presenceStep(st, T + 2 * H, day);
    expect(isOpen(st, T + 2 * H, day)).toBe(false);
  });
  it('after 4 h away the same day it opens again, unless dismissed today', () => {
    let st: PresenceState = presenceStep({ ...emptyPresence(), lastPresentAt: T - 12 * H }, T, day);
    expect(isOpen(st, T, day)).toBe(true);
    st = presenceStep(st, T + 10 * MIN, day);
    st = presenceStep(st, T + 10 * MIN + MORNING_GAP_MS, day);
    expect(st.openSince).toBe(T + 10 * MIN); // the last presence before that absence
    st = dismissStep(st, T + 5 * H, day);
    st = presenceStep(st, T + 5 * H + MORNING_GAP_MS, day);
    expect(isOpen(st, T + 5 * H + MORNING_GAP_MS, day)).toBe(false);
    // the next day it is back
    st = presenceStep(st, T + 24 * H, day);
    expect(isOpen(st, T + 24 * H, day)).toBe(true);
  });
  it('a clock moving backwards never moves the last presence back', () => {
    const st = presenceStep({ ...emptyPresence(), lastPresentAt: T }, T - H, day);
    expect(st.lastPresentAt).toBe(T);
  });
});

const run = (p: Partial<AgentRun>): AgentRun => ({ runId: `r${Math.random()}`, chatId: 'c1', agentId: 'artisan', version: 1, goal: 'Fix login', startedBy: 'orchestrator', startedAt: T - 10 * H,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 1, tokens: null, ...p });
const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({ id, harness: 'claude', origin: 'app', title: `Chat ${id}`, cwd: '', sessionId: null, model: null, effort: null,
  permissionMode: null, state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: T, browserTabIds: [], ...p } as ChatSummary);
const tasks = (p: Partial<TasksState>): TasksState => ({ enabled: false, everyMin: 30, sound: false, running: false, at: T - 13 * H, nextAt: null, error: null, news: [], assigned: [], urgent: [], oldReviews: [], reviews: [], prs: [], ...p } as TasksState);
const pr = (id: number, result: string | null) => ({ id, title: `PR ${id}`, repo: 'r', project: 'p', author: null, createdAt: '', url: `https://dev/pr/${id}`, target: 'main', draft: false, autoComplete: false, reviewers: [], workItems: [],
  build: result === null ? null : { result, status: 'completed', number: '1', url: '', at: null } });
const change = (id: string, at: number, p: Partial<BrainChange> = {}): BrainChange => ({ id, at, job: 'merge-skills', kind: 'skill', action: 'merge', target: 't', summary: `s ${id}`, reason: '', evidence: [], canRollback: true, ...p });
const input = (p: Partial<BriefInput> = {}): BriefInput => ({ now: T, since: T - 14 * H, chats: [], runs: [], pending: 0, approvals: 0, tasks: null, ideas: [], today: '2026-10-20', cloud: [], changes: [], spendYesterdayUsd: null, stallMin: 10, ...p });

describe('buildBrief', () => {
  it('runs ended since then, newest first, with their outcome; not the Battito\'s one-shots nor delegated children', () => {
    const b = buildBrief(input({ chats: [chat('c1', { title: 'Login', closedAt: T - H })], runs: [
      run({ runId: 'a', endedAt: T - 2 * H, report: { at: 0, outcome: 'partial', verified: 'no', summary: '' } }),
      run({ runId: 'b', endedAt: T - H, outcome: { verdict: 'success', basis: 'human', at: 0, by: 'u' } }),
      run({ runId: 'old', endedAt: T - 20 * H }), run({ runId: 'open' }),
      run({ runId: 'pulse', endedAt: T - H, source: 'oneshot' }), run({ runId: 'kid', endedAt: T - H, parentRunId: 'a' }),
    ] }));
    expect(b.runs.map(r => [r.runId, r.outcome, r.title, r.open])).toEqual([['b', 'done', 'Login', false], ['a', 'partial', 'Login', false]]);
  });
  it('red builds on the user\'s PRs and the reviews that wait for a vote, once each', () => {
    const b = buildBrief(input({ tasks: tasks({ prs: [pr(1, 'failed'), pr(2, 'succeeded'), pr(3, null)], reviews: [{ id: 9, title: 'Rev', repo: 'r', project: 'p', author: null, createdAt: '', url: 'u9' }, { id: 1, title: 'dup', repo: 'r', project: 'p', author: null, createdAt: '', url: '' }] }) }));
    expect(b.prs.map(p => [p.id, p.why])).toEqual([[1, 'build'], [9, 'vote']]);
    expect(b.tasksAt).toBe(T - 13 * H);
  });
  it('ideas due by today, not done or dropped; cloud agents ended since then; the maintenance changes since then', () => {
    const b = buildBrief(input({
      ideas: [{ titolo: 'A', stato: 'aperta', scaduta: '2026-10-19' }, { titolo: 'B', stato: 'fatta', scaduta: '2026-10-01' }, { titolo: 'C', stato: 'aperta', scaduta: '2026-10-21' }, { titolo: 'D', stato: '', scaduta: '' }],
      cloud: [{ id: 'x', engine: 'cursor', title: 'Checkout', status: 'done', url: null, repo: 'o/r', updatedAt: T - H, by: 'user' }, { id: 'y', engine: 'cursor', title: 'Run', status: 'running', url: null, repo: 'o/r', updatedAt: T - H, by: 'user' }],
      changes: [change('n', T - H), change('u', T - H, { job: 'user' }), change('o', T - 20 * H), change('r', T - H, { rolledBackAt: T })],
    }));
    expect(b.ideas).toEqual([{ title: 'A', due: '2026-10-19' }]);
    expect(b.cloud).toEqual([{ id: 'x', title: 'Checkout', status: 'done' }]);
    expect(b.changes.map(c => c.id)).toEqual(['n']);
  });
  it('a root chat at work silent for stallMin is stalled; queued, waiting or delegated ones are not', () => {
    const b = buildBrief(input({ chats: [
      chat('s', { state: 'running', updatedAt: T - 30 * MIN }), chat('q', { state: 'running', updatedAt: T - 30 * MIN, queued: { kind: 'start', position: 1, since: 0, cpu: 0, freeRam: 0 } as ChatSummary['queued'] }),
      chat('w', { state: 'waiting', updatedAt: T - 30 * MIN }), chat('k', { state: 'running', updatedAt: T - 30 * MIN, parentId: 's' }), chat('f', { state: 'running', updatedAt: T - 5 * MIN }),
    ], lastEventAt: id => (id === 'f' ? T - MIN : undefined) }));
    expect(b.stalled).toEqual([{ chatId: 's', title: 'Chat s', quietMin: 30 }]);
  });
  it('an empty brief says so', () => {
    expect(briefEmpty(buildBrief(input()))).toBe(true);
    expect(briefEmpty(buildBrief(input({ pending: 1 })))).toBe(false);
  });
});

describe('outcome, spend, priority', () => {
  it('the report wins, else the verdict, else unknown', () => {
    expect(outcomeOf(run({ report: { at: 0, outcome: 'blocked', verified: 'no', summary: '' }, outcome: { verdict: 'success', basis: 'human', at: 0, by: 'u' } }))).toBe('blocked');
    expect(outcomeOf(run({ outcome: { verdict: 'fail', basis: 'human', at: 0, by: 'u' } }))).toBe('blocked');
    expect(outcomeOf(run({}))).toBe('unknown');
  });
  it('yesterday from the cost report (Claude + Cursor), else the runs started that day', () => {
    expect(spendOfDay({ byDay: { '2026-10-19': { usd: 3.214 } }, cursor: { byDay: { '2026-10-19': { usd: 1 } } } }, '2026-10-19')).toBe(4.21);
    expect(spendOfDay({ byDay: {} }, '2026-10-19')).toBe(0);
    expect(spendOfDay(null, '2026-10-19')).toBeNull();
    expect(runsSpend([run({ startedAt: 5, costUsd: 1.5 }), run({ startedAt: 6, costUsd: null }), run({ startedAt: 50, costUsd: 9 })], 0, 10)).toBe(1.5);
    expect(runsSpend([], 0, 10)).toBeNull();
  });
  it('Ctrl+J: a red build, then approvals, then the longest stalled chat, then an idea due', () => {
    const b = buildBrief(input());
    expect(nextPriority(null)).toBeNull();
    expect(nextPriority(b)).toBeNull();
    const ideas = { ...b, ideas: [{ title: 'I', due: '2026-10-19' }] };
    expect(nextPriority(ideas)).toEqual({ kind: 'idea', idea: { title: 'I', due: '2026-10-19' } });
    const stalled = { ...ideas, stalled: [{ chatId: 'a', title: 'A', quietMin: 12 }, { chatId: 'b', title: 'B', quietMin: 40 }] };
    expect(nextPriority(stalled)).toMatchObject({ kind: 'stalled', chat: { chatId: 'b' } });
    expect(nextPriority({ ...stalled, approvals: 2 })).toEqual({ kind: 'approvals', n: 2 });
    expect(nextPriority({ ...stalled, approvals: 2, prs: [{ id: 2, title: 'v', url: '', why: 'vote' }, { id: 1, title: 'b', url: '', why: 'build' }] })).toMatchObject({ kind: 'pr', pr: { id: 1 } });
  });
});
