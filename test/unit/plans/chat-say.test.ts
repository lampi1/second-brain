// What a chat of a plan says now (src/main/plans/chat-say.ts): at work, waits for the user or for an agent that holds its
// question, failed, reported done, partial or blocked, says nothing. Moved from the project maps' tests (issue #456, ADR 0330).
import { describe, expect, it } from 'vitest';
import type { ChatSummary, PendingRequest } from '../../../src/shared/contract';
import { sayOf } from '../../../src/main/plans/chat-say';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:\\repo\\shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const ask = (chatId: string): PendingRequest => ({ id: 'r1', chatId, type: 'question', tool: 'AskUserQuestion' } as PendingRequest);
const run = (outcome?: 'done' | 'partial' | 'blocked', t = 0) => ({ runId: 'r', chatId: 'w', agentId: 'artisan', version: 1, goal: '', startedBy: 'orchestrator', startedAt: t + 10, ...(outcome ? { report: { at: t + 20, outcome, verified: 'yes', summary: '' } } : {}) }) as unknown as NonNullable<ChatSummary['run']>;


describe('sayOf', () => {
  const say = (p: Partial<ChatSummary>, all: ChatSummary[] = [], asks: PendingRequest[] = []) => sayOf(chat({ id: 'w', ...p }), all, asks);
  it('at work: it runs, starts, is queued, or a chat it delegated runs', () => {
    expect(say({ state: 'running' })).toBe('run');
    expect(say({ state: 'starting' })).toBe('run');
    expect(say({ state: 'idle', background: 1 })).toBe('run');
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false } }, [chat({ id: 'kid', parentId: 'w', state: 'running' })])).toBe('run');
    // a chat it delegated that closed does not count
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false } }, [chat({ id: 'kid', parentId: 'w', state: 'closed', closedAt: 5 })])).toBe('work');
  });
  it('a question an agent holds is waited for at that agent, until it reaches the user (ADR 0344)', () => {
    const q = (level: 'strategist' | 'orchestrator' | 'user', via: 'request' | 'message' = 'message') => [{ id: 'q', asks: [], level, at: 1, levelAt: 1, trail: [], via }];
    expect(say({ state: 'idle', waitsOn: 'user', questions: q('strategist'), lastResult: { at: 1, isError: false } })).toBe('held');
    expect(say({ state: 'waiting', questions: q('orchestrator', 'request') })).toBe('held');
    expect(say({ state: 'running', questions: q('strategist') })).toBe('run');
    expect(say({ state: 'waiting', pending: 1, questions: q('user', 'request') })).toBe('wait');
  });
  it('waits for the user: an open request (its own or a delegated chat\'s), or its last answer says so', () => {
    expect(say({ state: 'waiting' })).toBe('wait');
    expect(say({ state: 'running' }, [], [ask('w')])).toBe('wait');
    expect(say({ state: 'running' }, [chat({ id: 'kid', parentId: 'w', state: 'running' })], [ask('kid')])).toBe('wait');
    expect(say({ state: 'idle', waitsOn: 'user', lastResult: { at: 1, isError: false } })).toBe('wait');
    expect(say({ state: 'running' }, [], [ask('other')])).toBe('run');
  });
  it('failed, stuck, done, still on it', () => {
    expect(say({ state: 'error' })).toBe('fail');
    expect(say({ state: 'idle', lastResult: { at: 1, isError: true } })).toBe('fail');
    expect(say({ state: 'idle', run: run('blocked'), lastResult: { at: 30, isError: false } })).toBe('stuck');
    expect(say({ state: 'idle', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('done');
    expect(say({ state: 'idle', run: run('partial'), lastResult: { at: 30, isError: false } })).toBe('work');
    // a turn ended well, no report yet, the chat is still open: it is not finished
    expect(say({ state: 'idle', run: run(), lastResult: { at: 30, isError: false } })).toBe('work');
    // a delegated chat's report
    expect(say({ state: 'idle', delegation: { role: 'artisan', goal: '', doneWhen: [], at: 5, result: { outcome: 'done', summary: '', at: 9 } } as ChatSummary['delegation'] })).toBe('done');
    // a report of an earlier assignment is not this one's
    expect(say({ state: 'idle', lastResult: { at: 30, isError: false }, run: { ...run('done'), startedAt: 25 } })).toBe('work');
  });
  it('at work again after its done report (the turn that reported goes on, a message followed): redo, not a new start', () => {
    expect(say({ state: 'running', run: run('done') })).toBe('redo');
    expect(say({ state: 'running', run: run('partial') })).toBe('run');
    // a new assignment is a new start
    expect(say({ state: 'running', run: { ...run('done'), startedAt: 25 } })).toBe('run');
    // a question after the done report (an open request, a closing question): it waits again, the work stays done
    expect(say({ state: 'waiting', run: run('done') })).toBe('reask');
    expect(say({ state: 'idle', waitsOn: 'user', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('reask');
  });
  it('a report given before the chat was linked to a piece is not about that piece', () => {
    const c = chat({ id: 'w', state: 'running', run: run('done') });
    expect(sayOf(c, [], [], 20)).toBe('redo');
    expect(sayOf(c, [], [], 21)).toBe('run');
    expect(sayOf({ ...c, state: 'idle', lastResult: { at: 30, isError: false } }, [], [], 21)).toBe('work');
    // it did nothing since the link: it says nothing (also when the app closed it)
    expect(sayOf({ ...c, state: 'idle', lastResult: { at: 20, isError: false } }, [], [], 21)).toBeNull();
    expect(sayOf({ ...c, state: 'closed', closedAt: 50, closedBy: 'auto', lastResult: { at: 20, isError: false } }, [], [], 21)).toBeNull();
  });
  it('with no report to give it is done when the app closed it after a turn that ended well', () => {
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'auto', lastResult: { at: 30, isError: false } })).toBe('done');
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'user', lastResult: { at: 30, isError: false } })).toBeNull();
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'user', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('done');
  });
  it('says nothing when it never started or the user stopped it', () => {
    expect(say({ state: 'idle' })).toBeNull();
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false, interrupted: true } })).toBeNull();
  });
});
