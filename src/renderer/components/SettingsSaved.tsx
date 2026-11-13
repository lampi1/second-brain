// The quiet «Salvato» of the Settings page (ADR 0207): every change there saves at once, so instead of a toast the page
// header shows a small pill for a few seconds, with «Annulla» when the change has an undo (a setting in the change
// history: settings:undo restores the value before). A change the Orchestrator made (app_config) shows who made it.
// View preferences (density) have no history: they show «Salvato» only (savedLocally). Used by SettingsPage.tsx; the
// store's setSetting skips its own toast while this page is open (store.ts).
import { useEffect, useState } from 'react';
import type { SettingChange } from '@shared/contract';
import { IconCheck, IconHistory } from './Icons';
import { t } from '../i18n';
import { toast } from '../store/ui';

type Shown = { kind: 'saved' | 'undone'; change: SettingChange | null; at: number };
const listeners = new Set<(s: Shown) => void>();
const show = (s: Shown) => { for (const l of listeners) l(s); };
/** A change with no history (renderer view preferences): «Salvato», no undo. */
export const savedLocally = (): void => show({ kind: 'saved', change: null, at: Date.now() });

export const SAVED_MS = 6000;

export function SavedPill() {
  const [shown, setShown] = useState<Shown | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    listeners.add(setShown);
    const off = window.sb.on('settings:changed', c => setShown({ kind: c.undoOf ? 'undone' : 'saved', change: c, at: Date.now() }));
    return () => { listeners.delete(setShown); off(); };
  }, []);
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), SAVED_MS);
    return () => clearTimeout(id);
  }, [shown]);
  const undo = async (c: SettingChange) => {
    setBusy(true);
    try { await window.sb.invoke('settings:undo', { changeId: c.id }); }
    catch { toast(t('essential.error'), 'err'); }
    finally { setBusy(false); }
  };
  const c = shown?.change ?? null;
  return <div className="st-saved" role="status" aria-live="polite" data-testid="st-saved" data-on={!!shown}>
    {shown && <>
      <span className="st-saved-mark" aria-hidden="true"><IconCheck size={12} /></span>
      <span>{shown.kind === 'undone' ? t('stx.undone') : c?.by === 'agent' ? t('stx.savedByAgent') : t('essential.saved')}</span>
      {c && shown.kind === 'saved' && <button type="button" className="st-saved-undo" disabled={busy} data-testid="st-saved-undo" onClick={() => void undo(c)}><IconHistory size={12} />{t('stx.undo')}</button>}
    </>}
  </div>;
}
