// Synthetic semantic-detector tests: corpus construction, intent contrast, warm lookup and failure isolation.
// No personal messages or model downloads; the hook HTTP tests separately prove the user-visible reminder.
import { describe, expect, it, vi } from 'vitest';
import { CorrectionDetector, correctionExamples, isCorrection } from '../../src/main/search/hybrid/corrections';

const yes: Float32Array = new Float32Array([1, 0]), no: Float32Array = new Float32Array([0, 1]);
const entries = [{ line: 1, day: '2026-10-18', text: 'chat · app · bug · detto: completed · vero: tests failed · visto da: reviewer' }];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('semantic correction detection', () => {
  it('uses only logged said/true pairs, without metadata or unrelated log lines', () => {
    const result = correctionExamples([...entries, { ...entries[0]!, text: 'ordinary note' }]);
    expect(result.positive).toEqual(['Hai detto: completed. In realtà: tests failed.']);
    expect(result.negative).toContain('Spiegami: tests failed.');
    expect(result.negative).toContain('Vorrei che tu facessi questo: tests failed.');
  });

  it('requires both a close correction and a margin over ordinary requests on the same topic', () => {
    expect(isCorrection(yes, [yes], [no])).toBe(true);
    expect(isCorrection(no, [yes], [no])).toBe(false);
    expect(isCorrection(yes, [yes], [yes])).toBe(false);
    expect(isCorrection(new Float32Array([0.8, 0.6]), [yes], [no])).toBe(false);
    expect(isCorrection(yes, [], [no])).toBe(false);
  });

  const fixture = () => {
    let root: string | null = 'brain-a', ready = true;
    const query = vi.fn(async () => [yes]);
    const passages = vi.fn(async (texts: string[]) => texts.map((_, i) => i === 0 ? yes : no));
    const read = vi.fn(async () => entries);
    const detector = new CorrectionDetector({ root: () => root, ready: () => ready, entries: read, passages, query });
    return { detector, query, passages, read, root: (value: string | null) => { root = value; }, ready: (value: boolean) => { ready = value; } };
  };

  it('falls back cold, reuses warm passages, and never queries a missing model', async () => {
    const f = fixture();
    expect((await f.detector.detect('a paraphrase')).ready).toBe(false);
    await flush();
    expect(await f.detector.detect('a paraphrase')).toEqual({ ready: true, correction: true });
    expect(f.passages).toHaveBeenCalledTimes(1);
    f.ready(false);
    expect((await f.detector.detect('x')).ready).toBe(false);
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('refreshes same-length edits and falls back for an empty corpus', async () => {
    const f = fixture();
    f.detector.warm(); await flush();
    f.read.mockResolvedValue([{ ...entries[0]!, text: entries[0]!.text.replace('failed', 'passed') }]);
    f.detector.warm(); await flush();
    expect(f.passages).toHaveBeenCalledTimes(2);
    f.read.mockResolvedValue([]);
    f.detector.warm(); await flush();
    expect((await f.detector.detect('x')).ready).toBe(false);
  });

  it('discards in-flight results after a brain switch and does not queue concurrent queries', async () => {
    const f = fixture();
    f.detector.warm(); await flush();
    let resolve!: (value: Float32Array[]) => void;
    f.query.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = f.detector.detect('x'); await flush();
    expect((await f.detector.detect('y')).ready).toBe(false);
    f.root('brain-b'); resolve([yes]);
    expect((await pending).ready).toBe(false);
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('discards a corpus that finishes warming for a different brain', async () => {
    const f = fixture();
    let resolve!: (value: Float32Array[]) => void;
    f.passages.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    f.detector.warm(); await flush();
    f.root('brain-b'); resolve([yes, no]); await flush();
    expect((await f.detector.detect('x')).ready).toBe(false);
    expect(f.query).not.toHaveBeenCalled();
    await flush();
    expect(await f.detector.detect('x')).toEqual({ ready: true, correction: true });
  });

  it('bounds slow queries and falls back on errors', async () => {
    const f = fixture();
    f.detector.warm(); await flush();
    f.query.mockRejectedValueOnce(new Error('offline'));
    expect((await f.detector.detect('x')).ready).toBe(false);
    vi.useFakeTimers();
    try {
      f.query.mockImplementation(() => new Promise(() => {}));
      const pending = f.detector.detect('x');
      await vi.advanceTimersByTimeAsync(180);
      expect((await pending).ready).toBe(false);
      expect((await f.detector.detect('x')).ready).toBe(false);
      expect(f.query).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
