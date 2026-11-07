// Guard, pairing and saved state of the phone bridge: foreign ids, groups, chat/from mismatch, bots and unknown update
// kinds dropped and counted; /start before pairing only; rate limit with one notice; pairing code random, single use,
// 10-minute expiry, 5 wrong attempts; the state file sanitized and written atomically, never holding message text.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuard } from '../../../src/main/phone/guard';
import { createPairing, PAIRING_TTL_MS } from '../../../src/main/phone/pairing';
import { defaultState, loadState, pushAction, saveState, sanitizeState } from '../../../src/main/phone/state';
import { callbackUpdate, ME, textUpdate } from './fakes';

describe('guard', () => {
  const g = () => { let t = 0; return { guard: createGuard(() => t), at: (v: number) => { t = v; } }; };

  it('lets the paired user through, drops every other id silently and counts it', () => {
    const { guard } = g();
    expect(guard.check(textUpdate('ciao'), ME).kind).toBe('message');
    expect(guard.check(textUpdate('ciao', { from: 999 }), ME)).toEqual({ kind: 'drop', reason: 'foreign' });
    expect(guard.dropped).toBe(1);
  });

  it('drops groups, channels, a chat id different from the sender and bots', () => {
    const { guard } = g();
    expect(guard.check(textUpdate('x', { type: 'group', chat: -100 }), ME).kind).toBe('drop');
    expect(guard.check(textUpdate('x', { type: 'supergroup', chat: ME }), ME).kind).toBe('drop');
    expect(guard.check(textUpdate('x', { chat: 555 }), ME)).toEqual({ kind: 'drop', reason: 'chat-mismatch' });
    const bot = textUpdate('x'); bot.message!.from!.is_bot = true;
    expect(guard.check(bot, ME).kind).toBe('drop');
    expect(guard.dropped).toBe(4);
  });

  it('drops unknown update kinds and updates carrying two kinds', () => {
    const { guard } = g();
    expect(guard.check({ update_id: 1, edited_message: textUpdate('x').message }, ME).kind).toBe('drop');
    expect(guard.check({ update_id: 1, inline_query: {} }, ME).kind).toBe('drop');
    const both = { ...textUpdate('x'), callback_query: callbackUpdate('a:x:s', 1).callback_query };
    expect(guard.check(both, ME).kind).toBe('drop');
  });

  it('before pairing passes only /start <code> from a private chat', () => {
    const { guard } = g();
    expect(guard.check(textUpdate('/start 123456', { from: 77 }), null)).toEqual({ kind: 'pair', code: '123456', userId: 77, chatId: 77 });
    expect(guard.check(textUpdate('/start@MyBot 123456', { from: 77 }), null).kind).toBe('pair');
    expect(guard.check(textUpdate('ciao', { from: 77 }), null).kind).toBe('drop');
    expect(guard.check(textUpdate('/start 123456', { from: 77, type: 'group', chat: -5 }), null).kind).toBe('drop');
    expect(guard.check(callbackUpdate('a:x:s', 1, { from: 77 }), null).kind).toBe('drop');
  });

  it('callbacks: only from the paired id, on a message of the paired private chat', () => {
    const { guard } = g();
    expect(guard.check(callbackUpdate('a:x:s', 1), ME).kind).toBe('callback');
    expect(guard.check(callbackUpdate('a:x:s', 1, { from: 999 }), ME).kind).toBe('drop');
    expect(guard.check(callbackUpdate('a:x:s', 1, { chat: 999 }), ME).kind).toBe('drop');
    const noMsg = callbackUpdate('a:x:s', 1); delete noMsg.callback_query!.message;
    expect(guard.check(noMsg, ME).kind).toBe('drop');
  });

  it('rate limit: 20 messages in 10 minutes, then ignored with a single notice, then free again', () => {
    const { guard, at } = g();
    for (let i = 0; i < 20; i++) expect(guard.check(textUpdate(`m${i}`), ME).kind).toBe('message');
    const over = guard.check(textUpdate('21'), ME);
    expect(over).toMatchObject({ kind: 'rate-limited', notify: true });
    expect(guard.check(textUpdate('22'), ME)).toMatchObject({ kind: 'rate-limited', notify: false });
    at(10 * 60_000 + 1);
    expect(guard.check(textUpdate('later'), ME).kind).toBe('message');
  });
});

