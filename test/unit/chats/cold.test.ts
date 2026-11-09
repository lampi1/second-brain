// Cold chats and the compaction window (ADR 0031): the pure rules (when a chat writes its cold note, when its engine is
// kept, when a message goes on in a fresh session), the per-process compaction window, the "long" rule tied to the
// window, and the ChatManager flows on the fake Claude engine: the quiet note, the invisible continuation (same chat,
// title and tile; old session folded behind a divider; a restart reads both sessions back), no switch on a warm cache,
// the engine kept for the note, and the context counters.
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession, compactSettings } from '../../../src/main/chats/claude';
import { CACHE_TTL_MS, COLD_MIN_TOKENS, coldArmed, coldAsk, coldRoute, type ColdView } from '../../../src/main/chats/continuity';
import { coldPrompt, coldUserText, handoffRequest } from '../../../src/main/chats/handoff';
import { userText } from '../../../src/main/chats/transcript';
import { isLongChat, longAt } from '../../../src/shared/context';
import { recSink } from './helpers';

const MIN = 60_000;
const base: ColdView = {
  harness: 'claude', isOrchestrator: false, state: 'idle', pending: 0, background: 0, busy: false, alive: true, handoffTurn: false,
  contextTokens: 250_000, lastTurnAt: 1_000, noteAt: 0, lastCallAt: 1_000,
};

describe('cold rules', () => {
  it('asks the note once, idle and long, after the idle time and before the cache expires', () => {
    const at = (min: number) => 1_000 + min * MIN;
    expect(coldAsk(base, at(49), 50 * MIN)).toBe(false);
    expect(coldAsk(base, at(50), 50 * MIN)).toBe(true);
    expect(coldAsk(base, at(56), 50 * MIN)).toBe(false); // the cache is gone: a note would cost a full re-read
    for (const v of [
      { harness: 'cursor' }, { isOrchestrator: true }, { continuedBy: { id: 'x' } }, { state: 'running' },
      { pending: 1 }, { background: 1 }, { busy: true }, { alive: false }, { handoffTurn: true }, { contextTokens: COLD_MIN_TOKENS - 1 },
      { noteAt: 2_000 }, { askedFor: 1_000 }, { lastTurnAt: 0 },
    ] satisfies Partial<ColdView>[]) expect(coldAsk({ ...base, ...v }, at(50), 50 * MIN), JSON.stringify(v)).toBe(false);
    // a turn after the note: a new stretch, asked again
    expect(coldAsk({ ...base, noteAt: 900, askedFor: 500, lastTurnAt: 1_000 }, at(50), 50 * MIN)).toBe(true);
  });

  it('keeps the engine while the note is due, and routes only past the cache with a fresh note', () => {
    expect(coldArmed(base, 1_000 + 10 * MIN)).toBe(true);
    expect(coldArmed({ ...base, noteAt: 2_000 }, 1_000 + 10 * MIN)).toBe(false);
    expect(coldArmed(base, 1_000 + CACHE_TTL_MS)).toBe(false);
    const noted = { ...base, noteAt: 3_000, lastCallAt: 3_000 };
    expect(coldRoute(noted, 3_000 + CACHE_TTL_MS - 1)).toBe(false); // warm: the old session is cheaper
    expect(coldRoute(noted, 3_000 + CACHE_TTL_MS + 1)).toBe(true);
    expect(coldRoute({ ...noted, lastTurnAt: 4_000 }, 4_000 + CACHE_TTL_MS + 1)).toBe(false); // the note is stale
    expect(coldRoute({ ...noted, busy: true }, 3_000 + CACHE_TTL_MS + 1)).toBe(false);
    expect(coldRoute({ ...noted, background: 1 }, 3_000 + CACHE_TTL_MS + 1)).toBe(false); // a new session would end its agents
    expect(coldRoute({ ...noted, harness: 'cursor' }, 3_000 + CACHE_TTL_MS + 1)).toBe(false);
  });

  it('the cold request asks what to restart and runs no tool; the prompt carries the note, the transcript only the message', () => {
    const r = handoffRequest({ title: 't', reason: 'cold' });
    expect(r).toContain('## In corso');
    expect(r).toContain('sessione nuova');
    expect(handoffRequest({ title: 't', reason: 'manual' })).not.toContain('## In corso');
    const p = coldPrompt({ title: 'Fix', cwd: 'C:/r', inWorktree: true }, { chatId: 'c', title: 'Fix', path: 'C:/h/c.md', text: '## Stato\nok', at: 1, source: 'chat' }, 'e adesso?\nseconda riga');
    expect(p).toContain('## Stato\nok');
    expect(p).toContain('git worktree list');
    expect(coldUserText(p)).toBe('e adesso?\nseconda riga');
    expect(userText(p)).toEqual({ text: 'e adesso?\nseconda riga' });
    expect(coldUserText('ciao')).toBe('ciao');
  });

  it('the compaction window goes inline per process (clamped), and the meter turns amber near it', () => {
    expect(compactSettings(300_000)).toEqual({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } });
    expect(compactSettings(5)).toEqual({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' } });
    expect(compactSettings(0)).toBeNull();
    const args = (w?: number) => new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: '00000000-0000-4000-8000-000000000000', ...(w !== undefined ? { compactWindowTokens: w } : {}), stable: true, localAppData: 'C:/L' }, recSink()).args();
    const settings = JSON.parse(args(300_000)[args(300_000).indexOf('--settings') + 1]!) as { env?: unknown; permissions?: { deny?: unknown[] } };
    expect(settings.env).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' });
    expect(settings.permissions?.deny?.length).toBeGreaterThan(0); // the stable guard rails stay
    expect(JSON.parse(args()[args().indexOf('--settings') + 1]!).env).toBeUndefined();
    const claude = { harness: 'claude' as const, contextMaxTokens: 300_000 };
    expect(longAt(claude, 200_000)).toBe(240_000);
    expect(isLongChat({ ...claude, contextTokens: 230_000 }, 200_000)).toBe(false);
    expect(isLongChat({ ...claude, contextTokens: 245_000 }, 200_000)).toBe(true);
    expect(isLongChat({ harness: 'cursor', contextTokens: 210_000, contextEstimated: true }, 200_000)).toBe(true);
  });
});

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });
