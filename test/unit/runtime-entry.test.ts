// Real utility entry wiring with a private fake parent port: late broker failure cannot kill a new generation.
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { RUNTIME_PROTOCOL_VERSION } from '../../src/shared/agent-runtime';

const native = vi.hoisted(() => ({ adapters: [] as { options: { preToolUse: { turnEnded(): void } }; killNow: ReturnType<typeof vi.fn> }[] }));
vi.mock('../../src/main/chats/claude', () => ({ ClaudeSession: class {
  state = 'idle'; sessionId = 'native'; pid = 123; busy = false; alive = true;
  killNow = vi.fn();
  constructor(readonly options: { preToolUse: { turnEnded(): void } }) { native.adapters.push(this); }
} }));
vi.mock('../../src/main/chats/acp', () => ({ AcpSession: class {} }));
vi.mock('../../src/main/chats/codex', () => ({ CodexSession: class {} }));
vi.mock('../../src/main/chats/api', () => ({ ApiSession: class {} }));

const original = Object.getOwnPropertyDescriptor(process, 'parentPort');
const disconnect = process.listeners('disconnect');
afterEach(() => {
  if (original) Object.defineProperty(process, 'parentPort', original);
  else Reflect.deleteProperty(process, 'parentPort');
  for (const listener of process.listeners('disconnect')) if (!disconnect.includes(listener)) process.removeListener('disconnect', listener);
  native.adapters.length = 0; vi.useRealTimers(); vi.resetModules();
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
