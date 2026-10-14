// ApiSession (ADR 0046, engine kind "api") against a local HTTP server on 127.0.0.1 that speaks the OpenAI chat
// completions and the Anthropic Messages streams as SSE: streamed text, usage → cost, the key only in its header (never
// in an item, the history file or an error), resume from the history file, interrupt, a rejected key, redirects not
// followed, plain http refused off this computer, images → the text-only note. No real endpoint is ever called.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ApiSession, MISSING_KEY, TEXT_ONLY, checkBaseUrl, historyItems, type ApiOptions } from '../../../src/main/chats/api';
import { PNG_1PX, recSink, tmp, waitFor, type RecSink } from './helpers';

const KEY = 'sk-test-SECRET-0123456789abcdef';

interface Seen { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }
const seen: Seen[] = [];
/** what the next request gets: a normal stream, a hanging one, a status, a redirect */
let mode: 'ok' | 'hang' | 'redirect' | number = 'ok';
let base = '';

const sse = (res: http.ServerResponse, events: unknown[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`);
  res.end();
};

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d: Buffer) => { raw += d.toString('utf8'); });
  req.on('end', () => {
    seen.push({ url: req.url ?? '', headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
    if (req.url?.startsWith('/elsewhere')) return sse(res, [{ choices: [{ delta: { content: 'redirected!' } }] }, 'data: [DONE]\n\n']);
    if (mode === 'redirect') { res.writeHead(307, { location: `${base}/elsewhere/chat/completions` }); return res.end(); }
    if (typeof mode === 'number') { res.writeHead(mode, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `bad key ${KEY}` } })); }
    if (mode === 'hang') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Inizio' } }] })}\n\n`); return; }
    if (req.url === '/v1/chat/completions') {
      return sse(res, [
        { choices: [{ delta: { role: 'assistant', content: 'Ciao' } }] },
        ': keep-alive comment\n\n',
        { choices: [{ delta: { content: ', come ' } }] },
        { choices: [{ delta: { content: 'stai?' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 500 } },
        'data: [DONE]\n\n',
      ]);
    }
    if (req.url === '/v1/messages') {
      return sse(res, [
        'event: message_start\r\n' + `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 2000, output_tokens: 1 } } })}\r\n\r\n`,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Buon' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'giorno' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } },
        { type: 'message_stop' },
      ]);
    }
    res.writeHead(404); res.end();
  });
});

beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));

const open: ApiSession[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(s => s.close()));
  seen.length = 0;
  mode = 'ok';
});

function start(extra: Partial<ApiOptions> = {}): { s: ApiSession; sink: RecSink; historyFile: string } {
  const historyFile = extra.historyFile ?? path.join(tmp('api'), 'history.json');
  const sink = recSink();
  const s = new ApiSession({
    chatId: 'c_api', cwd: tmp('cwd'), engineId: 'deepseek', protocol: 'openai', baseUrl: `${base}/v1`, model: 'deepseek-chat',
    apiKey: () => KEY, historyFile, pricesOf: () => ({ inputPerMTok: 2, outputPerMTok: 10 }), ...extra,
  }, sink);
  open.push(s);
  s.start();
  return { s, sink, historyFile };
}
const results = (sink: RecSink) => [...sink.items.values()].filter(i => i.kind === 'result');
const turnDone = (sink: RecSink, n = 1) => waitFor(() => results(sink).length >= n && sink.patch.state === 'idle', 'turn end');
/** everything the session showed or wrote, to grep for the key */
const everything = (sink: RecSink, historyFile: string) =>
  JSON.stringify(sink.events) + JSON.stringify(sink.patches) + JSON.stringify(sink.exited) + (fs.existsSync(historyFile) ? fs.readFileSync(historyFile, 'utf8') : '');

