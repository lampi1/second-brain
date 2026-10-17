// User-owned agent catalog/editor with optional explicit AI draft assistance. Uses only typed catalog capabilities;
// editing never changes the identity/model of running sessions, and provider responses never save themselves.
import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import { AGENT_SYMBOLS, type AgentDraft, type AgentProfile } from '@shared/agents';
import { duplicateAgent, draftAgent, refreshAgents, saveAgent, useAgents } from '../store/agents';
import { openModal, toast,ui } from '../store/ui';
import { EFFORTS, effortLabel } from '../lib/format';
import { forgetAgentEditor, readAgentEditor, rememberAgentEditor } from '../lib/agent-drafts';
import { validateAvatarImage } from '../lib/avatar-raster';
import {holdUpdate} from '../lib/update-barrier';
import { AppearancePreview } from './AppearancePreview';
import {t}from'../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { AgentManifestPanel } from './AgentManifestPanel';
import { checkedManifest } from '@shared/agent-manifest';
import '../styles/agent-studio.css';

export function AgentStudio() {
  const presentation=ui.use(s=>s.prefs.appearance.templates.agents);
  const { catalog, error } = useAgents();
  const restored = useRef(readAgentEditor(undefined,true));
  const [editing, setEditing] = useState<AgentDraft | null>(restored.current?.draft ?? null);
  const [id, setId] = useState<string | undefined>(restored.current?.id);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const [guideText, setGuideText] = useState(restored.current?.message ?? ''), [guideModel, setGuideModel] = useState('');
  const [suggestion, setSuggestion] = useState<AgentDraft | null>(restored.current?.suggestion ?? null);
  const [guideHistory, setGuideHistory] = useState<{role:'user'|'assistant';text:string}[]>(restored.current?.history ?? []);
  useEffect(()=>{if(busy||uploading)return holdUpdate(t('studio.hold'));},[busy,uploading]);
  const nameInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0), working = useRef(false);
  const remember = () => { if(editing) rememberAgentEditor({id,draft:editing,message:guideText,history:guideHistory,suggestion}); };
  useEffect(remember,[editing,id,guideText,guideHistory,suggestion]);
  const pick = (profile?: AgentProfile, saved=false) => {
    if(saved) { forgetAgentEditor(id); forgetAgentEditor(profile?.id); } else remember();
    const cached=readAgentEditor(profile?.id);
    revision.current++; setUploading(false); setSuggestion(cached?.suggestion ?? null); setGuideHistory(cached?.history ?? []); setGuideText(cached?.message ?? ''); setProblem(null); setId(profile?.id);
    const engine = catalog?.models.find(e => e.enabled && e.trusted && e.defaultModel)?.engine ?? catalog?.models[0]?.engine ?? 'claude';
    setEditing(cached?.draft ?? (profile ? { ...profile } : { name: '', purpose: '', instructions: '', engine, model: null, avatar: { kind: 'symbol', value: 'briefcase' } }));
    requestAnimationFrame(()=>{ nameInput.current?.scrollIntoView({block:'nearest'}); nameInput.current?.focus(); });
  };
  const change = (patch: Partial<AgentDraft>) => { revision.current++; setUploading(false); setEditing(p => p ? { ...p, ...patch } : p); setSuggestion(null); };
  const choice = catalog?.models.find(e => e.engine === editing?.engine);
  const knownModel = !!choice && (editing?.model === null ? choice.defaultModel : choice.modelSelectable && choice.models.some(m => m.id === editing?.model));
  let validManifest = true;
  try { checkedManifest(editing?.manifest); } catch { validManifest = false; }
  const canSave = !!editing?.name.trim() && !!editing.purpose.trim() && validManifest && !!choice?.enabled && !!choice.trusted && knownModel && !busy && !uploading && !catalog?.problem;
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
  const askGuide = async () => {
    const builder = catalog?.builder, engine = catalog?.models.find(e => e.engine === builder?.engine)?.engine;
    const model = guideModel || builder?.models[0];
    if (!editing || !builder?.available || !engine || !model || !guideText.trim() || working.current) return;
    working.current = true;
    const message = guideText.trim();
    setGuideHistory(history => [...history, {role:'user',text:message}]); setGuideText('');
    setBusy(true); setProblem(null); const version = revision.current;
    try {
      const result = await draftAgent({ text: message, engine, model, base: suggestion ?? editing });
      if (version === revision.current) { if (result.ok) { setSuggestion(result.draft); setGuideHistory(history => [...history, {role:'assistant',text:`${result.draft.name}: ${result.draft.purpose}`}]); } else setProblem(result.reason); }
    } catch { setProblem(t('studio.guideError')); }
    finally { working.current = false; setBusy(false); }
  };
  return <section className="agent-studio" aria-label={t('home.manageAgents')} data-testid="agent-studio">
    <header className="studio-head"><div><h2>{t('home.manageAgents')}</h2><p>{t('product.agentsPurpose')}</p></div><button type="button" className="btn btn-primary" disabled={!catalog || busy} onClick={() => pick()}>{t('product.newAgent')}</button><button type="button" className="btn btn-ghost" onClick={() => openModal('setup')}>{t('product.setup')}</button></header>
    <AppearancePreview />
    {problem && <p role="alert">{problem}</p>}
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    <div className={`studio-columns${editing?'':' no-editor'}`}><div className="agent-catalog" data-agent-template={presentation} aria-label={t('product.catalog')}>
      {catalog?.profiles.map(profile => <article key={profile.id} className={id === profile.id ? 'selected' : ''}>
        <AgentAvatar avatar={profile.avatar} name={profile.name} size={36} /><div><h3>{profile.name}</h3><p>{profile.purpose}</p><small>{catalog.models.find(e => e.engine === profile.engine)?.label ?? profile.engine} · {profile.model || t('studio.defaultEngine')}</small></div>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => pick(profile)}>{t('studio.edit')}</button>
        <button type="button" className="link-btn" disabled={busy} onClick={() => { setBusy(true); void duplicateAgent(profile.id).then(profile => pick(profile), () => setProblem(t('studio.duplicateError'))).finally(() => setBusy(false)); }}>{t('studio.duplicate')}</button>
        <AgentManifestPanel manifest={profile.manifest} />
      </article>)}
      {catalog?.profiles.length === 0 && <p>{t('studio.empty')}</p>}
    </div>{editing && catalog && <form className="agent-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={id ? t('studio.editAgent') : t('studio.createAgent')}>
      <fieldset disabled={busy} className="agent-editor-fields"><legend>{id ? t('studio.editAgent') : t('studio.newAgent')}</legend><p>{t('studio.newSessions')}</p>
      <label className="field"><span>{t('studio.name')}</span><input ref={nameInput} maxLength={80} value={editing.name} onChange={e => change({ name: e.target.value })} required data-testid="agent-name" /></label>
      <label className="field"><span>{t('studio.purpose')}</span><textarea maxLength={400} rows={2} value={editing.purpose} onChange={e => change({ purpose: e.target.value })} required data-testid="agent-purpose" /></label>
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
      <fieldset><legend>{t('studio.avatar')}</legend><div className="avatar-options">{AGENT_SYMBOLS.map(value => <button key={value} type="button" aria-label={`${t('studio.avatar')} ${value}`} aria-pressed={editing.avatar.kind === 'symbol' && editing.avatar.value === value} onClick={() => change({ avatar: { kind: 'symbol', value } })}><AgentAvatar avatar={{ kind: 'symbol', value }} name={value} /></button>)}<AgentAvatar avatar={editing.avatar} name={editing.name || t('studio.newAgent')} size={44} /></div><label className="field"><span>{t('studio.upload')}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /></label><small>{catalog.imageGeneration.reason} {t('studio.uploadHint')}</small></fieldset>
      <details className="agent-guide"><summary>{t('studio.guide')}</summary><p>{t('studio.guideExplain')}</p>
        <div role="log" aria-label={t('studio.guideLog')} aria-live="polite">{guideHistory.map((message,index)=><p key={index}><b>{message.role === 'user' ? t('studio.you') : t('studio.assistant')}: </b>{message.text}</p>)}</div>
        <textarea rows={3} value={guideText} onChange={e => setGuideText(e.target.value)} maxLength={6000} placeholder={t('studio.guideExample')} aria-label={t('studio.guideMessage')} />
        {catalog.builder.available ? <label className="field"><span>{t('studio.guideModel')}</span><Select value={guideModel || catalog.builder.models[0] || ''} onChange={e => setGuideModel(e.target.value)}>{catalog.builder.models.map(m => <option key={m}>{m}</option>)}</Select></label> : <p role="status">{catalog.builder.reason || t('studio.guideUnavailable')}</p>}
        <button type="button" className="btn btn-ghost" disabled={busy || !catalog.builder.available || !guideText.trim()} onClick={() => void askGuide()}>{t('studio.sendGuide')}</button>
        {suggestion && <section aria-label={t('studio.suggestion')}><h4>{suggestion.name}</h4><p>{suggestion.purpose}</p><pre>{suggestion.instructions}</pre><AgentManifestPanel manifest={suggestion.manifest} /><p>{t('studio.engine')}: {suggestion.engine} · {suggestion.model || t('studio.defaultEngine')}</p><button type="button" className="btn btn-ghost" onClick={() => { change(suggestion); setSuggestion(null); }}>{t('studio.useDraft')}</button></section>}
      </details>
      <button type="submit" className="btn btn-primary" disabled={!canSave} data-testid="agent-save">{busy ? t('studio.busy') : t('studio.save')}</button>
      </fieldset>
    </form>}</div>
  </section>;
}
