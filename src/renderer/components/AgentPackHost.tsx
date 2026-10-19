// The pack review surface, from the Agenti page and window-wide file drops: export a role's pack, or import one whose
// skills (and rules) attach to the built-in role the user picks, as a trial version of that role.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PackExportPlan, PackImportReview, PackTarget } from '@shared/agent-pack';
import { ROLE_DEFAULTS, WORK_ROLE_IDS, type WorkRoleId } from '@shared/roles';
import { sb } from '../sb';
import { t } from '../i18n';
import { toast } from '../store/ui';
import { refreshAgents } from '../store/agents';
import { acceptsPackDrop, PACK_EVENT, type PackRequest } from '../lib/agent-pack-ui';
import { suspendViews } from '../lib/viewports';
import { Modal } from './ui';
import '../styles/agent-pack.css';

export function AgentPackHost() {
  const [request, setRequest] = useState<PackRequest | null>(null), [drag, setDrag] = useState(false);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const open = (event: Event) => setRequest(current => current ?? (event as CustomEvent<PackRequest>).detail);
    let release: (() => void) | undefined;
    const clear = () => { setDrag(false); release?.(); release = undefined; };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDrag(true); release ??= suspendViews(); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) clear(); };
    const drop = (e: DragEvent) => {
      clear();
      if (e.target instanceof Element && e.target.closest('input[type=file]')) return;
      const file = e.dataTransfer?.files[0], entry = e.dataTransfer?.items[0]?.webkitGetAsEntry();
      if (!file || !acceptsPackDrop(file.name, entry?.isDirectory === true)) return;
      e.preventDefault(); const dropped = sb.pathForFile?.(file);
      if (dropped) setRequest(current => current ?? { kind: 'import', dropped });
    };
    window.addEventListener(PACK_EVENT, open); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('dragend', clear);
    return () => { clear(); window.removeEventListener(PACK_EVENT, open); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('dragend', clear); };
  }, []);
  return <>{drag && <div className="pack-drop" role="status">{t('pack.drop')}</div>}{request && <PackReview request={request} close={close} />}</>;
}

