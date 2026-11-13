// The page's side of the usage counter (ADR 0202, src/renderer/lib/use-counter.ts and lib/use-view.ts): the key of a
// place (tabs of Memoria, Andamento, Impostazioni as places of their own), actions, the batch sent in one call, the
// data-track clicks, and the report in words (never-opened places, active days).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_MS, MAX_PENDING, flushUseCounts, installUseCounter, pendingUseCounts, placeKey, track, trackPlace } from '../../src/renderer/lib/use-counter';
import { activeDays, neverOpened, placeOfKey, useItems } from '../../src/renderer/lib/use-view';

const invoke = vi.fn(async () => undefined);
(globalThis as unknown as { window: unknown }).window = { sb: { invoke, on: () => () => {} } };
afterEach(() => { flushUseCounts(); invoke.mockClear(); vi.useRealTimers(); });

describe('keys', () => {
  it('a page, or its tab for the pages made of tabs', () => {
    expect(placeKey('task', null)).toBe('page:task');
    expect(placeKey('memoria', 'skill/x')).toBe('page:memoria/skill');
    expect(placeKey('memoria', null)).toBe('page:memoria/proposte');
    expect(placeKey('andamento', 'costi/30')).toBe('page:andamento/costi');
    expect(placeKey('andamento', null)).toBe('page:andamento/costi');
    expect(placeKey('impostazioni', 'appearance')).toBe('page:impostazioni/appearance');
    expect(placeKey('impostazioni', null)).toBe('page:impostazioni');
    expect(placeKey('Bad Page', null)).toBeNull();
  });
});

describe('batching', () => {
  it('sums uses and sends them in one call after FLUSH_MS', () => {
    vi.useFakeTimers();
    trackPlace('task', null); trackPlace('task', null); track('discuss'); track('Not An Action');
    expect(pendingUseCounts()).toEqual({ 'page:task': 2, 'action:discuss': 1 });
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FLUSH_MS);
    expect(invoke).toHaveBeenCalledWith('usecount:add', { counts: { 'page:task': 2, 'action:discuss': 1 } });
    expect(pendingUseCounts()).toEqual({});
  });
  it('sends at once when the batch is full', () => {
    for (let i = 0; i < MAX_PENDING; i++) track('next-thing');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('usecount:add', { counts: { 'action:next-thing': MAX_PENDING } });
  });
  it('counts a click on an element with data-track (or inside one)', () => {
    let onClick: ((e: { target: unknown }) => void) | null = null;
    const doc = { addEventListener: (_: string, fn: typeof onClick) => { onClick = fn; }, removeEventListener: () => { onClick = null; }, defaultView: null } as unknown as Document;
    const off = installUseCounter(doc);
    const inside = { closest: (sel: string) => (sel === '[data-track]' ? { getAttribute: () => 'maintenance' } : null) };
    const plain = { closest: () => null };
    onClick!({ target: inside });
    onClick!({ target: plain });
    expect(pendingUseCounts()).toEqual({ 'action:maintenance': 1 });
    off();
    expect(onClick).toBeNull();
  });
});

describe('the report in words', () => {
  const rows = [{ key: 'page:memoria/skill', n: 5, days: 3, last: '2026-10-30' }, { key: 'action:discuss', n: 2, days: 1, last: '2026-10-29' }];
  it('names each row and knows where a page goes', () => {
    const items = useItems(rows, (kind, id, sub) => `${kind}:${id}${sub ? `>${sub}` : ''}`);
    expect(items.map(x => [x.label, x.kind, x.place])).toEqual([['page:memoria>skill', 'page', { page: 'memoria', arg: 'skill' }], ['action:discuss', 'action', null]]);
    expect(placeOfKey('page:task')).toEqual({ page: 'task', arg: null });
  });
  it('lists the places never opened and the active days', () => {
    expect(neverOpened(rows, ['page:memoria/skill', 'page:task', 'page:mappa'])).toEqual(['page:task', 'page:mappa']);
    expect(activeDays([{ n: 0 }, { n: 3 }, { n: 1 }])).toBe(2);
  });
});
