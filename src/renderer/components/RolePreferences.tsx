// Explicit role preference preview and reversible durable commits, used only in Settings > My space.
import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import { initialRolePresets } from '../../shared/role-preset-catalog';
import { validatePreset, type ResolvedRole, type RoleSelection } from '../../shared/role-presets';
import { rolePreview, savedRole } from '../lib/role-preferences';
import { useAgents } from '../store/agents';
import { BRAIN_PAGES, saveRolePreference, ui } from '../store/ui';
import { t as auditText } from '../i18n';

export function RolePreferences() {
  const { catalog, error: catalogError } = useAgents(), raw = ui.use(s => s.prefs.role);
  const [target, setTarget] = useState('dev'), [preview, setPreview] = useState<(ReturnType<typeof rolePreview> & { expected: string | undefined }) | null>(null);
  const [undo, setUndo] = useState<{ previous: RoleSelection | undefined; applied: string } | null>(null);
  const [error, setError] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null), roleSelect = useRef<HTMLButtonElement>(null), [focusTick, setFocusTick] = useState(0), [status, setStatus] = useState('');
  useEffect(() => { if (focusTick) (previewButton.current?.disabled ? roleSelect.current : previewButton.current)?.focus(); }, [focusTick]);
  const returnFocus = () => setFocusTick(n => n + 1);
  const refs = { agentIds: catalog?.profiles.map(p => p.id) ?? [], pageIds: BRAIN_PAGES.map(p => p.id) };
  const signature = JSON.stringify(raw);
  let title = auditText('cmp.role.t1'), invalid = false;
  if (catalog && raw !== undefined) {
    try { title = savedRole(raw, refs).preset.title; } catch { invalid = true; }
  }
  const choices = initialRolePresets().map(p => {
    try { validatePreset(p, refs); return { ...p, available: true }; } catch { return { ...p, available: false }; }
  });
  const describe = (role: ResolvedRole) => <>
    <p>{auditText('cmp.role.t2')}: {role.agentIds.map(id => catalog?.profiles.find(p => p.id === id)?.name ?? id).join(', ')}</p>
    <p>{auditText('cmp.role.t3')}: {role.pageIds.map(id => BRAIN_PAGES.find(p => p.id === id)?.label ?? id).join(', ')}</p>
    <p>{auditText('cmp.role.t4')}: {BRAIN_PAGES.find(p => p.id === role.defaults.homePageId)?.label}. {auditText('cmp.role.t5')}: {catalog?.profiles.find(p => p.id === role.defaults.primaryAgentId)?.name}</p>
  </>;
  const attempt = (run: () => void) => { try { run(); setError(false); } catch { setError(true); } };
  return <section className="st-tool" aria-label={auditText('cmp.role.t6')} data-testid="role-preferences">
    <h3>{auditText('cmp.role.t6')}</h3>
    <p>{title}</p>
    <p className="st-desc">{auditText('cmp.role.t7')}</p>
    {!catalog && <p role="status">{catalogError ? (auditText('cmp.role.t8')) : (auditText('cmp.role.t9'))}</p>}
    {invalid && <p role="alert">{auditText('cmp.role.t10')}</p>}
    <label>{auditText('cmp.role.t11')} <Select aria-label={auditText('cmp.role.t11')} ref={roleSelect} value={target} disabled={!catalog || invalid} onChange={e => { setTarget(e.target.value); setPreview(null); setError(false); }}>
      {choices.map(p => <option key={p.id} value={p.id} disabled={!p.available}>{p.title}{!p.available ? (auditText('cmp.role.t12')) : ''}</option>)}
    </Select></label>{' '}
    <button ref={previewButton} className="btn btn-ghost" disabled={!catalog || invalid || !choices.find(p => p.id === target)?.available} onClick={() => attempt(() => { setStatus(''); setPreview({ ...rolePreview(raw, target, refs), expected: signature }); })}>{auditText('cmp.role.t13')}</button>
    {preview && <div aria-live="polite" data-testid="role-preview">
      <h4>{auditText('cmp.role.t14')}</h4>{preview.before ? describe(preview.before) : <p>{auditText('cmp.role.t1')}</p>}
      <h4>{auditText('cmp.role.t15')}</h4>{describe(preview.after)}
      <p>{auditText('cmp.role.t16')}</p>
      <button className="btn" onClick={() => attempt(() => {
        // Revalidate against fresh references and compare the exact selection captured by the preview.
        const next = rolePreview(preview.previous, target, refs).next;
        saveRolePreference(next, preview.expected);
        setUndo({ previous: preview.previous, applied: JSON.stringify(next) }); setPreview(null); setStatus(auditText('cmp.role.t17')); returnFocus();
      })}>{auditText('cmp.role.t18')}</button>{' '}
      <button className="btn btn-ghost" onClick={() => { setPreview(null); returnFocus(); }}>{auditText('cmp.role.t19')}</button>
    </div>}
    {undo && <button className="btn btn-ghost" onClick={() => attempt(() => {
      if (undo.previous !== undefined) savedRole(undo.previous, refs);
      saveRolePreference(undo.previous, undo.applied); setUndo(null); setPreview(null); setStatus(auditText('cmp.role.t20')); returnFocus();
    })}>{auditText('cmp.role.t21')}</button>}
    {invalid && <button className="btn btn-ghost" onClick={() => attempt(() => { saveRolePreference(undefined, signature); setPreview(null); setUndo(null); setStatus(auditText('cmp.role.t22')); returnFocus(); })}>{auditText('cmp.role.t23')}</button>}
    <p role="status">{status}</p>
    {error && <p role="alert">{auditText('cmp.role.t24')}</p>}
  </section>;
}
