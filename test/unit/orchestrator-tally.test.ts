// The Orchestrator card's line (#153, renderer/lib/orchestrator-tally.ts): the chats it started today counted like a
// parent's children, and the cost of those chats (with what they delegated) apart from its own.
import { describe, expect, it } from 'vitest';
import { orchestratorTally } from '../../src/renderer/lib/orchestrator-tally';
import type { ChatSummary } from '../../src/shared/contract';

const NOW = new Date(2026, 9, 21, 20, 0).getTime();
const chat = (id: string, o: Partial<ChatSummary> & { startedBy?: 'orchestrator' | 'user'; at?: number; reported?: boolean } = {}): ChatSummary => {
  const { startedBy, at, reported, ...rest } = o;
  return { id, title: id, state: 'idle', pending: 0, costUsd: 0, harness: 'claude', ...(startedBy ? { run: { startedBy, startedAt: at ?? NOW - 60_000, ...(reported ? { report: { outcome: 'done' } } : {}) } } : {}), ...rest } as unknown as ChatSummary;
};

describe('orchestratorTally', () => {
  it('two chats started, one finished: 1 concluded, 1 running; the cost of its chats includes their children', () => {
    const t = orchestratorTally([
      chat('orc', { isOrchestrator: true, costUsd: 0.2 }),
      chat('a', { startedBy: 'orchestrator', reported: true, costUsd: 0.1 }),
      chat('b', { startedBy: 'orchestrator', state: 'running', costUsd: 0.05 }),
      chat('b1', { parentId: 'b', costUsd: 0.01 }),
      chat('mine', { startedBy: 'user', costUsd: 9 }),
      chat('old', { startedBy: 'orchestrator', at: NOW - 2 * 86_400_000, costUsd: 9 }),
    ], NOW);
    expect(t.started).toBe(2);
    expect(t.counts).toEqual({ run: 1, wait: 0, stuck: 0, done: 1 });
    expect(t.startedUsd).toBeCloseTo(0.16);
  });
  it('an idle chat without its report is stopped; one waiting for the user is waiting', () => {
    const t = orchestratorTally([chat('x', { startedBy: 'orchestrator' }), chat('y', { startedBy: 'orchestrator', pending: 1 }), chat('z', { startedBy: 'orchestrator', state: 'error' })], NOW);
    expect(t.counts).toEqual({ run: 0, wait: 1, stuck: 2, done: 0 });
  });
});
