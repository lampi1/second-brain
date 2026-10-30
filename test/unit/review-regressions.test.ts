// Concrete general-review regressions. Real services/parsers with synthetic streams/events; no CLI/network/model.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrainApi } from '../../src/main/brain/api';
import { ApiSession } from '../../src/main/chats/api';
import { createRoutedChat } from '../../src/main/chats/routed';
import { routeChat } from '../../src/main/brain/routing';
import type { ChatItem, ChatSummary, NewChat } from '../../src/shared/contract';

afterEach(() => vi.restoreAllMocks());
describe('general main-process findings', () => {
  it('turns response stream abort/error into a failed data API result instead of an unhandled exception', async () => {
    const req = new EventEmitter() as http.ClientRequest; req.destroy = vi.fn(() => req);
    const res = new EventEmitter() as http.IncomingMessage;
    vi.spyOn(http, 'get').mockImplementation(((_o: unknown, cb: (r: http.IncomingMessage) => void) => { queueMicrotask(() => { cb(res); res.emit('aborted'); res.emit('error', new Error('synthetic reset')); }); return req; }) as typeof http.get);
    const api = new BrainApi(null, { exe: process.execPath, env: {} });
    (api as unknown as { port: Promise<number> }).port = Promise.resolve(1);
    await expect(api.get('/api/cost')).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/interrotto|reset/) });
  });
  it('does not report a partial SSE body as a successful completed answer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-api-eof-'));
    const items: ChatItem[] = [];
    let ended!: () => void;
    const done = new Promise<void>(resolve => { ended = resolve; });
    const session = new ApiSession({ chatId: 'c', cwd: dir, engineId: 'api-test', protocol: 'openai', baseUrl: 'https://synthetic.invalid/v1', model: 'known', apiKey: () => 'synthetic-key', historyFile: path.join(dir, 'history.json'),
      fetchImpl: async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Incomplete answer' } }] })}\n\n`, { status: 200 }),
    }, { item: item => { items.push(item); if (item.kind === 'result') ended(); }, changed() {}, pending() {}, resolved() {}, exit() {} });
    try { session.start(); session.send('Synthetic request'); await done; expect(items.find(i => i.kind === 'result')).toMatchObject({ isError: true }); }
    finally { await session.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('keeps an arbitrary registered engine default model', async () => {
    const made: NewChat[] = [];
    await createRoutedChat({ route: request => routeChat(request, null, null, 1), engineOn: () => true, agentsMayOpen: () => true, create: async req => { made.push(req); return { id: 'c1' } as ChatSummary; } },
      { cwd: '/', title: '', prompt: 'Ordinary request', defaults: { harness: 'codex', model: 'known-model' } }, { byUser: true });
    expect(made[0]).toMatchObject({ harness: 'codex', model: 'known-model' });
  });
});
