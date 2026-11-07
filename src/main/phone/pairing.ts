// Pairing of the phone with the PC (design §5.2): the PC shows a one-time 6-digit code (crypto random), valid 10 minutes,
// usable once; the user sends "/start <code>" to the bot from a private chat and the bridge stores that account's
// from.id and chat.id. Wrong attempts are counted per Telegram account: after 5 an account is refused ('blocked') until
// a new code, so a stranger cannot burn the owner's code; 100 wrong attempts in all (many accounts guessing) still
// invalidate it (a new one only from the PC). Wrong attempts get no reply; the bridge shows them on the PC.
// Used by bridge.ts (startPairing, the guard's 'pair' verdict); tests: test/unit/phone/guard-pairing-state.test.ts.
import crypto from 'node:crypto';

export const PAIRING_TTL_MS = 10 * 60_000;
/** wrong attempts one account may make on one code */
export const PAIRING_MAX_ATTEMPTS = 5;
/** wrong attempts from all accounts together that invalidate the code (bounds guessing with many accounts) */
export const PAIRING_MAX_TOTAL = 100;

export type PairAttempt = 'ok' | 'wrong' | 'blocked' | 'none';

export interface Pairing {
  /** a new code, replacing any previous one (the per-account counts start again) */
  start(): { code: string; expiresAt: number };
  /** the code still usable, or null (none, expired, used or invalidated) */
  current(): { code: string; expiresAt: number } | null;
  attempt(code: string, fromId: number): PairAttempt;
  cancel(): void;
}

export function createPairing(now: () => number, randomInt: (max: number) => number = max => crypto.randomInt(max)): Pairing {
  let active: { code: string; expiresAt: number; total: number; wrong: Map<number, number> } | null = null;
  const live = () => {
    if (active && now() >= active.expiresAt) active = null;
    return active;
  };
  return {
    start() {
      active = { code: String(randomInt(1_000_000)).padStart(6, '0'), expiresAt: now() + PAIRING_TTL_MS, total: 0, wrong: new Map() };
      return { code: active.code, expiresAt: active.expiresAt };
    },
    current() {
      const a = live();
      return a ? { code: a.code, expiresAt: a.expiresAt } : null;
    },
    attempt(code, fromId) {
      const a = live();
      if (!a) return 'none';
      const mine = a.wrong.get(fromId) ?? 0;
      if (mine >= PAIRING_MAX_ATTEMPTS) return 'blocked';
      const given = Buffer.from(String(code));
      const want = Buffer.from(a.code);
      if (given.length === want.length && crypto.timingSafeEqual(given, want)) { active = null; return 'ok'; }
      a.wrong.set(fromId, mine + 1);
      if (++a.total >= PAIRING_MAX_TOTAL) active = null;
      return 'wrong';
    },
    cancel() { active = null; },
  };
}
