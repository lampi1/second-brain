// One-shot restrictions on the shared runner: startup deadlines and permission refusal without live engines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { HeadlessRunner } from '../../../src/main/compare/headless';
import { ClaudeSession } from '../../../src/main/chats/claude';

const fake = vi.hoisted(() => ({ make: vi.fn() }));
vi.mock('../../../src/main/engines/sessions', () => ({ sessionFor: fake.make, readOnlyConfigDir: () => '' }));
const folders: string[] = [];
afterEach(() => { vi.useRealTimers(); fake.make.mockReset(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function setup(ready: Promise<void>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-headless-'));
  folders.push(folder);
  const session = { ready, alive: true, start: vi.fn(), send: vi.fn(), answer: vi.fn(), killNow: vi.fn(), close: vi.fn(async () => {}) };
  let sink!: SessionSink;
  let options!: SessionOptions;
  fake.make.mockImplementation((_engine: unknown, opts: SessionOptions, s: SessionSink) => { options = opts; sink = s; return session as unknown as HarnessSession; });
  const runner = new HeadlessRunner({ userData: folder, settings: () => ({ engineOn: { claude: true }, engines: { claude: true } }), keyFor: () => null, enginePaths: () => ({ claude: 'fake.mjs' }) });
  const request = { engine: 'claude', cwd: folder, model: null, effort: null, prompt: 'digest only', round: 'pulse', timeoutMs: 100, noTools: true, maxTokens: 1200 };
  return { runner, request, session, sink: () => sink, options: () => options };
}
it('kills a session that never finishes startup at the per-request deadline', async () => {
  vi.useFakeTimers();
  const f = setup(new Promise(() => {}));
  const result = f.runner.run(f.request);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('tempo scaduto') });
  expect(f.session.killNow).toHaveBeenCalledOnce();
  expect(f.session.send).not.toHaveBeenCalled();
});
it('refuses a read and passes the output cap and empty tool policy to the adapter', async () => {
  vi.useFakeTimers();
  const f = setup(Promise.resolve());
  const result = f.runner.run(f.request);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.options()).toMatchObject({ maxTokens: 1200, toolPolicy: { allow: [] }, ceiling: 'plan' });
  f.sink().pending({ id: 'read', title: 'Read file', type: 'permission', tool: 'Read', input: { file_path: '/data' }, detail: '', at: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.session.answer).toHaveBeenCalledWith('read', expect.objectContaining({ allow: false }));
  const args = new ClaudeSession(f.options(), f.sink()).args();
  expect(args).toContain('--tools=');
  expect(args).not.toContain('Read,Grep,Glob');
  f.sink().item({ kind: 'assistant', id: 'a', at: 0, text: 'done' }, false);
  f.sink().item({ kind: 'result', id: 'r', at: 0, costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
  f.sink().changed({ state: 'idle' });
  expect(await result).toMatchObject({ ok: true, text: 'done' });
});
