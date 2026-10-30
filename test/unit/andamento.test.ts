// Andamento's places (ADR 0202, src/renderer/lib/andamento.ts): its tabs, the args that open one, and the old statistics
// pages (costi, qualita, classificatori; Memoria's apprendimento) landing on their tab through go(), links, parseTarget
// and the G-keys; the usage counter sees each tab as its own place.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: () => () => {} } }));
import { DEFAULT_TREND_TAB, TREND_TABS, parseTrendArg, trendArg, trendRedirect } from '../../src/renderer/lib/andamento';
import { BRAIN_PAGES, GO_ALIASES, parseTarget } from '../../src/renderer/brain';
import { go, goTarget, placeOf } from '../../src/renderer/actions';
import { ui } from '../../src/renderer/store/ui';
import { HUB_TABS } from '../../src/renderer/lib/memory-hub';

describe('the Andamento tabs', () => {
  it('keeps the agreed order and opens on Costi', () => {
    expect(TREND_TABS).toEqual(['costi', 'qualita', 'apprendimento', 'classificatori', 'uso']);
    expect(DEFAULT_TREND_TAB).toBe('costi');
  });
  it('parses a tab, its own arg and the words people type', () => {
    expect(parseTrendArg('costi/30')).toEqual({ tab: 'costi', rest: '30' });
    expect(parseTrendArg('Qualita')).toEqual({ tab: 'qualita', rest: null });
    expect(parseTrendArg('learning')).toEqual({ tab: 'apprendimento', rest: null });
    expect(parseTrendArg('usage')).toEqual({ tab: 'uso', rest: null });
    expect(parseTrendArg(null)).toEqual({ tab: 'costi', rest: null });
    expect(parseTrendArg('boh/x')).toEqual({ tab: 'costi', rest: null });
    expect(trendArg('costi', '90')).toBe('costi/90');
    expect(trendArg('uso')).toBe('uso');
  });
  it('redirects the old pages and Memoria\'s old tab, and nothing else', () => {
    expect(trendRedirect('costi', '30')).toEqual({ page: 'andamento', arg: 'costi/30' });
    expect(trendRedirect('qualita', null)).toEqual({ page: 'andamento', arg: 'qualita' });
    expect(trendRedirect('classificatori', null)).toEqual({ page: 'andamento', arg: 'classificatori' });
    expect(trendRedirect('apprendimento', null)).toEqual({ page: 'andamento', arg: 'apprendimento' });
    expect(trendRedirect('memoria', 'apprendimento')).toEqual({ page: 'andamento', arg: 'apprendimento' });
    expect(trendRedirect('memoria', 'skill')).toBeNull();
    expect(trendRedirect('andamento', 'uso')).toBeNull();
    expect(trendRedirect('task', null)).toBeNull();
  });
});

describe('one page, the old ids as aliases', () => {
  it('lists Andamento once (G C) and no longer the four pages; G Q, G J and G K stay as aliases', () => {
    const ids = BRAIN_PAGES.map(p => p.id) as string[];
    expect(ids).toContain('andamento');
    for (const old of ['costi', 'qualita', 'apprendimento', 'classificatori']) expect(ids).not.toContain(old);
    expect(BRAIN_PAGES.find(p => p.id === 'andamento')?.key).toBe('G C');
    expect(GO_ALIASES).toEqual(expect.arrayContaining([{ id: 'qualita', key: 'G Q' }, { id: 'apprendimento', key: 'G J' }, { id: 'classificatori', key: 'G K' }]));
    expect(HUB_TABS).not.toContain('apprendimento' as never);
  });
  it('go(), links and the brain pages\' targets land on the tab', () => {
    go({ page: 'qualita' as never });
    expect(ui.get().page).toBe('andamento');
    expect(ui.get().pageArg).toBe('qualita');
    go({ page: 'memoria', arg: 'apprendimento' });
    expect([ui.get().page, ui.get().pageArg]).toEqual(['andamento', 'apprendimento']);
    goTarget('costi/30');
    expect([ui.get().page, ui.get().pageArg]).toEqual(['andamento', 'costi/30']);
    expect(placeOf('classificatori')).toEqual({ page: 'andamento', arg: 'classificatori' });
    expect(parseTarget('costi/90')).toEqual({ map: false, id: 'andamento', arg: 'costi/90' });
    expect(parseTarget('andamento/uso')).toEqual({ map: false, id: 'andamento', arg: 'uso' });
  });
});
