// The Memoria hub's places (ADR 0122): tab args, the old pages' redirect and «Rispolvera».
import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, HUB_PAGES, HUB_TABS, hubArg, hubRedirect, parseHubArg, pickOld } from '../../src/renderer/lib/memory-hub';

describe('the Memoria hub tabs', () => {
  it('keeps the tabs in the agreed order', () => {
    expect(HUB_TABS).toEqual(['proposte', 'approvate', 'skill', 'regole', 'script', 'idee', 'file', 'apprendimento', 'statistiche']);
    expect(DEFAULT_TAB).toBe('proposte');
  });

  it('parses a tab, its own arg and the aliases', () => {
    expect(parseHubArg('skill/note-di-rilascio')).toEqual({ tab: 'skill', rest: 'note-di-rilascio' });
    expect(parseHubArg('idee/ia')).toEqual({ tab: 'idee', rest: 'ia' });
    expect(parseHubArg('Regole')).toEqual({ tab: 'regole', rest: null });
    expect(parseHubArg('queries')).toEqual({ tab: 'script', rest: null });
    expect(parseHubArg('script/a/b')).toEqual({ tab: 'script', rest: 'a/b' });
  });

  it('falls back to the default tab', () => {
    expect(parseHubArg(null)).toEqual({ tab: 'proposte', rest: null });
    expect(parseHubArg('')).toEqual({ tab: 'proposte', rest: null });
    expect(parseHubArg('boh/x')).toEqual({ tab: 'proposte', rest: null });
  });

  it('builds a tab arg', () => {
    expect(hubArg('file')).toBe('file');
    expect(hubArg('skill', 'x')).toBe('skill/x');
  });

  it('redirects every old page to its tab, keeping its arg', () => {
    for (const [page, tab] of Object.entries(HUB_PAGES)) expect(hubRedirect(page, null)).toEqual({ page: 'memoria', arg: tab });
    expect(hubRedirect('skill', 'note')).toEqual({ page: 'memoria', arg: 'skill/note' });
    expect(hubRedirect('idee', 'ia')).toEqual({ page: 'memoria', arg: 'idee/ia' });
    expect(hubRedirect('memoria', 'file')).toBeNull();
    expect(hubRedirect('costi', null)).toBeNull();
  });
});

describe('«Rispolvera»', () => {
  const idea = (titolo: string, data: string, stato = 'aperta') => ({ titolo, data, stato });
  const today = '2026-10-22';

  it('prefers an open idea at least 30 days old', () => {
    const list = [idea('nuova', '2026-10-20'), idea('vecchia', '2026-08-01'), idea('fatta', '2026-01-01', 'fatta')];
    expect(pickOld(list, today, null, () => 0.99)?.titolo).toBe('vecchia');
  });

  it('then any open idea, then any idea', () => {
    expect(pickOld([idea('nuova', '2026-10-20'), idea('x', '2026-01-01', 'scartata')], today, null, () => 0)?.titolo).toBe('nuova');
    expect(pickOld([idea('x', '2026-01-01', 'fatta')], today, null)?.titolo).toBe('x');
    expect(pickOld([], today, null)).toBeNull();
  });

  it('never repeats the one shown when there is another', () => {
    const list = [idea('a', '2026-01-01'), idea('b', '2026-02-01')];
    for (const r of [0, 0.5, 0.99]) expect(pickOld(list, today, 'a', () => r)?.titolo).toBe('b');
    expect(pickOld([idea('a', '2026-01-01')], today, 'a')?.titolo).toBe('a');
  });
});
