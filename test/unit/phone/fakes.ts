// Test doubles for the phone bridge tests: a fake Telegram Bot API server on 127.0.0.1 (node:http, a random port; it
// speaks /bot<token>/<method> and /file/bot<token>/<path>, keeps the calls, queues updates, can fail a method once),
// a fake PhonePort, a capturing logger and update builders. No real Telegram, no real token.
// Used by test/unit/phone/*.test.ts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PhoneDecidable, PhoneDecideResult, PhonePort } from '../../../src/shared/contract/phone';
import type { PhoneLog, TgUpdate } from '../../../src/main/phone/types';

export const TOKEN = '123456789:AAFakeTokenForTests_abcdefghijklmnopqrst';
export const ME = 4242;

// Made-up sensitive-looking values the filter must hide, joined at runtime because the public-repo guard
// (tools/guard/scan.mjs) reads the source and these shapes are exactly what it hunts (same as agent-pack-guard.test).
const j = (sep: string, ...p: string[]) => p.join(sep);
export const FX = {
  mail: j('@', 'mario', 'rossi.it'),
  mail2: j('@', 'mario.rossi', 'studio.it'),
  mailShort: j('@', 'a', 'b.it'),
  userPass: j('@', 'https://user:pw', 'host.com/x'),
  devops: j('.', 'dev', 'azure', 'com'),
  privateIp: j('.', '10', '0', '0', '1'),
  pw: (v: string) => j('=', 'password', v),
  connString: j(';', 'Server=x', 'Database=y', 'User Id=sa', j('=', 'Password', 'Hunter22'), ''),
  winUserPath: j('\\', 'C:', 'Users', 'mario', 'clienti', 'rossi.xlsx'),
  macHomePath: j('/', '', 'Users', 'mario', 'rossi.txt'),
  guid: j('-', '3f2504e0', '4f89', '11d3', '9a0c', '0305e82c3301'),
};

export interface Call { method: string; body: Record<string, unknown> }
interface Fail { status: number; body: Record<string, unknown> }

export interface FakeTelegram {
  base: string;
  calls: Call[];
  /** raw URLs the server saw (to check nothing but this server was called) */
  urls: string[];
  push(...u: TgUpdate[]): void;
  failNext(method: string, status: number, body?: Record<string, unknown>): void;
  files: Map<string, Buffer>;
  sent(): Call[];
  close(): Promise<void>;
}

