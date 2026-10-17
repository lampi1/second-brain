// Session factory key binding: a running API session must never read a replacement engine definition's key.
// Exercises real sessionFor/ApiSession with synthetic keys and a stubbed fetch; no HTTP server or CLI is started.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { brainEngine, engineOf, fingerprint, setBrainEngines, setTrust, type EngineEntry } from '../../../src/main/engines/registry';
import { sessionFor, type EngineContext } from '../../../src/main/engines/sessions';
import type { HarnessSession } from '../../../src/main/chats/session';
import { recSink, waitFor } from '../chats/helpers';

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-session-key-'));
const sessions: HarnessSession[] = [];
const ENGINE = 'session-key-test';
const ENDPOINT_A = 'https://endpoint-a.invalid/v1';
const ENDPOINT_B = 'https://endpoint-b.invalid/v1';
const KEY_A = 'synthetic-key-a';
const KEY_B = 'synthetic-key-b';

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.close()));
  setBrainEngines([]);
  setTrust({});
  vi.unstubAllGlobals();
});
afterAll(() => {
  const expected = path.join(path.resolve(os.tmpdir()), 'sb-session-key-');
  if (!path.resolve(fixtureRoot).startsWith(expected)) throw new Error('Unexpected session-key fixture directory');
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function definition(baseUrl: string): EngineEntry {
  const entry = brainEngine(ENGINE, { kind: 'api', label: 'Session key test', protocol: 'openai', baseUrl });
  if (typeof entry === 'string') throw new Error(`Invalid test engine: ${entry}`);
  return entry;
}

function start() {
  const entry = definition(ENDPOINT_A);
  setBrainEngines([entry]);
  setTrust({ [ENGINE]: fingerprint(entry) });
  const engine = engineOf(ENGINE);
  if (!engine) throw new Error('Test engine not registered');
  const userData = fs.mkdtempSync(path.join(fixtureRoot, 'case-'));
  let key: string | null = KEY_A;
  const readKey = vi.fn(() => key);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetchMock);
  const context: EngineContext = { userData, mcpUrl: null, appMcpUrl: null, showReplay: false, acpModelConfig: null, key: readKey };
  const sink = recSink();
  const session = sessionFor(engine, { chatId: 'key-binding', cwd: userData, model: 'synthetic-model' }, sink, context);
  sessions.push(session);
  session.start();
  const results = () => [...sink.items.values()].filter(item => item.kind === 'result');
  const send = async (text: string, count: number) => {
    session.send(text);
    await waitFor(() => results().length === count && !session.busy, 'synthetic API turn to settle');
    return results().at(-1);
  };
  return { entry, session, sink, readKey, fetchMock, send, setKey: (value: string | null) => { key = value; } };
}

describe('sessionFor API key binding', () => {
  it('does not read a replacement endpoint key or issue another request from the old session', async () => {
    const f = start();
    expect(await f.send('First request', 1)).toMatchObject({ isError: false });
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith(`${ENDPOINT_A}/chat/completions`, expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${KEY_A}` }),
    }));
    f.readKey.mockClear();
    f.fetchMock.mockClear();
    setBrainEngines([definition(ENDPOINT_B)]);
    f.setKey(KEY_B);

    expect(await f.send('Old session after replacement', 2)).toMatchObject({ isError: true });
    expect(f.readKey).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.sink.last('system')).toMatchObject({ level: 'error', code: 'apiMissingKey' });
  });

  it('reads a rotated key on the next turn when the engine fingerprint stays the same', async () => {
    const f = start();
    expect(await f.send('Before key rotation', 1)).toMatchObject({ isError: false });
    f.readKey.mockClear();
    f.fetchMock.mockClear();
    // Registry objects and presentation labels may change without changing the endpoint/start definition.
    setBrainEngines([{ ...f.entry, label: 'Renamed engine' }]);
    f.setKey(KEY_B);

    expect(await f.send('After key rotation', 2)).toMatchObject({ isError: false });
    expect(f.readKey).toHaveBeenCalledTimes(1);
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith(`${ENDPOINT_A}/chat/completions`, expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${KEY_B}` }),
    }));
  });

  it('blocks an existing session when its custom engine is removed', async () => {
    const f = start();
    expect(await f.send('Before engine removal', 1)).toMatchObject({ isError: false });
    f.readKey.mockClear();
    f.fetchMock.mockClear();
    setBrainEngines([]);
    f.setKey(KEY_B);

    expect(await f.send('After engine removal', 2)).toMatchObject({ isError: true });
    expect(f.readKey).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
});
