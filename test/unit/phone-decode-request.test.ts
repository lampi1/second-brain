// The phone bridge's voice-decode round trip on the main side (ADR 0219, src/main/phone/decode-request.ts): a request
// goes to the page with a fresh id and resolves on the matching answer; errors, unknown ids, size limits, a closed
// window and the timeout are each handled.
import { afterEach, expect, it, vi } from 'vitest';
import { PHONE_VOICE_MAX_BYTES, VoiceDecodeRequests } from '../../src/main/phone/decode-request';
import { PHONE_IPC, type PhoneDecodeRequest } from '../../src/shared/contract/phone';

afterEach(() => { vi.useRealTimers(); });
const wav = () => new Uint8Array(100).fill(1);
const sink = () => { const sent: { channel: string; payload: PhoneDecodeRequest }[] = []; return { sent, sender: { send: (channel: string, payload: PhoneDecodeRequest) => { sent.push({ channel, payload }); } } }; };

it('sends the bytes with a fresh id and resolves on the matching answer', async () => {
  let n = 0;
  const r = new VoiceDecodeRequests(() => `id-${++n}`), { sent, sender } = sink();
  const p = r.request(sender, new Uint8Array([1, 2, 3]));
  expect(sent).toEqual([{ channel: PHONE_IPC.decodeRequest, payload: { id: 'id-1', bytes: new Uint8Array([1, 2, 3]) } }]);
  expect(r.resolve({ id: 'other', wav: wav() })).toBe(false);
  expect(r.resolve({ id: 'id-1', wav: wav() })).toBe(true);
  await expect(p).resolves.toEqual(wav());
  expect(r.pending).toBe(0);
  expect(r.resolve({ id: 'id-1', wav: wav() })).toBe(false);
});

it('rejects with the page\'s error, or when no audio comes back', async () => {
  const r = new VoiceDecodeRequests(() => 'a'), { sender } = sink();
  const p1 = r.request(sender, new Uint8Array([1]));
  r.resolve({ id: 'a', error: 'decoding failed: bad ogg' });
  await expect(p1).rejects.toThrow('bad ogg');
  const p2 = r.request(sender, new Uint8Array([1]));
  r.resolve({ id: 'a', wav: new Uint8Array(10) });
  await expect(p2).rejects.toThrow('no audio');
});

it('refuses no window, a destroyed window, empty and oversized notes', async () => {
  const r = new VoiceDecodeRequests();
  await expect(r.request(null, new Uint8Array([1]))).rejects.toThrow('closed');
  await expect(r.request({ send: () => {}, isDestroyed: () => true }, new Uint8Array([1]))).rejects.toThrow('closed');
  await expect(r.request(sink().sender, new Uint8Array(0))).rejects.toThrow('empty');
  await expect(r.request(sink().sender, new Uint8Array(PHONE_VOICE_MAX_BYTES + 1))).rejects.toThrow('20 MB');
  expect(r.pending).toBe(0);
});

it('times out and forgets the request', async () => {
  vi.useFakeTimers();
  const r = new VoiceDecodeRequests(() => 't'), p = r.request(sink().sender, new Uint8Array([1]), 1000);
  const seen = expect(p).rejects.toThrow('timed out after 1000 ms');
  vi.advanceTimersByTime(1001);
  await seen;
  expect(r.pending).toBe(0);
  expect(r.resolve({ id: 't', wav: wav() })).toBe(false);
});

it('a send that throws rejects at once', async () => {
  const r = new VoiceDecodeRequests();
  await expect(r.request({ send: () => { throw new Error('gone'); } }, new Uint8Array([1]))).rejects.toThrow('gone');
  expect(r.pending).toBe(0);
});
