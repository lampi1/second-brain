// Runtime baseline accounting with a deterministic clock: no sleeps, latency thresholds or load assumptions.
// Checks attribution, missing evidence, bounded capture and privacy independently of the replay machine's speed.
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimePerformance, percentiles } from '../../src/main/runtime-performance';

let time = 1000;
const recorder = new RuntimePerformance(() => time);
afterEach(() => { recorder.stop(); time = 1000; });
const begin = (id = 'op-1', chatId = 'chat') => recorder.begin(chatId, { operationId: id, sentAt: 990 });

describe('runtime baseline', () => {
  it('uses nearest-rank percentiles and reports no samples as null', () => {
    expect(percentiles([])).toEqual({ n: 0, p50: null, p95: null, p99: null, max: null });
    expect(percentiles([4, 1, 3, 2, NaN, -1, Infinity])).toEqual({ n: 4, p50: 2, p95: 4, p99: 4, max: 4 });
  });

  it('does not capture ordinary app traffic', () => {
    begin(); recorder.runtime('chat', 'claude', false, false); recorder.ipc({ arbitrary: 'private' });
    expect(recorder.snapshot().rows).toEqual([]);
    expect(recorder.snapshot().ipc.events).toBe(0);
  });

  it('correlates separate milestones without mistaking transport submission for acknowledgement', () => {
    recorder.start(); begin();
    time = 1010; recorder.runtime('chat', 'claude', false, false);
    time = 1020; recorder.providerWrite('chat');
    time = 1030; recorder.item('chat', 'assistant', true, false);
    time = 1040; recorder.ipc({ chatId: 'chat', text: 'not retained' }, 'chat', true);
    time = 1050; recorder.item('chat', 'assistant', true, false); // the first delta stays first
    time = 1060; recorder.item('chat', 'result', false, false);
    const result = recorder.snapshot();
    expect(result.rows[0]).toEqual({ operationId: 'op-1', chatId: 'chat', uiAt: 990, engine: 'claude', temperature: 'cold',
      marks: { main: 1000, runtime: 1010, providerWrite: 1020, firstText: 1030, firstTextIpc: 1040, result: 1060 } });
    expect(result.groups[0]?.sendToFirstTextMs.p99).toBe(40);
    expect(result.groups[0]?.firstTextToIpcMs.p99).toBe(10);
    expect(JSON.stringify(result)).not.toContain('not retained');
    expect(result.ipc.events).toBe(1);
  });

  it('excludes replayed text and incomplete operations rather than manufacturing zeroes', () => {
    recorder.start(); begin(); recorder.runtime('chat', 'acp', false, false); recorder.providerWrite('chat');
    recorder.item('chat', 'assistant', true, true);
    recorder.item('chat', 'assistant', false, false);
    expect(recorder.snapshot().rows[0]?.marks.firstText).toBeUndefined();
    expect(recorder.snapshot().rows[0]?.invalid).toBe('incomplete');
    expect(recorder.snapshot().groups).toEqual([]);
  });

  it('excludes ambiguous overlaps, duplicates and busy-turn sends', () => {
    recorder.start(); begin(); begin('op-2'); begin('op-2');
    recorder.runtime('chat', 'codex', true, true); recorder.providerWrite('chat');
    recorder.item('chat', 'result', false, false);
    expect(recorder.snapshot().rows.map(r => r.invalid)).toEqual(['overlap', 'overlap']);
    expect(recorder.snapshot().dropped).toBe(1);
    expect(recorder.snapshot().groups).toEqual([]);
  });

  it('keeps independent chats independent and records failures', () => {
    recorder.start(); begin('op-1', 'a'); begin('op-2', 'b');
    recorder.runtime('b', 'api', true, false); recorder.providerWrite('b'); recorder.item('b', 'result', false, false);
    recorder.fail('a');
    expect(recorder.snapshot().rows.map(r => r.invalid)).toEqual(['failed', undefined]);
    expect(recorder.snapshot().groups[0]?.sendToFirstTextMs.n).toBe(0);
  });

  it('counts the first send after chat creation as cold even when the session already exists', () => {
    recorder.start(); recorder.sessionCreated('chat'); begin();
    recorder.runtime('chat', 'claude', true, true); recorder.providerWrite('chat'); recorder.item('chat', 'result', false, false);
    begin('op-2'); recorder.runtime('chat', 'claude', true, false); recorder.providerWrite('chat'); recorder.item('chat', 'result', false, false);
    expect(recorder.snapshot().rows.map(r => r.temperature)).toEqual(['cold', 'warm']);
    expect(recorder.snapshot().rows.map(r => r.invalid)).toEqual([undefined, undefined]);
  });

  it('bounds capture and rejects malformed/future input', () => {
    recorder.start();
    recorder.begin('chat', { operationId: '../bad', sentAt: 990 });
    recorder.begin('chat', { operationId: 'future', sentAt: 1001 });
    for (let i = 0; i < 4097; i++) begin(`op-${i}`, `chat-${i}`);
    expect(recorder.snapshot().rows).toHaveLength(4096);
    expect(recorder.snapshot().dropped).toBe(3);
  });
});
