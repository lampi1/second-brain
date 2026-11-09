// The phone bridge end to end against the fake Telegram server: a dev build without a test base never calls fetch;
// the token is registered for redaction before the first call and never appears in a log line; pairing with the
// 6-digit code; foreign ids silent and counted; text to the Orchestrator and the condensed reply back; buttons from
// the paired chat only; 409 → the conflict error; old messages asked back; /stop halts until re-enabled on the PC;
// the offset survives a restart; urgent messages pass /pausa; the review fixes (S6, C1-C3, C5-C7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPhoneBridge, ERR_CONFLICT, PAIRED_TEXT, type PhoneBridge } from '../../../src/main/phone/bridge';
import { loadState } from '../../../src/main/phone/state';
import { PHONE_TOKEN_SHAPE } from '../../../src/main/phone/token-store';
import type { PhoneBridgeDeps } from '../../../src/main/phone/types';
import type { PhoneOutcome } from '../../../src/shared/contract/phone';
import { callbackUpdate, capLog, fakePort, FX, ME, question, startFakeTelegram, textUpdate, TOKEN, waitFor, type CapLog, type FakePort, type FakeTelegram } from './fakes';

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
  it.each([
    { atPc: false, nightMode: true, focus: null },
    { atPc: true, nightMode: false, focus: null },
    { atPc: false, nightMode: false, focus: 'another-chat' },
  ])('canonical outcomes respect policy: %j', async ({ atPc, nightMode, focus }) => {
    const r = rig({ presence: { atPc, nightMode } });
    const presence = vi.fn(r.deps.presence); r.deps.presence = presence;
    let outcome!: (ev: PhoneOutcome) => void;
    r.port.onOutcome = cb => { outcome = cb; return () => {}; };
    await r.b.start(); r.b.setFocus(focus); presence.mockClear();
    outcome({ runId: 'blocked-outcome', revision: 1, text: 'Should remain on the PC' });
    // The second queued event reaches policy only after the first outcome's send has settled.
    outcome({ runId: 'blocked-outcome', revision: 1, text: 'Should remain on the PC' });
    await vi.waitFor(() => expect(presence).toHaveBeenCalledTimes(2));
    expect(loadState(r.deps.statePath).outcomes ?? []).toEqual([]);
    expect(r.texts()).toEqual(['🟢 PC collegato']);
  });

  it('canonical outcomes in a phone conversation use quiet hours and edit corrections only when policy allows', async () => {
    const presence = { atPc: false, nightMode: false }, r = rig({ presence });
    let outcome!: (ev: PhoneOutcome) => void;
    r.port.onOutcome = cb => { outcome = cb; return () => {}; };
    await r.b.start(); r.b.update({ quietHours: null });
    tg.push(textUpdate('Give me the result'));
    await waitFor(() => r.port.texts.length === 1);
    outcome({ runId: 'result', revision: 1, text: 'First result' });
    await waitFor(() => r.texts().includes('First result'));
    expect(tg.sent().find(s => s.body.text === 'First result')!.body.disable_notification).not.toBe(true);
    await vi.waitFor(() => expect(loadState(r.deps.statePath).outcomes?.[0]?.messageId).toEqual(expect.any(Number)));
    presence.nightMode = true;
    const observed = vi.fn(r.deps.presence); r.deps.presence = observed;
    outcome({ runId: 'result', revision: 2, text: 'Correction at night' });
    await vi.waitFor(() => expect(observed.mock.calls.length > 0 || loadState(r.deps.statePath).outcomes?.[0]?.revision === 2).toBe(true));
    expect(loadState(r.deps.statePath).outcomes?.[0]?.revision).toBe(1);
    presence.nightMode = false;
    outcome({ runId: 'result', revision: 2, text: 'Allowed correction' });
    await waitFor(() => tg.calls.some(c => c.method === 'editMessageText' && c.body.text === 'Allowed correction'));
    expect(r.texts().filter(t => t === 'First result')).toHaveLength(1);
  });

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

  it('starts: addRedaction first, deleteWebhook, the start notice, then polling; the token never in logs', async () => {
    const r = rig();
    await r.b.start();
    expect(r.redactions).toEqual([TOKEN]);
    expect(tg.calls[0]!.method).toBe('deleteWebhook');
    await waitFor(() => tg.calls.some(c => c.method === 'getUpdates'));
    expect(r.texts()).toEqual(['🟢 PC collegato']);
    expect(r.b.status().state).toBe('running');
    await r.b.stop();
    expect(r.texts()).toContain('🔴 App chiusa');
    expect(r.log.lines.join('\n')).not.toContain(TOKEN.split(':')[1]);
  });

  it('a bad token stops with the token error', async () => {
    const r = rig({ token: '1111111:BadTokenBadTokenBadTokenBadTokenBad' });
    await r.b.start();
    expect(r.b.status()).toMatchObject({ state: 'error' });
    expect(r.b.status().error).toContain('Token non valido');
    expect(r.log.lines.join('\n')).not.toContain('BadToken');
  });

  it('pairing: only /start with the right code links the account; others stay silent', async () => {
    const r = rig({ paired: false });
    const code = r.b.startPairing().pairing!.code;
    await waitFor(() => r.b.status().state === 'running');
    tg.push(textUpdate('ciao', { from: 77 }), textUpdate('/start 000000', { from: 77 }));
    await waitFor(() => r.b.status().dropped >= 1);
    tg.push(textUpdate(`/start ${code}`, { from: 77 }));
    await waitFor(() => r.texts().length === 1);
    expect(r.b.status().paired).toBe(true);
    expect(r.texts()).toEqual([PAIRED_TEXT]);
    expect(tg.sent()[0]!.body.chat_id).toBe(77);
    expect(loadState(r.deps.statePath).paired).toEqual({ userId: 77, chatId: 77 });
  });

  it('a stranger guessing the code cannot burn it; the PC sees the attempts (review S6)', async () => {
    const r = rig({ paired: false });
    const code = r.b.startPairing().pairing!.code;
    const wrong = code === '000000' ? '000001' : '000000';
    await waitFor(() => r.b.status().state === 'running');
    tg.push(...Array.from({ length: 6 }, () => textUpdate(`/start ${wrong}`, { from: 666 })));
    await waitFor(() => r.b.status().dropped === 6);
    expect(r.b.status().recent.map(a => a.label)).toEqual(['associazione: codice errato', 'associazione: troppi tentativi da un account']);
    expect(r.b.status().pairing?.code).toBe(code);
    tg.push(textUpdate(`/start ${code}`, { from: 666 }));
    await waitFor(() => r.b.status().dropped === 7);
    expect(r.b.status().paired).toBe(false);
    tg.push(textUpdate(`/start ${code}`, { from: 77 }));
    await waitFor(() => r.texts().length === 1);
    expect(r.b.status().paired).toBe(true);
    expect(r.texts()).toEqual([PAIRED_TEXT]);
  });

  it('foreign ids are dropped silently and counted', async () => {
    const r = rig();
    await r.b.start();
    tg.push(textUpdate('dammi i clienti', { from: 999 }), callbackUpdate('a:AAAAAAAAAAAAAAAA:s', 100, { from: 999 }));
    await waitFor(() => r.b.status().dropped === 2);
    expect(r.port.texts).toEqual([]);
    expect(r.texts()).toEqual(['🟢 PC collegato']);
  });

  it('text goes to the Orchestrator; the reply comes back condensed and filtered', async () => {
    const r = rig();
    await r.b.start();
    tg.push(textUpdate('come va la PR?'));
    await waitFor(() => r.port.texts.length === 1);
    expect(r.port.texts[0]).toEqual({ text: 'come va la PR?', voice: false });
    r.port.emitTurnEnd({ reply: `PR verde, vedi https://${FX.devops}/org/p/_git/r/pullrequest/9 e lancia \`git push\`. ${'Dettaglio. '.repeat(100)}`, fromPhone: true, failed: false });
    await waitFor(() => r.texts().length === 2);
    const reply = r.texts()[1]!;
    expect(reply).toContain(`${FX.devops}/...`);
    expect(reply).not.toContain('git push');
    expect(reply.endsWith('Continua sul PC')).toBe(true);
  });

  it('a decidable is offered with buttons; a press from the paired chat answers, a forged one does nothing', async () => {
    const r = rig();
    await r.b.start();
    const q = question({ orchestrator: true });
    r.port.open = [q];
    tg.push(textUpdate('ci sei?')); // a phone conversation is active → Orchestrator questions go at once
    await waitFor(() => r.port.texts.length === 1);
    r.port.emitDecidable({ type: 'added', item: q });
    await waitFor(() => tg.sent().some(s => s.body.reply_markup));
    const msg = tg.sent().find(s => s.body.reply_markup)!;
    const kb = msg.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    const yes = kb.inline_keyboard[0]![0]!.callback_data;
    const msgId = 100 + tg.sent().indexOf(msg);
    tg.push(callbackUpdate(yes, msgId, { from: 999 }), callbackUpdate(yes, msgId + 1), callbackUpdate(yes, msgId));
    await waitFor(() => r.port.answers.length === 1);
    expect(r.port.answers[0]).toEqual({ chatId: 'c1', id: 'r1', yes: true });
    await waitFor(() => tg.calls.some(c => c.method === 'editMessageText'));
    tg.push(callbackUpdate(yes, msgId));
    await waitFor(() => tg.calls.filter(c => c.method === 'answerCallbackQuery').length >= 3);
    expect(r.port.answers).toHaveLength(1);
  });

  it('409 conflict → the conflict error, then back to running', async () => {
    const r = rig();
    tg.failNext('getUpdates', 409, { ok: false, error_code: 409, description: 'Conflict' });
    await r.b.start();
    await waitFor(() => r.b.status().error === ERR_CONFLICT);
    await waitFor(() => r.b.status().state === 'running');
  });

  it('messages sent while the app was closed are asked back, not run', async () => {
    const r = rig();
    await r.b.start();
    tg.push(textUpdate('vecchio ordine', { date: Math.floor(Date.now() / 1000) - 600 }));
    await waitFor(() => r.texts().some(t => t.startsWith('📨 Ricevuto alle')));
    expect(r.port.texts).toEqual([]);
    const ask = tg.sent().find(s => (s.body.text as string).startsWith('📨'))!;
    const kb = ask.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    tg.push(callbackUpdate(kb.inline_keyboard[0]![0]!.callback_data, 100 + tg.sent().indexOf(ask)));
    await waitFor(() => r.port.texts.length === 1);
    expect(r.port.texts[0]!.text).toBe('vecchio ordine');
  });

  it('/stop halts the bridge until it is re-enabled on the PC; the offset is kept', async () => {
    const r = rig();
    await r.b.start();
    tg.push(textUpdate('/stop'));
    await waitFor(() => r.b.status().state === 'stopped-from-phone');
    expect(r.texts().some(t => t.includes('Riaccendilo dal PC'))).toBe(true);
    const offset = loadState(r.deps.statePath).offset;
    expect(offset).toBeGreaterThan(0);
    await r.b.start();
    expect(r.b.status().state).toBe('stopped-from-phone');
    const pollsBefore = tg.calls.filter(c => c.method === 'getUpdates').length;
    r.b.update({ enabled: true });
    await waitFor(() => tg.calls.filter(c => c.method === 'getUpdates').length > pollsBefore);
    expect(r.b.status().state).toBe('running');
    expect(tg.calls.filter(c => c.method === 'getUpdates')[pollsBefore]!.body.offset).toBe(offset);
  });

  it('/pausa silences everything but urgent', async () => {
    const r = rig();
    await r.b.start();
    tg.push(textUpdate('/pausa'));
    await waitFor(() => r.texts().some(t => t.includes('pausa')));
    expect(r.b.status().state).toBe('paused');
    const before = r.texts().length;
    r.port.emitTurnEnd({ reply: 'fatto', fromPhone: false, failed: false });
    await r.b.notifyUrgent('production', 'Air giù per Db_Studio_Rossi');
    await waitFor(() => r.texts().length === before + 1);
    expect(r.texts()[before]).toBe('🚨 PRODUZIONE\nAir giù per [db]');
  });

  it('start while starting: one client, one poll; stop while Telegram answers: no start notice, no polling', async () => {
    const r = rig();
    const real = r.deps.fetch;
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    r.deps.fetch = (async (u: string | URL | Request, i?: RequestInit) => { if (String(u).endsWith('/deleteWebhook')) await gate; return real(u, i); }) as typeof fetch;
    const a = r.b.start(), b = r.b.start();
    release();
    await Promise.all([a, b]);
    await waitFor(() => tg.calls.some(c => c.method === 'getUpdates'));
    expect(tg.calls.filter(c => c.method === 'deleteWebhook')).toHaveLength(1);
    expect(r.texts()).toEqual(['🟢 PC collegato']);
    await r.b.stop();

    const r2 = rig();
    let release2!: () => void;
    const gate2 = new Promise<void>(res => { release2 = res; });
    r2.deps.fetch = (async (u: string | URL | Request, i?: RequestInit) => { if (String(u).endsWith('/deleteWebhook')) await gate2; return real(u, i); }) as typeof fetch;
    const before = tg.calls.length;
    const s = r2.b.start();
    await r2.b.stop();
    release2();
    await s;
    await new Promise(res => setTimeout(res, 100));
    const after = tg.calls.slice(before).map(c => c.method);
    expect(after).not.toContain('getUpdates');
    expect(after).not.toContain('sendMessage');
    expect(r2.b.status().state).not.toBe('running');
  });

  it('a failed chat reaches the phone when away, never while at the PC', async () => {
    let atPc = true;
    const r = rig();
    r.deps.presence = () => ({ atPc, nightMode: false });
    await r.b.start();
    await waitFor(() => r.b.status().state === 'running');
    const before = r.texts().length;
    r.port.emitChatFailed({ chatId: 'c1', role: 'Scout', neutralLabel: 'lavoro 1' });
    await new Promise(res => setTimeout(res, 50));
    expect(r.texts().length).toBe(before);
    atPc = false;
    r.port.emitChatFailed({ chatId: 'c1', role: 'Scout', neutralLabel: 'lavoro 1' });
    await waitFor(() => r.texts().length === before + 1);
    expect(r.texts()[before]).toBe('⚠️ Scout · lavoro 1 si è fermata con un errore: guarda sul PC.');
  });

  it('repeated 409s back off longer each time and log the conflict once (review C1)', async () => {
    const r = rig();
    const real = r.deps.fetch;
    const polls: number[] = [];
    r.deps.fetch = (async (u: string | URL | Request, i?: RequestInit) => { if (String(u).endsWith('/getUpdates')) polls.push(Date.now()); return real(u, i); }) as typeof fetch;
    for (let n = 0; n < 5; n++) tg.failNext('getUpdates', 409, { ok: false, error_code: 409, description: 'Conflict' });
    await r.b.start();
    await waitFor(() => polls.length >= 6);
    // backoff 5 ms base, 20 ms cap: 10 + 20 + 20 + 20 + 20 after the five 409s (a fixed 5 ms before the fix: 25 ms)
    expect(polls[5]! - polls[0]!).toBeGreaterThanOrEqual(80);
    expect(r.log.lines.filter(l => l.includes('telegram polling conflict'))).toHaveLength(1);
    await waitFor(() => r.b.status().state === 'running');
  });

  it('after /stop the PC switch shows off; turning it on clears the stop (review C2)', async () => {
    const r = rig();
    await r.b.start();
    expect(r.b.status().enabled).toBe(true);
    tg.push(textUpdate('/stop'));
    await waitFor(() => r.b.status().state === 'stopped-from-phone');
    expect(r.b.status().enabled).toBe(false);
    r.b.update({ enabled: true });
    expect(r.b.status().enabled).toBe(true);
  });

  it('a stop that ends after a new start leaves the new loop running (review C3)', async () => {
    const r = rig();
    const real = r.deps.fetch;
    // getUpdates ignores the abort and, once the gate closes, holds its answer: the stopped loop outlives the stop
    let gate: Promise<void> = Promise.resolve(), open = () => {};
    r.deps.fetch = (async (u: string | URL | Request, i?: RequestInit) => {
      if (!String(u).endsWith('/getUpdates')) return real(u, i);
      const res = await real(u, { ...i, signal: undefined });
      await gate;
      return res;
    }) as typeof fetch;
    await r.b.start();
    await waitFor(() => tg.calls.some(c => c.method === 'getUpdates'));
    gate = new Promise(res => { open = res; });
    const sent = r.texts().length;
    const stopping = r.b.stop();
    // past the stop notice the halt waits for the old loop; a start now begins a new one
    await waitFor(() => r.texts().length > sent);
    await new Promise(res => setTimeout(res, 20));
    await r.b.start();
    expect(r.b.status().state).toBe('running');
    open();
    await stopping;
    expect(r.b.status().state).toBe('running');
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
