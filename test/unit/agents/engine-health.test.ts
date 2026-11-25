// An engine whose chats just failed to start (src/main/agents/engine-health.ts, ADR 0359): in trouble for ten minutes, once
// per chat that enters the error, cleared by a good turn; a plan limit is the credit book's, never trouble.
import { describe, expect, it } from 'vitest';
import { EngineHealth, TROUBLE_MS } from '../../../src/main/agents/engine-health';
import type { ChatSummary } from '../../../src/shared/contract';

const chat = (p: Partial<ChatSummary>) => ({ id: 'c', harness: 'codex', state: 'error', lastError: 'login scaduto', ...p }) as ChatSummary;

describe('EngineHealth', () => {
  it('a chat that failed before its first turn puts its engine in trouble for a while', () => {
    let t = 1_000;
    const h = new EngineHealth(() => t);
    expect(h.trouble('codex')).toBe(false);
    h.observe(chat({}));
    expect([h.trouble('codex'), h.trouble('claude')]).toEqual([true, false]);
    t += TROUBLE_MS;
    expect(h.trouble('codex')).toBe(false);
    // the same error seen again is the same failure
    h.observe(chat({}));
    expect(h.trouble('codex')).toBe(false);
  });
  it('an error after a turn, or a plan limit, is not trouble', () => {
    const h = new EngineHealth(() => 1);
    h.observe(chat({ lastResult: { at: 1, isError: false } as never }));
    h.observe(chat({ id: 'd', lastError: "You've hit your usage limit" }));
    expect(h.trouble('codex')).toBe(false);
  });
  it('a good turn after it clears it at once', () => {
    let t = 10;
    const h = new EngineHealth(() => t);
    h.fail('codex');
    t = 20;
    h.observe(chat({ id: 'x', state: 'idle', lastResult: { at: 5, isError: false } as never }));
    expect(h.trouble('codex')).toBe(true);
    h.observe(chat({ id: 'x', state: 'idle', lastResult: { at: 15, isError: false } as never }));
    expect(h.trouble('codex')).toBe(false);
  });
});
