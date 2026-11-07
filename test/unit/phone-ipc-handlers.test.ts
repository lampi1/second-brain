// The phone bridge's IPC handlers (ADR 0219, src/main/ipc-handlers/phone.ts): the disabled controller before the
// wiring, the checks on what the page sends (patch, Focus, token), the token never in an answer, every channel handled,
// and the hub that forwards the current controller's changes to the page.
import { expect, it, vi } from 'vitest';
import { PhoneIpcHub, checkFocus, checkPatch, disabledPhoneController, phoneHandlers } from '../../src/main/ipc-handlers/phone';
import { PHONE_IPC, type PhoneController, type PhoneStatus } from '../../src/shared/contract/phone';
import { PHONE_INVOKE_CHANNELS } from '../../src/shared/contract/phone-ipc';

const status = (over: Partial<PhoneStatus> = {}): PhoneStatus => ({ hasToken: false, enabled: false, paired: false, pairing: null, state: 'off', error: null, dropped: 0, quietHours: null, recent: [], ...over });

function fakeController(): PhoneController & { fire: (s: PhoneStatus) => void; focus: (string | null)[]; tokens: string[] } {
  const subs = new Set<(s: PhoneStatus) => void>();
  const focus: (string | null)[] = [], tokens: string[] = [];
  return {
    focus, tokens,
    fire: s => { for (const f of subs) f(s); },
    status: () => status({ state: 'running' }),
    setToken: async t => { tokens.push(t); return status({ hasToken: true }); },
    clearToken: async () => status(),
    startPairing: () => status({ pairing: { code: '123456', expiresAt: 1 } }),
    unpair: () => status(),
    update: p => status({ enabled: p.enabled ?? false }),
    onChanged: cb => { subs.add(cb); return () => subs.delete(cb); },
    setFocus: id => { focus.push(id); },
  };
}

it('the disabled controller says off (or dev-disabled) and refuses every action in Italian', async () => {
  const off = disabledPhoneController();
  expect(off.status()).toEqual(status());
  await expect(off.setToken('x')).rejects.toThrow(/non è attivo/);
  expect(() => off.startPairing()).toThrow(/non è attivo/);
  const dev = disabledPhoneController('dev-disabled', () => true);
  expect(dev.status()).toMatchObject({ state: 'dev-disabled', hasToken: true });
  expect(() => dev.update({ enabled: true })).toThrow(/stable/);
});

it('checkPatch keeps a boolean switch and whole, different hours', () => {
  expect(checkPatch({ enabled: true })).toEqual({ enabled: true });
  expect(checkPatch({ quietHours: null })).toEqual({ quietHours: null });
  expect(checkPatch({ quietHours: { from: 22, to: 7 }, other: 1 })).toEqual({ quietHours: { from: 22, to: 7 } });
  expect(() => checkPatch({ enabled: 'yes' })).toThrow();
  for (const q of [{ from: 7, to: 7 }, { from: 24, to: 1 }, { from: 1.5, to: 2 }, { from: '1', to: 2 }, 5]) expect(() => checkPatch({ quietHours: q })).toThrow(/Fuori orario/);
  expect(checkPatch(undefined)).toEqual({});
});

it('checkFocus takes a short chat id or null', () => {
  expect(checkFocus({ chatId: 'c1' })).toBe('c1');
  expect(checkFocus({ chatId: null })).toBeNull();
  expect(checkFocus({ chatId: '' })).toBeNull();
  expect(checkFocus({ chatId: 'x'.repeat(201) })).toBeNull();
  expect(checkFocus(null)).toBeNull();
});

it('handles every phone channel; the token goes in trimmed and never comes back', async () => {
  const c = fakeController(), decoded = vi.fn(() => true);
  const h = phoneHandlers(() => c, decoded);
  expect(Object.keys(h).sort()).toEqual([...PHONE_INVOKE_CHANNELS].sort());
  const token = '1234567:AAsynthetic_value_for_the_test_only';
  const out = await h[PHONE_IPC.setToken]({ token: `  ${token} ` });
  expect(c.tokens).toEqual([token]);
  expect(JSON.stringify(out)).not.toContain(token);
  expect(() => h[PHONE_IPC.setToken]({ token: '   ' })).toThrow(/BotFather/);
  expect(() => h[PHONE_IPC.setToken](undefined as never)).toThrow(/BotFather/);
  expect(await h[PHONE_IPC.status](undefined)).toMatchObject({ state: 'running' });
  expect(await h[PHONE_IPC.startPairing](undefined)).toMatchObject({ pairing: { code: '123456' } });
  expect(await h[PHONE_IPC.update]({ enabled: true })).toMatchObject({ enabled: true });
  expect(() => h[PHONE_IPC.update]({ quietHours: { from: 3, to: 3 } })).toThrow();
  h[PHONE_IPC.focusChanged]({ chatId: 'chat-1' });
  h[PHONE_IPC.focusChanged]({ chatId: 42 as never });
  expect(c.focus).toEqual(['chat-1', null]);
  h[PHONE_IPC.decodeResult]({ id: 'r', error: 'x' });
  expect(decoded).toHaveBeenCalledWith({ id: 'r', error: 'x' });
});

it('the hub forwards the current controller\'s changes and swaps cleanly', () => {
  const hub = new PhoneIpcHub(), sent: PhoneStatus[] = [];
  expect(hub.controller().status().state).toBe('off');
  hub.forwardTo(s => sent.push(s));
  const a = fakeController(), b = fakeController();
  hub.set(a);
  expect(sent.at(-1)?.state).toBe('running');
  a.fire(status({ state: 'error', error: 'proxy' }));
  expect(sent.at(-1)).toMatchObject({ state: 'error', error: 'proxy' });
  hub.set(b);
  const n = sent.length;
  a.fire(status({ state: 'paused' }));
  expect(sent.length).toBe(n);
  b.fire(status({ state: 'paused' }));
  expect(sent.at(-1)?.state).toBe('paused');
  expect(hub.controller()).toBe(b);
});
