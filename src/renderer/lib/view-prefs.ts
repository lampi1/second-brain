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

/** The patch as JSON text (ui:command 'prefs', or window.__sbSetView from main): every field it holds must be one of
 *  the three with a valid value, else nothing changes; the answer says which and what the view is now. */
export function setViewPrefs(json: string): { ok: boolean; error?: string; view: ViewPrefs } {
  let v: Record<string, unknown>;
  try { v = JSON.parse(json) as Record<string, unknown>; } catch { return { ok: false, error: 'not JSON', view: viewPrefs() }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not an object', view: viewPrefs() };
  const bad = Object.keys(v).find(k => !(k === 'theme' ? v.theme === 'system' || v.theme === 'light' || v.theme === 'dark'
    : k === 'density' ? v.density === 'comfortable' || v.density === 'compact'
      : k === 'workProfile' ? v.workProfile === null || WORK_PROFILES.some(w => w.id === v.workProfile) : false));
  if (bad) return { ok: false, error: `${bad}: not a valid field or value`, view: viewPrefs() };
  const patch: { theme?: Theme; density?: Density } = {};
  if (v.theme) patch.theme = v.theme as Theme;
  if (v.density) patch.density = v.density as Density;
  if (Object.keys(patch).length) setPrefs(patch);
  if ('workProfile' in v) {
    try { saveWorkProfile(v.workProfile === null ? undefined : String(v.workProfile), ui.get().prefs.workProfile); }
    catch (e) { return { ok: false, error: (e as Error).message, view: viewPrefs() }; }
  }
  return { ok: true, view: viewPrefs() };
}
/** ui:command 'prefs': the same, its answer dropped. */
export function applyViewPrefs(json: string): void { setViewPrefs(json); }

