// A role's own page (Brain → Agenti → a role) and its editor. The page leads with who the role is (its character at
// 96 px, English name, what it is for, engine, model tier, trial and customized chips, Avvia), its run numbers, the
// instructions it runs with, its configuration (tools, permission ceiling, the roles it may launch), the skills it loads
// at every launch, its versions, its pack actions and the user's milestones (ProgressPanel). "Modifica" opens the
// editor in place: only the behaviour is editable (instructions, engine, model, tier, tools, ceiling, launches, skills,
// context); name, summary and character belong to the role. "Ripristina predefinito" goes back to the shipped role
// after an inline confirmation. Editing never changes running chats. Rendered by AgentCatalogPage.tsx. Styles:
// styles/agent-studio.css.
import { Select } from './Select';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { MAX_CONTEXT_RANGE, PERMISSION_CEILINGS, TOOL_CLASSES, type AgentDraft, type AgentMetrics, type AgentProfile, type AgentVersion, type ToolClass } from '@shared/agents';
import { MODEL_TIERS, WORK_ROLE_IDS, PULSE_ID, roleName, tierRank, type ModelTier } from '@shared/roles';
import { characterOf } from '@shared/characters';
import { agentHistory, refreshAgents, resetAgent, restoreAgentVersion, saveAgent, useAgents } from '../store/agents';
import { toast } from '../store/ui';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { EFFORTS, effortLabel } from '../lib/format';
import { characterTone } from '../lib/character-art';
import { forgetAgentEditor, readAgentEditor, rememberAgentEditor } from '../lib/agent-drafts';
import { holdUpdate } from '../lib/update-barrier';
import { go, goTarget } from '../actions';
import { locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { AgentPackDetails } from './AgentPackDetails';
import { ProgressPanel } from './ProgressPanel';
import { useBrainModel } from '../store/brain-model';
import '../styles/agent-studio.css';
import '../styles/brain-model.css';

const percent = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
const usd = (v: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(v);
const tierLabel = (tier: ModelTier) => t(`roles.tier.${tier}`);
const reason = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const SKILL = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

/** The editable behaviour of a role, from its profile (the editor's starting draft). */
const draftOf = (p: AgentProfile): AgentDraft => ({
  name: p.name, purpose: p.purpose, avatar: p.avatar, instructions: p.instructions, engine: p.engine, model: p.model,
  ...(p.effort ? { effort: p.effort } : {}), tools: p.tools, permissionCeiling: p.permissionCeiling,
  ...(p.knowhow ? { knowhow: p.knowhow } : {}), ...(p.pack ? { pack: p.pack } : {}),
  maxContext: p.maxContext ?? null, tier: p.tier, tierMax: p.tierMax, independent: p.independent, launches: [...p.launches], skills: [...p.skills],
});

/** The run numbers of one role, read like the catalogue's (agents:metrics); null when unavailable. */
function useAgentMetrics(agentId: string): AgentMetrics | null | undefined {
  const [value, setValue] = useState<AgentMetrics | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void sb.invoke('agents:metrics', undefined).then(all => { if (alive) setValue(all.find(m => m.agentId === agentId) ?? null); }, () => { if (alive) setValue(null); });
    return () => { alive = false; };
  }, [agentId]);
  return value;
}

