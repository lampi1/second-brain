// The view preferences an agent may read and change for the user (app_config area "view", ADR 0149): theme, density
// and the work profile (the rail's composition), the same fields Settings → Aspetto / Spazio and the palette change.
// Main reads them through window.__sbView (lib/app-map.ts) and changes them with ui:command 'prefs' (actions.ts):
// only these fields with valid values; anything else is ignored. Used by actions.ts and lib/app-map.ts.
import { WORK_PROFILES } from '@shared/work-profiles';
import { saveWorkProfile, setPrefs, ui, type Density, type Theme } from '../store/ui';

export interface ViewPrefs { theme: Theme; density: Density; workProfile: string | null; orchestratorOpen: boolean; workProfiles: { id: string; title: string }[] }

export function viewPrefs(): ViewPrefs {
  const p = ui.get().prefs;
  return { theme: p.theme, density: p.density, workProfile: p.workProfile ?? null, orchestratorOpen: p.orchestratorOpen, workProfiles: WORK_PROFILES.map(w => ({ id: w.id, title: w.title })) };
}

/** ui:command 'prefs': the patch as JSON text. */
export function applyViewPrefs(json: string): void {
  let v: Record<string, unknown>;
  try { v = JSON.parse(json) as Record<string, unknown>; } catch { return; }
  if (!v || typeof v !== 'object') return;
  const patch: { theme?: Theme; density?: Density } = {};
  if (v.theme === 'system' || v.theme === 'light' || v.theme === 'dark') patch.theme = v.theme;
  if (v.density === 'comfortable' || v.density === 'compact') patch.density = v.density;
  if (Object.keys(patch).length) setPrefs(patch);
  if ('workProfile' in v && (v.workProfile === null || WORK_PROFILES.some(w => w.id === v.workProfile))) {
    try { saveWorkProfile(v.workProfile === null ? undefined : String(v.workProfile), ui.get().prefs.workProfile); } catch { /* changed meanwhile: the next ask reads it again */ }
  }
}