function PackReview({ request, close }: { request: PackRequest; close: () => void }) {
  const [target, setTarget] = useState<PackTarget>('sbagent'), [plan, setPlan] = useState<PackExportPlan | null>(null), [review, setReview] = useState<PackImportReview | null>(null);
  const [stats, setStats] = useState(false), [scripts, setScripts] = useState(false), [personal, setPersonal] = useState(false);
  const [roleId, setRoleId] = useState<WorkRoleId>('artisan');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), token = useRef<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (active.current) return; active.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(`${t('pack.error')} ${e instanceof Error ? e.message : ''}`); }
    finally { active.current = false; setBusy(false); }
  };
  const dismiss = useCallback(() => { if (!active.current) close(); }, [close]);
  useEffect(() => {
    if (request.kind === 'import') void run(async () => {
      const result = await sb.invoke('agents:importInspect', request.dropped ? { dropped: request.dropped } : { pick: true });
      if (!result) { close(); return; }
      token.current = result.token; setReview(result); if (result.role) setRoleId(result.role);
    });
    return () => { if (token.current) void sb.invoke('agents:importCancel', { token: token.current }).catch(() => {}); };
  }, []);
  const prepare = () => run(async () => {
    if (request.kind !== 'export') return;
    if (token.current) await sb.invoke('agents:importCancel', { token: token.current });
    const next = await sb.invoke('agents:exportPlan', { id: request.id, target }); token.current = next.token; setPlan(next);
  });
  const fix = (item: string, action: 'exclude' | 'rescan' | 'allow' | 'open') => run(async () => { if (plan) setPlan(await sb.invoke('agents:exportFix', { token: plan.token, item, action })); });
  const finish = () => run(async () => {
    if (plan) {
      const result = await sb.invoke('agents:export', { token: plan.token, includeStats: stats });
      if (!result.ok) { setPlan({ ...plan, findings: result.findings }); return; }
      token.current = null; toast(t('pack.saved'), 'ok');
    } else if (review) {
      await sb.invoke('agents:importApply', { token: review.token, approveScripts: scripts, approvePersonalData: personal, roleId });
      token.current = null; await refreshAgents(); toast(t('pack.imported'), 'ok');
    } else return;
    close();
  });
  return <Modal onClose={dismiss} label={t(request.kind === 'export' ? 'pack.export' : 'pack.review')} testid="agent-pack-dialog" className="agent-pack-modal">
    <div className="modal-head"><h2>{t(request.kind === 'export' ? 'pack.export' : 'pack.review')}</h2></div>
    <div className="modal-body"><fieldset disabled={busy}>
      {error && <p role="alert">{error}</p>}
      {request.kind === 'export' && <>
        <label>{t('pack.target')} <select value={target} disabled={!!plan} onChange={e => setTarget(e.target.value as PackTarget)}>{(['sbagent', 'claude', 'cursor', 'codex'] as const).map(value => <option key={value} value={value}>{value === 'sbagent' ? '.sbagent' : value === 'claude' ? 'Claude Code' : value === 'cursor' ? 'Cursor' : 'Codex'}</option>)}</select></label>
        {!plan && <button type="button" className="btn" onClick={() => void prepare()}>{t('pack.prepare')}</button>}
      </>}
      {plan && <>
        <h3>{t('pack.include')}</h3>{plan.items.map(item => <label className="pack-check" key={item.id}><input type="checkbox" checked={item.included} disabled={item.required} onChange={() => void fix(item.id, item.included ? 'exclude' : item.id.startsWith('key:') ? 'allow' : 'rescan')} />{item.label}</label>)}
        <label className="pack-check"><input type="checkbox" checked={stats} onChange={e => setStats(e.target.checked)} />{t('pack.stats')}</label><p>{t('pack.statsHint')}</p>
        {!!plan.findings.length && <><h3>{t('pack.findings')}</h3><ul>{plan.findings.map((finding, index) => <li key={index}><code>{finding.file}:{finding.line ?? 0} · {finding.rule}</code><div className="pack-actions">
          <button type="button" onClick={() => void fix(finding.file, 'exclude')}>{t('pack.exclude')}</button><button type="button" onClick={() => void fix(finding.file, 'open')}>{t('pack.open')}</button><button type="button" onClick={() => void fix(`${finding.file}:${finding.line ?? 0}:${finding.rule}`, 'allow')}>{t('pack.allow')}</button>
        </div></li>)}</ul></>}
        <button type="button" onClick={() => void fix('', 'rescan')}>{t('pack.rescan')}</button><Notes values={plan.warnings} />
      </>}
      {review && <>
        <p>{review.kind}</p><ul>{review.agents.map(agent => <li key={agent.name}><strong>{agent.name}</strong> · {agent.description}</li>)}</ul>
        <h3>{t('pack.include')}</h3><ul>{review.skills.map(skill => <li key={skill}>{skill}</li>)}</ul>
        {!!review.rules?.length && <><h3>{t('pack.rules')}</h3><ul>{review.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><p>{t('pack.rulesHint')}</p></>}
        {!!review.scripts.length && <><h3>{t('pack.scripts')}</h3>{review.scripts.map((script, index) => <details key={index}><summary>{script.file} · {script.kind}</summary><pre>{script.text}</pre></details>)}<label className="pack-check"><input type="checkbox" checked={scripts} onChange={e => setScripts(e.target.checked)} />{t('pack.approveScripts')}</label><p>{t('pack.scriptHint')}</p></>}
        {!!review.ignored.length && <details><summary>{t('pack.ignored')}</summary><ul>{review.ignored.map(file => <li key={file}>{file}</li>)}</ul></details>}
        <h3>{t('pack.permissions')}</h3><ul>{review.clamps.map(value => <li key={value}>{value}</li>)}</ul>
        {!!review.findings.length && <><h3>{t('pack.findings')}</h3><ul>{review.findings.map((f, i) => <li key={i}>{f.file}:{f.line ?? 0} · {f.rule}</li>)}</ul><label className="pack-check"><input type="checkbox" checked={personal} onChange={e => setPersonal(e.target.checked)} />{t('pack.personal')}</label></>}
        {review.collision.kind === 'present' && <p>{t('pack.present')}</p>}
        <label>{t('pack.role')} <select value={roleId} onChange={e => setRoleId(WORK_ROLE_IDS.find(r => r === e.target.value) ?? 'artisan')} data-testid="pack-role">
          {WORK_ROLE_IDS.map(id => <option key={id} value={id}>{ROLE_DEFAULTS[id].name}</option>)}
        </select></label><p>{t('pack.roleHint')}</p><Notes values={review.warnings} />
      </>}
    </fieldset>{busy && <p role="status">{t('pack.working')}</p>}</div>
    <div className="modal-foot"><button type="button" className="btn" disabled={busy} onClick={dismiss}>{t('pack.close')}</button><button type="button" className="btn btn-primary" disabled={busy || !plan && !review || !!plan?.findings.length || !!review?.findings.length && !personal} onClick={() => void finish()}>{t(request.kind === 'export' ? 'pack.save' : 'pack.apply')}</button></div>
  </Modal>;
}
function Notes({ values }: { values: string[] }) { return values.length ? <details><summary>{t('pack.warnings')}</summary><ul>{values.map((value, i) => <li key={i}>{value}</li>)}</ul></details> : null; }
