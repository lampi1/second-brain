// The guard every Telegram update passes before the bridge looks at it (design §5.3). Only `message` and
// `callback_query`, only private chats, only the paired account writing in its own chat (from.id === paired id and
// chat.id === from.id); everything else is dropped without a reply (the bot stays mute with strangers) and counted.
// Before pairing the only thing let through is "/start <code>" from a private chat, for pairing.ts to check. The paired
// user is rate-limited (20 messages in 10 minutes: over it the messages are ignored and one notice is sent).
// Pure (time injected). Used by bridge.ts; tests: test/unit/phone/guard.test.ts.
import type { TgCallbackQuery, TgMessage, TgUpdate } from './types';

export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 10 * 60_000;

export type GuardVerdict =
  | { kind: 'drop'; reason: string }
  | { kind: 'pair'; code: string; userId: number; chatId: number }
  | { kind: 'rate-limited'; notify: boolean; message: TgMessage }
  | { kind: 'message'; message: TgMessage }
  | { kind: 'callback'; callback: TgCallbackQuery };

const START = /^\/start(?:@\w+)?(?:\s+(\S{1,32}))?\s*$/;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export interface Guard {
  check(update: TgUpdate, pairedId: number | null): GuardVerdict;
  /** updates dropped since start (the bridge adds them to the saved counter) */
  readonly dropped: number;
}

export function createGuard(now: () => number, limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS): Guard {
  let dropped = 0;
  let times: number[] = [];
  let noticed = false;
  const drop = (reason: string): GuardVerdict => { dropped++; return { kind: 'drop', reason }; };

  return {
    get dropped() { return dropped; },
    check(u, pairedId) {
      if (!u || typeof u !== 'object') return drop('invalid');
      const kinds = Object.keys(u).filter(k => k !== 'update_id');
      if (kinds.length !== 1) return drop('kind');
      if (u.message) {
        const m = u.message;
        if (!m.chat || m.chat.type !== 'private' || !m.from || !isId(m.from.id) || !isId(m.chat.id)) return drop('not-private');
        if (m.from.is_bot) return drop('bot');
        if (m.chat.id !== m.from.id) return drop('chat-mismatch');
        if (pairedId === null) {
          const start = typeof m.text === 'string' ? START.exec(m.text.trim()) : null;
          if (!start) return drop('unpaired');
          return { kind: 'pair', code: start[1] ?? '', userId: m.from.id, chatId: m.chat.id };
        }
        if (m.from.id !== pairedId) return drop('foreign');
        const t = now();
        times = times.filter(x => t - x < windowMs);
        if (times.length >= limit) {
          const notify = !noticed;
          noticed = true;
          return { kind: 'rate-limited', notify, message: m };
        }
        if (times.length === 0) noticed = false;
        times.push(t);
        return { kind: 'message', message: m };
      }
      if (u.callback_query) {
        const c = u.callback_query;
        if (pairedId === null) return drop('unpaired');
        if (!c.from || c.from.id !== pairedId) return drop('foreign');
        const m = c.message;
        if (!m || !m.chat || m.chat.type !== 'private' || m.chat.id !== pairedId) return drop('not-private');
        return { kind: 'callback', callback: c };
      }
      return drop('kind');
    },
  };
}
