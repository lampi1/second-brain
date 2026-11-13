// First-run setup: ONE modal from start to finish (owner, 2026-10-18: "si rimanga sempre sulla stessa modale"), in three
// moments (ADR 0279, the 1.0 onboarding; it replaces ADR 0119's six steps): (1) welcome: the language (SetupLanguage.tsx:
// a click switches the UI at once) and the name, on one screen; (2) your AI: the engines found on this computer, one
// click, sign-in in its own window while the setup waits in place (SetupEngines.tsx); (3) the first real request: the
// workspace is prepared with no questions (a NEW empty brain in the default place when none is connected, the projects
// folder the app found by itself, the chosen AI as the roles' engine, issue #96, the name and chat language in me.md)
// and the Orchestrator starts; its real chat fills the right half (SetupStage.tsx), where a fixed preview stood until
// then. Tools, folders, role, goals and team are NOT asked here: the Orchestrator proposes them the first time they
// are needed (Settings → Connettori and Il mio spazio stay). Nothing inside closes it or navigates away. It ends only
// through an explicit button: «Più tardi» (or Esc: answers saved as a draft, it reopens where it was), «Salta per
// ora», «Continua senza AI» or «Entra nell'app»; a click on the backdrop does nothing. Only preference fields are
// saved (setup:save); the me.md answers go through 'profile:save' (lib/agent-setup.ts wizardProfile decides what).
// Flow: lib/setup-wizard.ts. Mounted by App.tsx (FirstInterviewGate, modal 'setup'); opened by itself on a new or
// unfinished run, and from Settings, the agent studio and the new-chat dialog.
import { lang, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SetupDraft, SetupProfile, SetupState } from '@shared/agents';
import type { OwnerProfile } from '@shared/profile';
import type { Harness, Lang } from '@shared/contract';
import type { CreateBrainRequest } from '@shared/brain-create';
import { PROFILE_LIMITS } from '@shared/profile';
import { answerPatch, answerProblems, knownName, profileDraft, wizardLocked, wizardProfile } from '../lib/agent-setup';
import { ENGINE_NAMES, LANG_PROFILE, SETUP_ENGINES, SETUP_STEPS, canAdvance, clampStep, exitStatus, openingDraft, stepId } from '../lib/setup-wizard';
import type { SetupEngineId, SetupExit } from '../lib/setup-wizard';
import { orchestratorIdOf } from '../lib/orchestrator-route';
import { profileError } from '../lib/profile';
import { refreshSetup, saveSetup, useAgents } from '../store/agents';
import { callQuestions, closeModal, openModal, requestFocus, toast, ui } from '../store/ui';
import { dispatch, ensureOrchestrator, refreshInfo, useApp } from '../store/store';
import { sb } from '../sb';
import { SetupEngines } from './SetupEngines';
import { SetupLanguage } from './SetupLanguage';
import { StageLive, StagePreview } from './SetupStage';
import { IconArrowLeft, IconArrowRight, IconSpinner } from './Icons';
import { Modal } from './ui';
import '../styles/setup-wizard.css';

const engineLabel = (id: string | undefined): string => (id && ENGINE_NAMES[id as SetupEngineId]) || id || '';
const IDEAS = ['team', 'week', 'repo'] as const;

export function FirstInterviewGate() {
  const { setup, error } = useAgents(), modal = ui.use(s => s.modal);
  const offered = useRef(false);
  useEffect(() => {
    if (modal === 'setup') offered.current = true;
    if (!offered.current && setup && (setup.status === 'new' || setup.status === 'draft') && !modal) { offered.current = true; openModal('setup'); }
  }, [setup?.status, modal]);
  if (modal !== 'setup') return null;
  if (!setup) return <Modal onClose={closeModal} label={t('audit.FirstInterview.setUpYourWorkspace')} testid="first-interview" className="modal-setup modal-setup-wait">
    <div className="sw-loading"><p role="status">{error ?? t('auditExpression.FirstInterview.text39')}</p>
      <div className="sw-loading-actions">{error && <button type="button" className="btn btn-m btn-primary" onClick={() => void refreshSetup()}>{t('audit.FirstInterview.retry')}</button>}<button type="button" className="btn btn-m btn-ghost" onClick={closeModal}>{t('audit.FirstInterview.close')}</button></div></div>
  </Modal>;
  return <SetupWizard initial={setup}/>;
}

