// The user's Stop on a Claude engine (ADR 0368, claude.ts watchStop): a turn whose result has not come STOP_GRACE_MS
// after the interrupt ends at once as his stop and the engine is restarted on the same session, carrying the messages
// sent since; a result in time leaves everything as it was. In process: a fake child on the session, fake timers, no
// real process (rule 7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeSession, STOP_GRACE_MS } from '../../../src/main/chats/claude';
import { CANCEL_GRACE_MS } from '../../../src/main/chats/acp';
import { recSink } from './helpers';

afterEach(() => { vi.useRealTimers(); });

function live() {
  vi.useFakeTimers();
  const sink = recSink(), written: Record<string, unknown>[] = [];
  const s = new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: 'abc12345' }, sink);
  const proc = { pid: 4242, stdin: { writable: true, write: (line: string) => { written.push(JSON.parse(line) as Record<string, unknown>); return true; }, end() {} }, kill() {} };
  (s as unknown as { proc: unknown }).proc = proc;
  const out = (m: unknown) => (s as unknown as { onStdout(d: string): void }).onStdout(`${JSON.stringify(m)}\n`);
  return { s, sink, written, out };
}

describe('Stop on a Claude engine', () => {
  it('waits one second by default, as the ACP engines do', () => {
    expect(STOP_GRACE_MS).toBe(1000);
    expect(CANCEL_GRACE_MS).toBe(1000);
  });

  it('a turn not ended a second after the interrupt ends as his stop; the engine restarts with what was sent since', async () => {
    const { s, sink, written } = live();
    s.send('lavora');
    const stopping = s.interrupt({ byUser: true });
    expect(written.at(-1)).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
    s.send('poi questo');
    vi.advanceTimersByTime(STOP_GRACE_MS - 1);
    expect(sink.patches.some(p => p.restart)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sink.last('result')).toMatchObject({ kind: 'result', interrupted: true, isError: false });
    expect(sink.patches.find(p => p.restart)?.restart).toEqual([{ text: 'poi questo', images: [] }]);
    expect(sink.patch.state).toBe('idle');
    // the left-behind engine's late output belongs to no turn; the interrupt resolves without «Stop non riuscito»
    const results = sink.events.filter(e => e.item.kind === 'result').length;
    (s as unknown as { onStdout(d: string): void }).onStdout(`${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true })}\n`);
    expect(sink.events.filter(e => e.item.kind === 'result').length).toBe(results);
    vi.advanceTimersByTime(5000);
    await expect(stopping).resolves.toBeUndefined();
  });

  it('a result in time: no restart, the stop is the usual interrupted turn', async () => {
    const { s, sink, written, out } = live();
    s.send('lavora');
    const stopping = s.interrupt({ byUser: true });
    const id = (written.at(-1) as { request_id: string }).request_id;
    out({ type: 'control_response', response: { subtype: 'success', request_id: id, response: {} } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, usage: {} });
    await stopping;
    vi.advanceTimersByTime(STOP_GRACE_MS * 5);
    expect(sink.patches.some(p => p.restart)).toBe(false);
    expect(sink.last('result')).toMatchObject({ interrupted: true, isError: false });
  });

  it('an interrupt of an idle engine starts no watch', async () => {
    const { s, sink, written, out } = live();
    const stopping = s.interrupt({ byUser: true });
    out({ type: 'control_response', response: { subtype: 'success', request_id: (written.at(-1) as { request_id: string }).request_id, response: {} } });
    await stopping;
    vi.advanceTimersByTime(STOP_GRACE_MS * 5);
    expect(sink.patches.some(p => p.restart)).toBe(false);
  });
});
