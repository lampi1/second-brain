// One review chat per piece of work (#387, ADR 0309): the pure lookup (agents/one-review.ts) that finds the review
// chat a new one would duplicate. The tools that refuse on it are pinned in appctl.test.ts and delegation.test.ts.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import type { ChatSummary } from '../../../src/shared/contract';
import { childReviewers, hasReported, nextReviewOf, reviewedChat, reviewsSameWork, rootReviewer, sameWork, type ReviewWorld } from '../../../src/main/agents/one-review';

const run = (runId: string, chatId: string, p: Partial<AgentRun> = {}): AgentRun => ({ runId, chatId, agentId: 'artisan', version: 1, goal: '', startedBy: 'orchestrator', startedAt: 1, ...p }) as AgentRun;
const chat = (id: string, role: string, p: Partial<ChatSummary> = {}): ChatSummary => ({ id, title: id, harness: 'claude', cwd: '/repo', state: 'idle', isOrchestrator: false,
  agent: { id: role, source: 'catalog', version: 1, revision: 7 }, ...p }) as unknown as ChatSummary;
const reported = { report: { summary: 'ok' } } as Partial<AgentRun>;

function world(chats: ChatSummary[], runs: AgentRun[], threads: Record<string, string> = {}): ReviewWorld {
  return { chats, runs, profile: () => ({ activeVersion: 1, updatedAt: 7 }), threadOf: id => threads[id] ?? null };
}

