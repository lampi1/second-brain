// The view preferences an agent may change (renderer/lib/view-prefs.ts, app_config area "view", ADR 0149): only density
// and the work profile, only valid values (no theme: the app is dark only, ADR 0366); anything else is refused or ignored. And the Settings sections the
// app map lists are the page's own (renderer/lib/settings-sections.ts).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyViewPrefs, setViewPrefs, viewPrefs } from '../../src/renderer/lib/view-prefs';
import { settingsSections, SETTINGS_SECTION_IDS } from '../../src/renderer/lib/settings-sections';
import { clampSidebarWidth, loadPrefs, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, ui } from '../../src/renderer/store/ui';
import { WORK_PROFILES } from '../../src/shared/work-profiles';

describe('view prefs from an agent', () => {
  beforeAll(() => { const m = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }); });
  it('applies a valid density; a patch with any other field (the retired theme too) or a bad value changes nothing', () => {
    const size = ui.get().prefs.orchestratorSize;
    expect(setViewPrefs(JSON.stringify({ density: 'compact', orchestratorSize: { w: 1, h: 1 } }))).toMatchObject({ ok: false, error: /orchestratorSize/ });
    expect(ui.get().prefs.orchestratorSize).toEqual(size);
    expect(viewPrefs().density).toBe('comfortable');
    expect(setViewPrefs(JSON.stringify({ theme: 'light' }))).toMatchObject({ ok: false, error: /theme/ });
    expect(viewPrefs()).not.toHaveProperty('theme');
    expect(setViewPrefs(JSON.stringify({ density: 'compact' }))).toMatchObject({ ok: true, view: { density: 'compact' } });
    applyViewPrefs(JSON.stringify({ density: 'huge' }));
    expect(viewPrefs().density).toBe('compact');
    applyViewPrefs('not json');
    expect(viewPrefs().density).toBe('compact');
  });

  it('sets a known work profile and clears it with null; an unknown id is ignored', () => {
    const id = WORK_PROFILES[0]!.id;
    applyViewPrefs(JSON.stringify({ workProfile: id }));
    expect(viewPrefs().workProfile).toBe(id);
    applyViewPrefs(JSON.stringify({ workProfile: 'nope' }));
    expect(viewPrefs().workProfile).toBe(id);
    applyViewPrefs(JSON.stringify({ workProfile: null }));
    expect(viewPrefs().workProfile).toBeNull();
  });
});

describe('sidebar width preference', () => {
  it('clamps to min, max and 42% viewport cap and sanitizes persisted values', () => {
    expect(clampSidebarWidth(100, 1440)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(900, 1440)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(400, 800)).toBe(336);
    expect(loadPrefs(JSON.stringify({ sidebarWidth: 320 })).sidebarWidth).toBe(320);
    expect(loadPrefs(JSON.stringify({ sidebarWidth: 40 })).sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);
    expect(loadPrefs(JSON.stringify({ sidebarWidth: 999 })).sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
    expect(loadPrefs(JSON.stringify({ sidebarWidth: 'wide' })).sidebarWidth).toBeNull();
  });
});

describe('settings sections', () => {
  it('one entry per id, in page order, each with a title and a description', () => {
    const s = settingsSections(['Claude']);
    expect(Object.keys(s)).toEqual([...SETTINGS_SECTION_IDS]);
    for (const id of SETTINGS_SECTION_IDS) { expect(s[id].title.length).toBeGreaterThan(2); expect(s[id].description.length).toBeGreaterThan(5); }
    expect(s.accounts.search).toContain('Claude');
  });
});
