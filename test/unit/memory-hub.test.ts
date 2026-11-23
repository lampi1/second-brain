// The Memoria hub's places (ADR 0122; owner 2026-11-23: only Diario, Artifact, Skill and Proposte): tab args, the old
// pages' redirect, and the deleted tabs' old links.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, HUB_PAGES, HUB_TABS, hubArg, hubRedirect, parseHubArg } from '../../src/renderer/lib/memory-hub';

describe('the Memoria hub tabs', () => {
  it('has only the four agreed tabs', () => {
    expect(HUB_TABS).toEqual(['file', 'artifact', 'skill', 'proposte']);
    expect(DEFAULT_TAB).toBe('proposte');
  });

  it('parses a tab, its own arg and the aliases', () => {
    expect(parseHubArg('skill/note-di-rilascio')).toEqual({ tab: 'skill', rest: 'note-di-rilascio' });
    expect(parseHubArg('Diario')).toEqual({ tab: 'file', rest: null });
    // Script & Query is gone (ADR 0263): its links open the script's skill
    expect(parseHubArg('queries')).toEqual({ tab: 'skill', rest: null });
    expect(parseHubArg('script/deploy%2Fa.ps1')).toEqual({ tab: 'skill', rest: 'deploy' });
    expect(parseHubArg('script/deploy/a.ps1')).toEqual({ tab: 'skill', rest: 'deploy' });
    expect(parseHubArg('script/vecchio.ps1')).toEqual({ tab: 'skill', rest: null });
    expect(parseHubArg('script/50%')).toEqual({ tab: 'skill', rest: null }); // a malformed link does not throw
    expect(parseHubArg('statistiche')).toEqual({ tab: 'skill', rest: null }); // gone (ADR 0248): skill use is in Skill
  });

  it('falls back to the default tab, the deleted tabs included', () => {
    for (const arg of [null, '', 'boh/x', 'approvate', 'regole', 'Regole/x', 'idee/ia']) expect(parseHubArg(arg)).toEqual({ tab: 'proposte', rest: null });
  });

  it('builds a tab arg', () => {
    expect(hubArg('file')).toBe('file');
    expect(hubArg('skill', 'x')).toBe('skill/x');
  });

  it('redirects every old page to its tab', () => {
    for (const [page, tab] of Object.entries(HUB_PAGES)) expect(hubRedirect(page, null)).toEqual({ page: 'memoria', arg: tab });
    expect(hubRedirect('skill', 'note')).toEqual({ page: 'memoria', arg: 'skill/note' });
    expect(hubRedirect('script', 'deploy/a.ps1')).toEqual({ page: 'memoria', arg: 'skill/deploy' });
    expect(hubRedirect('idee', 'ia')).toBeNull(); // deleted pages: plain aliases of Memoria (brain PAGE_ALIAS)
    expect(hubRedirect('memoria', 'file')).toBeNull();
    expect(hubRedirect('costi', null)).toBeNull();
  });
});
