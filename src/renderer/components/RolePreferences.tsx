// Explicit role preference preview and reversible durable commits, used only in Settings > My space.
import { useEffect, useRef, useState } from 'react';
import { initialRolePresets } from '../../shared/role-preset-catalog';
import { validatePreset, type ResolvedRole, type RoleSelection } from '../../shared/role-presets';
import { rolePreview, savedRole } from '../lib/role-preferences';
import { useAgents } from '../store/agents';
import { BRAIN_PAGES, saveRolePreference, ui } from '../store/ui';
import { lang } from '../i18n';

export function RolePreferences() {
  const { catalog, error: catalogError } = useAgents(), raw = ui.use(s => s.prefs.role);
  const [target, setTarget] = useState('dev'), [preview, setPreview] = useState<(ReturnType<typeof rolePreview> & { expected: string | undefined }) | null>(null);
  const [undo, setUndo] = useState<{ previous: RoleSelection | undefined; applied: string } | null>(null);
  const [error, setError] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null), roleSelect = useRef<HTMLSelectElement>(null), [focusTick, setFocusTick] = useState(0), [status, setStatus] = useState('');
  useEffect(() => { if (focusTick) (previewButton.current?.disabled ? roleSelect.current : previewButton.current)?.focus(); }, [focusTick]);
  const returnFocus = () => setFocusTick(n => n + 1);
  const it = lang() === 'it';
  const refs = { agentIds: catalog?.profiles.map(p => p.id) ?? [], pageIds: BRAIN_PAGES.map(p => p.id) };
  const signature = JSON.stringify(raw);
  let title = it ? 'Nessun ruolo scelto' : 'No role selected', invalid = false;
  if (catalog && raw !== undefined) {
    try { title = savedRole(raw, refs).preset.title; } catch { invalid = true; }
  }
  const choices = initialRolePresets().map(p => {
    try { validatePreset(p, refs); return { ...p, available: true }; } catch { return { ...p, available: false }; }
  });
  const describe = (role: ResolvedRole) => <>
    <p>{it ? 'Agenti' : 'Agents'}: {role.agentIds.map(id => catalog?.profiles.find(p => p.id === id)?.name ?? id).join(', ')}</p>
    <p>{it ? 'Pagine' : 'Pages'}: {role.pageIds.map(id => BRAIN_PAGES.find(p => p.id === id)?.label ?? id).join(', ')}</p>
    <p>{it ? 'Pagina di riferimento' : 'Reference page'}: {BRAIN_PAGES.find(p => p.id === role.defaults.homePageId)?.label}. {it ? 'Agente principale' : 'Primary agent'}: {catalog?.profiles.find(p => p.id === role.defaults.primaryAgentId)?.name}</p>
  </>;
  const attempt = (run: () => void) => { try { run(); setError(false); } catch { setError(true); } };
  return <section className="st-tool" aria-label={it ? 'Il mio ruolo' : 'My role'} data-testid="role-preferences">
    <h3>{it ? 'Il mio ruolo' : 'My role'}</h3>
    <p>{title}</p>
    <p className="st-desc">{it ? 'Scegli una composizione di agenti e pagine. Le chat e i permessi restano come sono.' : 'Choose a composition of agents and pages. Chats and permissions stay as they are.'}</p>
    {!catalog && <p role="status">{catalogError ? (it ? 'Catalogo non disponibile.' : 'Catalog unavailable.') : (it ? 'Caricamento agenti…' : 'Loading agents…')}</p>}
    {invalid && <p role="alert">{it ? 'Il ruolo salvato non è utilizzabile. Puoi rimuoverlo e scegliere di nuovo.' : 'The saved role cannot be used. You can remove it and choose again.'}</p>}
    <label>{it ? 'Ruolo' : 'Role'} <select aria-label={it ? 'Ruolo' : 'Role'} ref={roleSelect} value={target} disabled={!catalog || invalid} onChange={e => { setTarget(e.target.value); setPreview(null); setError(false); }}>
      {choices.map(p => <option key={p.id} value={p.id} disabled={!p.available}>{p.title}{!p.available ? (it ? ' — agenti o pagine mancanti' : ' — missing agents or pages') : ''}</option>)}
    </select></label>{' '}
    <button ref={previewButton} className="btn btn-ghost" disabled={!catalog || invalid || !choices.find(p => p.id === target)?.available} onClick={() => attempt(() => { setStatus(''); setPreview({ ...rolePreview(raw, target, refs), expected: signature }); })}>{it ? 'Anteprima' : 'Preview'}</button>
    {preview && <div aria-live="polite" data-testid="role-preview">
      <h4>{it ? 'Prima' : 'Before'}</h4>{preview.before ? describe(preview.before) : <p>{it ? 'Nessun ruolo scelto' : 'No role selected'}</p>}
      <h4>{it ? 'Dopo' : 'After'}</h4>{describe(preview.after)}
      <p>{it ? 'Le personalizzazioni del ruolo vengono conservate. Questa scelta salva la composizione preferita.' : 'Role customizations are retained. This choice saves your preferred composition.'}</p>
      <button className="btn" onClick={() => attempt(() => {
        // Revalidate against fresh references and compare the exact selection captured by the preview.
        const next = rolePreview(preview.previous, target, refs).next;
        saveRolePreference(next, preview.expected);
        setUndo({ previous: preview.previous, applied: JSON.stringify(next) }); setPreview(null); setStatus(it ? 'Ruolo salvato.' : 'Role saved.'); returnFocus();
      })}>{it ? 'Conferma ruolo' : 'Confirm role'}</button>{' '}
      <button className="btn btn-ghost" onClick={() => { setPreview(null); returnFocus(); }}>{it ? 'Annulla' : 'Cancel'}</button>
    </div>}
    {undo && <button className="btn btn-ghost" onClick={() => attempt(() => {
      if (undo.previous !== undefined) savedRole(undo.previous, refs);
      saveRolePreference(undo.previous, undo.applied); setUndo(null); setPreview(null); setStatus(it ? 'Ruolo precedente ripristinato.' : 'Previous role restored.'); returnFocus();
    })}>{it ? 'Ripristina ruolo precedente' : 'Undo role change'}</button>}
    {invalid && <button className="btn btn-ghost" onClick={() => attempt(() => { saveRolePreference(undefined, signature); setPreview(null); setUndo(null); setStatus(it ? 'Ruolo rimosso.' : 'Role removed.'); returnFocus(); })}>{it ? 'Rimuovi ruolo non valido' : 'Remove invalid role'}</button>}
    <p role="status">{status}</p>
    {error && <p role="alert">{it ? 'Modifica non salvata: controlla gli agenti disponibili, lo spazio locale e riapri l’anteprima.' : 'Change not saved: check available agents and local storage, then preview again.'}</p>}
  </section>;
}