/** writes the setup's answers into me.md; a concurrent edit gets one retry on the fresh file. Returns whether it failed. */
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

/** The workspace, with no questions: the projects folder the app found by itself, a new empty brain in the default
 *  place when none is connected, the chosen engines (the first one is the roles' and the Orchestrator's), the answers
 *  in me.md. Throws when the brain cannot be created or the answers cannot be written into the new brain. */
async function prepareWorkspace(draft: SetupDraft, firstRun: boolean, keepOrchestrator: boolean): Promise<void> {
  const latest = await sb.invoke('app:info', undefined), primary = draft.engines?.[0] as Harness | undefined;
  const projects = await sb.invoke('app:projectsFolder', undefined).catch(() => null);
  if (projects && !projects.saved && projects.detected) await sb.invoke('settings:set', { projectsRoot: projects.detected.path });
  if (!latest.brainRoot) {
    // the brain template has harness notes for these three only; any other engine (OpenCode) gets a brain with none
    const harness: CreateBrainRequest['harness'] = primary === 'claude' || primary === 'codex' || primary === 'cursor' ? primary : 'none';
    const created = await sb.invoke('app:createBrain', { language: lang(), harness });
    if (!created?.connected) throw new Error('brain not connected');
    await refreshInfo();
  }
  // a first run states every engine (the ones not found go off, so no list offers them); a run repeated from Settings
  // only turns on what was chosen: it never turns off an engine the owner uses, even one signed out today
  const on = SETUP_ENGINES.filter(e => draft.engines?.includes(e) || firstRun).map(e => [e, !!draft.engines?.includes(e)] as const);
  // an Orchestrator that already runs keeps its engine («Cambia motore» in its menu changes it, with its confirm)
  const lead = primary && !keepOrchestrator ? { orchestratorChats: { harness: primary } } : {};
  if (on.length || 'orchestratorChats' in lead) dispatch({ type: 'settings', settings: await sb.invoke('settings:set', { engineOn: Object.fromEntries(on), ...lead }) });
  if (await saveProfile(draft)) {
    if (!latest.brainRoot) throw new Error('profile not saved');
    toast(t('cmp.interview.profileNotWritable'), 'info');
  }
}

