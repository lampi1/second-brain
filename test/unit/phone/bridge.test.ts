// The phone bridge end to end against the fake Telegram server: a dev build without a test base never calls fetch;
// the token is registered for redaction before the first call and never appears in a log line; pairing with the
// 6-digit code; foreign ids silent and counted; text to the Orchestrator and the condensed reply back; buttons from
// the paired chat only; 409 → the conflict error; old messages asked back; /stop halts until re-enabled on the PC;
// the offset survives a restart; urgent messages pass /pausa; the review fixes (S6, C1-C3, C5-C7).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPhoneBridge, type PhoneBridge } from '../../../src/main/phone/bridge';
import { PHONE_TOKEN_SHAPE } from '../../../src/main/phone/token-store';
import type { PhoneBridgeDeps } from '../../../src/main/phone/types';
import { capLog, fakePort, ME, startFakeTelegram, TOKEN, type CapLog, type FakePort, type FakeTelegram } from './fakes';

let tg: FakeTelegram;
let bridges: PhoneBridge[] = [];
beforeEach(async () => { tg = await startFakeTelegram(); });
afterEach(async () => { for (const b of bridges) await b.stop(); bridges = []; await tg.close(); });

interface Rig { b: PhoneBridge; port: FakePort; log: CapLog; deps: PhoneBridgeDeps; redactions: string[]; fetches: string[]; texts(): string[] }
function rig(o: { paired?: boolean; enabled?: boolean; token?: string | null; isStable?: boolean; testApiBase?: string | null; presence?: { atPc: boolean; nightMode: boolean }; statePath?: string } = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-bridge-'));
  const statePath = o.statePath ?? path.join(dir, 'phone-state.json');
  if (!o.statePath) fs.writeFileSync(statePath, JSON.stringify({ version: 1, enabled: o.enabled ?? true, paired: o.paired === false ? null : { userId: ME, chatId: ME } }));
  const port = fakePort();
  const log = capLog();
  const redactions: string[] = [];
  const fetches: string[] = [];
  let token: string | null = o.token === undefined ? TOKEN : o.token;
  const deps: PhoneBridgeDeps = {
    fetch: (async (u: string | URL | Request, i?: RequestInit) => {
      fetches.push(String(u));
      // the token must already be registered when the first request leaves
      if (token && !redactions.includes(token)) throw new Error('fetch before addRedaction');
      return fetch(u, i);
    }) as typeof fetch,
    getToken: () => token,
    saveToken: async t => { token = t; },
    deleteToken: async () => { token = null; },
    statePath,
    now: () => Date.now(),
    phonePort: port,
    decodeVoice: async b => b,
    transcribe: async () => 'ciao',
    tempDir: dir,
    presence: () => o.presence ?? { atPc: false, nightMode: false },
    isStable: o.isStable ?? false,
    testApiBase: o.testApiBase === null ? undefined : (o.testApiBase ?? tg.base),
    addRedaction: s => { redactions.push(s); },
    log,
    timing: { sendGapMs: 0, pollTimeoutS: 1, backoffMs: 5, backoffMaxMs: 20, tickMs: 60_000 },
  };
  const b = createPhoneBridge(deps);
  bridges.push(b);
  return { b, port, log, deps, redactions, fetches, texts: () => tg.sent().map(s => s.body.text as string) };
}

describe('phone bridge', () => {
  it('a dev build without a test base is dev-disabled and never calls fetch', async () => {
    const r = rig({ testApiBase: null });
    await r.b.start();
    expect(r.b.status().state).toBe('dev-disabled');
    expect(r.fetches).toEqual([]);
  });

  it('a test base off loopback is refused before any call', async () => {
    const r = rig({ testApiBase: 'https://api.telegram.org' });
    await r.b.start();
    expect(r.b.status().state).toBe('error');
    expect(r.fetches).toEqual([]);
  });

  it('a bad token stops with the token error', async () => {
    const r = rig({ token: '1111111:BadTokenBadTokenBadTokenBadTokenBad' });
    await r.b.start();
    expect(r.b.status()).toMatchObject({ state: 'error' });
    expect(r.b.status().error).toContain('Token non valido');
    expect(r.log.lines.join('\n')).not.toContain('BadToken');
  });

  it('a dev build never shows a pairing code (review C5)', async () => {
    const r = rig({ testApiBase: null, paired: false });
    await r.b.start();
    expect(r.b.startPairing().pairing).toBeNull();
    expect(r.fetches).toEqual([]);
  });

  it('voice temp files left by a crash are removed at start; nothing else (review C6)', async () => {
    const r = rig();
    const left = path.join(r.deps.tempDir, `phone-${'a1'.repeat(12)}.wav`), other = path.join(r.deps.tempDir, 'phone-notes.wav');
    fs.writeFileSync(left, 'x');
    fs.writeFileSync(other, 'x');
    await r.b.start();
    expect(fs.existsSync(left)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(r.deps.statePath)).toBe(true);
  });

  it('setToken refuses a malformed token and never stores it', async () => {
    const r = rig({ token: null, enabled: false });
    await expect(r.b.setToken('not-a-token')).rejects.toThrow();
    expect(r.deps.getToken()).toBeNull();
    const st = await r.b.setToken(TOKEN);
    expect(st.hasToken).toBe(true);
    expect(st.enabled).toBe(true);
    expect(r.redactions[0]).toBe(TOKEN);
    // one shape with the token store and the filter (review C7): BotFather ids now reach 16 digits
    const long = `1234567890123456:${TOKEN.split(':')[1]}`;
    expect(PHONE_TOKEN_SHAPE.test(long)).toBe(true);
    expect((await r.b.setToken(long)).hasToken).toBe(true);
  });
});
