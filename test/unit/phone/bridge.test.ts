// The phone bridge end to end against the fake Telegram server: a dev build without a test base never calls fetch;
// the token is registered for redaction before the first call and never appears in a log line; pairing with the
// 6-digit code; foreign ids silent and counted; text to the Orchestrator and the condensed reply back; buttons from
// the paired chat only; 409 → the conflict error; old messages asked back; /stop halts until re-enabled on the PC;
// the offset survives a restart; urgent messages pass /pausa.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPhoneBridge, ERR_CONFLICT, PAIRED_TEXT, type PhoneBridge } from '../../../src/main/phone/bridge';
import { loadState } from '../../../src/main/phone/state';
import type { PhoneBridgeDeps } from '../../../src/main/phone/types';
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

  it('setToken refuses a malformed token and never stores it', async () => {
    const r = rig({ token: null, enabled: false });
    await expect(r.b.setToken('not-a-token')).rejects.toThrow();
    expect(r.deps.getToken()).toBeNull();
    const st = await r.b.setToken(TOKEN);
    expect(st.hasToken).toBe(true);
    expect(st.enabled).toBe(true);
    expect(r.redactions[0]).toBe(TOKEN);
  });
});