export async function startFakeTelegram(token = TOKEN): Promise<FakeTelegram> {
  const calls: Call[] = [];
  const urls: string[] = [];
  const queue: TgUpdate[] = [];
  const fails = new Map<string, Fail[]>();
  const files = new Map<string, Buffer>();
  let nextMessageId = 100;
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d: Buffer) => { raw += d.toString('utf8'); });
    req.on('end', () => {
      const url = req.url ?? '';
      urls.push(url);
      const file = /^\/file\/bot([^/]+)\/(.+)$/.exec(url);
      if (file) {
        if (file[1] !== token) return json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
        const f = files.get(file[2]!);
        if (!f) return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(f.length) });
        return res.end(f);
      }
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(url);
      if (!m) return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
      if (m[1] !== token) return json(res, 401, { ok: false, error_code: 401, description: `Unauthorized ${m[1]}` });
      const method = m[2]!;
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      calls.push({ method, body });
      const f = fails.get(method)?.shift();
      if (f) return json(res, f.status, f.body);
      switch (method) {
        case 'getUpdates': {
          const offset = Number(body.offset ?? 0);
          const reply = () => {
            const out = queue.filter(u => u.update_id >= offset);
            json(res, 200, { ok: true, result: out });
          };
          if (queue.some(u => u.update_id >= offset)) return reply();
          // a long poll: wait a little for new updates (res 'close' = the client went away; req 'close' fires at once)
          const t = setTimeout(reply, 60);
          res.on('close', () => clearTimeout(t));
          return;
        }
        case 'sendMessage': return json(res, 200, { ok: true, result: { message_id: nextMessageId++, date: 0, chat: { id: body.chat_id, type: 'private' }, text: body.text } });
        case 'getFile': {
          const id = String(body.file_id);
          const f = files.get(`voice/${id}.oga`);
          return json(res, 200, { ok: true, result: { file_id: id, file_size: f?.length ?? 0, file_path: `voice/${id}.oga` } });
        }
        case 'getMe': return json(res, 200, { ok: true, result: { id: 1, is_bot: true, first_name: 'Bot' } });
        default: return json(res, 200, { ok: true, result: true });
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    calls, urls, files,
    push: (...u) => { queue.push(...u); },
    failNext: (method, status, body) => { const l = fails.get(method) ?? []; l.push({ status, body: body ?? { ok: false, error_code: status, description: `failure ${status}` } }); fails.set(method, l); },
    sent: () => calls.filter(c => c.method === 'sendMessage'),
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ── updates ────────────────────────────────────────────────────────────────────────────────────────────────────────
let uid = 1;
const nowS = () => Math.floor(Date.now() / 1000);
export function textUpdate(text: string, o: { from?: number; chat?: number; type?: string; date?: number; id?: number } = {}): TgUpdate {
  const from = o.from ?? ME;
  return { update_id: o.id ?? uid++, message: { message_id: uid + 1000, date: o.date ?? nowS() + 5, chat: { id: o.chat ?? from, type: o.type ?? 'private' }, from: { id: from, first_name: 'X' }, text } };
}
export function voiceUpdate(fileId: string, duration = 3, o: { date?: number } = {}): TgUpdate {
  return { update_id: uid++, message: { message_id: uid + 1000, date: o.date ?? nowS() + 5, chat: { id: ME, type: 'private' }, from: { id: ME }, voice: { file_id: fileId, duration } } };
}
export function callbackUpdate(data: string, messageId: number, o: { from?: number; chat?: number } = {}): TgUpdate {
  const from = o.from ?? ME;
  return { update_id: uid++, callback_query: { id: `cb${uid}`, from: { id: from }, data, message: { message_id: messageId, date: nowS(), chat: { id: o.chat ?? from, type: 'private' } } } };
}

// ── PhonePort ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FakePort extends PhonePort {
  texts: { text: string; voice: boolean }[];
  answers: { chatId: string; id: string; yes: boolean }[];
  open: PhoneDecidable[];
  result: PhoneDecideResult;
  queued: boolean;
  emitDecidable(ev: { type: 'added' | 'resolved'; item: PhoneDecidable; by?: 'phone' | 'pc' }): void;
  emitTurnEnd(ev: { reply: string; fromPhone: boolean; failed: boolean }): void;
}

export function fakePort(): FakePort {
  const dec = new Set<(ev: { type: 'added' | 'resolved'; item: PhoneDecidable; by?: 'phone' | 'pc' }) => void>();
  const turn = new Set<(ev: { reply: string; fromPhone: boolean; failed: boolean }) => void>();
  const p: FakePort = {
    texts: [], answers: [], open: [], result: 'ok', queued: false,
    async sendFromPhone(text, opts) { p.texts.push({ text, voice: opts.voice }); return { queued: p.queued }; },
    listDecidable: () => p.open,
    async answerFromPhone(chatId, id, yes) { p.answers.push({ chatId, id, yes }); return p.result; },
    async decidePlanFromPhone(chatId, at, yes) { p.answers.push({ chatId, id: at, yes }); return p.result; },
    onDecidable(cb) { dec.add(cb); return () => { dec.delete(cb); }; },
    onOrchestratorTurnEnd(cb) { turn.add(cb); return () => { turn.delete(cb); }; },
    waitingSummary: () => ({ waiting: p.open.length, orchestratorBusy: false, labels: p.open.map(d => `${d.role} · ${d.neutralLabel}`) }),
    emitDecidable(ev) { for (const cb of dec) cb(ev); },
    emitTurnEnd(ev) { for (const cb of turn) cb(ev); },
  };
  return p;
}

export function question(o: Partial<PhoneDecidable> = {}): PhoneDecidable {
  return { chatId: 'c1', ref: { kind: 'question', requestId: 'r1' }, role: 'Artisan', neutralLabel: 'lavoro 3', text: 'Faccio il commit sul branch?', recommended: 'yes', simple: true, reserved: false, orchestrator: false, ...o };
}

// ── logger ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CapLog extends PhoneLog { lines: string[] }
export function capLog(): CapLog {
  const lines: string[] = [];
  const w = (lvl: string) => (scope: string, msg: string, extra?: unknown) => { lines.push(JSON.stringify({ lvl, scope, msg, extra })); };
  return { lines, debug: w('debug'), info: w('info'), warn: w('warn'), error: w('error') };
}

export async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('waitFor: timed out');
    await new Promise(r => setTimeout(r, 10));
  }
}
