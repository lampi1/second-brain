// Large semantic updates retain exact Unicode/content and ordering under bounded, acknowledged transport.
import { expect, it, vi } from 'vitest';
import { SemanticReceiver, SemanticSender, type SemanticFrame } from '../../src/main/agent-runtime/semantic-transport';

it('reassembles large Unicode updates before delivering following boundaries', async () => {
  const seen: unknown[] = [], frames: SemanticFrame<unknown>[] = [];
  const receiver = new SemanticReceiver(value => { seen.push(value); });
  const sender = new SemanticSender(async frame => { frames.push(frame); receiver.receive(frame); }, vi.fn());
  const value = { text: 'é💡'.repeat(100_000) };
  sender.send(value); sender.send({ done: true });
  await sender.drain();
  expect(seen).toEqual([value, { done: true }]);
  expect(frames.length).toBeGreaterThan(2);
  expect(frames.every(frame => Buffer.byteLength(JSON.stringify(frame)) + 512 <= 256 * 1024)).toBe(true);
});

it('bounds queued bytes when acknowledgement is held and releases on close', async () => {
  const fail = vi.fn();
  let release!: () => void;
  const sender = new SemanticSender(() => new Promise<void>(resolve => { release = resolve; }), fail, 1_000_000);
  sender.send({ text: 'x'.repeat(600_000) });
  sender.send({ text: 'y'.repeat(600_000) });
  expect(fail).toHaveBeenCalledTimes(1);
  release(); await sender.drain();
});

it('rejects skipped fragments and cross-update substitutions without publishing partial data', () => {
  const deliver = vi.fn();
  const receiver = new SemanticReceiver(deliver);
  receiver.receive({ kind: 'fragment', id: 1, offset: 0, total: 4, data: 'YWI=' });
  expect(() => receiver.receive({ kind: 'fragment', id: 2, offset: 2, total: 4, data: 'Y2Q=' })).toThrow();
  expect(deliver).not.toHaveBeenCalled();
});
