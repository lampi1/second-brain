// Calm notifications (src/main/brain/notify.ts) on a fake clock: who may toast, grouping, the 20 s throttle, urgent
// bypass, focus, mutes, do-not-disturb, disabled toasts, requests held while "Rispondi dopo" is on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notifier, compose, loud, type Toast } from '../../../src/main/brain/notify';
import { stamp } from '../../../src/main/brain/live';
import type { FeedEvent, Settings } from '../../../src/shared/contract';

type S = Pick<Settings, 'osToasts' | 'mute' | 'dnd' | 'dndUntil'>;
const ev = (kind: string, title = kind, extra: Partial<FeedEvent> = {}): FeedEvent => ({ ...stamp({ kind, title }), ...extra });

function setup(s: Partial<S> = {}, focused = false) {
  const shown: Toast[] = [];
  const st: S = { osToasts: 'urgent', mute: {}, dnd: false, dndUntil: null, ...s };
  const state = { focused, enabled: true };
  const n = new Notifier({ settings: () => st, isFocused: () => state.focused, show: t => shown.push(t), enabled: () => state.enabled });
  return { n, shown, st, state };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('notify', () => {
  it('"Rispondi dopo": a held request never toasts, the rest still does; off again, requests toast', () => {
    const shown: Toast[] = [];
    const later = { on: true };
    const n = new Notifier({ settings: () => ({ osToasts: 'urgent', mute: {}, dnd: false, dndUntil: null }), isFocused: () => false,
      show: t => shown.push(t), enabled: () => true, held: e => later.on && e.kind === 'question' });
    n.push([ev('question', 'Quale ambiente?')]);
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual([]);
    n.push([ev('question', 'Apro la PR?'), ev('chat-waiting', 'OS · Prova')]);
    vi.advanceTimersByTime(2000);
    expect(shown.map(t => t.title)).toEqual(['Chat che ti aspetta: OS · Prova']);
    later.on = false;
    n.push([ev('question', 'Quale tema?')]);
    vi.advanceTimersByTime(2000);
    expect(shown).toHaveLength(2);
  });

  it('by default only urgent kinds may toast; away, muted and dnd never do', () => {
    const s: S = { osToasts: 'urgent', mute: {}, dnd: false, dndUntil: null };
    expect(loud([ev('chat-waiting'), ev('idea'), ev('now')], s).map(e => e.kind)).toEqual(['chat-waiting']);
    expect(loud([ev('chat-waiting'), ev('idea'), ev('now')], { ...s, osToasts: 'normal' }).map(e => e.kind)).toEqual(['chat-waiting', 'idea']);
    expect(loud([ev('chat-waiting')], { ...s, osToasts: 'off' })).toEqual([]);
    expect(loud([ev('chat-waiting', 't', { away: true })], s)).toEqual([]);
    expect(loud([ev('chat-waiting')], { ...s, mute: { 'chat-waiting': true } })).toEqual([]);
    expect(loud([ev('chat-waiting')], { ...s, dnd: true })).toEqual([]);
  });

  it('timed do-not-disturb silences until its time, then toasts come back', () => {
    const s: S = { osToasts: 'urgent', mute: {}, dnd: false, dndUntil: Date.now() + 3600e3 };
    expect(loud([ev('chat-waiting')], s)).toEqual([]);
    expect(loud([ev('chat-waiting')], s, Date.now() + 3601e3).map(e => e.kind)).toEqual(['chat-waiting']);
  });

  it('urgent events within 1.5 s become one toast, shown at once (no throttle)', () => {
    const { n, shown } = setup();
    n.push([ev('chat-waiting', 'OS · Prova')]);
    vi.advanceTimersByTime(500);
    n.push([ev('question', 'Quale ambiente?')]);
    vi.advanceTimersByTime(999);
    expect(shown).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('2 novità per te');
    expect(shown[0]!.urgent).toBe(true);
    // another urgent one right after: not throttled
    n.push([ev('chat-waiting', 'Altra chat')]);
    vi.advanceTimersByTime(1500);
    expect(shown).toHaveLength(2);
    expect(shown[1]!.title).toBe('Chat che ti aspetta: Altra chat');
  });

  it('normal events are grouped and never sooner than 20 s after the last toast', () => {
    const { n, shown } = setup({ osToasts: 'normal' });
    n.push([ev('idea', 'A')]);
    vi.advanceTimersByTime(1000);
    n.push([ev('error', 'B'), ev('win', 'C')]);
    vi.advanceTimersByTime(2999);
    expect(shown).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: '3 novità per te', urgent: false, count: 3 });
    n.push([ev('idea', 'D')]);
    vi.advanceTimersByTime(10000);
    expect(shown).toHaveLength(1); // throttled
    n.push([ev('idea', 'E')]);
    vi.advanceTimersByTime(10000);
    expect(shown).toHaveLength(2);
    expect(shown[1]!.title).toBe('2 novità per te');
  });

  it('nothing while the window is focused, and nothing if the user came back before the flush', () => {
    const a = setup({}, true);
    a.n.push([ev('chat-waiting')]);
    vi.advanceTimersByTime(5000);
    expect(a.shown).toEqual([]);
    const b = setup();
    b.n.push([ev('chat-waiting')]);
    b.state.focused = true;
    vi.advanceTimersByTime(5000);
    expect(b.shown).toEqual([]);
  });

  it('a mute or dnd set while waiting is respected at flush; disabled toasts (tests, unsupported) never show', () => {
    const a = setup();
    a.n.push([ev('chat-waiting')]);
    a.st.dnd = true;
    vi.advanceTimersByTime(5000);
    expect(a.shown).toEqual([]);
    const b = setup();
    b.state.enabled = false;
    b.n.push([ev('chat-waiting')]);
    vi.advanceTimersByTime(5000);
    expect(b.shown).toEqual([]);
  });

  it('compose: one named thing, or the count with the first three (urgent first) and "e altre N"', () => {
    const one = compose([ev('chat-waiting', 'OS · Prova', { detail: 'domanda' })]);
    expect(one).toMatchObject({ title: 'Chat che ti aspetta: OS · Prova', body: 'domanda', count: 1 });
    const many = compose([ev('idea', 'i1'), ev('idea', 'i2'), ev('chat-waiting', 'c1'), ev('error', 'e1'), ev('win', 'w1')]);
    expect(many.title).toBe('5 novità per te');
    expect(many.body.split('\n')[0]).toBe('Chat che ti aspetta: c1');
    expect(many.body.split('\n').at(-1)).toBe('e altre 2');
  });
});
