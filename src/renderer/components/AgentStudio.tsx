// An agent's own page and the hand editor of a profile, in the Dashboard's look (owner, 18/10: the old two-column studio
// looked out of place). The page leads with who the agent is (glyph, name, role, state, engine and model, Avvia), its
// run numbers, then the prompt that makes it an agent (its instructions, in full), its configuration, its learned rules
// and its lifecycle. "Modifica" opens the editor in place; "Duplica" opens the copy's page with its editor. New agents
// are not made here: "Crea agente" (AgentCreateDialog) asks the Orchestrator. With no profile (arg 'studio') the page
// holds a draft prepared from an approval and the automatic proposals. Editing never changes the identity/model of
// running sessions. Rendered by AgentCatalogPage.tsx. Styles: styles/agent-studio.css.
import { Select } from './Select';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AGENT_CATEGORIES, AGENT_TONES, MAX_CONTEXT_RANGE, inProbation, type AgentDraft, type AgentMetrics, type AgentProfile } from '@shared/agents';
import { ROLE_GLYPHS } from '@shared/agent-glyphs';
import { duplicateAgentAvatars, unusedAgentTone } from '../lib/agent-avatar-choice';
import { GLYPH_ART, GLYPH_LABELS_IT } from '../lib/agent-glyph-art';
import { duplicateAgent, refreshAgents, saveAgent, useAgents } from '../store/agents';
import { toast } from '../store/ui';
import { sb } from '../sb';
import { useApp } from '../store/store';
import { EFFORTS, effortLabel } from '../lib/format';
import { forgetAgentEditor, readAgentEditor, rememberAgentEditor } from '../lib/agent-drafts';
import { validateAvatarImage } from '../lib/avatar-raster';
import { holdUpdate } from '../lib/update-barrier';
import { profileCanStart } from '../lib/role-consumers';
import { go } from '../actions';
import { lang, locale, t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { AgentManifestPanel } from './AgentManifestPanel';
import { AgentPackDetails } from './AgentPackDetails';
import { ProgressPanel } from './ProgressPanel';
import { AgentProposals } from './AgentProposals';
import { CatalogRun } from './CatalogRun';
import { checkedManifest } from '@shared/agent-manifest';
import '../styles/agent-studio.css';

const percent = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
const usd = (v: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(v);

/** The run numbers of one agent, read like the catalogue's (agents:metrics); null while loading or unavailable. */
function useAgentMetrics(agentId: string | undefined): AgentMetrics | null | undefined {
  const [value, setValue] = useState<AgentMetrics | null | undefined>(undefined);
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    void sb.invoke('agents:metrics', undefined).then(all => { if (alive) setValue(all.find(m => m.agentId === agentId) ?? null); }, () => { if (alive) setValue(null); });
    return () => { alive = false; };
  }, [agentId]);
  return value;
}

