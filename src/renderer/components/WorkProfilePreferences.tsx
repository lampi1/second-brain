// "Il mio profilo di lavoro" in Impostazioni → Il mio spazio: Dev, QA, PO or CTO decides which Brain pages the sidebar
// shows and the reference page (shared/work-profiles.ts). Saved at once with an Annulla; navigation only, never a role,
// an engine or a permission. Rendered by SettingsPage.tsx.
import { useState } from 'react';
import { Select } from './Select';
import { WORK_PROFILES, workProfile } from '../../shared/work-profiles';
import { BRAIN_PAGES, saveWorkProfile, ui } from '../store/ui';
import { t } from '../i18n';

const NONE = '';

export function WorkProfilePreferences() {
  const saved = ui.use(s => s.prefs.workProfile);
  const pageIds = BRAIN_PAGES.map(p => p.id);
  const current = workProfile(saved, pageIds);
  const [undo, setUndo] = useState<{ previous: string | undefined; applied: string | undefined } | null>(null);
  const [status, setStatus] = useState(''), [error, setError] = useState(false);
  const label = (id: string) => BRAIN_PAGES.find(p => p.id === id)?.label ?? id;
  const apply = (next: string | undefined, expected: string | undefined, message: string, afterwards: typeof undo) => {
    try { saveWorkProfile(next, expected); setUndo(afterwards); setStatus(message); setError(false); } catch { setError(true); }
  };
  return <section className="st-tool" aria-label={t('cmp.work.title')} data-testid="work-profile">
    <h3>{t('cmp.work.title')}</h3>
    <p className="st-desc">{t('cmp.work.lead')}</p>
    <label>{t('cmp.work.choose')} <Select aria-label={t('cmp.work.choose')} value={current?.id ?? NONE}
      onChange={e => { const next = e.target.value || undefined; apply(next, saved, t('cmp.work.saved'), { previous: saved, applied: next }); }}>
      <option value={NONE}>{t('cmp.work.none')}</option>
      {WORK_PROFILES.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </Select></label>
    {current
      ? <div data-testid="work-profile-pages"><p>{t('cmp.work.pages')}: {current.pageIds.map(label).join(', ')}</p><p>{t('cmp.work.home')}: {label(current.homePageId)}</p></div>
      : <p>{t('cmp.work.all')}</p>}
    {undo && <button className="btn btn-ghost" onClick={() => apply(undo.previous, undo.applied, t('cmp.work.restored'), null)}>{t('cmp.work.undo')}</button>}
    <p role="status">{status}</p>
    {error && <p role="alert">{t('cmp.work.error')}</p>}
  </section>;
}
