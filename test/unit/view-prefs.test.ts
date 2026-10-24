// The view preferences an agent may change (renderer/lib/view-prefs.ts, app_config area "view", ADR 0149): only theme,
// density and the work profile, only valid values; anything else in the patch is ignored. And the Settings sections the
// app map lists are the page's own (renderer/lib/settings-sections.ts).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyViewPrefs, viewPrefs } from '../../src/renderer/lib/view-prefs';
import { settingsSections, SETTINGS_SECTION_IDS } from '../../src/renderer/lib/settings-sections';
import { ui } from '../../src/renderer/store/ui';
import { WORK_PROFILES } from '../../src/shared/work-profiles';

describe('view prefs from an agent', () => {
  beforeAll(() => { const m = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }); });
  it('applies valid theme and density, ignores other fields and bad values', () => {
    const size = ui.get().prefs.orchestratorSize;
    applyViewPrefs(JSON.stringify({ theme: 'light', density: 'compact', orchestratorSize: { w: 1, h: 1 } }));
    expect(viewPrefs()).toMatchObject({ theme: 'light', density: 'compact' });
    expect(ui.get().prefs.orchestratorSize).toEqual(size);
    applyViewPrefs(JSON.stringify({ theme: 'pink', density: 'huge' }));
    expect(viewPrefs()).toMatchObject({ theme: 'light', density: 'compact' });
    applyViewPrefs('not json');
    expect(viewPrefs().theme).toBe('light');
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

describe('settings sections', () => {
  it('one entry per id, in page order, each with a title and a description', () => {
    const s = settingsSections(['Claude']);
    expect(Object.keys(s)).toEqual([...SETTINGS_SECTION_IDS]);
    for (const id of SETTINGS_SECTION_IDS) { expect(s[id].title.length).toBeGreaterThan(2); expect(s[id].description.length).toBeGreaterThan(5); }
    expect(s.accounts.search).toContain('Claude');
  });
});
