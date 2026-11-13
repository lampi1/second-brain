// Utility boundary regressions with deterministic promises/fake timers: real host owner and proxy, no model calls.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HarnessSession, SessionSink } from '../../src/main/chats/session';
import { HostSession, type AdapterCommand, type AdapterResult, type HostUpdateFrame } from '../../src/main/agent-runtime/host-session';
import { RuntimeSessionProxy } from '../../src/main/agent-runtime/proxy';
import { RuntimeChannel, type RuntimeFrame } from '../../src/main/agent-runtime/channel';
import { RUNTIME_PROTOCOL_VERSION } from '../../src/shared/agent-runtime';

const identity = { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: 'host', chatId: 'chat', sessionGeneration: 1 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = () => vi.advanceTimersByTimeAsync(0);

function fixture(options: { holdAccepted?: boolean; dropAck?: boolean; dropUpdates?: boolean; constructorEvent?: boolean; ready?: Promise<void> } = {}) {
  let engineSink!: SessionSink;
  let root: HarnessSession['root'] = null;
  let writeBarrier: Promise<unknown> = Promise.resolve();
  const writes = vi.fn();
  const killed = vi.fn();
  const answer = vi.fn(() => true);
  const sink: SessionSink = { item: vi.fn(), pending: vi.fn(), resolved: vi.fn(), changed: vi.fn(), exit: vi.fn() };
  const replies: RuntimeFrame<AdapterCommand, AdapterResult>[] = [];
  const updates: RuntimeFrame<HostUpdateFrame, void>[] = [];
  const proxy = new RuntimeSessionProxy('claude', identity, sink, frame => host.receiveCommand(frame), frame => host.receiveUpdateAck(frame), () => host.dispose());
  const host = new HostSession(identity, target => {
    engineSink = target;
    if (options.constructorEvent) target.changed({ state: 'starting' });
    return {
      harness: 'claude', state: 'idle', sessionId: 'native', pid: 123, get root() { return root; }, busy: false, alive: true,
      ready: options.ready,
      start() {}, send() { void writeBarrier.then(() => { if (!killed.mock.calls.length) writes(); }); },
      holdWrites(until) { writeBarrier = until; return options.holdAccepted ?? true; },
      answer, interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {},
      setEffort: async () => {}, rename: async () => {}, contextUsage: async () => null,
      usage: async () => null, killNow: killed,
      close: async () => { root = { pid: 123, created: 10, exited: 20, job: 7 }; target.exit({ code: 0, error: null }); },
    } satisfies HarnessSession;
  }, frame => { replies.push(frame); if (!options.dropAck) proxy.receiveReply(frame); },
  frame => { updates.push(frame); if (!options.dropUpdates) proxy.receiveUpdate(frame); }, () => proxy.hostDied());
  return { proxy, host, sink, engineSink, replies, updates, writes, killed, answer };
}

it('acknowledges answer consumption only after the host consumes the request; lost ack stays uncertain', async () => {
  const f = fixture({ dropAck: true });
  const pending = f.proxy.answerConsumed('permission', { kind: 'permission', allow: true });
  const result = expect(pending).rejects.toMatchObject({ outcome: 'uncertain' });
  await flush();
  expect(f.answer).toHaveBeenCalledTimes(1);
  f.proxy.hostDied(); await result;
  expect(f.proxy.receiveReply(f.replies[0])).toBe(false);
  expect(f.answer).toHaveBeenCalledTimes(1);
});

it('rejects a stale generation update without touching the replacement session', async () => {
  const f = fixture({ dropUpdates: true });
  f.engineSink.changed({ state: 'running' });
  const frame = f.updates[0]!;
  expect(f.proxy.receiveUpdate({ ...frame, sessionGeneration: 0 })).toBe(false);
  await flush(); expect(f.sink.changed).not.toHaveBeenCalled();
  f.proxy.hostDied();
});

it('holds the first write across the process boundary until the checkpoint settles', async () => {
  const f = fixture();
  f.proxy.start(); await flush(); await f.proxy.ready;
  let release!: () => void;
  const checkpoint = new Promise<void>(resolve => { release = resolve; });
  expect(f.proxy.holdWrites(checkpoint)).toBe(true);
  f.proxy.send('write'); await flush();
  expect(f.writes).not.toHaveBeenCalled();
  release(); await flush(); expect(f.writes).toHaveBeenCalledTimes(1);
  f.proxy.hostDied();
});

it('does not dispatch the turn when the host refuses to arm its write barrier', async () => {
  const f = fixture({ holdAccepted: false });
  f.proxy.start(); await flush();
  expect(f.proxy.holdWrites(Promise.resolve())).toBe(true);
  f.proxy.send('write'); await flush();
  expect(f.writes).not.toHaveBeenCalled(); expect(f.killed).toHaveBeenCalledTimes(1);
});

it('bounds unacknowledged semantic bytes, not just the number of events', async () => {
  const f = fixture({ dropUpdates: true });
  for (let i = 0; i < 400; i++) f.engineSink.item({ kind: 'assistant', id: `a${i}`, at: 1, text: 'x'.repeat(200_000) }, false);
  f.engineSink.changed({ state: 'idle' });
  await flush();
  expect(f.killed).toHaveBeenCalledTimes(1);
  expect(f.updates.reduce((bytes, frame) => bytes + Buffer.byteLength(JSON.stringify(frame)), 0)).toBeLessThanOrEqual(1024 * 1024);
});

it('retains constructor events until the adapter exists', async () => {
  const f = fixture({ constructorEvent: true });
  await flush();
  expect(f.sink.changed).toHaveBeenCalledWith({ state: 'starting' });
  f.proxy.hostDied();
});

it('delivers an assistant item larger than one IPC frame without killing the session', async () => {
  const f = fixture();
  const item = { kind: 'assistant' as const, id: 'large', at: 1, text: '💡'.repeat(150_000) };
  f.engineSink.item(item, false);
  f.engineSink.changed({ state: 'idle' });
  await flush();
  expect(f.sink.item).toHaveBeenCalledWith(item, false);
  expect(f.killed).not.toHaveBeenCalled();
  f.proxy.hostDied();
});

it('cancels an undispatched held send when interrupted before the hold acknowledgement', async () => {
  const f = fixture({ dropAck: true });
  f.proxy.start(); await flush();
  f.proxy.receiveReply(f.replies[0]); await flush();
  let release!: () => void;
  expect(f.proxy.holdWrites(new Promise<void>(resolve => { release = resolve; }))).toBe(true);
  f.proxy.send('cancelled turn');
  const interrupted = f.proxy.interrupt();
  await flush();
  // Deliver the interrupt and hold receipts only after both commands executed in the host.
  for (const frame of f.replies.slice(1)) f.proxy.receiveReply(frame);
  await interrupted; release(); await flush();
  for (const frame of f.replies) f.proxy.receiveReply(frame);
  await flush();
  expect(f.writes).not.toHaveBeenCalled();
  f.proxy.hostDied();
});

it('retires a spontaneously exited adapter instead of leaking a live host slot', async () => {
  const f = fixture();
  f.engineSink.exit({ code: 0, error: null });
  await flush();
  expect(f.proxy.gone).toBe(true);
  expect(f.sink.exit).toHaveBeenCalledTimes(1);
  f.engineSink.changed({ state: 'running' }); await flush();
  expect(f.sink.changed).not.toHaveBeenCalled();
});

it('does not advertise ready before the ready snapshot reaches main', async () => {
  const f = fixture({ dropUpdates: true });
  let ready = false;
  void f.proxy.ready.then(() => { ready = true; });
  f.proxy.start(); await flush();
  expect(ready).toBe(false);
  for (const update of f.updates) f.proxy.receiveUpdate(update);
  await flush();
  expect(ready).toBe(true);
  expect(f.proxy.alive).toBe(true);
  f.proxy.hostDied();
});

it('does not kill a valid native cold start at the command acknowledgement deadline', async () => {
  let complete!: () => void;
  const f = fixture({ ready: new Promise<void>(resolve => { complete = resolve; }) });
  let ready = false;
  void f.proxy.ready.then(() => { ready = true; });
  f.proxy.start(); await flush();
  await vi.advanceTimersByTimeAsync(30_001);
  expect(f.killed).not.toHaveBeenCalled();
  expect(ready).toBe(false);
  expect(f.replies).toHaveLength(1);
  expect(f.replies[0]!.payload).toMatchObject({ kind: 'reply', ok: true });
  complete(); await flush(); await f.proxy.ready;
  expect(ready).toBe(true);
  expect(f.proxy.alive).toBe(true);
  f.proxy.hostDied();
});

it('refuses queued command bytes before dispatch and recovers credit after acknowledgement', async () => {
  const frames: RuntimeFrame<string, boolean>[] = [];
  const channel = new RuntimeChannel<string, boolean>(identity, frame => frames.push(frame), 30_000, 256, 600);
  const first = channel.request('one');
  await expect(channel.request('two')).rejects.toMatchObject({ outcome: 'not-dispatched' });
  expect(frames).toHaveLength(1);
  channel.receive({ ...frames[0], payload: { kind: 'reply', ok: true, value: true } });
  await first;
  const next = channel.request('three');
  expect(frames).toHaveLength(2);
  channel.receive({ ...frames[1], payload: { kind: 'reply', ok: true, value: true } });
  await next; channel.close();
});

it('carries the exited engine root to main so a kept engine is reaped at the real close', async () => {
  const f = fixture();
  expect(f.proxy.root).toBeNull();
  await f.proxy.close(undefined, true);
  // The host's job handle has no meaning in main's job registry: main reaps by the process walk.
  expect(f.proxy.root).toEqual({ pid: 123, created: 10, exited: 20, job: null });
});

it('dispatches a send at once after an acknowledged hold, so a stop in the same tick cannot drop it silently', async () => {
  const f = fixture();
  f.proxy.start(); await flush(); await f.proxy.ready;
  expect(f.proxy.holdWrites(Promise.resolve())).toBe(true);
  await flush(); // hold acknowledged and released: the barrier is no longer pending
  f.proxy.send('next turn');
  const interrupted = f.proxy.interrupt();
  await interrupted; await flush();
  expect(f.writes).toHaveBeenCalledTimes(1);
  f.proxy.hostDied();
});

it('close and interrupt on a session whose host already died resolve, like the in-process adapters (finding 4)', async () => {
  const f = fixture();
  f.proxy.hostDied();
  await expect(f.proxy.close()).resolves.toBeUndefined();
  await expect(f.proxy.interrupt()).resolves.toBeUndefined();
});

it('setRemoteControl waits as long as Claude allows the CLI (60 s), not the default 30 s', async () => {
  const f = fixture();
  const request = vi.spyOn((f.proxy as unknown as { commands: { request: (...a: unknown[]) => Promise<unknown> } }).commands, 'request');
  await f.proxy.setRemoteControl(false).catch(() => null);
  expect(request.mock.calls[0]![1]).toMatchObject({ timeoutMs: expect.any(Number) });
  expect((request.mock.calls[0]![1] as { timeoutMs: number }).timeoutMs).toBeGreaterThanOrEqual(65_000);
});

it('a close in flight when the host dies resolves instead of an unhandled rejection', async () => {
  const f = fixture({ dropAck: true });
  const closing = f.proxy.close();
  f.proxy.hostDied();
  await expect(closing).resolves.toBeUndefined();
});

it('an interrupt in flight when the host dies resolves, as one sent after it died', async () => {
  const f = fixture({ dropAck: true });
  const stopping = f.proxy.interrupt();
  f.proxy.hostDied();
  await expect(stopping).resolves.toBeUndefined();
});

it('a failure of main on one engine event is logged, never kills the engine; the batch goes on (#353 review)', async () => {
  const f = fixture();
  vi.mocked(f.sink.pending).mockImplementationOnce(() => { throw new Error('database is locked'); });
  f.engineSink.pending({ id: 'p1', type: 'permission', tool: 'Bash', title: 'Bash', detail: '', input: {}, at: 1 });
  f.engineSink.item({ kind: 'assistant', id: 'a1', at: 1, text: 'ok' }, false);
  await vi.advanceTimersByTimeAsync(50);
  expect(f.sink.pending).toHaveBeenCalledTimes(1);
  expect(f.sink.item).toHaveBeenCalledTimes(1);
  expect(f.killed).not.toHaveBeenCalled();
  expect(f.sink.exit).not.toHaveBeenCalled();
  f.proxy.hostDied();
});
