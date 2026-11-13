// The turn-start watchdog (src/main/chats/turn-watchdog.ts, ADR 0221): a stalled turn (the replay engine fed a
// recording whose answer never comes) gets a visible warning and a warn log line, the session is neither restarted nor
// closed; a late first event turns the warning into an info line; a busy session's send, an interrupt and an exit do
// not arm or fire it; what the adapter reports inside send() is not the engine's first event.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTurns } from '../../../src/main/chats/turn-watchdog';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { ChatItem } from '../../../src/shared/contract';
import { log } from '../../../src/main/log';
import { recSink } from './helpers';

/** a stand-in session: busy as told, send reports a user item synchronously (as the adapters do) */
function fakeSession(sink: SessionSink, busy = { v: false }) {
  return {
    get busy() { return busy.v; },
    send(text: string) { sink.item({ kind: 'user', id: `u-${text}`, at: 0, text } as ChatItem, false); sink.changed({ state: 'running' }); },
    interrupt: vi.fn(async () => {}), close: vi.fn(async () => {}), start: vi.fn(),
  } as unknown as HarnessSession & { interrupt: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}
const systems = (sink: ReturnType<typeof recSink>) => [...sink.items.values()].filter(i => i.kind === 'system') as Extract<ChatItem, { kind: 'system' }>[];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('watchTurns', () => {
  it('warns and logs a turn with no first event, keeps the session, and turns the warning into info when it starts late', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(log, 'warn');
    const sink = recSink();
    let inner!: SessionSink, raw!: ReturnType<typeof fakeSession>;
    const s = watchTurns(k => { inner = k; raw = fakeSession(k); return raw; }, sink, { chatId: 'c1', engine: 'codex', label: 'Codex', noStartMs: 1000 });
    s.send('ciao');
    vi.advanceTimersByTime(999);
    expect(systems(sink)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(systems(sink).map(i => [i.code, i.level])).toEqual([['turnNoStart', 'warn']]);
    expect(systems(sink)[0]!.text).toContain('Codex has not answered yet after 1 s');
    expect(warn).toHaveBeenCalledWith('chats', 'turn start watchdog: no first event from the engine', expect.objectContaining({ chat: 'c1', cause: expect.any(String), hint: expect.any(String) }));
    expect(raw.close).not.toHaveBeenCalled();
    expect(raw.interrupt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    inner.item({ kind: 'assistant', id: 'a1', at: 0, text: 'eccomi' } as ChatItem, false);
    expect(systems(sink).map(i => [i.code, i.level])).toEqual([['turnStartLate', 'info']]);
    expect(systems(sink)[0]!.text).toContain('after 3 s');
  });

  it('does not fire when the first event comes in time, nor for a busy session, an interrupt or an exit', async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(log, 'info');
    const sink = recSink();
    let inner!: SessionSink;
    const busy = { v: false };
    const s = watchTurns(k => { inner = k; return fakeSession(k, busy); }, sink, { chatId: 'c2', engine: 'claude', label: 'Claude', noStartMs: 1000 });
    s.send('a'); vi.advanceTimersByTime(10);
    inner.changed({ sessionId: 'x' });
    vi.advanceTimersByTime(5000);
    expect(info).toHaveBeenCalledWith('chats', 'timing: turn start', expect.objectContaining({ data: expect.objectContaining({ engine: 'claude', firstEventMs: 10 }) }));
    busy.v = true; s.send('b'); vi.advanceTimersByTime(5000); busy.v = false;
    s.send('c'); await s.interrupt(); vi.advanceTimersByTime(5000);
    s.send('d'); inner.exit({ code: 1, error: 'x' }); vi.advanceTimersByTime(5000);
    expect(systems(sink)).toEqual([]);
  });
});