function SetupWizard({ initial }: { initial: SetupState }) {
  const enabledEngines = useApp(s => s.settings?.engineOn), savedLanguage = useApp(s => s.settings?.language);
  const [draft, setDraft] = useState<SetupDraft>(() => openingDraft(initial, enabledEngines));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState('');
  // every engine has been checked: until then «Continua con …» could name one this computer no longer backs
  const [scanned, setScanned] = useState(false);
  const saving = useRef(false), terminal = useRef(false);
  const info = useApp(s => s.info), uiLang = lang();
  const orchestrator = useApp(orchestratorIdOf);
  const change = (patch: Partial<SetupDraft>) => { setDraft(d => ({ ...d, ...patch })); setSaved(false); };
  // what me.md says now (re-read when the brain folder changes): shown where the owner gave no answer in this run
  const [current, setCurrent] = useState<OwnerProfile | null>(null);
  useEffect(() => {
    let live = true;
    void sb.invoke('profile:get', undefined).then(r => { if (live) setCurrent(r.ok ? r.profile : null); }, () => { if (live) setCurrent(null); });
    return () => { live = false; };
  }, [info?.brainRoot]);
  const answers = profileDraft(draft, current), problems = answerProblems(draft, current), locked = wizardLocked(current);
  const answer = (patch: Partial<SetupProfile>) => change({ profile: answerPatch(draft, patch) });
  const step = clampStep(draft.step), id = stepId(step), blocked = !canAdvance(step, problems);
  const primary = draft.engines?.[0];
  // autosave: every answer lands in the draft half a second later, so leaving in any way keeps it
  useEffect(() => {
    if (terminal.current || busy) return;
    let live = true;
    const timer = setTimeout(() => { void saveSetup(draft, 'draft').then(() => { if (live) setSaved(true); }, () => { if (live) setError(t('cmp.interview.draftNotSaved')); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, busy]);
  // each moment announces itself: focus moves to its title, on opening too (the Modal then leaves the focus where it is)
  const heading = useRef<HTMLHeadingElement>(null), askBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  /** the language choice: the chat language in me.md and the app setting. The draft is saved BEFORE the setting
   *  changes: the switch re-mounts the tree in the new language and the setup resumes from the saved draft, on `to`,
   *  with every answer. */
  const pickLanguage = async (l: Lang, to: number) => {
    if (busy) return;
    const next: SetupDraft = { ...draft, step: clampStep(to), profile: locked.has('language') ? draft.profile : answerPatch(draft, { language: LANG_PROFILE[l] }) };
    setBusy(true); setError(null);
    try {
      await saveSetup(next, 'draft');
      setDraft(next);
      if (savedLanguage !== l) dispatch({ type: 'settings', settings: await sb.invoke('settings:set', { language: l }) });
    } catch { setError(t('cmp.interview.saveFailed')); }
    finally { setBusy(false); }
  };

  /** leaves without finishing: «Più tardi» / Esc keep the draft, «Salta per ora» stops the setup from coming back */
  const leave = async (how: Exclude<SetupExit, 'finish'>) => {
    if (saving.current || busy) return;
    if (terminal.current) { closeModal(); return; } // the workspace is ready (third moment): nothing left to save
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try { await saveSetup(draft, exitStatus(how)); if (ui.get().modal === 'setup') closeModal(); }
    catch { terminal.current = false; setError(t('cmp.interview.saveFailed')); }
    finally { saving.current = false; setBusy(false); }
  };
  /** the end of the second moment: prepares the workspace and, with an AI, starts the Orchestrator and stays here for
   *  the first request; without one the setup is done and closes */
  const finish = async (withAi: boolean) => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try {
      const mine: SetupDraft = withAi ? draft : { ...draft, engines: [] };
      await prepareWorkspace(mine, initial.status === 'new' || initial.status === 'draft', !!orchestrator);
      if (withAi && primary) {
        await sb.invoke('engines:trust', { engine: primary }).catch(() => {});
        if (!await ensureOrchestrator(primary)) throw new Error('orchestrator not started');
      }
      await saveSetup({ ...mine, step: withAi ? SETUP_STEPS.indexOf('first') : draft.step }, 'completed');
      if (withAi) setDraft(d => ({ ...d, step: SETUP_STEPS.indexOf('first') }));
      else if (ui.get().modal === 'setup') closeModal();
    }
    catch { terminal.current = false; setError(t(withAi ? 'setup.first.failed' : 'cmp.interview.saveFailed')); }
    finally { saving.current = false; setBusy(false); }
  };
  /** «Entra nell'app»: the setup is already saved; the Orchestrator keeps the conversation and takes the focus */
  const enter = (questions = false) => {
    closeModal();
    if (orchestrator) requestFocus(orchestrator);
    if (questions) callQuestions(null);
  };
  const next = () => {
    if (busy || blocked) return;
    if (id === 'welcome') void pickLanguage(uiLang, step + 1);
    else if (id === 'ai' && primary && scanned) void finish(true);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); next(); };
  const idea = (text: string) => { setAsk(text); askBox.current?.focus(); };
  const name = knownName(current) ? current!.name : answers.name.trim();

  return <Modal onClose={() => void leave('later')} backdropCloses={false} label={t('audit.FirstInterview.setUpYourWorkspace')} testid="first-interview" className="modal-setup">
    <div className="sw" data-step={id}>
      <section className="sw-main">
        <header className="sw-top">
          {step > 0 && id !== 'first' && <button type="button" className="sw-back" disabled={busy} aria-label={t('audit.FirstInterview.back')} data-tip={t('audit.FirstInterview.back')} onClick={() => change({ step: step - 1 })} data-testid="setup-back"><IconArrowLeft size={15}/></button>}
          <span className="sw-brand" aria-hidden="true">second-brain</span>
          <ol className="sw-dots" aria-label={t('setup.steps')}>{SETUP_STEPS.map((s, i) => <li key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined} data-testid={`setup-step-${s}`}><span className="sr-only">{t(`setup.step.${s}`)}</span></li>)}</ol>
          <span className="sw-count">{t('setup.stepOf', { n: step + 1, total: SETUP_STEPS.length })}</span>
        </header>
        <form className="sw-body" onSubmit={submit} aria-labelledby="sw-title" noValidate>
          <div className="sw-intro" key={id}>
            <h2 ref={heading} tabIndex={-1} id="sw-title">{id === 'welcome' && name ? t('setup.head.welcomeNamed', { name }) : t(`setup.head.${id}`)}</h2>
            <p>{t(`setup.lead.${id}`)}</p>
          </div>
          <fieldset disabled={busy} className="sw-fields" key={`f-${id}`}>
            {id === 'welcome' && <>
              <SetupLanguage current={uiLang} system={info?.systemLang} busy={busy} onPick={l => void pickLanguage(l, step)}/>
              {knownName(current)
                ? <p className="sw-known" data-testid="setup-known-name">{t('audit.FirstInterview.hello')}{' '}<b>{current!.name}</b>{t('setup.welcome.known')}</p>
                : <label className="field sw-name"><span>{t('audit.FirstInterview.whatIsYourName')}</span>
                  <input value={answers.name} maxLength={PROFILE_LIMITS.name} onChange={e => answer({ name: e.target.value })} disabled={locked.has('name')} autoComplete="given-name" data-autofocus data-testid="setup-name" aria-invalid={!!problems.name}/>
                  <small>{locked.has('name') ? t('audit.FirstInterview.writtenManuallyInMeMdChange') : t('setup.welcome.nameHint')}</small>
                  {problems.name && <small role="alert" className="sw-field-error">{problems.name}</small>}
                </label>}
            </>}
            {id === 'ai' && <SetupEngines engines={draft.engines ?? []} onChange={engines => { setDraft(d => ({ ...d, engines })); setSaved(false); }} onSettled={setScanned}/>}
            {id === 'first' && <div className="sw-ideas" data-testid="setup-ideas">
              <span className="sw-kicker">{t('setup.first.ideas')}</span>
              {IDEAS.map(k => <button key={k} type="button" className="sw-idea" onClick={() => idea(t(`setup.first.idea.${k}`))} data-testid={`setup-idea-${k}`}><span>{t(`setup.first.idea.${k}`)}</span><IconArrowRight size={14}/></button>)}
              <p className="sw-hint">{t('setup.first.later')}</p>
              {info?.brainRoot && <p className="sw-where" data-testid="setup-where">{t('setup.first.ready')}<code>{info.brainRoot}</code></p>}
            </div>}
            {error && <p role="alert" className="sw-error">{error}</p>}
          </fieldset>
          {/* Enter in the name moves on, like Continua */}
          <button type="submit" hidden tabIndex={-1}/>
        </form>
        <footer className="sw-foot">
          {id === 'first'
            ? <><span className="sp"/>
              <button type="button" className="btn btn-m btn-primary" onClick={() => enter()} data-testid="setup-enter">{t('setup.first.enter')}<IconArrowRight size={14}/></button></>
            : <>
              <button type="button" className="btn btn-m btn-subtle" disabled={busy} data-tip={t('setup.laterTip')} onClick={() => void leave('later')} data-testid="setup-later">{t('setup.later')}</button>
              <button type="button" className="btn btn-m btn-subtle" disabled={busy} onClick={() => void leave('skip')}>{t('audit.FirstInterview.skipForNow')}</button>
              <small className="sw-saved" role="status">{busy ? '' : saved ? t('auditExpression.FirstInterview.text52') : ''}</small>
              <span className="sp"/>
              {id === 'ai' && (!primary || !!error) && <button type="button" className="btn btn-m btn-ghost" disabled={busy} onClick={() => void finish(false)} data-testid="setup-no-ai">{t('setup.ai.without')}</button>}
              <button type="button" className="btn btn-m btn-primary" disabled={busy || blocked || (id === 'ai' && (!primary || !scanned))} onClick={next} data-testid="setup-next">
                {busy && id === 'ai' ? <><IconSpinner size={14}/>{t('setup.first.preparing')}</> : <>{id === 'ai' && primary && !orchestrator ? t('setup.ai.continueWith', { name: engineLabel(primary) }) : t('audit.FirstInterview.continue')}<IconArrowRight size={14}/></>}
              </button>
            </>}
        </footer>
      </section>
      {id === 'first' && orchestrator
        ? <StageLive chatId={orchestrator} text={ask} onText={setAsk} input={askBox} onAnswer={() => enter(true)}/>
        : <StagePreview name={name}/>}
    </div>
  </Modal>;
}
