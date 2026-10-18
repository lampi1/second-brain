// First-run interview: offline, resumable, optional and private. Existing installations never get a forced wizard.
// Only preference fields are saved; permission, trust, accounts and provider calls remain separate explicit actions.
// Five steps, nothing asked twice: who you are (what me.md already knows is prefilled), your work areas, how we work
// (reply style, GitHub/Jira sign-in in place), agents, summary. Confirm writes the answers into me.md through
// 'profile:save' (lib/agent-setup.ts wizardProfile decides what); Settings → Il mio profilo edits them later.
import { t as auditText } from '../i18n';
import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import type { AgentCatalog, SetupDraft, SetupProfile, SetupState } from '@shared/agents';
import type { OwnerProfile } from '@shared/profile';
import { PROFILE_LIMITS } from '@shared/profile';
import { INTERVIEW_STEPS, answerPatch, answerProblems, customReplyStyle, knownName, profileDraft, recommendedAgents, validSetupStep, wizardLocked, wizardProfile } from '../lib/agent-setup';
import { profileError, workAreas } from '../lib/profile';
import { refreshSetup, saveSetup, useAgents } from '../store/agents';
import { closeModal, openModal, toast, ui } from '../store/ui';
import { refreshInfo, useApp } from '../store/store';
import { sb } from '../sb';
import { AgentAvatar } from './AgentAvatar';
import { AgentReadiness } from './AgentReadiness';
import { CreateMemory } from './CreateMemory';
import { Modal } from './ui';
import '../styles/agent-studio.css';
import { AiFirstGate } from '../../modules/ai-first/Gate';
import { aiCopy } from '../../modules/ai-first/i18n';
import { lang } from '../i18n';
import { AppConnectorScreen } from '../../modules/onboarding/AppScreen';

export function FirstInterviewGate() {
  const { setup, catalog, error } = useAgents(), modal = ui.use(s => s.modal);
  const offered = useRef(false);
  const [fallback, setFallback] = useState(false);
  const [connectors, setConnectors] = useState(false);
  useEffect(() => {
    if (modal === 'setup') offered.current = true;
    if (!offered.current && setup && (setup.status === 'new' || setup.status === 'draft') && !modal) { offered.current = true; openModal('setup'); }
  }, [setup?.status, modal]);
  if (modal !== 'setup') return null;
  if (connectors) return <Modal onClose={closeModal} label={auditText('audit.FirstInterview.connectYourTools')} testid="connector-setup"><div className="modal-body"><AppConnectorScreen onClose={() => { setConnectors(false); closeModal(); }}/></div></Modal>;
  if (!setup) return <Modal onClose={closeModal} label={auditText('audit.FirstInterview.setUpYourWorkspace')} testid="first-interview"><div className="modal-body"><p role="status">{error ?? auditText('auditExpression.FirstInterview.text39')}</p>{error && <button type="button" className="btn" onClick={() => void refreshSetup()}>{auditText('audit.FirstInterview.retry')}</button>}<button type="button" className="btn btn-ghost" onClick={closeModal}>{auditText('audit.FirstInterview.close')}</button></div></Modal>;
  if (!fallback && setup.preferences.guide && setup.preferences.guide.stage !== 'fallback') return <AiFirstGate setup={setup} onFallback={() => setFallback(true)} onConnected={() => setConnectors(true)}/>;
  return <FirstInterview initial={setup} catalog={catalog} onConnectAi={async preferences => { await saveSetup({ ...preferences, guide: { stage: 'choosing' } }, 'draft'); setFallback(false); }}/>;
}

/** writes the interview's answers into me.md; a concurrent edit gets one retry on the fresh file. Returns whether it failed. */
async function saveProfile(draft: SetupDraft): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await sb.invoke('profile:get', undefined);
    if (!read.ok) return read.reason !== 'no-brain';
    const fields = wizardProfile(draft, read.profile);
    if (!Object.keys(fields).length) return false;
    try { await sb.invoke('profile:save', { revision: read.profile.revision, fields }); return false; }
    catch (error) { if (profileError(error) !== 'changed') return true; }
  }
  return true;
}

