// The Telegram client and the voice pipeline of the phone bridge, against the fake Telegram server: only a loopback
// test base is accepted, long texts split with the buttons on the last part, 429 waits retry_after, network errors
// retry, the token never appears in an error or a log line, downloads capped and paths checked; voice notes refused
// over 5 minutes, the temporary WAV deleted on success and on every failure, no models → "scrivimi in testo".
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTelegramClient, resolveApiBase, splitText, TelegramError, TELEGRAM_API } from '../../../src/main/phone/client';
import { createOutbound } from '../../../src/main/phone/outbound';
import { handleVoice, NO_MODELS } from '../../../src/main/phone/voice';
import { capLog, fakePort, FX, ME, startFakeTelegram, TOKEN, type FakeTelegram } from './fakes';

const timing = { sendGapMs: 0, pollTimeoutS: 1, backoffMs: 1, backoffMaxMs: 5, maxRetryAfterMs: 50 };
let tg: FakeTelegram;
beforeEach(async () => { tg = await startFakeTelegram(); });
afterEach(async () => { await tg.close(); });

const mk = (o: { token?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) => {
  const log = capLog();
  return { log, c: createTelegramClient({ fetch: o.fetch ?? fetch, token: o.token ?? TOKEN, base: tg.base, log, timing, sleep: o.sleep }) };
};

describe('resolveApiBase', () => {
  it('real API by default; a test base only on loopback, root path', () => {
    expect(resolveApiBase()).toBe(TELEGRAM_API);
    expect(resolveApiBase('http://127.0.0.1:8081')).toBe('http://127.0.0.1:8081');
    expect(resolveApiBase('http://localhost:9/')).toBe('http://localhost:9');
    for (const bad of ['https://evil.com', 'http://127.0.0.1.evil.com:1', `http://${FX.privateIp}:80`, 'http://127.0.0.1:1/x', 'file:///c:/x', 'nonsense']) {
      expect(() => resolveApiBase(bad)).toThrow();
    }
  });
});

describe('telegram client', () => {
  it('splits long texts at 4096 chars, buttons only on the last part, no parse_mode, silent flag', async () => {
    const { c } = mk();
    const kb = { inline_keyboard: [[{ text: 'Sì', callback_data: 'a:AAAAAAAAAAAAAAAA:s' }]] };
    await c.sendMessage(ME, `${'a'.repeat(5000)}`, { replyMarkup: kb, silent: true });
    const sent = tg.sent();
    expect(sent).toHaveLength(2);
    expect((sent[0]!.body.text as string).length).toBeLessThanOrEqual(4096);
    expect(sent[0]!.body.reply_markup).toBeUndefined();
    expect(sent[1]!.body.reply_markup).toEqual(kb);
    expect(sent.every(s => s.body.disable_notification === true && s.body.parse_mode === undefined)).toBe(true);
    expect(splitText('ciao\nmondo', 6)).toEqual(['ciao', 'mondo']);
  });

  it('429 waits retry_after and retries', async () => {
    const waits: number[] = [];
    const { c } = mk({ sleep: async ms => { waits.push(ms); } });
    tg.failNext('sendMessage', 429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } });
    await c.sendMessage(ME, 'x');
    expect(waits).toContain(50); // capped by maxRetryAfterMs
    expect(tg.sent()).toHaveLength(2);
  });

  it('a network error retries with backoff, then gives up with a TelegramError', async () => {
    let n = 0;
    const flaky: typeof fetch = async (u, i) => { if (n++ < 2) throw new Error(`connect ECONNREFUSED ${String(u)}`); return fetch(u, i); };
    const { c } = mk({ fetch: flaky, sleep: async () => undefined });
    await expect(c.getMe()).resolves.toMatchObject({ is_bot: true });
    const dead: typeof fetch = async u => { throw new Error(`boom ${String(u)}`); };
    const { c: c2 } = mk({ fetch: dead, sleep: async () => undefined });
    const err = (await c2.getMe().catch((e: unknown) => e)) as TelegramError;
    expect(err).toBeInstanceOf(TelegramError);
    expect(err.code).toBe('network');
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain('[redacted]');
  });

  it('a wrong token: 401, the token never in the error nor in the log', async () => {
    const { c, log } = mk({ token: '999:WrongTokenWrongTokenWrongTokenWrong' });
    const err = (await c.deleteWebhook().catch((e: unknown) => e)) as TelegramError;
    expect(err.code).toBe(401);
    expect(err.message).not.toContain('WrongToken');
    expect(log.lines.join('\n')).not.toContain('WrongToken');
  });

  it('409 conflict surfaces at once (no retry)', async () => {
    const { c } = mk();
    tg.failNext('getUpdates', 409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' });
    await expect(c.getUpdates(0)).rejects.toMatchObject({ code: 409 });
  });

  it('downloads: capped by content-length and by streaming, bad paths refused', async () => {
    const { c } = mk();
    tg.files.set('voice/a.oga', Buffer.alloc(100, 1));
    expect((await c.download('voice/a.oga', 1000)).byteLength).toBe(100);
    await expect(c.download('voice/a.oga', 50)).rejects.toMatchObject({ code: 'too-large' });
    await expect(c.download('../secret', 1000)).rejects.toMatchObject({ code: 400 });
    await expect(c.download('voice/a.oga?x=1', 1000)).rejects.toMatchObject({ code: 400 });
    const lying: typeof fetch = async () => new Response(new Uint8Array(200), { headers: { 'content-length': '1' } });
    const { c: c2 } = mk({ fetch: lying });
    await expect(c2.download('voice/a.oga', 50)).rejects.toMatchObject({ code: 'too-large' });
  });
});

