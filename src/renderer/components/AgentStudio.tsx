// User-owned agent catalog/editor: edit, duplicate, export or import a profile by hand. New agents are not made here:
// "Crea agente" (AgentCreateDialog) asks the Orchestrator. Uses only typed catalog capabilities; editing never changes
// the identity/model of running sessions. Rendered by AgentCatalogPage.tsx for an agent's page (and 'studio').
import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import { AGENT_CATEGORIES, AGENT_TONES, type AgentDraft, type AgentProfile } from '@shared/agents';
import { ROLE_GLYPHS } from '@shared/agent-glyphs';
import { duplicateAgentAvatars, unusedAgentTone } from '../lib/agent-avatar-choice';
import { GLYPH_ART, GLYPH_LABELS_IT } from '../lib/agent-glyph-art';
import { duplicateAgent, refreshAgents, saveAgent, useAgents } from '../store/agents';
import { openModal, toast,ui } from '../store/ui';
import { EFFORTS, effortLabel } from '../lib/format';
import { forgetAgentEditor, readAgentEditor, rememberAgentEditor } from '../lib/agent-drafts';
import { validateAvatarImage } from '../lib/avatar-raster';
import {holdUpdate} from '../lib/update-barrier';
import { AppearancePreview } from './AppearancePreview';
import {lang,t}from'../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { AgentManifestPanel } from './AgentManifestPanel';
import { AgentPackDetails } from './AgentPackDetails';
import { requestPack } from '../lib/agent-pack-ui';
import { ProgressPanel } from './ProgressPanel';
import { AgentProposals } from './AgentProposals';
import { checkedManifest } from '@shared/agent-manifest';
import '../styles/agent-studio.css';