function FirstInterview({ initial, catalog, onConnectAi }: { initial: SetupState; catalog: AgentCatalog | null; onConnectAi: (preferences: SetupDraft) => Promise<void> }) {
  const enabledEngines = useApp(s => s.settings?.engineOn);
  // a finished or skipped run starts over from what me.md says now: its old answers are never written again
  const [draft, setDraft] = useState<SetupDraft>(() => { const resume = ['new', 'draft'].includes(initial.status); return { ...initial.preferences, engines: initial.preferences.engines ?? (resume ? [] : ['claude', 'codex', 'cursor'].filter(id => enabledEngines?.[id])), step: resume ? validSetupStep(initial.preferences.step) : 0, profile: resume ? initial.preferences.profile : undefined }; });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const saving = useRef(false), terminal = useRef(false), suggestionsMade = useRef(initial.preferences.step >= 3);
  const info = useApp(s => s.info);
  const [candidates, setCandidates] = useState<string[]>([]);
  useEffect(() => { void sb.invoke('app:brainCandidates', undefined).then(setCandidates, () => setCandidates([])); }, []);
  const change = (patch: Partial<SetupDraft>) => { setDraft(d => ({ ...d, ...patch })); setSaved(false); };
  // what me.md says now (re-read when the memory folder changes): shown where the owner gave no answer in this run
  const [current, setCurrent] = useState<OwnerProfile | null>(null);
  useEffect(() => {
    let live = true;
    void sb.invoke('profile:get', undefined).then(r => { if (live) setCurrent(r.ok ? r.profile : null); }, () => { if (live) setCurrent(null); });
    return () => { live = false; };
  }, [info?.brainRoot]);
  // an emptied answer keeps what me.md says (inMeMd): the summary shows that, never a blank the confirm would not write
  const answers = profileDraft(draft, current), inMeMd = profileDraft({ ...draft, profile: undefined }, current), problems = answerProblems(draft, current), locked = wizardLocked(current);
  const answer = (patch: Partial<SetupProfile>) => change({ profile: answerPatch(draft, patch) });
  const fixedStyle = !!current && (customReplyStyle(current) || locked.has('replyStyle'));
  const blocked = (draft.step === 0 && !!(problems.name || problems.role || problems.language)) || (draft.step === 1 && !!problems.areas) || (draft.step === 4 && Object.keys(problems).length > 0);
  const lockedNote = <small>{auditText('audit.FirstInterview.writtenManuallyInMeMdChange')}</small>;
  const problem = (key: keyof typeof problems) => problems[key] && <small role="alert">{problems[key]}</small>;
  useEffect(() => {
    if (terminal.current || busy) return;
    let live = true;
    const timer = setTimeout(() => { void saveSetup(draft, 'draft').then(() => { if (live) setSaved(true); }, () => { if (live) setError(auditText('cmp.interview.draftNotSaved')); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, busy]);
  const saveAndClose = async (status: 'draft' | 'completed' | 'skipped') => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try {
      if (status === 'completed') {
        const latest = await sb.invoke('app:info', undefined);
        if (!latest.brainRoot) {
          const created = await sb.invoke('app:createBrain', { automatic: true, name: answers.name, role: answers.role, language: /^en/i.test(answers.language) ? 'en' : 'it', harness: draft.engines?.[0] ?? 'none', folderName: 'memory' });
          if (!created?.connected) throw new Error('Memoria non collegata');
          await refreshInfo();
        }
        if (draft.engines) await sb.invoke('settings:set', { engineOn: Object.fromEntries(['claude', 'codex', 'cursor'].map(id => [id, draft.engines!.includes(id)])) });
        if (await saveProfile(draft)) {
          if (!latest.brainRoot) throw new Error('Profilo non salvato');
          toast(auditText('cmp.interview.profileNotWritable'), 'info');
        }
      }
      await saveSetup(draft, status);
      if (ui.get().modal === 'setup') closeModal();
    }
    catch { terminal.current = false; setError(auditText('cmp.interview.saveFailed')); }
    finally { saving.current = false; setBusy(false); }
  };
  const next = () => {
    if (draft.step === 2 && !suggestionsMade.current) { suggestionsMade.current = true; change({ step: 3, agentIds: recommendedAgents(draft, catalog?.profiles ?? []) }); }
    else change({ step: validSetupStep(draft.step + 1) });
  };
  const pickBrain = async () => {
    setBusy(true); setError(null);
    try { await sb.invoke('app:pickBrain', undefined); await refreshInfo(); }
    catch { setError(auditText('cmp.interview.pickFailed')); }
    finally { setBusy(false); }
  };
  const selected = catalog?.profiles.filter(p => draft.agentIds.includes(p.id)) ?? [];
  const connectAi = async () => {
    if (busy) return;
    terminal.current = true; setBusy(true);
    try { await onConnectAi(draft); }
    catch { terminal.current = false; setBusy(false); setError(auditText('cmp.interview.configNotSaved')); }
  };
  return <Modal onClose={() => void saveAndClose('draft')} label={auditText('audit.FirstInterview.setUpYourWorkspace')} testid="first-interview" className="modal-interview">
    <div className="modal-head"><h2>{auditText('audit.FirstInterview.makeRoomForYourWork')}</h2><span className="sp" /><small>{auditText('audit.FirstInterview.step')}{' '}{draft.step + 1}{' '}{auditText('audit.FirstInterview.of')}{' '}{INTERVIEW_STEPS.length}</small></div>
    <div className="modal-body"><fieldset disabled={busy} className="agent-editor-fields">
      <button type="button" className="btn" onClick={() => void connectAi()}>{aiCopy[lang()].title}</button>
      <p>{auditText('audit.FirstInterview.yourAnswersStayOnThisComputer')}</p>
      <ol className="interview-steps" aria-label={auditText('audit.FirstInterview.setupSteps')}>{INTERVIEW_STEPS.map((step, i) => <li key={step} aria-current={i === draft.step ? 'step' : undefined}>{auditText(`cmp.interview.step.${step}` as const)}</li>)}</ol>
      {draft.step === 0 && <>
        {knownName(current) ? <p data-testid="setup-known-name">{auditText('audit.FirstInterview.hello')}{' '}<b>{current!.name}</b>{auditText('audit.FirstInterview.letSCompleteTheRest')}</p>
          : <label className="field"><span>{auditText('audit.FirstInterview.whatIsYourName')}</span><input value={answers.name} maxLength={PROFILE_LIMITS.name} onChange={e => answer({ name: e.target.value })} disabled={locked.has('name')} data-testid="setup-name"/>{locked.has('name') ? lockedNote : <small>{auditText('audit.FirstInterview.agentsWillCallYouThis')}</small>}{problem('name')}</label>}
        <label className="field"><span>{auditText('audit.FirstInterview.yourRoleInOneLine')}</span><input value={answers.role} maxLength={PROFILE_LIMITS.role} onChange={e => answer({ role: e.target.value })} disabled={locked.has('role')} placeholder={auditText('audit.FirstInterview.forExampleBackendDeveloperProductManager')} data-testid="setup-role"/>{locked.has('role') && lockedNote}{problem('role')}</label>
        <label className="field"><span>{auditText('audit.FirstInterview.chatLanguage')}</span><input value={answers.language} maxLength={PROFILE_LIMITS.language} list="setup-languages" onChange={e => answer({ language: e.target.value })} disabled={locked.has('language')} data-testid="setup-language"/><datalist id="setup-languages"><option value="italiano"/><option value="English"/></datalist>{locked.has('language') && lockedNote}{problem('language')}</label>
      </>}
      {draft.step === 0 && <fieldset><legend>{auditText('audit.FirstInterview.howDoYouUsuallyWork')}</legend>{([
        ['employee', auditText('cmp.interview.work.employee'), auditText('cmp.interview.work.employeeHint')], ['independent', auditText('cmp.interview.work.independent'), auditText('cmp.interview.work.independentHint')], ['other', auditText('cmp.interview.work.other'), auditText('cmp.interview.work.otherHint')], ['', auditText('cmp.interview.work.later'), auditText('cmp.interview.work.laterHint')],
      ] as const).map(([work, name, hint]) => <label key={work} className="interview-choice"><input type="radio" name="work" checked={draft.work === work} onChange={() => change({ work })} /><span><b>{name}</b><small>{hint}</small></span></label>)}</fieldset>}
      {draft.step === 1 && <label className="field"><span>{auditText('audit.FirstInterview.yourWorkAreas')}</span><textarea rows={4} value={answers.areas} maxLength={2000} onChange={e => answer({ areas: e.target.value })} disabled={locked.has('mainWork')} placeholder={auditText('auditExpression.FirstInterview.text40')} data-testid="setup-areas"/>{locked.has('mainWork') ? lockedNote : <small>{auditText('audit.FirstInterview.projectsClientsOrTopicsYouFollow')}</small>}{problem('areas')}</label>}
      {draft.step === 1 && <label className="field"><span>{auditText('audit.FirstInterview.whatWouldHelpYouOverThe')}</span><textarea rows={5} maxLength={2000} value={draft.goals} onChange={e => change({ goals: e.target.value })} placeholder={draft.work === 'independent' ? auditText('auditExpression.FirstInterview.text41') : auditText('auditExpression.FirstInterview.text42')} data-testid="setup-goals" /><small>{auditText('audit.FirstInterview.describeUsefulOutcomesDetailsCanCome')}</small></label>}
      {draft.step === 2 && <><label className="field"><span>{auditText('audit.FirstInterview.whichToolsAndMaterialsDoYou')}</span><textarea rows={4} maxLength={2000} value={draft.tools} onChange={e => change({ tools: e.target.value })} placeholder={auditText('audit.FirstInterview.documentsSpreadsheetsAppsSitesOrFolders')} data-testid="setup-tools" /><small>{auditText('audit.FirstInterview.optionalNoAccountsAreConnectedAnd')}</small></label><label className="field"><span>{auditText('audit.FirstInterview.howDoYouPreferResponses')}</span><Select value={answers.style} disabled={fixedStyle} onChange={e => { const style = e.target.value === 'concise' ? 'concise' : e.target.value === 'detailed' ? 'detailed' : 'balanced'; change({ style, profile: answerPatch(draft, { style }) }); }} data-testid="setup-style"><option value="balanced">{auditText('audit.FirstInterview.clearWithUsefulDetail')}</option><option value="concise">{auditText('audit.FirstInterview.shortAndDirect')}</option><option value="detailed">{auditText('audit.FirstInterview.thoroughAndExplained')}</option></Select>{fixedStyle && <small>{auditText('audit.FirstInterview.youAlreadyHaveYourOwnStyle')}</small>}</label><AppConnectorScreen/></>}
      {draft.step === 3 && <><h3>{auditText('audit.FirstInterview.aStartingTeamYouCanChange')}</h3><p>{auditText('audit.FirstInterview.selectTheAgentsYouWantAs')}</p>{catalog?.profiles.map(p => <label key={p.id} className="interview-choice"><input type="checkbox" checked={draft.agentIds.includes(p.id)} onChange={e => change({ agentIds: e.target.checked ? [...draft.agentIds, p.id] : draft.agentIds.filter(id => id !== p.id) })} /><AgentAvatar avatar={p.avatar} name={p.name} /><span><b>{p.name}</b><small>{p.purpose}</small></span></label>)}{!catalog?.profiles.length && <p role="status">{auditText('audit.FirstInterview.theCatalogueIsNotAvailableYet')}</p>}</>}
      {draft.step === 4 && <><h3>{auditText('audit.FirstInterview.yourConfiguration')}</h3><dl className="setup-summary"><dt>{auditText('audit.FirstInterview.name')}</dt><dd>{knownName(current) ? current!.name : answers.name.trim() || auditText('cmp.interview.toBeGiven')}</dd><dt>{auditText('audit.FirstInterview.role')}</dt><dd>{answers.role.trim() || inMeMd.role || auditText('auditExpression.FirstInterview.text46')}</dd><dt>{auditText('audit.FirstInterview.chatLanguage')}</dt><dd>{answers.language.trim() || inMeMd.language || auditText('auditExpression.FirstInterview.text46')}</dd><dt>{auditText('audit.FirstInterview.workAreas')}</dt><dd>{(workAreas(answers.areas).length ? workAreas(answers.areas) : workAreas(inMeMd.areas)).join(', ') || auditText('auditExpression.FirstInterview.text46')}</dd><dt>{auditText('audit.FirstInterview.context')}</dt><dd>{draft.work === 'employee' ? auditText('auditExpression.FirstInterview.text43') : draft.work === 'independent' ? auditText('auditExpression.FirstInterview.text44') : draft.work === 'other' ? auditText('auditExpression.FirstInterview.text45') : auditText('auditExpression.FirstInterview.text46')}</dd><dt>{auditText('audit.FirstInterview.goals')}</dt><dd>{draft.goals || auditText('cmp.interview.toDefine')}</dd><dt>{auditText('audit.FirstInterview.toolsAndMaterials')}</dt><dd>{draft.tools || auditText('cmp.interview.chooseWhenNeeded')}</dd><dt>{auditText('audit.FirstInterview.favouriteAgents')}</dt><dd>{selected.map(p => p.name).join(', ') || auditText('cmp.interview.chooseLater')}</dd><dt>{auditText('audit.FirstInterview.workMemory')}</dt><dd>{info?.brainRoot ? auditText('auditExpression.FirstInterview.text47') : auditText('auditExpression.FirstInterview.text48')}</dd></dl><button type="button" className="btn btn-ghost" onClick={() => void pickBrain()} disabled={busy}>{info?.brainRoot ? auditText('auditExpression.FirstInterview.text49') : auditText('auditExpression.FirstInterview.text50')}</button><h4>{auditText('audit.FirstInterview.detectedAvailability')}</h4>{catalog?.models.map(e => <AgentReadiness key={e.engine} choice={e} />)}<p>{auditText('audit.FirstInterview.setupDoesNotChangePermissionsOr')}</p></>}
      {draft.step === 3 && <fieldset><legend>{auditText('audit.FirstInterview.whichEnginesDoYouWantTo')}</legend>{[['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor']].map(([id, label]) => <label key={id} className="interview-choice"><input type="checkbox" checked={draft.engines?.includes(id!) ?? false} onChange={e => change({ engines: e.target.checked ? [...(draft.engines ?? []), id!] : (draft.engines ?? []).filter(engine => engine !== id) })}/><span>{label}</span></label>)}<small>{auditText('audit.FirstInterview.youCanChooseSeveralEnginesOr')}</small></fieldset>}
      {draft.step === 4 && !info?.brainRoot && <section><h4>{auditText('audit.FirstInterview.yourWorkMemory')}</h4><p>{auditText('audit.FirstInterview.onConfirmationWeWillCreateA')}</p>{candidates.map(root => <button key={root} type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await sb.invoke('settings:set', { brainRoot: root }); await refreshInfo(); } catch { setError(auditText('cmp.interview.folderNotLinked')); } finally { setBusy(false); } }}>{auditText('audit.FirstInterview.useTheOneFoundAt')}{' '}{root}</button>)}</section>}
      {draft.step===4&&<CreateMemory onBusy={setBusy} initial={answers}/>}
      {draft.step === 4 && Object.values(problems).map(message => <p key={message} role="alert">{message}{' '}{auditText('audit.FirstInterview.goBackToCorrectIt')}</p>)}
      {draft.step === 4 && <p>{auditText('audit.FirstInterview.onConfirmationYourNameRoleLanguage')}</p>}
      {error && <p role="alert">{error}</p>}<small role="status">{busy ? auditText('auditExpression.FirstInterview.text51') : saved ? auditText('auditExpression.FirstInterview.text52') : auditText('auditExpression.FirstInterview.text53')}</small>
    </fieldset></div>
    <div className="modal-foot"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('skipped')}>{auditText('audit.FirstInterview.skipForNow')}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('draft')}>{auditText('audit.FirstInterview.saveAndResumeLater')}</button><span className="sp" />{draft.step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => change({ step: draft.step - 1 })}>{auditText('audit.FirstInterview.back')}</button>}{draft.step < 4 ? <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={next}>{auditText('audit.FirstInterview.continue')}</button> : <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={() => void saveAndClose('completed')} data-testid="setup-complete">{auditText('audit.FirstInterview.confirmMyWorkspace')}</button>}</div>
  </Modal>;
}