describe('one review chat per piece of work', () => {
  const impl1 = run('i1', 'impl'), impl2 = run('i2', 'impl', { startedAt: 5 });
  const rev = run('r1', 'rev', { agentId: 'sentinel', startedBy: 'app', reviewOf: 'i1', ...reported });
  const reviewer = chat('rev', 'sentinel', { run: rev });
  const implChat = chat('impl', 'artisan', { run: impl2 });
  const ask = { role: 'sentinel', reviewOf: 'i2', cwd: '/repo', from: 'claude' as const };

  it('finds the review chat that already reported on the same implementation chat, on a later run of it too', () => {
    const w = world([implChat, reviewer], [impl1, impl2, rev]);
    expect(reviewedChat(w.runs, 'i2')).toBe('impl');
    expect(rootReviewer(w, ask)?.id).toBe('rev');
    expect(reviewsSameWork(w, reviewer, 'i2')).toBe(true);
    expect(nextReviewOf(w, reviewer)).toBe('i2');             // the implementation chat's current run
    // busy with its second round (no report on that run yet): still the work's review chat
    const again = run('r2', 'rev', { agentId: 'sentinel', startedBy: 'app', reviewOf: 'i2', startedAt: 6 });
    expect(rootReviewer(world([implChat, chat('rev', 'sentinel', { run: again, state: 'running' })], [impl1, impl2, rev, again]), ask)?.id).toBe('rev');
  });

  it('a reviewer still at work, of other work, or of another role is no duplicate', () => {
    const busy = chat('rev', 'sentinel', { run: run('r1', 'rev', { reviewOf: 'i1' }) });
    expect(rootReviewer(world([implChat, busy], [impl1, impl2]), ask)).toBeNull();
    const other = run('o1', 'other');
    expect(rootReviewer(world([implChat, reviewer, chat('other', 'artisan', { run: other })], [impl1, impl2, rev, other]), { ...ask, reviewOf: 'o1' })).toBeNull();
    expect(reviewsSameWork(world([implChat, reviewer], [impl1, impl2, rev, other]), reviewer, 'o1')).toBe(false);
    expect(rootReviewer(world([implChat, reviewer], [impl1, impl2, rev]), { ...ask, role: 'judge' })).toBeNull();
    expect(rootReviewer(world([implChat, reviewer], [impl1, impl2, rev]), { ...ask, reviewOf: 'unknown' })).toBeNull();
  });

  it('a chat it names is one the assign tool accepts: work it reviewed in an earlier round counts, never a review chat', () => {
    // r1 reviewed A, then r2 reviewed B of the same thread; the thread is now done, so A and B are apart again
    const a1 = run('a1', 'A'), a2 = run('a2', 'A', { startedAt: 9 }), b1 = run('b1', 'B');
    const r1 = run('r1', 'rev', { agentId: 'sentinel', reviewOf: 'a1', ...reported }), r2 = run('r2', 'rev', { agentId: 'sentinel', reviewOf: 'b1', startedAt: 3, ...reported });
    const rv = chat('rev', 'sentinel', { run: r2 });
    const w = world([chat('A', 'artisan', { run: a2 }), chat('B', 'artisan', { run: b1 }), rv], [a1, a2, b1, r1, r2]);
    expect(rootReviewer(w, { ...ask, reviewOf: 'a2' })?.id).toBe('rev');
    expect(reviewsSameWork(w, rv, 'a2')).toBe(true);
    expect(reviewsSameWork(w, rv, 'r1')).toBe(false);         // its own run: never a review of itself
    expect(hasReported(w, rv)).toBe(true);
    expect(hasReported(world([chat('rev', 'sentinel', { run: run('r9', 'rev', { reviewOf: 'a1' }) })], [a1]), chat('rev', 'sentinel', { run: run('r9', 'rev', { reviewOf: 'a1' }) }))).toBe(false);
  });

  it('two chats linked to the same open work thread are one piece of work', () => {
    const second = run('s1', 'impl-b');
    const w = world([implChat, reviewer, chat('impl-b', 'artisan', { run: second })], [impl1, impl2, rev, second], { impl: 't1', 'impl-b': 't1' });
    expect(sameWork(w, 'impl', 'impl-b')).toBe(true);
    expect(rootReviewer(w, { ...ask, reviewOf: 's1' })?.id).toBe('rev');
    expect(sameWork(world([], []), 'impl', 'impl-b')).toBe(false);
  });

  it('a reviewer that could not take the assignment is never named: a fresh one is the only way', () => {
    const runs = [impl1, impl2, rev];
    // another folder, a changed role card, closed by the user, a stopped engine of another kind
    expect(rootReviewer(world([implChat, reviewer], runs), { ...ask, cwd: '/elsewhere' })).toBeNull();
    expect(rootReviewer({ ...world([implChat, reviewer], runs), profile: () => ({ activeVersion: 2, updatedAt: 7 }) }, ask)).toBeNull();
    expect(rootReviewer({ ...world([implChat, reviewer], runs), profile: () => ({ activeVersion: 1, updatedAt: 8 }) }, ask)).toBeNull();
    expect(rootReviewer(world([implChat, chat('rev', 'sentinel', { run: rev, closedAt: 9, closedBy: 'user' })], runs), ask)).toBeNull();
    expect(rootReviewer(world([implChat, chat('rev', 'sentinel', { run: rev, harness: 'codex', closedAt: 9, closedBy: 'auto', state: 'closed' })], runs), ask)).toBeNull();
    // closed by the app after its report: it reopens with the assignment, so it is still the work's review chat
    expect(rootReviewer(world([implChat, chat('rev', 'sentinel', { run: rev, closedAt: 9, closedBy: 'auto', state: 'closed' })], runs), ask)?.id).toBe('rev');
  });

  it('a parent\'s Sentinel children that reported on its current task, never those of an earlier task or still at work', () => {
    const p1 = run('p1', 'parent', { taskId: 'p1' }), p2 = run('p2', 'parent', { taskId: 'p1' }), p3 = run('p3', 'parent', { taskId: 'p3' });
    const kid = (id: string, parentRunId: string, done = true): ChatSummary => chat(id, 'sentinel', { parentId: 'parent',
      run: run(`run-${id}`, id, { agentId: 'sentinel', parentRunId }), delegation: { role: 'sentinel', goal: '', doneWhen: [], at: 1, ...(done ? { result: { outcome: 'done', summary: '', at: 2 } } : {}) } } as Partial<ChatSummary>);
    const chats = [kid('a', 'p1'), kid('b', 'p2', false), chat('c', 'scout', { parentId: 'parent' })];
    const parent = (r: AgentRun) => chat('parent', 'strategist', { run: r });
    const w = world(chats, [p1, p2, p3]);
    expect(childReviewers(w, parent(p2), '/repo').map(c => c.id)).toEqual(['a']);   // a rework of the same task
    expect(childReviewers(w, parent(p3), '/repo')).toEqual([]);                      // a new task: its own review
    // re-reviewing a fix (its result cleared by the new assignment): its earlier round still counts
    const first = run('k1', 'a', { agentId: 'sentinel', parentRunId: 'p1', ...reported }), second = run('k2', 'a', { agentId: 'sentinel', parentRunId: 'p2' });
    const busy = chat('a', 'sentinel', { parentId: 'parent', run: second, state: 'running', delegation: { role: 'sentinel', goal: '', doneWhen: [], at: 3 } } as Partial<ChatSummary>);
    expect(childReviewers(world([busy], [p1, p2, first, second]), parent(p2), '/repo').map(c => c.id)).toEqual(['a']);
    expect(childReviewers(w, parent(p2), '/other')).toEqual([]);
  });
});