describe('pairing', () => {
  it('a 6-digit code, single use', () => {
    const t = 0;
    const p = createPairing(() => t, () => 4821);
    const { code } = p.start();
    expect(code).toBe('004821');
    expect(p.attempt('004821', 77)).toBe('ok');
    expect(p.attempt('004821', 77)).toBe('none');
    expect(p.current()).toBeNull();
  });

  it('uses crypto randomness by default', () => {
    const p = createPairing(() => 0);
    const codes = new Set(Array.from({ length: 20 }, () => p.start().code));
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(15);
  });

  it('expires after 10 minutes', () => {
    let t = 0;
    const p = createPairing(() => t, () => 111111);
    p.start();
    t = PAIRING_TTL_MS;
    expect(p.attempt('111111', 77)).toBe('none');
  });

  it('a code that ran out stays shown as expired, without its digits, until a new code or a cancel (Sentinel review)', () => {
    let t = 0;
    const p = createPairing(() => t, () => 111111);
    expect(p.shown()).toBeNull();
    p.start();
    expect(p.shown()).toEqual({ code: '111111', expiresAt: PAIRING_TTL_MS });
    t = PAIRING_TTL_MS;
    expect(p.current()).toBeNull();
    expect(p.shown()).toEqual({ code: '', expiresAt: PAIRING_TTL_MS });
    expect(p.shown()).toEqual({ code: '', expiresAt: PAIRING_TTL_MS });
    p.start();
    expect(p.shown()!.code).toBe('111111');
    t = 2 * PAIRING_TTL_MS + 1;
    p.cancel();
    expect(p.shown()).toBeNull();
  });

  it('5 wrong attempts block that account only: a stranger cannot burn the owner’s code (review S6)', () => {
    const p = createPairing(() => 0, () => 222222);
    p.start();
    for (let i = 0; i < 5; i++) expect(p.attempt('000000', 666)).toBe('wrong');
    expect(p.attempt('222222', 666)).toBe('blocked');
    expect(p.current()).not.toBeNull();
    expect(p.attempt('222222', 77)).toBe('ok');
  });

  it('a new code gives every account its attempts back; many accounts guessing still invalidate it', () => {
    const p = createPairing(() => 0, () => 222222);
    p.start();
    for (let i = 0; i < 5; i++) p.attempt('000000', 666);
    p.start();
    expect(p.attempt('000001', 666)).toBe('wrong');
    for (let id = 1; p.current(); id++) p.attempt('000000', id);
    expect(p.attempt('222222', 77)).toBe('none');
  });

  it('a different length or a non-digit code is wrong', () => {
    const p = createPairing(() => 0, () => 333333);
    p.start();
    expect(p.attempt('3333333', 77)).toBe('wrong');
    expect(p.attempt('', 77)).toBe('wrong');
    expect(p.attempt('333333', 77)).toBe('ok');
  });
});

describe('state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-state-'));

  it('missing or broken file → defaults', () => {
    expect(loadState(path.join(dir, 'none.json'))).toEqual(defaultState());
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    expect(loadState(path.join(dir, 'bad.json'))).toEqual(defaultState());
  });

  it('sanitizes every field and drops unknown ones', () => {
    const s = sanitizeState({ offset: -3, paired: { userId: 5, chatId: 6 }, enabled: 'yes', quietHours: { from: 25, to: 1 }, recent: [{ at: 1, kind: 'evil', label: 'x' }, { at: 2, kind: 'text', label: 'messaggio' }], extra: 'leak' });
    expect(s.offset).toBe(0);
    expect(s.paired).toBeNull();
    expect(s.enabled).toBe(false);
    expect(s.quietHours).toEqual({ from: 22, to: 7 });
    expect(s.recent).toEqual([{ at: 2, kind: 'text', label: 'messaggio' }]);
    expect(s).not.toHaveProperty('extra');
  });

  it('writes atomically and keeps only the last 20 actions', () => {
    const file = path.join(dir, 'phone-state.json');
    const s = defaultState();
    for (let i = 0; i < 25; i++) pushAction(s, { at: i, kind: 'text', label: 'messaggio' });
    s.offset = 42; s.paired = { userId: 9, chatId: 9 };
    saveState(file, s);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    const back = loadState(file);
    expect(back.recent).toHaveLength(20);
    expect(back.recent[0]!.at).toBe(5);
    expect(back.offset).toBe(42);
    expect(back.paired).toEqual({ userId: 9, chatId: 9 });
  });
});
