// The origin line above a root strip (src/renderer/lib/chat-origin.ts, ADR 0102): the Orchestrator's chats, the app's
// own (a Judge's sampled review numbered among today's), the ones resumed after a restart; the user's and the children
// say nothing.
import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import type { AgentRun } from '../../src/shared/agents';
import { originOf } from '../../src/renderer/lib/chat-origin';

const day = new Date(2026, 9, 20, 9).getTime();
const run = (p: Partial<AgentRun>): AgentRun => ({ runId: 'r', chatId: 'c', agentId: 'judge', version: 1, goal: 'g', startedBy: 'user', startedAt: day,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null, ...p });
const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({ id, harness: 'claude', origin: 'app', title: id, cwd: '', sessionId: null, model: null, effort: null,
  permissionMode: null, state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: day, browserTabIds: [], ...p } as ChatSummary);

describe('originOf', () => {
  it('the Orchestrator\'s chats keep their line', () => {
    expect(originOf(chat('a', { run: run({ startedBy: 'orchestrator', startedAt: day + 5 }) }), [])).toEqual({ kind: 'orchestrator', at: day + 5 });
  });
  it('a sampled review is numbered among today\'s, earliest first', () => {
    const r1 = chat('r1', { run: run({ startedBy: 'app', reviewOf: 'x', startedAt: day + 1000 }) });
    const r2 = chat('r2', { run: run({ startedBy: 'app', reviewOf: 'y', startedAt: day + 2000 }) });
    const old = chat('r0', { run: run({ startedBy: 'app', reviewOf: 'z', startedAt: day - 86_400_000 }) });
    const all = [r2, old, r1];
    expect(originOf(r1, all)).toEqual({ kind: 'app', at: day + 1000, review: 1 });
    expect(originOf(r2, all)).toEqual({ kind: 'app', at: day + 2000, review: 2 });
    expect(originOf(chat('o', { run: run({ startedBy: 'app' }) }), all)).toEqual({ kind: 'app', at: day, review: 0 });
  });
  it('a chat resumed after a restart says so; the user\'s chats, children and the Orchestrator say nothing', () => {
    expect(originOf(chat('a', { resumedAt: day + 7 }), [])).toEqual({ kind: 'resumed', at: day + 7 });
    expect(originOf(chat('a', { run: run({ startedBy: 'user' }) }), [])).toBeNull();
    expect(originOf(chat('a', { parentId: 'p', run: run({ startedBy: 'app', reviewOf: 'x' }) }), [])).toBeNull();
    expect(originOf(chat('a', { isOrchestrator: true, resumedAt: day }), [])).toBeNull();
    expect(originOf(undefined, [])).toBeNull();
  });
});