export function AgentStudio({ initialProfile }: { initialProfile?: AgentProfile } = {}) {
  const presentation=ui.use(s=>s.prefs.appearance.templates.agents);
  const { catalog, error } = useAgents();
  const restored = useRef(initialProfile ? readAgentEditor(initialProfile.id) : readAgentEditor(undefined,true));
  const [editing, setEditing] = useState<AgentDraft | null>(restored.current?.draft ?? initialProfile ?? null);
  const [id, setId] = useState<string | undefined>(restored.current?.id ?? initialProfile?.id);
  const [editorRevision, setEditorRevision] = useState<number | null>(restored.current ? restored.current.baseRevision ?? null : initialProfile?.updatedAt ?? null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  useEffect(()=>{if(busy||uploading)return holdUpdate(t('studio.hold'));},[busy,uploading]);
  const nameInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0), working = useRef(false);
  // message/history/suggestion stay empty: the update checkpoint keeps the shape the removed AI guide used
  const remember = () => { if(editing) rememberAgentEditor({id,...(editorRevision === null ? {} : { baseRevision: editorRevision }),draft:editing,message:'',history:[],suggestion:null}); };
  useEffect(remember,[editing,id,editorRevision]);
  const pick = (profile: AgentProfile, saved=false) => {
    if(saved) { forgetAgentEditor(id); forgetAgentEditor(profile.id); } else remember();
    const cached=readAgentEditor(profile.id);
    setEditorRevision(cached ? cached.baseRevision ?? null : profile.updatedAt);
    revision.current++; setUploading(false); setProblem(null); setId(profile.id);
    setEditing(cached?.draft ?? { ...profile });
    requestAnimationFrame(()=>{ nameInput.current?.scrollIntoView({block:'nearest'}); nameInput.current?.focus(); });
  };
  const change = (patch: Partial<AgentDraft>) => { revision.current++; setUploading(false); setEditing(p => p ? { ...p, ...patch } : p); };
  const choice = catalog?.models.find(e => e.engine === editing?.engine);
  const avatarDuplicates = editing ? duplicateAgentAvatars(editing.avatar, catalog?.profiles ?? [], id) : [];
  const presetUpdate = catalog?.presetUpdates?.find(update => update.agentId === id);
  const knownModel = !!choice && (editing?.model === null ? choice.defaultModel : choice.modelSelectable && choice.models.some(m => m.id === editing?.model));
  let validManifest = true;
  try { checkedManifest(editing?.manifest); } catch { validManifest = false; }
  const currentProfile = catalog?.profiles.find(profile => profile.id === id);
  const staleEditor = !!id && (editorRevision === null || currentProfile?.updatedAt !== editorRevision);
  const canSave = !staleEditor && !!editing?.name.trim() && !!editing.purpose.trim() && validManifest && !!choice?.enabled && !!choice.trusted && knownModel && !busy && !uploading && !catalog?.problem;
  const save = async () => {
    if (!editing || !canSave || working.current) return;
    working.current = true;
    setBusy(true); setProblem(null);
    try { const profile = await saveAgent(editing, id); pick(profile,true); toast(t('studio.saved'), 'ok'); }
    catch { setProblem(t('studio.saveError')); }
    finally { working.current = false; setBusy(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const version = ++revision.current;
    setUploading(true);
    try {
      await validateAvatarImage(file);
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      if (version === revision.current) change({ avatar: { kind: 'image', dataUrl } });
    } catch { if(version === revision.current) setProblem(t('studio.uploadError')); } finally { if(version === revision.current) setUploading(false); }
  };
  return <section className="agent-studio" aria-label={t('home.manageAgents')} data-testid="agent-studio">
    <header className="studio-head"><div><h2>{t('home.manageAgents')}</h2><p>{t('product.agentsPurpose')}</p></div><button type="button" className="btn btn-ghost" onClick={() => openModal('setup')}>{t('product.setup')}</button></header>
    <button type="button" className="btn btn-ghost" onClick={() => requestPack({ kind: 'import' })}>{t('pack.import')}</button>
    <AppearancePreview />
    <ProgressPanel />
    <AgentProposals />
    {problem && <p role="alert">{problem}</p>}
    {staleEditor && <div role="alert"><p>{t('pack.staleEditor')}</p><button type="button" disabled={busy} onClick={() => { setId(undefined); setEditorRevision(null); }}>{t('pack.copyDraft')}</button><button type="button" disabled={busy || !currentProfile} onClick={() => currentProfile && pick(currentProfile, true)}>{t('pack.reloadDraft')}</button></div>}
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    <div className={`studio-columns${editing?'':' no-editor'}`}><div className="agent-catalog" data-agent-template={presentation} aria-label={t('product.catalog')}>
      {catalog?.profiles.map(profile => <article key={profile.id} className={id === profile.id ? 'selected' : ''}>
        <AgentAvatar avatar={profile.avatar} name={profile.name} size={36} /><div><h3>{profile.name}</h3><p>{profile.purpose}</p><small>{catalog.models.find(e => e.engine === profile.engine)?.label ?? profile.engine} · {profile.model || t('studio.defaultEngine')}</small></div>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => pick(profile)}>{t('studio.edit')}</button>
        <button type="button" className="link-btn" disabled={busy} onClick={() => { setBusy(true); void duplicateAgent(profile.id).then(profile => pick(profile), () => setProblem(t('studio.duplicateError'))).finally(() => setBusy(false)); }}>{t('studio.duplicate')}</button>
        <AgentManifestPanel manifest={profile.manifest} />
        <AgentPackDetails profile={profile} />
      </article>)}
      {catalog?.profiles.length === 0 && <p>{t('studio.empty')}</p>}
    </div>{editing && catalog && <form className="agent-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={id ? t('studio.editAgent') : t('studio.createAgent')}>
      <fieldset disabled={busy} className="agent-editor-fields"><legend>{id ? t('studio.editAgent') : t('studio.newAgent')}</legend><p>{t('studio.newSessions')}</p>
      {presetUpdate && <details data-testid="preset-update"><summary>{t('studio.presetUpdate')}</summary>
        <p>{t('studio.presetCompare')}</p>
        {presetUpdate.differences.map(diff => <section key={diff.field}><h4>{diff.field}</h4><p>{t('studio.presetCurrent')}</p><pre>{JSON.stringify(diff.before, null, 2)}</pre><p>{t('studio.presetNext')}</p><pre>{JSON.stringify(diff.after, null, 2)}</pre></section>)}
        <button type="button" className="btn btn-ghost" onClick={() => change({ ...presetUpdate.draft, name: editing.name, purpose: editing.purpose, avatar: editing.avatar })}>{t('studio.presetApply')}</button>
      </details>}
      <label className="field"><span>{t('studio.name')}</span><input ref={nameInput} maxLength={80} value={editing.name} onChange={e => change({ name: e.target.value })} required data-testid="agent-name" /></label>
      <label className="field"><span>{t('studio.purpose')}</span><textarea maxLength={400} rows={2} value={editing.purpose} onChange={e => change({ purpose: e.target.value })} required data-testid="agent-purpose" /></label>
      <label className="field"><span>{t('studio.category')}</span><Select value={editing.category ?? 'other'} onChange={e => {
        const category = AGENT_CATEGORIES.find(c => c === e.target.value) ?? 'other';
        change({ category, ...(editing.avatar.kind === 'symbol' ? { avatar: { ...editing.avatar, tone: unusedAgentTone(catalog.profiles, category, id) } } : {}) });
      }}>{AGENT_CATEGORIES.map(category => <option key={category} value={category}>{t(`studio.category.${category}`)}</option>)}</Select></label>
      <AgentManifestPanel manifest={editing.manifest} onChange={manifest => change({ manifest })} />
      {!validManifest && <p role="alert">{t('studio.manifestInvalid')}</p>}
      <details className="agent-advanced"><summary>{t('product.advanced')}</summary>
      <label className="field"><span>{t('studio.instructions')}</span><textarea maxLength={6000} rows={4} value={editing.instructions} onChange={e => change({ instructions: e.target.value })} placeholder={t('studio.instructionsHint')} data-testid="agent-instructions" /></label>
      <div className="field-row"><label className="field"><span>{t('studio.engine')}</span><Select value={editing.engine} onChange={e => change({ engine: e.target.value, model: null, effort: undefined })} data-testid="agent-engine">{catalog.models.map(e => <option key={e.engine} value={e.engine} disabled={!e.enabled || !e.trusted}>{e.label}{!e.enabled ? ` · ${t('studio.disabled')}` : !e.trusted ? ` · ${t('studio.trust')}` : ''}</option>)}</Select></label>
        <label className="field"><span>{t('studio.model')}</span><Select value={editing.model ?? ''} onChange={e => change({ model: e.target.value || null })} data-testid="agent-model">
          <option value="" disabled={!choice?.defaultModel}>{t('studio.actualAtStart')}</option>
          {choice?.modelSelectable && choice.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          {editing.model && (!choice?.modelSelectable || !choice.models.some(m => m.id === editing.model)) && <option value={editing.model} disabled>{editing.model} · {t('studio.unavailable')}</option>}
        </Select></label></div>
      <AgentReadiness choice={choice} />
      {!choice?.modelSelectable && choice?.modelReason && <p role="status">{choice.modelReason}</p>}
      {choice?.effort && <label className="field"><span>{t('studio.effort')}</span><Select value={editing.effort ?? ''} onChange={e => change({ effort: EFFORTS.find(effort => effort === e.target.value) })}><option value="">{t('studio.defaultModel')}</option>{EFFORTS.map(e => <option key={e} value={e}>{effortLabel(e)}</option>)}</Select></label>}
      </details>
      <fieldset><legend>{t('studio.avatar')}</legend><div className="avatar-options">{ROLE_GLYPHS.map(value => {
        const tone = editing.avatar.kind === 'symbol' ? editing.avatar.tone ?? 'blue' : unusedAgentTone(catalog.profiles, editing.category, id);
        const label = lang() === 'it' ? GLYPH_LABELS_IT[value] : GLYPH_ART[value].label;
        return <button key={value} type="button" title={label} aria-label={`${t('studio.avatar')} ${label}`} aria-pressed={editing.avatar.kind === 'symbol' && editing.avatar.value === value} onClick={() => change({ avatar: { kind: 'symbol', value, tone } })}><AgentAvatar avatar={{ kind: 'symbol', value, tone }} name={label} /></button>;
      })}<AgentAvatar avatar={editing.avatar} name={editing.name || t('studio.newAgent')} size={40} /></div>
      {editing.avatar.kind === 'symbol' && <fieldset><legend>{t('studio.tone')}</legend><div className="avatar-tones">{AGENT_TONES.map(tone => <button key={tone} type="button" aria-label={t(`studio.tone.${tone}`)} title={t(`studio.tone.${tone}`)} aria-pressed={editing.avatar.kind === 'symbol' && (editing.avatar.tone ?? 'blue') === tone} onClick={() => { if (editing.avatar.kind === 'symbol') change({ avatar: { ...editing.avatar, tone } }); }}><AgentAvatar avatar={{ kind: 'symbol', value: 'role-spark', tone }} name={t(`studio.tone.${tone}`)} size={20} /></button>)}</div></fieldset>}
      {avatarDuplicates.length > 0 && <p role="status" data-testid="agent-avatar-duplicate">{t('studio.avatarDuplicate', { names: avatarDuplicates.map(p => p.name).join(', ') })}</p>}
      <label className="field"><span>{t('studio.upload')}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label><small>{catalog.imageGeneration.reason} {t('studio.uploadHint')}</small></fieldset>
      <button type="submit" className="btn btn-primary" disabled={!canSave} data-testid="agent-save">{busy ? t('studio.busy') : t('studio.save')}</button>
      </fieldset>
    </form>}</div>
  </section>;
}
