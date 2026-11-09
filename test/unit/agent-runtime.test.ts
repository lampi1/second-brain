// Deterministic transport and batching invariants for runtime extraction: no real-time assertions or live engines.
// Models lost replies, stale epochs/generations, duplicate effects, bounded admission and semantic event ordering.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeChannel, RuntimeReceiver, type RuntimeFrame } from '../../src/main/agent-runtime/channel';
import { RuntimeBatcher, RuntimeBatchOverflow, type RuntimeItem } from '../../src/main/agent-runtime/batcher';
import { RUNTIME_PROTOCOL_VERSION, type RuntimeIdentity } from '../../src/shared/agent-runtime';
import type { ChatItem } from '../../src/shared/contract';

const identity: RuntimeIdentity = { protocolVersion: RUNTIME_PROTOCOL_VERSION, hostEpoch: 'epoch-1', chatId: 'chat-1', sessionGeneration: 1 };
type Frame = RuntimeFrame<string, string>;
const reply = (request: Frame, value = 'consumed'): Frame => ({ ...request, payload: { kind: 'reply', ok: true, value } });
const request = (sequence = 1, operationId = `op-${sequence}`): Frame => ({ ...identity, sequence, operationId, payload: { kind: 'request', value: 'send' } });
const assistant = (text: string, id = 'a'): Extract<ChatItem, { kind: 'assistant' }> => ({ kind: 'assistant', id, text, at: 1, streaming: true });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('runtime channel', () => {
  it('binds acknowledgement to exact epoch, session generation, command ID and sequence', async () => {
    const sent: Frame[] = [];
    const channel = new RuntimeChannel<string, string>(identity, frame => sent.push(frame));
    const result = channel.request('send');
    const r = reply(sent[0]!);
    for (const wrong of [{ ...r, hostEpoch: 'retired' }, { ...r, chatId: 'other' }, { ...r, sessionGeneration: 2 },
      { ...r, operationId: 'unknown' }, { ...r, sequence: 2 }, { ...r, protocolVersion: 99 }]) expect(channel.receive(wrong)).toBe(false);
    expect(channel.outstanding).toBe(1);
    expect(channel.receive(r)).toBe(true);
    expect(channel.receive(r)).toBe(false);
    await expect(result).resolves.toBe('consumed');
  });

  it('never resends a dispatched action after a missing acknowledgement', async () => {
    const post = vi.fn();
    const channel = new RuntimeChannel<string, string>(identity, post, 100);
    const result = expect(channel.request('write')).rejects.toMatchObject({ outcome: 'uncertain' });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(post).toHaveBeenCalledTimes(1);
    expect(channel.receive(reply(post.mock.calls[0]![0]))).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('distinguishes never-dispatched backpressure from uncertain posted operations', async () => {
    const post = vi.fn();
    const channel = new RuntimeChannel<string, string>(identity, post, 100, 1);
    const first = expect(channel.request('a')).rejects.toMatchObject({ outcome: 'uncertain' });
    await expect(channel.request('b')).rejects.toMatchObject({ outcome: 'not-dispatched' });
    expect(post).toHaveBeenCalledTimes(1);
    channel.close(); await first;
    await expect(channel.request('c')).rejects.toMatchObject({ outcome: 'not-dispatched' });
    expect(channel.outstanding).toBe(0);
  });

  it('treats a throwing post as uncertain without exposing its exception payload', async () => {
    const channel = new RuntimeChannel<string, string>(identity, () => { throw new Error('private provider payload'); });
    await expect(channel.request('a')).rejects.toMatchObject({ outcome: 'uncertain', message: 'Runtime transport failed; not retried' });
    expect(channel.outstanding).toBe(0);
  });

  it('rejects malformed replies without consuming the real pending request', async () => {
    const sent: Frame[] = [];
    const channel = new RuntimeChannel<string, string>(identity, f => sent.push(f));
    const result = channel.request('a');
    expect(channel.receive({ ...sent[0], payload: { kind: 'reply', ok: 'yes' } })).toBe(false);
    expect(channel.receive({ ...sent[0], payload: { kind: 'reply', ok: false, error: 'bad', outcome: 'allow' } })).toBe(false);
    expect(channel.receive(reply(sent[0]!))).toBe(true);
    await expect(result).resolves.toBe('consumed');
  });
});

describe('runtime receiver', () => {
  it('executes once despite duplicates while running and after completion', async () => {
    const execute = vi.fn(async () => 'ok'), post = vi.fn();
    const host = new RuntimeReceiver(identity, execute, post);
    expect(host.receive(request())).toBe(true);
    expect(host.receive(request())).toBe(false);
    await vi.runAllTimersAsync();
    expect(host.receive(request())).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects stale, duplicate-ID and noncontiguous commands before side effects', async () => {
    const execute = vi.fn(async () => 'ok');
    const host = new RuntimeReceiver(identity, execute, vi.fn());
    expect(host.receive({ ...request(), hostEpoch: 'old' })).toBe(false);
    expect(host.receive(request(2))).toBe(false);
    expect(host.receive(request(1, 'same'))).toBe(true);
    expect(host.receive(request(2, 'same'))).toBe(false);
    expect(host.receive(request(2, 'next'))).toBe(true);
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('lets interrupt finish independently of a pending send, with correlated replies', async () => {
    let complete!: (v: string) => void;
    const post = vi.fn();
    const host = new RuntimeReceiver<string, string>(identity, value => value === 'send'
      ? new Promise(resolve => { complete = resolve; }) : Promise.resolve('stopped'), post);
    host.receive(request());
    host.receive({ ...request(2), payload: { kind: 'request', value: 'interrupt' } });
    await vi.runAllTimersAsync();
    expect(post.mock.calls.map(([f]) => f.operationId)).toEqual(['op-2']);
    complete('sent'); await vi.runAllTimersAsync();
    expect(post.mock.calls.map(([f]) => f.operationId)).toEqual(['op-2', 'op-1']);
  });

  it('reports execution failure as uncertain because an effect could already have happened', async () => {
    const post = vi.fn();
    const host = new RuntimeReceiver(identity, async () => { throw new Error('private'); }, post);
    host.receive(request()); await vi.runAllTimersAsync();
    expect(post.mock.calls[0]![0].payload).toMatchObject({ ok: false, outcome: 'uncertain' });
    expect(JSON.stringify(post.mock.calls)).not.toContain('private');
  });

  it('bounds concurrent operations and never executes refused work', async () => {
    const execute = vi.fn(() => new Promise<string>(() => {})), post = vi.fn();
    const host = new RuntimeReceiver(identity, execute, post, 1);
    host.receive(request(1)); host.receive(request(2));
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0].payload).toMatchObject({ ok: false, outcome: 'rejected' });
    host.close();
  });

  it('a long generation keeps admitting new operations; a replayed frame is refused by its sequence alone', async () => {
    const execute = vi.fn(async () => 'ok'), post = vi.fn();
    const host = new RuntimeReceiver(identity, execute, post);
    // a streaming session sends one update per 16 ms flush: 65,536 of them is about 18 minutes, never a limit
    for (let s = 1; s <= 65_537; s++) {
      expect(host.receive(request(s))).toBe(true);
      if (s % 200 === 0) await vi.runAllTimersAsync(); // under the in-flight limit of 256
    }
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(65_537);
    expect(post.mock.calls.every(([f]) => f.payload.ok === true)).toBe(true);
    // a replay of any earlier frame carries its old sequence: refused, never run again
    expect(host.receive(request(1))).toBe(false);
    expect(host.receive(request(65_537))).toBe(false);
    expect(execute).toHaveBeenCalledTimes(65_537);
  });

  it('does not execute queued callbacks after shutdown or deliver late old-generation replies', async () => {
    const execute = vi.fn(async () => 'ok'), post = vi.fn();
    const host = new RuntimeReceiver(identity, execute, post);
    host.receive(request()); host.close(); await vi.runAllTimersAsync();
    expect(execute).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
});

describe('runtime semantic batcher', () => {
  it('emits first text immediately and coalesces later snapshots over exactly one 16 ms interval', () => {
    const emit = vi.fn(); const b = new RuntimeBatcher(emit);
    b.item(assistant('a'), false);
    expect(emit.mock.calls[0]![0][0].item.text).toBe('a');
    b.item(assistant('ab'), true); b.item(assistant('abc'), true);
    vi.advanceTimersByTime(15); expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]![0]).toEqual([{ item: assistant('abc'), replace: true }]);
  });

  it('does not delay the first semantic text behind earlier thinking or empty text', () => {
    const emit = vi.fn(); const b = new RuntimeBatcher(emit);
    b.item(assistant(''), false); b.item(assistant('', 'other'), false);
    b.item(assistant('first'), true);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls[2]![0][0].item.text).toBe('first');
  });

  it('preserves insert semantics, nonadjacent order and mutable adapter snapshots', () => {
    const emitted: RuntimeItem[][] = []; const b = new RuntimeBatcher(items => emitted.push([...items]));
    b.item(assistant('first'), false);
    const mutable = assistant('B', 'b'); b.item(mutable, false);
    mutable.text = 'mutated'; b.item(assistant('BB', 'b'), true);
    b.item(assistant('A', 'a'), true); b.item(assistant('BBB', 'b'), true);
    b.boundary();
    expect(emitted[1]!.map(x => [x.item.id, x.replace, (x.item as { text: string }).text])).toEqual([
      ['b', false, 'BB'], ['a', true, 'A'], ['b', true, 'BBB'],
    ]);
  });

  it('flushes before results and makes the next turn first item immediate', () => {
    const events: string[] = []; const b = new RuntimeBatcher(items => events.push(...items.map(x => x.item.id)));
    b.item(assistant('a'), false); b.item(assistant('b', 'b'), false);
    b.item({ kind: 'result', id: 'r', at: 1, costUsd: 0, durationMs: 0, turns: 1, isError: false }, false);
    b.item(assistant('next', 'c'), false);
    expect(events).toEqual(['a', 'b', 'r', 'c']);
    b.close(); expect(vi.getTimerCount()).toBe(0);
    expect(() => b.item(assistant('late'), true)).toThrow('closed');
  });

  it('bounds batch count and bytes without discarding distinct items', () => {
    const emitted: RuntimeItem[][] = [];
    const b = new RuntimeBatcher(items => emitted.push([...items]), { intervalMs: 16, maxItems: 2, maxBytes: 1024 });
    for (let i = 0; i < 6; i++) b.item(assistant(`${i}`, `${i}`), false);
    b.close();
    expect(emitted.every(x => x.length <= 2 && Buffer.byteLength(JSON.stringify(x)) < 1024)).toBe(true);
    expect(emitted.flat().map(x => x.item.id)).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('refuses an oversized event explicitly, before it enters the queue', () => {
    const emit = vi.fn(); const b = new RuntimeBatcher(emit, { intervalMs: 16, maxItems: 2, maxBytes: 100 });
    expect(() => b.item(assistant('x'.repeat(100)), false)).toThrow(RuntimeBatchOverflow);
    expect(emit).not.toHaveBeenCalled();
  });

  it('includes JSON array framing in the byte bound', () => {
    const emitted: RuntimeItem[][] = [];
    const item = assistant('x');
    const maxBytes = Buffer.byteLength(JSON.stringify([{ item, replace: false }]));
    const b = new RuntimeBatcher(items => emitted.push([...items]), { intervalMs: 16, maxItems: 64, maxBytes });
    b.item(item, false); b.item(item, false); b.item(item, false); b.close();
    expect(emitted).toHaveLength(3);
    expect(emitted.every(items => Buffer.byteLength(JSON.stringify(items)) <= maxBytes)).toBe(true);
  });

  it('counts separators and both delimiters at the exact 262144-byte limit', () => {
    const emitted: RuntimeItem[][] = [];
    const b = new RuntimeBatcher(items => emitted.push([...items]));
    const a = { item: assistant('a', 'b'), replace: false };
    const c = { item: assistant('', 'c'), replace: false };
    c.item.text = 'x'.repeat(262144 - Buffer.byteLength(JSON.stringify([a, c])));
    b.item(assistant('first'), false); b.item(a.item, false); b.item(c.item, false);
    b.item(assistant('extra', 'd'), false); b.close();
    expect(Buffer.byteLength(JSON.stringify(emitted[1]))).toBe(262144);
    expect(emitted.every(items => Buffer.byteLength(JSON.stringify(items)) <= 262144)).toBe(true);
    const single = { item: assistant('', 's'), replace: false };
    single.item.text = 'x'.repeat(262145 - Buffer.byteLength(JSON.stringify([single])));
    const other = new RuntimeBatcher(() => {});
    expect(() => other.item(single.item, false)).toThrow(RuntimeBatchOverflow);
    other.close();
  });

  it('recomputes bytes when coalescing replacements into inserts', () => {
    const emitted: RuntimeItem[][] = [];
    const b = new RuntimeBatcher(items => emitted.push([...items]));
    const a = { item: assistant('', 'b'), replace: false };
    const c = { item: assistant('', 'c'), replace: false };
    a.item.text = 'x'.repeat(262144 - Buffer.byteLength(JSON.stringify([a, c])));
    b.item(assistant('first'), false);
    b.item(assistant('small', 'b'), false); b.item(a.item, true);
    b.item(assistant('', 'c'), false); b.item(assistant('xx', 'c'), true);
    b.close();
    expect(emitted.every(items => Buffer.byteLength(JSON.stringify(items)) <= 262144)).toBe(true);
    expect(emitted.flat().filter(x => x.item.id === 'b')).toEqual([a]);
  });

  it('keeps a quiet session first item independent of a noisy session queue', () => {
    const first = vi.fn(), second = vi.fn(); const a = new RuntimeBatcher(first), b = new RuntimeBatcher(second);
    a.item(assistant('a'), false); a.item(assistant('aa'), true); b.item(assistant('b'), false);
    expect(second).toHaveBeenCalledTimes(1); expect(first).toHaveBeenCalledTimes(1);
    a.close(); b.close();
  });
});
