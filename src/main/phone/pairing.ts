// Pairing of the phone with the PC (design §5.2): the PC shows a one-time 6-digit code (crypto random), valid 10 minutes,
// usable once; the user sends "/start <code>" to the bot from a private chat and the bridge stores that account's
// from.id and chat.id. 5 wrong attempts invalidate the code (a new one only from the PC). Wrong attempts get no reply.
// Used by bridge.ts (startPairing, the guard's 'pair' verdict); tests: test/unit/phone/pairing.test.ts.
import crypto from 'node:crypto';

export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;

export type PairAttempt = 'ok' | 'wrong' | 'none';

export interface Pairing {
  /** a new code, replacing any previous one */
  start(): { code: string; expiresAt: number };
  /** the code still usable, or null (none, expired, used or invalidated) */
  current(): { code: string; expiresAt: number } | null;
  attempt(code: string): PairAttempt;
  cancel(): void;
}

export function createPairing(now: () => number, randomInt: (max: number) => number = max => crypto.randomInt(max)): Pairing {
  let active: { code: string; expiresAt: number; wrong: number } | null = null;
  const live = () => {
    if (active && now() >= active.expiresAt) active = null;
    return active;
  };
  return {
    start() {
      active = { code: String(randomInt(1_000_000)).padStart(6, '0'), expiresAt: now() + PAIRING_TTL_MS, wrong: 0 };
      return { code: active.code, expiresAt: active.expiresAt };
    },
    current() {
      const a = live();
      return a ? { code: a.code, expiresAt: a.expiresAt } : null;
    },
    attempt(code) {
      const a = live();
      if (!a) return 'none';
      const given = Buffer.from(String(code));
      const want = Buffer.from(a.code);
      if (given.length === want.length && crypto.timingSafeEqual(given, want)) { active = null; return 'ok'; }
      a.wrong++;
      if (a.wrong >= PAIRING_MAX_ATTEMPTS) active = null;
      return 'wrong';
    },
    cancel() { active = null; },
  };
}