describe('ApiSession: OpenAI protocol', () => {
  it('streams the answer in chunks, prices the usage and keeps the key in its header only', async () => {
    const { s, sink, historyFile } = start();
    expect(sink.patch).toMatchObject({ state: 'idle', model: 'deepseek-chat' });
    expect(s.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.pid).toBeNull();
    s.send('Ciao');
    await turnDone(sink);
    const streamed = sink.events.filter(e => e.item.kind === 'assistant');
    expect(streamed.length).toBeGreaterThan(1);
    expect(streamed[0]!.replace).toBe(false);
    expect(streamed.slice(1).every(e => e.replace)).toBe(true);
    expect(sink.last('assistant')).toMatchObject({ text: 'Ciao, come stai?', streaming: false });
    // 1000 × 2 $/M + 500 × 10 $/M
    expect(sink.last('result')).toMatchObject({ costUsd: 0.007, isError: false });
    expect(sink.patch).toMatchObject({ turnCostUsd: 0.007, costKnown: true, contextTokens: 1500, lastText: 'Ciao, come stai?' });
    expect(sink.trace).toEqual(['state:idle', 'state:running', 'result', 'state:idle']);
    const req = seen[0]!;
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers['x-api-key']).toBeUndefined();
    expect(req.body).toMatchObject({ model: 'deepseek-chat', stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'Ciao' }] });
    expect(everything(sink, historyFile)).not.toContain(KEY);
    expect(JSON.parse(fs.readFileSync(historyFile, 'utf8'))).toMatchObject({ messages: [{ role: 'user', content: 'Ciao' }, { role: 'assistant', content: 'Ciao, come stai?' }] });
  });

  it('reports the cost as unknown without prices', async () => {
    const { s, sink } = start({ pricesOf: () => null });
    s.send('x');
    await turnDone(sink);
    expect(sink.patch).toMatchObject({ turnCostUsd: 0, costKnown: false });
  });

  it('prices a turn with the model it ran on, also when the model changes during it', async () => {
    const { s, sink } = start({ pricesOf: m => (m === 'deepseek-chat' ? { inputPerMTok: 2, outputPerMTok: 10 } : { inputPerMTok: 0, outputPerMTok: 0 }) });
    s.send('x');
    await s.setModel('cheap-model');
    await turnDone(sink);
    expect(seen[0]!.body).toMatchObject({ model: 'deepseek-chat' });
    expect(sink.last('result')).toMatchObject({ costUsd: 0.007 });
  });

  it('queues a message sent during a turn after it', async () => {
    const { s, sink } = start();
    s.send('uno');
    s.send('due');
    expect(s.busy).toBe(true);
    await turnDone(sink, 2);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.body.messages).toEqual([
      { role: 'user', content: 'uno' }, { role: 'assistant', content: 'Ciao, come stai?' }, { role: 'user', content: 'due' },
    ]);
  });

  it('resumes from the history file: the request carries the past messages', async () => {
    const first = start();
    first.s.send('prima');
    await turnDone(first.sink);
    await first.s.close();
    const sessionId = first.s.sessionId;
    expect(historyItems(first.historyFile).map(i => i.kind)).toEqual(['user', 'assistant']);
    const { s, sink } = start({ historyFile: first.historyFile, resume: true, sessionId });
    expect(s.sessionId).toBe(sessionId);
    s.send('dopo');
    await turnDone(sink);
    expect(seen.at(-1)!.body.messages).toEqual([
      { role: 'user', content: 'prima' }, { role: 'assistant', content: 'Ciao, come stai?' }, { role: 'user', content: 'dopo' },
    ]);
  });

  it('interrupt aborts the request: "Interrotto da te", no error, the partial answer kept', async () => {
    mode = 'hang';
    const { s, sink, historyFile } = start();
    s.send('lungo');
    await waitFor(() => sink.last('assistant')?.text === 'Inizio', 'first chunk');
    await s.interrupt({ byUser: true });
    await turnDone(sink);
    expect(sink.last('result')).toMatchObject({ isError: false, interrupted: true });
    expect(sink.last('system')?.text).toBe('Interrotto da te.');
    expect(sink.last('assistant')).toMatchObject({ streaming: false });
    expect(JSON.parse(fs.readFileSync(historyFile, 'utf8')).messages.at(-1)).toEqual({ role: 'assistant', content: 'Inizio' });
  });

  it('a first byte that never comes ends the turn with a timeout; the chat stays usable', async () => {
    const silent = http.createServer(() => { /* never answers */ });
    await new Promise<void>(r => silent.listen(0, '127.0.0.1', r));
    try {
      const { s, sink } = start({ firstByteMs: 150, baseUrl: `http://127.0.0.1:${(silent.address() as AddressInfo).port}/v1` });
      s.send('x');
      await turnDone(sink);
      expect(sink.last('system')).toMatchObject({ level: 'error', text: expect.stringMatching(/non ha risposto entro/) });
      expect(sink.last('result')).toMatchObject({ isError: true });
      expect(sink.exited).toBeNull();
    } finally { silent.closeAllConnections(); silent.close(); }
  });

  it('401: "chiave API rifiutata da <host>", never the key', async () => {
    mode = 401;
    const { s, sink, historyFile } = start();
    s.send('x');
    await turnDone(sink);
    const host = new URL(base).host;
    expect(sink.last('system')).toMatchObject({ level: 'error', text: `Chiave API rifiutata da ${host}.` });
    expect(sink.last('result')).toMatchObject({ isError: true });
    expect(everything(sink, historyFile)).not.toContain(KEY);
  });

  it('a 4xx body that echoes the key is shown masked', async () => {
    mode = 400;
    const { s, sink, historyFile } = start();
    s.send('x');
    await turnDone(sink);
    expect(sink.last('system')?.text).toMatch(/Richiesta rifiutata da .* \(400\): bad key \*\*\*/);
    expect(everything(sink, historyFile)).not.toContain(KEY);
  });

  it('429 and 5xx get their own short lines', async () => {
    mode = 429;
    const a = start();
    a.s.send('x');
    await turnDone(a.sink);
    expect(a.sink.last('system')?.text).toMatch(/Troppe richieste .*429/);
    mode = 503;
    const b = start();
    b.s.send('x');
    await turnDone(b.sink);
    expect(b.sink.last('system')?.text).toMatch(/errore 503/);
  });

  it('does not follow a redirect (the key never goes to another URL)', async () => {
    mode = 'redirect';
    const { s, sink, historyFile } = start();
    s.send('x');
    await turnDone(sink);
    expect(seen.map(r => r.url)).toEqual(['/v1/chat/completions']);
    expect(sink.last('system')).toMatchObject({ level: 'error', text: expect.stringMatching(/reindirizzamento/) });
    expect(sink.last('assistant')).toBeUndefined();
    expect(everything(sink, historyFile)).not.toContain(KEY);
  });

  it('a missing key: the Settings hint, nothing sent', async () => {
    const { s, sink } = start({ apiKey: () => null });
    s.send('x');
    await turnDone(sink);
    expect(sink.last('system')?.text).toBe(MISSING_KEY);
    expect(seen).toHaveLength(0);
  });

  it('images: the text-only note, the text still goes', async () => {
    const { s, sink } = start();
    s.send('guarda', [{ mimeType: 'image/png', data: PNG_1PX }]);
    await turnDone(sink);
    expect(sink.events.find(e => e.item.kind === 'system')?.item).toMatchObject({ text: TEXT_ONLY });
    expect(JSON.stringify(seen[0]!.body)).not.toContain(PNG_1PX);
    expect(seen[0]!.body.messages).toEqual([{ role: 'user', content: 'guarda' }]);
  });

  it('close ends the session cleanly', async () => {
    const { s, sink } = start();
    await s.close();
    expect(sink.exited).toEqual({ code: 0, error: null });
    expect(s.alive).toBe(false);
    expect(() => s.send('x')).toThrow();
  });
});