export function AgentStudio({ profile, children }: { profile: AgentProfile; children?: ReactNode }) {
  const { catalog, error } = useAgents();
  const shown = catalog?.profiles.find(p => p.id === profile.id) ?? profile;
  const restored = useRef(readAgentEditor(profile.id));
  const [editing, setEditing] = useState<AgentDraft | null>(restored.current?.draft ?? null);
  const [base, setBase] = useState<number>(restored.current?.baseRevision ?? shown.updatedAt);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [resetting, setResetting] = useState(false);
  useEffect(() => { if (busy) return holdUpdate(t('studio.hold')); }, [busy]);
  useEffect(() => { if (editing) rememberAgentEditor({ id: shown.id, baseRevision: base, draft: editing }); }, [editing, base, shown.id]);
  const firstField = useRef<HTMLTextAreaElement>(null);
  const openEditor = () => {
    if (!editing) { setEditing(draftOf(shown)); setBase(shown.updatedAt); }
    setProblem(null); requestAnimationFrame(() => { firstField.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); firstField.current?.focus(); });
  };
  const closeEditor = () => { forgetAgentEditor(shown.id); setProblem(null); setEditing(null); };
  const change = (patch: Partial<AgentDraft>) => setEditing(p => (p ? { ...p, ...patch } : p));
  const choice = catalog?.models.find(e => e.engine === editing?.engine);
  const knownModel = !!choice && (editing?.model === null || choice.modelSelectable && choice.models.some(m => m.id === editing?.model));
  const stale = !!editing && shown.updatedAt !== base;
  const tierOk = !!editing && tierRank(editing.tier) <= tierRank(editing.tierMax);
  const canSave = !!editing && !stale && !shown.trial && tierOk && !!choice?.enabled && !!choice.trusted && knownModel && !busy && !catalog?.problem;
  const save = async () => {
    if (!editing || !canSave) return;
    setBusy(true); setProblem(null);
    try {
      await saveAgent(editing, shown.id);
      forgetAgentEditor(shown.id); setEditing(null);
      toast(t('studio.saved'), 'ok');
    } catch (e) { setProblem(t('studio.saveError', { detail: reason(e) })); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setProblem(null);
    try { await resetAgent(shown.id); forgetAgentEditor(shown.id); setEditing(null); setResetting(false); toast(t('studio.resetDone'), 'ok'); }
    catch (e) { setProblem(`${t('studio.resetError')} ${reason(e)}`); }
    finally { setBusy(false); }
  };

  const status = <>
    {problem && <p role="alert" className="studio-alert">{problem}</p>}
    {stale && <div role="alert" className="studio-alert"><p>{t('studio.stale')}</p><div className="studio-alert-actions">
      <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => { setEditing(draftOf(shown)); setBase(shown.updatedAt); }}>{t('studio.reload')}</button></div></div>}
    {(error || catalog?.problem) && <p role="alert" className="studio-alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
  </>;
  const editor = editing && catalog ? <RoleEditor profile={shown} draft={editing} busy={busy} canSave={canSave} tierOk={tierOk} change={change} firstField={firstField}
    onSave={() => void save()} onClose={closeEditor} /> : null;
  return <RoleDetail profile={shown} busy={busy} editorOpen={!!editing} resetting={resetting} status={status} editor={editor}
    onEdit={openEditor} onReset={() => setResetting(true)} onResetCancel={() => setResetting(false)} onResetConfirm={() => void reset()}>{children}</RoleDetail>;
}

