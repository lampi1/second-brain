// Real utility entry wiring with a private fake parent port: late broker failure cannot kill a new generation,
// API broker calls get per-command deadlines and a refused launch is reported at once.
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { RUNTIME_PROTOCOL_VERSION } from '../../src/shared/agent-runtime';

type ApiRequest = (body: string, signal: AbortSignal) => Promise<Response>;
const native = vi.hoisted(() => ({ adapters: [] as { options: { preToolUse: { turnEnded(): void } }; killNow: ReturnType<typeof vi.fn> }[],
  api: [] as { options: { authenticatedRequest: ApiRequest } }[] }));
vi.mock('../../src/main/chats/claude', () => ({ ClaudeSession: class {
  state = 'idle'; sessionId = 'native'; pid = 123; busy = false; alive = true;
  killNow = vi.fn();
  constructor(readonly options: { preToolUse: { turnEnded(): void } }) { native.adapters.push(this); }
} }));
vi.mock('../../src/main/chats/acp', () => ({ AcpSession: class {} }));
vi.mock('../../src/main/chats/codex', () => ({ CodexSession: class {} }));
vi.mock('../../src/main/chats/api', () => ({ FIRST_BYTE_MS: 60_000, ApiSession: class {
  state = 'idle'; sessionId = null; pid = null; busy = false; alive = true;
  killNow = vi.fn();
  constructor(readonly options: { authenticatedRequest: ApiRequest }) { native.api.push(this); }
} }));

const original = Object.getOwnPropertyDescriptor(process, 'parentPort');
const disconnect = process.listeners('disconnect');
afterEach(() => {
  if (original) Object.defineProperty(process, 'parentPort', original);
  else Reflect.deleteProperty(process, 'parentPort');
  for (const listener of process.listeners('disconnect')) if (!disconnect.includes(listener)) process.removeListener('disconnect', listener);
  native.adapters.length = 0; native.api.length = 0; vi.useRealTimers(); vi.resetModules();
});

it('ignores the old turnEnded broker rejection after replacing its chat generation', async () => {
  vi.useFakeTimers();
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  await import('../../src/main/agent-runtime/entry');
  const launch = (generation: number) => port.emit('message', { data: { kind: 'launch',
    identity: { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: 'host', chatId: 'chat', sessionGeneration: generation },
    launch: { kind: 'claude', options: { chatId: 'chat' }, callbacks: { brief: false, preTool: true } },
  } });
  launch(1);
  native.adapters[0]!.options.preToolUse.turnEnded();
  launch(2);
  await vi.advanceTimersByTimeAsync(0);
  expect(native.adapters).toHaveLength(2);
  expect(native.adapters[0]!.killNow).toHaveBeenCalledTimes(1);
  expect(native.adapters[1]!.killNow).not.toHaveBeenCalled();
  expect(port.postMessage.mock.calls.some(([packet]) => packet.kind === 'failed')).toBe(false);
});

type Packet = { kind: string; identity?: unknown; frame?: { operationId: string; sequence: number; payload: { value: { method: string; input: unknown } } } };
async function apiHost() {
  vi.useFakeTimers();
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  await import('../../src/main/agent-runtime/entry');
  const identity = { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: 'host', chatId: 'api', sessionGeneration: 1 };
  port.emit('message', { data: { kind: 'launch', identity, launch: { kind: 'api', options: { chatId: 'api' }, callbacks: { brief: false, preTool: false } } } });
  const calls = (method: string) => port.postMessage.mock.calls.map(([p]) => p as Packet)
    .filter(p => p.kind === 'broker' && p.frame?.payload.value.method === method).map(p => p.frame!);
  const reply = (frame: { operationId: string; sequence: number }, value: unknown) => port.emit('message', { data: { kind: 'broker',
    frame: { ...identity, operationId: frame.operationId, sequence: frame.sequence, payload: { kind: 'reply', ok: true, value } } } });
  return { port, calls, reply, request: native.api[0]!.options.authenticatedRequest };
}

it('keeps the API open past the generic 30 s RPC deadline and a stream read while the provider is silent', async () => {
  const { calls, reply, request } = await apiHost();
  const response = request('{}', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(35_000); // headers after 35 s: inside the adapter's 60 s first-byte window
  reply(calls('open')[0]!, { status: 200 });
  const reader = (await response).body!.getReader();
  const chunk = reader.read();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(120_000); // a reasoning model pausing without keepalive
  reply(calls('read')[0]!, { done: true, text: 'late' });
  expect(new TextDecoder().decode((await chunk).value)).toBe('late');
  expect(calls('abort')).toHaveLength(0);
});

it('still bounds an API open whose headers never come, beyond the adapter first-byte deadline', async () => {
  const { calls, request } = await apiHost();
  const response = request('{}', new AbortController().signal);
  const settled = vi.fn();
  void response.then(settled, settled);
  await vi.advanceTimersByTimeAsync(64_000);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(settled).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'uncertain' }));
  expect(calls('abort')).toHaveLength(1);
});

it('ends a pending stream read when its signal aborts, without waiting for the broker reply', async () => {
  const { calls, reply, request } = await apiHost();
  const ctrl = new AbortController();
  const response = request('{}', ctrl.signal);
  await vi.advanceTimersByTimeAsync(0);
  reply(calls('open')[0]!, { status: 200 });
  const chunk = (await response).body!.getReader().read();
  const result = chunk.then(() => 'resolved', () => 'rejected');
  await vi.advanceTimersByTimeAsync(0);
  expect(calls('read')).toHaveLength(1);
  ctrl.abort();
  expect(await result).toBe('rejected');
  expect(calls('abort')).toHaveLength(1);
});

it('reports a refused launch at once instead of leaving main to its start deadline', async () => {
  vi.useFakeTimers();
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
  await import('../../src/main/agent-runtime/entry');
  const launch = (generation: number) => {
    const identity = { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: 'host', chatId: 'chat', sessionGeneration: generation };
    port.emit('message', { data: { kind: 'launch', identity, launch: { kind: 'claude', options: { chatId: 'chat' }, callbacks: { brief: false, preTool: false } } } });
    return identity;
  };
  launch(2);
  const stale = launch(1);
  expect(port.postMessage).toHaveBeenCalledWith({ kind: 'failed', identity: stale });
  expect(native.adapters).toHaveLength(1);
  expect(native.adapters[0]!.killNow).not.toHaveBeenCalled();
});