export function AgentStudio({ initialProfile, children }: { initialProfile?: AgentProfile; children?: ReactNode } = {}) {
  const { catalog, error } = useAgents();
  const restored = useRef(initialProfile ? readAgentEditor(initialProfile.id) : readAgentEditor(undefined, true));
  const [editorOpen, setEditorOpen] = useState(!!restored.current);
  const [editing, setEditing] = useState<AgentDraft | null>(restored.current?.draft ?? initialProfile ?? null);
  const [id, setId] = useState<string | undefined>(restored.current?.id ?? initialProfile?.id);
  const [editorRevision, setEditorRevision] = useState<number | null>(restored.current ? restored.current.baseRevision ?? null : initialProfile?.updatedAt ?? null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (busy || uploading) return holdUpdate(t('studio.hold')); }, [busy, uploading]);
  const nameInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0), working = useRef(false);
  // only an open editor is a draft worth keeping (message/history/suggestion: the checkpoint shape of the removed AI guide)
  useEffect(() => { if (editorOpen && editing) rememberAgentEditor({ id, ...(editorRevision === null ? {} : { baseRevision: editorRevision }), draft: editing, message: '', history: [], suggestion: null }); }, [editorOpen, editing, id, editorRevision]);
  const currentProfile = catalog?.profiles.find(profile => profile.id === id);
  const shown = catalog?.profiles.find(profile => profile.id === initialProfile?.id) ?? initialProfile;
  const focusName = () => requestAnimationFrame(() => { nameInput.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); nameInput.current?.focus(); });
  const openEditor = (patch: Partial<AgentDraft> = {}) => {
    if (!shown) return;
    if (!editorOpen) { setId(shown.id); setEditorRevision(shown.updatedAt); setEditing({ ...shown, ...patch }); setEditorOpen(true); }
    else if (Object.keys(patch).length) setEditing(p => p ? { ...p, ...patch } : p);
    setProblem(null); focusName();
  };
  const closeEditor = () => {
    forgetAgentEditor(id); revision.current++; setUploading(false); setProblem(null); setEditorOpen(false);
    if (shown) { setId(shown.id); setEditorRevision(shown.updatedAt); setEditing({ ...shown }); }
  };
  const change = (patch: Partial<AgentDraft>) => { revision.current++; setUploading(false); setEditing(p => p ? { ...p, ...patch } : p); };
  const choice = catalog?.models.find(e => e.engine === editing?.engine);
  const avatarDuplicates = editing ? duplicateAgentAvatars(editing.avatar, catalog?.profiles ?? [], id) : [];
  const presetUpdate = catalog?.presetUpdates?.find(update => update.agentId === (id ?? initialProfile?.id));
  const knownModel = !!choice && (editing?.model === null ? choice.defaultModel : choice.modelSelectable && choice.models.some(m => m.id === editing?.model));
  let validManifest = true;
  try { checkedManifest(editing?.manifest); } catch { validManifest = false; }
  const staleEditor = editorOpen && !!id && (editorRevision === null || currentProfile?.updatedAt !== editorRevision);
  const canSave = !staleEditor && !!editing?.name.trim() && !!editing.purpose.trim() && validManifest && !!choice?.enabled && !!choice.trusted && knownModel && !busy && !uploading && !catalog?.problem;
  const save = async () => {
    if (!editing || !canSave || working.current) return;
    working.current = true;
    setBusy(true); setProblem(null);
    try {
      const profile = await saveAgent(editing, id);
      forgetAgentEditor(id); forgetAgentEditor(profile.id);
      toast(t('studio.saved'), 'ok');
      if (initialProfile && profile.id === initialProfile.id) { setEditing({ ...profile }); setEditorRevision(profile.updatedAt); setEditorOpen(false); }
      else go({ page: 'agenti', arg: profile.id }); // a copy or a new agent: its own page
    } catch { setProblem(t('studio.saveError')); }
    finally { working.current = false; setBusy(false); }
  };
  const duplicate = (source: AgentProfile) => {
    setBusy(true);
    void duplicateAgent(source.id).then(copy => {
      rememberAgentEditor({ id: copy.id, baseRevision: copy.updatedAt, draft: { ...copy }, message: '', history: [], suggestion: null });
      go({ page: 'agenti', arg: copy.id });
    }, () => setProblem(t('studio.duplicateError'))).finally(() => setBusy(false));
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const version = ++revision.current;
    setUploading(true);
    try {
      await validateAvatarImage(file);
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      if (version === revision.current) change({ avatar: { kind: 'image', dataUrl } });
    } catch { if (version === revision.current) setProblem(t('studio.uploadError')); } finally { if (version === revision.current) setUploading(false); }
  };

  const status = <>
    {problem && <p role="alert" className="studio-alert">{problem}</p>}
    {staleEditor && <div role="alert" className="studio-alert"><p>{t('pack.staleEditor')}</p><div className="studio-alert-actions">
      <button type="button" className="btn btn-ghost btn-s" disabled={busy} onClick={() => { setId(undefined); setEditorRevision(null); }}>{t('pack.copyDraft')}</button>
      <button type="button" className="btn btn-ghost btn-s" disabled={busy || !currentProfile} onClick={() => { if (!currentProfile) return; forgetAgentEditor(id); setEditorRevision(currentProfile.updatedAt); setEditing({ ...currentProfile }); }}>{t('pack.reloadDraft')}</button></div></div>}
    {(error || catalog?.problem) && <p role="alert" className="studio-alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
  </>;
  const editor = editorOpen && editing && catalog ? <form className="agent-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={id ? t('studio.editAgent') : t('studio.createAgent')} data-testid="agent-editor">
    <fieldset disabled={busy} className="agent-editor-fields">
      <legend>{id ? t('studio.editAgent') : t('studio.newAgent')}</legend><p className="agent-editor-note">{t('studio.newSessions')}</p>
      {presetUpdate && <details data-testid="preset-update" className="agent-editor-section"><summary>{t('studio.presetUpdate')}</summary>
        <p>{t('studio.presetCompare')}</p>
        {presetUpdate.differences.map(diff => <section key={diff.field}><h4>{diff.field}</h4><p>{t('studio.presetCurrent')}</p><pre>{JSON.stringify(diff.before, null, 2)}</pre><p>{t('studio.presetNext')}</p><pre>{JSON.stringify(diff.after, null, 2)}</pre></section>)}
        <button type="button" className="btn btn-ghost" onClick={() => change({ ...presetUpdate.draft, name: editing.name, purpose: editing.purpose, avatar: editing.avatar })}>{t('studio.presetApply')}</button>
      </details>}
      <div className="agent-editor-grid">
        <div className="agent-editor-col">
          <label className="field"><span>{t('studio.name')}</span><input ref={nameInput} maxLength={80} value={editing.name} onChange={e => change({ name: e.target.value })} required data-testid="agent-name" /></label>
          <label className="field"><span>{t('studio.purpose')}</span><textarea maxLength={400} rows={2} value={editing.purpose} onChange={e => change({ purpose: e.target.value })} required data-testid="agent-purpose" /></label>
          <label className="field agent-editor-prompt"><span>{t('agentDetail.prompt')}</span><textarea maxLength={6000} rows={10} value={editing.instructions} onChange={e => change({ instructions: e.target.value })} placeholder={t('studio.instructionsHint')} data-testid="agent-instructions" /></label>
          <AgentManifestPanel manifest={editing.manifest} onChange={manifest => change({ manifest })} />
          {!validManifest && <p role="alert">{t('studio.manifestInvalid')}</p>}
        </div>
        <div className="agent-editor-col">
          <label className="field"><span>{t('studio.category')}</span><Select value={editing.category ?? 'other'} onChange={e => {
            const category = AGENT_CATEGORIES.find(c => c === e.target.value) ?? 'other';
            change({ category, ...(editing.avatar.kind === 'symbol' ? { avatar: { ...editing.avatar, tone: unusedAgentTone(catalog.profiles, category, id) } } : {}) });
          }}>{AGENT_CATEGORIES.map(category => <option key={category} value={category}>{t(`studio.category.${category}`)}</option>)}</Select></label>
          <div className="field-row"><label className="field"><span>{t('studio.engine')}</span><Select value={editing.engine} onChange={e => change({ engine: e.target.value, model: null, effort: undefined })} data-testid="agent-engine">{catalog.models.map(e => <option key={e.engine} value={e.engine} disabled={!e.enabled || !e.trusted}>{e.label}{!e.enabled ? ` · ${t('studio.disabled')}` : !e.trusted ? ` · ${t('studio.trust')}` : ''}</option>)}</Select></label>
            <label className="field"><span>{t('studio.model')}</span><Select value={editing.model ?? ''} onChange={e => change({ model: e.target.value || null })} data-testid="agent-model">
              <option value="" disabled={!choice?.defaultModel}>{t('studio.actualAtStart')}</option>
              {choice?.modelSelectable && choice.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {editing.model && (!choice?.modelSelectable || !choice.models.some(m => m.id === editing.model)) && <option value={editing.model} disabled>{editing.model} · {t('studio.unavailable')}</option>}
            </Select></label></div>
          <AgentReadiness choice={choice} />
          {!choice?.modelSelectable && choice?.modelReason && <p role="status">{choice.modelReason}</p>}
          {choice?.effort && <label className="field"><span>{t('studio.effort')}</span><Select value={editing.effort ?? ''} onChange={e => change({ effort: EFFORTS.find(effort => effort === e.target.value) })}><option value="">{t('studio.defaultModel')}</option>{EFFORTS.map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}</Select></label>}
          <label className="field"><span>{t('studio.maxContext')}</span><input type="number" inputMode="numeric" min={MAX_CONTEXT_RANGE.min / 1000} max={MAX_CONTEXT_RANGE.max / 1000} step={10}
            value={editing.maxContext ? Math.round(editing.maxContext / 1000) : ''} placeholder={t('studio.maxContextDefault')} data-testid="agent-max-context"
            onChange={e => { const k = Number(e.target.value); change({ maxContext: e.target.value === '' || !Number.isFinite(k) ? null : Math.round(k) * 1000 }); }} />
            <small data-testid="agent-max-context-note">{choice?.maxContext ? t('studio.maxContextHint') : t('studio.maxContextUnsupported')}</small></label>
          <fieldset className="agent-editor-avatar"><legend>{t('studio.avatar')}</legend><div className="avatar-options">{ROLE_GLYPHS.map(value => {
            const tone = editing.avatar.kind === 'symbol' ? editing.avatar.tone ?? 'blue' : unusedAgentTone(catalog.profiles, editing.category, id);
            const label = lang() === 'it' ? GLYPH_LABELS_IT[value] : GLYPH_ART[value].label;
            return <button key={value} type="button" title={label} aria-label={`${t('studio.avatar')} ${label}`} aria-pressed={editing.avatar.kind === 'symbol' && editing.avatar.value === value} onClick={() => change({ avatar: { kind: 'symbol', value, tone } })}><AgentAvatar avatar={{ kind: 'symbol', value, tone }} name={label} /></button>;
          })}<AgentAvatar avatar={editing.avatar} name={editing.name || t('studio.newAgent')} size={40} /></div>
            {editing.avatar.kind === 'symbol' && <fieldset><legend>{t('studio.tone')}</legend><div className="avatar-tones">{AGENT_TONES.map(tone => <button key={tone} type="button" aria-label={t(`studio.tone.${tone}`)} title={t(`studio.tone.${tone}`)} aria-pressed={editing.avatar.kind === 'symbol' && (editing.avatar.tone ?? 'blue') === tone} onClick={() => { if (editing.avatar.kind === 'symbol') change({ avatar: { ...editing.avatar, tone } }); }}><AgentAvatar avatar={{ kind: 'symbol', value: 'role-spark', tone }} name={t(`studio.tone.${tone}`)} size={20} /></button>)}</div></fieldset>}
            {avatarDuplicates.length > 0 && <p role="status" data-testid="agent-avatar-duplicate">{t('studio.avatarDuplicate', { names: avatarDuplicates.map(p => p.name).join(', ') })}</p>}
            <label className="field"><span>{t('studio.upload')}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label><small>{catalog.imageGeneration.reason} {t('studio.uploadHint')}</small></fieldset>
        </div>
      </div>
      <div className="agent-editor-foot">
        {shown && <button type="button" className="btn btn-ghost" onClick={closeEditor}>{t('agentDetail.closeEditor')}</button>}
        <button type="submit" className="btn btn-primary" disabled={!canSave} data-testid="agent-save">{busy ? t('studio.busy') : t('studio.save')}</button>
      </div>
    </fieldset>
  </form> : null;

  if (!shown) return <section className="agent-detail" aria-label={t('studio.newAgent')} data-testid="agent-studio">
    <header className="ad-hero ad-hero-plain"><div className="ad-id"><h2>{t('studio.newAgent')}</h2><p className="ad-purpose">{t('product.agentsPurpose')}</p></div></header>
    {status}
    {editor ?? <p className="ad-empty">{t('agentDetail.noDraft')}</p>}
    <div className="ad-card"><AgentProposals /></div>
    <div className="ad-card"><ProgressPanel /></div>
  </section>;
  return <AgentDetail profile={shown} busy={busy} editorOpen={editorOpen} hasUpdate={!!presetUpdate} status={status} editor={editor}
    onEdit={() => openEditor()} onDuplicate={() => duplicate(shown)}>{children}</AgentDetail>;
}

function AgentDetail({ profile, busy, editorOpen, hasUpdate, status, editor, onEdit, onDuplicate, children }: {
  profile: AgentProfile; busy: boolean; editorOpen: boolean; hasUpdate: boolean; status: ReactNode; editor: ReactNode; onEdit: () => void; onDuplicate: () => void; children?: ReactNode;
}) {
  const { catalog } = useAgents();
  const metrics = useAgentMetrics(profile.id);
  const lastStart = useApp(s => Object.values(s.chats).reduce((at, c) => c.run?.agentId === profile.id ? Math.max(at, c.run.startedAt) : at, 0));
  const model = catalog?.models.find(m => m.engine === profile.engine);
  const engine = model?.label ?? profile.engine;
  const probation = inProbation(profile);
  const open = metrics?.open ?? 0;
  const state = probation ? 'probation' : open > 0 ? 'working' : 'active';
  const tone = profile.avatar?.kind === 'symbol' ? profile.avatar.tone ?? 'blue' : 'blue';
  const origin = profile.origin.kind === 'preset' ? t('catalog.preset') : t('catalog.custom');
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
  const config: [string, string][] = [
    [t('catalog.engine'), engine],
    [t('studio.model'), profile.model ?? t('studio.defaultEngine')],
    [t('studio.effort'), profile.effort ? effortLabel(profile.effort) ?? profile.effort : t('studio.defaultModel')],
    [t('studio.maxContext'), profile.maxContext ? t('studio.maxContextValue', { n: Math.round(profile.maxContext / 1000) }) : t('studio.maxContextDefault')],
    [t('studio.category'), t(`studio.category.${profile.category}`)],
    [t('agentDetail.tools'), profile.tools ? [...profile.tools.allow, ...(profile.tools.mcp ?? []).map(s => `mcp:${s}`)].join(', ') || t('agentDetail.toolsNone') : t('agentDetail.toolsAll')],
    [t('agentDetail.ceiling'), profile.permissionCeiling ? t(`agentDetail.ceiling.${profile.permissionCeiling}`) : t('agentDetail.ceilingNone')],
    [t('agentsGrid.origin'), origin],
    [t('agentDetail.version'), profile.activeVersion === profile.version ? `v${profile.activeVersion}` : `v${profile.activeVersion} / v${profile.version}`],
    [t('agentDetail.updated'), new Date(profile.updatedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })],
  ];
  return <section className="agent-detail" aria-label={profile.name} data-testid="agent-studio" data-tone={tone} data-state={state}>
    <button type="button" className="ad-back" onClick={() => go({ page: 'agenti' })}><span aria-hidden="true">←</span> {t('agentDetail.back')}</button>
    {/* one article holds the whole agent: its name is the article's heading */}
    <article className="ad-body" data-testid={`agent-detail-${profile.id}`}>
      <header className="ad-hero" style={{ '--row-index': 0 } as CSSProperties}>
        <span className="ad-avatar"><AgentAvatar avatar={profile.avatar} name={profile.name} size={52} /></span>
        <div className="ad-id">
          <p className="ad-eyebrow">{profile.role || origin}</p>
          <h2>{profile.name}</h2>
          {profile.purpose && <p className="ad-purpose">{profile.purpose}</p>}
          <div className="ad-chips">
            <span className="ad-badge" data-state={state}><i aria-hidden="true" />{probation ? t('catalog.probation') : open > 0 ? t('agentsGrid.working') : t('catalog.active')}</span>
            <span className="ad-chip">{engine}</span>
            <span className="ad-chip ad-chip-mono">{profile.model ?? t('studio.defaultEngine')}</span>
            {profile.trial && <span className="ad-chip ad-chip-amber">{t('pack.trial')}</span>}
          </div>
        </div>
        <div className="ad-actions">
          <CatalogRun profile={profile} available={!catalog?.problem && profileCanStart(profile, model)} />
          <button type="button" className="btn btn-ghost" disabled={busy} aria-expanded={editorOpen} onClick={onEdit} data-testid="agent-edit">{t('studio.edit')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDuplicate}>{t('studio.duplicate')}</button>
        </div>
      </header>
      {hasUpdate && !editorOpen && <div className="ad-banner" role="status"><span>{t('agentDetail.updateBanner')}</span><button type="button" className="btn btn-ghost btn-s" onClick={onEdit}>{t('agentDetail.reviewUpdate')}</button></div>}
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
          <AgentManifestPanel manifest={profile.manifest} />
        </section>
        <div className="ad-side">
          <section className="ad-card" aria-labelledby={`ad-config-${profile.id}`}>
            <header className="ad-card-head"><h3 id={`ad-config-${profile.id}`}>{t('agentDetail.config')}</h3></header>
            <dl className="ad-config">{config.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>
          <section className="ad-card" aria-labelledby={`ad-learn-${profile.id}`}>
            <header className="ad-card-head"><h3 id={`ad-learn-${profile.id}`}>{t('agentDetail.learning')}</h3></header>
            <AgentPackDetails profile={profile} />
          </section>
        </div>
      </div>
      {children}
    </article>
  </section>;
}