function RoleEditor({ profile, draft, busy, canSave, tierOk, change, firstField, onSave, onClose }: {
  profile: AgentProfile; draft: AgentDraft; busy: boolean; canSave: boolean; tierOk: boolean; change: (patch: Partial<AgentDraft>) => void;
  firstField: RefObject<HTMLTextAreaElement | null>; onSave: () => void; onClose: () => void;
}) {
  const { catalog } = useAgents();
  const { state: brain } = useBrainModel();
  const [skill, setSkill] = useState('');
  const choice = catalog?.models.find(e => e.engine === draft.engine);
  const allow = draft.tools?.allow ?? [];
  const toggleTool = (c: ToolClass) => change({ tools: { ...(draft.tools ?? {}), allow: allow.includes(c) ? allow.filter(x => x !== c) : TOOL_CLASSES.filter(x => x === c || allow.includes(x)) } });
  const toggleLaunch = (id: string) => change({ launches: draft.launches.includes(id) ? draft.launches.filter(x => x !== id) : WORK_ROLE_IDS.filter(x => x === id || draft.launches.includes(x)) });
  const addSkill = () => { const name = skill.trim(); if (!SKILL.test(name) || draft.skills.includes(name) || draft.skills.length >= 40) return; change({ skills: [...draft.skills, name] }); setSkill(''); };
  const listId = `skills-${profile.id}`;
  return <form className="agent-editor" onSubmit={e => { e.preventDefault(); onSave(); }} aria-label={t('studio.editRole', { name: profile.name })} data-testid="agent-editor">
    <fieldset disabled={busy} className="agent-editor-fields">
      <legend>{t('studio.editRole', { name: profile.name })}</legend>
      <p className="agent-editor-note">{t('studio.newSessions')}</p>
      {profile.trial && <p role="alert" className="studio-alert">{t('studio.trialOpen')}</p>}
      <div className="agent-editor-grid">
        <div className="agent-editor-col">
          <label className="field agent-editor-prompt"><span>{t('studio.instructions')}</span><textarea ref={firstField} maxLength={8000} rows={12} value={draft.instructions} onChange={e => change({ instructions: e.target.value })} data-testid="agent-instructions" /><small>{t('studio.instructionsHint')}</small></label>
          <fieldset className="agent-editor-checks" data-testid="agent-skills-edit"><legend>{t('studio.skills')}</legend>
            <p className="agent-editor-note">{t('studio.skillsHint')}</p>
            {draft.skills.length ? <div className="bm-chips">{draft.skills.map(s => <span key={s} className="bm-chip">{s}<button type="button" className="link-btn" aria-label={t('studio.skillRemove', { name: s })} onClick={() => change({ skills: draft.skills.filter(x => x !== s) })}>×</button></span>)}</div> : <p className="agent-editor-note">{t('studio.skillsNone')}</p>}
            <div className="field-row"><label className="field"><span>{t('studio.skillName')}</span><input list={listId} value={skill} maxLength={80} onChange={e => setSkill(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} data-testid="agent-skill-input" /></label>
              <button type="button" className="btn btn-ghost" disabled={!SKILL.test(skill.trim())} onClick={addSkill} data-testid="agent-skill-add">{t('studio.skillAdd')}</button></div>
            <datalist id={listId}>{(brain?.skills ?? []).map(s => <option key={s.name} value={s.name}>{s.description}</option>)}</datalist>
          </fieldset>
        </div>
        <div className="agent-editor-col">
          <div className="field-row"><label className="field"><span>{t('studio.engine')}</span><Select value={draft.engine} onChange={e => change({ engine: e.target.value, model: null, effort: undefined })} data-testid="agent-engine">{(catalog?.models ?? []).map(e => <option key={e.engine} value={e.engine} disabled={!e.enabled || !e.trusted}>{e.label}{!e.enabled ? ` · ${t('studio.disabled')}` : !e.trusted ? ` · ${t('studio.trust')}` : ''}</option>)}</Select></label>
            <label className="field"><span>{t('studio.model')}</span><Select value={draft.model ?? ''} onChange={e => change({ model: e.target.value || null })} data-testid="agent-model">
              <option value="">{t('studio.tierModel')}</option>
              {choice?.modelSelectable && choice.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {draft.model && (!choice?.modelSelectable || !choice.models.some(m => m.id === draft.model)) && <option value={draft.model} disabled>{draft.model} · {t('studio.unavailable')}</option>}
            </Select></label></div>
          {draft.model === null && <small className="agent-editor-note">{t('studio.tierModelHint')}</small>}
          <AgentReadiness choice={choice} />
          {!choice?.modelSelectable && choice?.modelReason && <p role="status">{choice.modelReason}</p>}
          <div className="field-row">
            <label className="field"><span>{t('studio.tier')}</span><Select value={draft.tier} onChange={e => change({ tier: MODEL_TIERS.find(x => x === e.target.value) ?? draft.tier })} data-testid="agent-tier">{MODEL_TIERS.map(x => <option key={x} value={x}>{tierLabel(x)}</option>)}</Select></label>
            <label className="field"><span>{t('studio.tierMax')}</span><Select value={draft.tierMax} onChange={e => change({ tierMax: MODEL_TIERS.find(x => x === e.target.value) ?? draft.tierMax })} data-testid="agent-tier-max">{MODEL_TIERS.map(x => <option key={x} value={x}>{tierLabel(x)}</option>)}</Select></label>
          </div>
          {tierOk ? <small className="agent-editor-note">{t('studio.tierMaxHint')}</small> : <p role="alert">{t('studio.tierInvalid')}</p>}
          {choice?.effort && <label className="field"><span>{t('studio.effort')}</span><Select value={draft.effort ?? ''} onChange={e => change({ effort: EFFORTS.find(effort => effort === e.target.value) })}><option value="">{t('studio.defaultModel')}</option>{EFFORTS.map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}</Select></label>}
          <label className="field-check"><input type="checkbox" checked={draft.independent} onChange={e => change({ independent: e.target.checked })} data-testid="agent-independent" /><span>{t('studio.independent')} <small>{t('studio.independentHint')}</small></span></label>
          <label className="field"><span>{t('studio.ceiling')}</span><Select value={draft.permissionCeiling ?? ''} onChange={e => change({ permissionCeiling: PERMISSION_CEILINGS.find(c => c === e.target.value) ?? null })} data-testid="agent-ceiling">
            <option value="">{t('studio.ceilingNone')}</option>{PERMISSION_CEILINGS.map(c => <option key={c} value={c}>{t(`studio.ceiling.${c}`)}</option>)}</Select></label>
          <fieldset className="agent-editor-checks" data-testid="agent-tools"><legend>{t('studio.tools')}</legend><p className="agent-editor-note">{t('studio.toolsHint')}</p>
            <div className="agent-editor-checkgrid">{TOOL_CLASSES.map(c => <label key={c} className="field-check"><input type="checkbox" checked={allow.includes(c)} onChange={() => toggleTool(c)} /><span>{t(`studio.tool.${c}`)}</span></label>)}</div></fieldset>
          {profile.id !== PULSE_ID && <fieldset className="agent-editor-checks" data-testid="agent-launches"><legend>{t('studio.launches')}</legend><p className="agent-editor-note">{t('studio.launchesHint')}</p>
            <div className="agent-editor-checkgrid">{WORK_ROLE_IDS.filter(id => id !== profile.id).map(id => <label key={id} className="field-check"><input type="checkbox" checked={draft.launches.includes(id)} onChange={() => toggleLaunch(id)} /><AgentAvatar avatar={{ kind: 'character', value: id }} name={roleName(id)} size={20} /><span>{roleName(id)}</span></label>)}</div></fieldset>}
          <label className="field"><span>{t('studio.maxContext')}</span><input type="number" inputMode="numeric" min={MAX_CONTEXT_RANGE.min / 1000} max={MAX_CONTEXT_RANGE.max / 1000} step={10}
            value={draft.maxContext ? Math.round(draft.maxContext / 1000) : ''} placeholder={t('studio.maxContextDefault')} data-testid="agent-max-context"
            onChange={e => { const k = Number(e.target.value); change({ maxContext: e.target.value === '' || !Number.isFinite(k) ? null : Math.round(k) * 1000 }); }} />
            <small data-testid="agent-max-context-note">{choice?.maxContext ? t('studio.maxContextHint') : t('studio.maxContextUnsupported')}</small></label>
        </div>
      </div>
      <div className="agent-editor-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('agentDetail.closeEditor')}</button>
        <button type="submit" className="btn btn-primary" disabled={!canSave} data-testid="agent-save">{busy ? t('studio.busy') : t('studio.save')}</button>
      </div>
    </fieldset>
  </form>;
}

function Versions({ profile }: { profile: AgentProfile }) {
  const [list, setList] = useState<AgentVersion[] | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void agentHistory(profile.id).then(v => { if (alive) { setList(v); setFailed(false); } }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [profile.id, profile.updatedAt]);
  const use = async (v: number) => {
    setBusy(true);
    try { await restoreAgentVersion(profile.id, v); toast(t('studio.versionRestored', { v }), 'ok'); }
    catch (e) { toast(reason(e), 'err'); }
    finally { setBusy(false); }
  };
  const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  return <section className="ad-card" aria-labelledby={`ad-versions-${profile.id}`} data-testid="agent-versions">
    <header className="ad-card-head"><h3 id={`ad-versions-${profile.id}`}>{t('studio.versions')}</h3></header>
    <p className="ad-hint">{t('studio.versionsHint')}</p>
    {failed ? <p role="alert">{t('studio.versionsError')}</p> : <ol className="ad-versions">{[...(list ?? [])].reverse().slice(0, 8).map(v => <li key={v.version}>
      <strong>v{v.version}</strong> <span>{t(`studio.versionBy.${v.author}`)}</span> <small>{when(v.at)}</small>
      {v.version === profile.activeVersion ? <span className="ad-chip">{t('studio.versionActive')}</span>
        : !profile.trial && v.state !== 'rejected' && <button type="button" className="link-btn" disabled={busy} onClick={() => void use(v.version)}>{t('studio.versionRestore')}</button>}
      {v.reason && <p>{v.reason}</p>}
    </li>)}</ol>}
  </section>;
}

function RoleDetail({ profile, busy, editorOpen, resetting, status, editor, onEdit, onReset, onResetCancel, onResetConfirm, children }: {
  profile: AgentProfile; busy: boolean; editorOpen: boolean; resetting: boolean; status: ReactNode; editor: ReactNode;
  onEdit: () => void; onReset: () => void; onResetCancel: () => void; onResetConfirm: () => void; children?: ReactNode;
}) {
  const { catalog } = useAgents();
  const metrics = useAgentMetrics(profile.id);
  const lastStart = useApp(s => Object.values(s.chats).reduce((at, c) => c.run?.agentId === profile.id ? Math.max(at, c.run.startedAt) : at, 0));
  const model = catalog?.models.find(m => m.engine === profile.engine);
  const engine = model?.label ?? profile.engine;
  const open = metrics?.open ?? 0;
  const state = profile.trial ? 'trial' : open > 0 ? 'working' : 'active';
  const unknown = t('catalog.unknown');
  const stats = metrics?.all;
  const loaded = metrics !== undefined;
  const sample = (n: number) => loaded ? t('catalog.samples', { n, total: stats?.ended ?? 0 }) : '';
  const last = lastStart ? new Date(lastStart).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const numbers: { label: string; value: string | null; note?: string }[] = [
    { label: t('catalog.runs'), value: loaded ? (stats?.ended ?? 0).toLocaleString(locale()) : null },
    { label: t('catalog.open'), value: loaded ? open.toLocaleString(locale()) : null },
    { label: t('catalog.success'), value: stats?.successRate.value != null ? percent(stats.successRate.value) : null, note: sample(stats?.successRate.n ?? 0) },
    { label: t('catalog.cost'), value: stats?.costPerRun.median.value != null ? usd(stats.costPerRun.median.value) : null, note: sample(stats?.costPerRun.median.n ?? 0) },
    { label: t('catalog.last'), value: last },
  ];
  const instructions = profile.instructions.trim();
  const { state: brain } = useBrainModel();
  const memory = brain?.memory.find(m => m.kind === 'agent' && m.agentId === profile.id) ?? null;
  const background = profile.scope === 'background';
  const config: [string, string][] = [
    [t('catalog.engine'), engine],
    [t('studio.model'), profile.model ?? `${t('studio.tierModel')} · ${tierLabel(profile.tier)}`],
    [t('studio.tier'), `${tierLabel(profile.tier)} · ${t('studio.tierMax')}: ${tierLabel(profile.tierMax)}`],
    [t('studio.effort'), profile.effort ? effortLabel(profile.effort) ?? profile.effort : t('studio.defaultModel')],
    [t('studio.maxContext'), profile.maxContext ? t('studio.maxContextValue', { n: Math.round(profile.maxContext / 1000) }) : t('studio.maxContextDefault')],
    [t('studio.tools'), profile.tools ? profile.tools.allow.map(c => t(`studio.tool.${c}`)).join(', ') || t('agentDetail.toolsNone') : t('agentDetail.toolsAll')],
    [t('studio.ceiling'), profile.permissionCeiling ? t(`studio.ceiling.${profile.permissionCeiling}`) : t('studio.ceilingNone')],
    ...(background ? [] : [[t('studio.launches'), profile.launches.map(roleName).join(', ') || t('studio.launchesNone')] as [string, string]]),
    [t('studio.independent'), profile.independent ? '✓' : '—'],
    [t('agentDetail.version'), profile.activeVersion === profile.version ? `v${profile.activeVersion}` : `v${profile.activeVersion} / v${profile.version}`],
    [t('agentDetail.updated'), new Date(profile.updatedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })],
  ];
  return <section className="agent-detail" aria-label={profile.name} data-testid="agent-studio" data-state={state} style={{ '--tone': characterTone(characterOf(profile.id)) } as CSSProperties}>
    <button type="button" className="ad-back" onClick={() => go({ page: 'agenti' })}><span aria-hidden="true">←</span> {t('agentDetail.back')}</button>
    <article className="ad-body" data-testid={`agent-detail-${profile.id}`}>
      <header className="ad-hero" style={{ '--row-index': 0 } as CSSProperties}>
        <span className="ad-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={96} /></span>
        <div className="ad-id">
          <p className="ad-eyebrow">{t(profile.userLocked ? 'studio.customized' : 'studio.builtIn')}</p>
          <h2>{profile.name}</h2>
          <p className="ad-purpose">{profile.purpose}</p>
          <div className="ad-chips">
            <span className="ad-badge" data-state={state}><i aria-hidden="true" />{profile.trial ? t('studio.trial') : open > 0 ? t('agentsGrid.working') : t('catalog.active')}</span>
            <span className="ad-chip">{engine}</span>
            <span className="ad-chip">{t('studio.tierChip', { tier: tierLabel(profile.tier) })}</span>
            {profile.model && <span className="ad-chip ad-chip-mono">{profile.model}</span>}
          </div>
        </div>
        <div className="ad-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} aria-expanded={editorOpen} onClick={onEdit} data-testid="agent-edit">{t('studio.edit')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy || !profile.userLocked || !!profile.trial} aria-expanded={resetting} onClick={onReset} data-testid="agent-reset">{t('studio.reset')}</button>
        </div>
      </header>
      {resetting && <div className="ad-banner" role="group" aria-label={t('studio.reset')} data-testid="agent-reset-confirm"><span>{t('studio.resetConfirm')}</span>
        <button type="button" className="btn btn-primary btn-s" disabled={busy} onClick={onResetConfirm} autoFocus>{t('studio.resetDo')}</button>
        <button type="button" className="btn btn-ghost btn-s" onClick={onResetCancel}>{t('studio.cancel')}</button></div>}
      {background && <p className="ad-hint">{t('studio.background')}</p>}
      {status}
      <dl className="ad-stats" aria-label={t('agentDetail.results')}>
        {numbers.map(n => <div key={n.label} title={[n.label, n.value ?? unknown, n.note].filter(Boolean).join(' · ')}>
          <dt>{n.label}</dt><dd>{n.value ?? <><span aria-hidden="true">—</span><span className="sr-only">{unknown}</span></>}</dd>{n.note && n.value && <small>{n.note}</small>}</div>)}
      </dl>
      {editor}
      <div className="ad-grid">
        <section className="ad-card ad-prompt" aria-labelledby={`ad-prompt-${profile.id}`}>
          <header className="ad-card-head"><h3 id={`ad-prompt-${profile.id}`}>{t('agentDetail.prompt')}</h3>{instructions && <span className="ad-meta">{t('agentDetail.promptSize', { n: instructions.length })}</span>}</header>
          <p className="ad-hint">{t('agentDetail.promptHint')}</p>
          {instructions ? <pre className="ad-prompt-text" data-testid="agent-prompt" tabIndex={0}>{instructions}</pre> : <p className="ad-empty" data-testid="agent-prompt">{t('agentDetail.promptEmpty')}</p>}
        </section>
        <div className="ad-side">
          <section className="ad-card" aria-labelledby={`ad-config-${profile.id}`}>
            <header className="ad-card-head"><h3 id={`ad-config-${profile.id}`}>{t('agentDetail.config')}</h3></header>
            <dl className="ad-config">{config.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
          <section className="ad-card bm-studio-skills" aria-labelledby={`ad-skills-${profile.id}`} data-testid="agent-skills">
            <header className="ad-card-head"><h3 id={`ad-skills-${profile.id}`}>{t('studio.skills')}</h3></header>
            <p>{t('studio.skillsHint')}</p>
            {profile.skills.length ? <div className="bm-chips">{profile.skills.map(s => <button key={s} type="button" className="bm-chip" onClick={() => go({ page: 'skill', arg: s })}>{s}</button>)}</div> : <p>{t('studio.skillsNone')}</p>}
            <p>{t('bm.card.memory')}: {memory?.entries ? <button type="button" className="link-btn" onClick={() => goTarget(`file/${memory.file}`)}>{t('bm.mem.entries', { n: memory.entries })}</button> : t('bm.card.memoryNone')}</p>
            <button type="button" className="link-btn" onClick={() => go({ page: 'skill' })}>{t('bm.studio.manage')}</button>
            <AgentPackDetails profile={profile} />
          </section>
          <Versions profile={profile} />
        </div>
      </div>
      <div className="ad-card"><ProgressPanel /></div>
      {children}
    </article>
  </section>;
}
