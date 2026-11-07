// The page's Focus signal and pairing countdown for the phone bridge (ADR 0219, src/renderer/lib/phone.ts): main hears
// the Focus chat once at start and then only on a change (focus:changed); the code's time left reads m:ss.
// The pairing row (pairView): Codice scaduto + Nuovo codice once the code runs out, no pairing in a dev instance.
import { expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/store/ui', () => ({ ui: { get: () => ({ focusMode: null }), subscribe: () => () => {} } }));
import { pairLeft, pairView, watchFocus } from '../../src/renderer/lib/phone';

it('sends the first value, then only changes, and stops when unsubscribed', () => {
  let current: string | null = null, listener: (() => void) | null = null;
  const sent: (string | null)[] = [];
  const stop = watchFocus(() => current, fn => { listener = fn; return () => { listener = null; }; }, id => sent.push(id));
  expect(sent).toEqual([null]);
  listener!();
  expect(sent).toEqual([null]);
  current = 'chat-1'; listener!();
  current = 'chat-1'; listener!();
  current = null; listener!();
  expect(sent).toEqual([null, 'chat-1', null]);
  stop();
  expect(listener).toBeNull();
});

it('pairLeft reads m:ss and never goes below zero', () => {
  expect(pairLeft(10 * 60_000, 0)).toBe('10:00');
  expect(pairLeft(61_500, 0)).toBe('1:02');
  expect(pairLeft(0, 5000)).toBe('0:00');
});

it('the pairing row: an expired code says so with Nuovo codice; a dev instance has no pairing button', () => {
  const now = 1_000_000, code = (expiresAt: number) => ({ code: '123456', expiresAt });
  expect(pairView({ state: 'running', paired: false, pairing: code(now + 1000) }, now)).toEqual({ line: 'code', button: 'start' });
  expect(pairView({ state: 'running', paired: false, pairing: code(now) }, now)).toEqual({ line: 'expired', button: 'new' });
  expect(pairView({ state: 'running', paired: false, pairing: null }, now)).toEqual({ line: 'none', button: 'start' });
  expect(pairView({ state: 'running', paired: true, pairing: null }, now)).toEqual({ line: 'paired', button: 'unpair' });
  expect(pairView({ state: 'dev-disabled', paired: false, pairing: null }, now)).toEqual({ line: 'none', button: null });
});