describe('voice', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'phone-voice-'));
  const setup = (transcribe: (p: string) => Promise<string | null>, decode: (b: Uint8Array) => Promise<Uint8Array> = async () => new Uint8Array([1, 2, 3])) => {
    const { c, log } = mk();
    const out = createOutbound(() => c, () => ME, log);
    const port = fakePort();
    const tempDir = tmp();
    const seen: string[] = [];
    const deps = { client: c, out, port, decodeVoice: decode, tempDir, log, transcribe: async (p: string) => { seen.push(p); expect(fs.existsSync(p)).toBe(true); return transcribe(p); } };
    return { deps, port, tempDir, seen };
  };
  const texts = () => tg.sent().map(s => s.body.text as string);

  it('transcribes, echoes, sends to the Orchestrator and deletes the temp WAV', async () => {
    tg.files.set('voice/v1.oga', Buffer.alloc(10));
    const s = setup(async () => `apri attività per ${FX.mail}`);
    expect(await handleVoice({ file_id: 'v1', duration: 4 }, s.deps)).toBe('sent');
    expect(s.port.texts).toEqual([{ text: `apri attività per ${FX.mail}`, voice: true }]);
    expect(texts()[0]).toBe('🎙️ Ho capito: «apri attività per [email]»');
    expect(s.seen[0]!).toMatch(/phone-[0-9a-f]{24}\.wav$/);
    expect(fs.readdirSync(s.tempDir)).toEqual([]);
  });

  it('deletes the temp WAV when the transcription throws', async () => {
    tg.files.set('voice/v2.oga', Buffer.alloc(10));
    const s = setup(async () => { throw new Error('engine crashed'); });
    expect(await handleVoice({ file_id: 'v2', duration: 4 }, s.deps)).toBe('error');
    expect(s.seen).toHaveLength(1);
    expect(fs.readdirSync(s.tempDir)).toEqual([]);
    expect(s.port.texts).toEqual([]);
    expect(texts()[0]).toContain('scrivimi in testo');
  });

  it('no voice models → the "attiva la voce" message, nothing left on disk', async () => {
    tg.files.set('voice/v3.oga', Buffer.alloc(10));
    const s = setup(async () => null);
    expect(await handleVoice({ file_id: 'v3', duration: 4 }, s.deps)).toBe('no-models');
    expect(texts()).toEqual([NO_MODELS]);
    expect(fs.readdirSync(s.tempDir)).toEqual([]);
  });

  it('decode failure writes nothing; empty text asks to retry', async () => {
    tg.files.set('voice/v4.oga', Buffer.alloc(10));
    const s = setup(async () => 'x', async () => { throw new Error('bad ogg'); });
    expect(await handleVoice({ file_id: 'v4', duration: 4 }, s.deps)).toBe('error');
    expect(s.seen).toEqual([]);
    expect(fs.readdirSync(s.tempDir)).toEqual([]);
    const s2 = setup(async () => '   ');
    expect(await handleVoice({ file_id: 'v4', duration: 4 }, s2.deps)).toBe('empty');
    expect(fs.readdirSync(s2.tempDir)).toEqual([]);
  });

  it('refuses over 5 minutes or 20 MB before downloading', async () => {
    const s = setup(async () => 'x');
    expect(await handleVoice({ file_id: 'v5', duration: 301 }, s.deps)).toBe('too-long');
    expect(await handleVoice({ file_id: 'v5', duration: 3, file_size: 21 * 1024 * 1024 }, s.deps)).toBe('too-large');
    expect(tg.calls.filter(c => c.method === 'getFile')).toHaveLength(0);
  });
});