describe('ApiSession: Anthropic protocol', () => {
  it('streams with x-api-key, anthropic-version and max_tokens; usage → cost', async () => {
    const { s, sink, historyFile } = start({ protocol: 'anthropic', model: 'claude-x', maxTokens: 1024, pricesOf: m => (m === 'claude-x' ? { inputPerMTok: 3, outputPerMTok: 15 } : null) });
    s.send('Ciao');
    await turnDone(sink);
    expect(sink.last('assistant')).toMatchObject({ text: 'Buongiorno', streaming: false });
    // 2000 × 3 $/M + 300 × 15 $/M
    expect(sink.last('result')).toMatchObject({ costUsd: 0.0105, isError: false });
    expect(sink.patch).toMatchObject({ contextTokens: 2300, costKnown: true });
    const req = seen[0]!;
    expect(req.url).toBe('/v1/messages');
    expect(req.headers['x-api-key']).toBe(KEY);
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.body).toMatchObject({ model: 'claude-x', max_tokens: 1024, stream: true, messages: [{ role: 'user', content: 'Ciao' }] });
    expect(everything(sink, historyFile)).not.toContain(KEY);
  });
});

describe('base URL check', () => {
  it('refuses plain http off this computer and URLs with credentials', () => {
    expect(checkBaseUrl('https://api.deepseek.com/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://127.0.0.1:8080/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://localhost/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://[::1]:9000/v1')).toHaveProperty('url');
    expect(checkBaseUrl('http://api.example.com/v1')).toHaveProperty('error');
    expect(checkBaseUrl('http://127.0.0.1.evil.com/v1')).toHaveProperty('error');
    expect(checkBaseUrl('https://user:pw@localhost/v1')).toHaveProperty('error');
    expect(checkBaseUrl('ftp://api.example.com')).toHaveProperty('error');
    expect(checkBaseUrl('not a url')).toHaveProperty('error');
  });

  it('a session on a non-local http URL ends at start with an error and sends nothing', () => {
    const { s, sink } = start({ baseUrl: 'http://api.example.com/v1' });
    expect(sink.exited?.error).toMatch(/Indirizzo non sicuro/);
    expect(s.state).toBe('error');
    expect(() => s.send('x')).toThrow();
    expect(seen).toHaveLength(0);
  });
});
