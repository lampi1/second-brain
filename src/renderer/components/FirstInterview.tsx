// First-run setup: ONE modal wizard from start to finish (owner, 2026-10-18: "si rimanga sempre sulla stessa modale"),
// simple enough for non-technical people (issues #164, #165, ADR 0119). Six steps, each with its own title: language
// (big buttons, the system language preselected; a click switches the UI at once: SetupLanguage.tsx), your AI (one
// recommended, the others under «Altre IA», sign-in in place: SetupEngines.tsx), tools (a tile catalog, each tile
// creating the account and the MCP server together and testing them at once: ToolCatalog.tsx), about you (optional),
// folders (always a NEW brain in the default place, the projects folder asked only when the app cannot find it:
// SetupFolders.tsx) and ready (a summary; goals, work areas and team are asked later in the first guide chat,
// modules/ai-first/model.ts guidePrompt, started on confirm when an AI is chosen). Nothing inside it closes it or
// navigates away: a sign-in opens in its own window and the step waits; the folder picker is the native dialog. A
// language switch saves the draft first (the tree re-mounts in the new language, LangRoot.tsx, and the wizard resumes
// on the same step with its answers). It ends only through an explicit button: "Più tardi" (or Esc: answers saved as
// a draft, it reopens on the same step), "Salta per ora", or the confirmation; a click on the backdrop does nothing.
// Only preference fields are saved (setup:save); on confirm the me.md answers go through 'profile:save'
// (lib/agent-setup.ts wizardProfile decides what, the chat language included), a projects folder the app found by
// itself is saved (projectsRoot), the chosen AI becomes the roles' engine (orchestratorChats.harness, issue #96) and
// the brain is created, in the chosen language, only when none is connected. Step flow: lib/setup-wizard.ts.
// Mounted by App.tsx (FirstInterviewGate, modal 'setup'); opened by itself on a new or unfinished run, and from
// Settings, the agent studio and the new-chat dialog.
import { lang, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { SetupDraft, SetupProfile, SetupState } from '@shared/agents';
import type { OwnerProfile } from '@shared/profile';
import type { Harness, Lang, ProjectsFolderInfo } from '@shared/contract';
import type { CreateBrainRequest } from '@shared/brain-create';
import { PROFILE_LIMITS } from '@shared/profile';
import { answerPatch, answerProblems, knownName, profileDraft, wizardLocked, wizardProfile } from '../lib/agent-setup';
import { LANG_NATIVE, LANG_PROFILE, LAST_STEP, SETUP_STEPS, canAdvance, canJump, clampStep, exitStatus, openingDraft, stepId, stepProblems, withEngine } from '../lib/setup-wizard';
import type { SetupExit, SetupStepId } from '../lib/setup-wizard';
import { profileError } from '../lib/profile';
import { refreshSetup, saveSetup, useAgents } from '../store/agents';
import { closeModal, openModal, toast, ui } from '../store/ui';
import { createChat, dispatch, refreshInfo, useApp } from '../store/store';
import { focusChat } from '../actions';
import { guidePrompt } from '../../modules/ai-first/model';
import { sb } from '../sb';
import { SetupEngines } from './SetupEngines';
import { SetupFolders } from './SetupFolders';
import { SetupLanguage } from './SetupLanguage';
import { ToolCatalog } from './ToolCatalog';
import { IconArrowLeft, IconArrowRight, IconCheck, IconShield, IconSparkle } from './Icons';
import { Modal } from './ui';
import '../styles/setup-wizard.css';

const ENGINE_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };

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

function SetupWizard({ initial }: { initial: SetupState }) {
  const enabledEngines = useApp(s => s.settings?.engineOn), savedLanguage = useApp(s => s.settings?.language);
  const [draft, setDraft] = useState<SetupDraft>(() => openingDraft(initial, enabledEngines));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const [guide, setGuide] = useState(true);
  const saving = useRef(false), terminal = useRef(false);
  const info = useApp(s => s.info), uiLang = lang();
  // the projects folder, saved or found by main by itself (undefined = still looking, null = the look failed: it asks)
  const [projects, setProjects] = useState<ProjectsFolderInfo | null | undefined>(undefined);
  useEffect(() => { void sb.invoke('app:projectsFolder', undefined).then(setProjects, () => setProjects(null)); }, [info?.brainRoot]);
  const change = (patch: Partial<SetupDraft>) => { setDraft(d => ({ ...d, ...patch })); setSaved(false); };
  // what me.md says now (re-read when the brain folder changes): shown where the owner gave no answer in this run
  const [current, setCurrent] = useState<OwnerProfile | null>(null);
  useEffect(() => {
    let live = true;
    void sb.invoke('profile:get', undefined).then(r => { if (live) setCurrent(r.ok ? r.profile : null); }, () => { if (live) setCurrent(null); });
    return () => { live = false; };
  }, [info?.brainRoot]);
  const answers = profileDraft(draft, current), inMeMd = profileDraft({ ...draft, profile: undefined }, current), problems = answerProblems(draft, current), locked = wizardLocked(current);
  const answer = (patch: Partial<SetupProfile>) => change({ profile: answerPatch(draft, patch) });
  const step = clampStep(draft.step), id = stepId(step), blocked = !canAdvance(step, problems);
  const lockedNote = <small>{t('audit.FirstInterview.writtenManuallyInMeMdChange')}</small>;
  const problem = (key: keyof typeof problems) => problems[key] && <small role="alert" className="sw-field-error">{problems[key]}</small>;
  // autosave: every answer lands in the draft half a second later, so leaving in any way keeps it
  useEffect(() => {
    if (terminal.current || busy) return;
    let live = true;
    const timer = setTimeout(() => { void saveSetup(draft, 'draft').then(() => { if (live) setSaved(true); }, () => { if (live) setError(t('cmp.interview.draftNotSaved')); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, busy]);
  // each step announces itself: focus moves to its title, on opening too (the Modal then leaves the focus where it is)
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  /** the language step's choice (a click, or Continua on the preselected one): the chat language in me.md and the
   *  app setting. The draft is saved BEFORE the setting changes: the switch re-mounts the tree in the new language and
   *  the wizard resumes from the saved draft, on `to`, with every answer. */
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

  const exit = async (how: SetupExit) => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    let guideChat: string | null = null;
    try {
      let last: SetupDraft = draft;
      if (how === 'finish') {
        const latest = await sb.invoke('app:info', undefined), primary = draft.engines?.[0] as Harness | undefined;
        // the folder found by itself becomes the owner's (before a new brain is created: it points there)
        if (projects && !projects.saved && projects.detected) await sb.invoke('settings:set', { projectsRoot: projects.detected.path });
        if (!latest.brainRoot) {
          const created = await sb.invoke('app:createBrain', { language: lang(), harness: (primary ?? 'none') as CreateBrainRequest['harness'] });
          if (!created?.connected) throw new Error('brain not connected');
          await refreshInfo();
        }
        // the engines chosen in step 2; the first one is the one the roles start on (issue #96: catalog.ts defaultEngine)
        if (draft.engines) await sb.invoke('settings:set', { engineOn: Object.fromEntries(['claude', 'codex', 'cursor'].map(e => [e, draft.engines!.includes(e)])), ...(primary ? { orchestratorChats: { harness: primary } } : {}) });
        if (await saveProfile(draft)) {
          if (!latest.brainRoot) throw new Error('profile not saved');
          toast(t('cmp.interview.profileNotWritable'), 'info');
        }
        // the first guide chat asks goals, work areas and team, one question at a time (they are not asked here)
        if (primary && guide) {
          const root = (await sb.invoke('app:info', undefined)).brainRoot;
          if (root) {
            await sb.invoke('engines:trust', { engine: primary }).catch(() => {});
            const chat = await createChat({ harness: primary, cwd: root, title: t('setup.done.guideTitle'), prompt: guidePrompt(lang()), permissionMode: 'default' });
            if (chat) { guideChat = chat.id; last = { ...draft, guide: { stage: 'guided', engine: primary as 'claude' | 'codex' | 'cursor', chatId: chat.id } }; }
          }
        }
      }
      await saveSetup(last, exitStatus(how));
      if (ui.get().modal === 'setup') closeModal();
      if (guideChat) focusChat(guideChat);
    }
    catch { terminal.current = false; setError(t('cmp.interview.saveFailed')); }
    finally { saving.current = false; setBusy(false); }
  };
  const goTo = (target: number) => {
    const to = clampStep(target);
    if (busy || !canJump(step, to, problems)) return;
    if (id === 'language' && to > step) { void pickLanguage(uiLang, to); return; }
    change({ step: to });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (busy || blocked) return; if (step < LAST_STEP) goTo(step + 1); else void exit('finish'); };
  const pickProjects = async () => {
    setBusy(true); setError(null);
    try { const dir = await sb.invoke('app:pickProjects', undefined); if (dir) setProjects(p => ({ newMemoryIn: p?.newMemoryIn ?? '', detected: p?.detected ?? null, saved: dir })); }
    catch { setError(t('cmp.interview.pickFailed')); }
    finally { setBusy(false); }
  };
  const brainReady = !!info?.brainRoot && !info.brainProblem;
  const primary = draft.engines?.[0];
  const stepLabel = (s: SetupStepId) => t(`setup.step.${s}`);
  const row = (label: string, value: ReactNode, at: SetupStepId) => <div className="sw-summary-row"><dt>{label}</dt><dd>{value}</dd><button type="button" className="sw-edit" aria-label={t('setup.done.editAria', { step: stepLabel(at) })} onClick={() => goTo(SETUP_STEPS.indexOf(at))}>{t('setup.done.edit')}</button></div>;

  return <Modal onClose={() => void exit('later')} backdropCloses={false} label={t('audit.FirstInterview.setUpYourWorkspace')} testid="first-interview" className="modal-setup">
    <div className="sw" data-step={id}>
      <aside className="sw-rail">
        <div className="sw-brand"><span className="sw-eyebrow">{t('setup.eyebrow')}</span><p className="sw-brand-title">{t('setup.title')}</p></div>
        <ol className="sw-steps" aria-label={t('setup.steps')}>{SETUP_STEPS.map((s, i) => {
          const done = i < step;
          return <li key={s}><button type="button" className={`sw-step${done ? ' is-done' : ''}${i === step ? ' is-current' : ''}`} aria-current={i === step ? 'step' : undefined} disabled={busy || !canJump(step, i, problems)} onClick={() => goTo(i)} data-testid={`setup-step-${s}`}>
            <span className="sw-step-dot" aria-hidden="true">{done ? <IconCheck size={12}/> : i + 1}</span><span className="sw-step-label">{stepLabel(s)}</span>
          </button></li>;
        })}</ol>
        <p className="sw-rail-note"><IconShield size={14}/><span>{t('setup.privacy')}</span></p>
      </aside>
      <section className="sw-main">
        <header className="sw-head">
          <div className="sw-head-text">
            <span className="sw-count">{t('setup.stepOf', { n: step + 1, total: SETUP_STEPS.length })}</span>
            <h2 ref={heading} tabIndex={-1} id="sw-title">{t(`setup.head.${id}`)}</h2>
            <p>{t(`setup.lead.${id}`)}</p>
          </div>
          <button type="button" className="btn btn-m btn-ghost sw-later" disabled={busy} data-tip={t('setup.laterTip')} onClick={() => void exit('later')} data-testid="setup-later">{t('setup.later')}</button>
        </header>
        <form className="sw-body" onSubmit={submit} aria-labelledby="sw-title" noValidate>
          <fieldset disabled={busy} className="sw-fields">
            {id === 'language' && <SetupLanguage current={uiLang} system={info?.systemLang} busy={busy} onPick={l => void pickLanguage(l, step)}/>}
            {id === 'ai' && <SetupEngines engines={draft.engines ?? []} onUse={(engine, on) => { setDraft(d => ({ ...d, engines: withEngine(d.engines, engine, on) })); setSaved(false); }}/>}
            {id === 'tools' && <div className="sw-stack" data-testid="setup-tools"><ToolCatalog onConnected={names => { const tools = names.join(', '); setDraft(d => d.tools === tools ? d : { ...d, tools }); }}/></div>}
            {id === 'you' && <div className="sw-stack">
              {knownName(current)
                ? <p className="sw-known" data-testid="setup-known-name">{t('audit.FirstInterview.hello')}{' '}<b>{current!.name}</b>{t('audit.FirstInterview.letSCompleteTheRest')}</p>
                : <label className="field"><span>{t('audit.FirstInterview.whatIsYourName')}</span><input value={answers.name} maxLength={PROFILE_LIMITS.name} onChange={e => answer({ name: e.target.value })} disabled={locked.has('name')} data-testid="setup-name" aria-invalid={!!problems.name}/>{locked.has('name') ? lockedNote : <small>{t('audit.FirstInterview.agentsWillCallYouThis')}</small>}{problem('name')}</label>}
              <label className="field"><span>{t('audit.FirstInterview.yourRoleInOneLine')}</span><input value={answers.role} maxLength={PROFILE_LIMITS.role} onChange={e => answer({ role: e.target.value })} disabled={locked.has('role')} placeholder={t('audit.FirstInterview.forExampleBackendDeveloperProductManager')} data-testid="setup-role" aria-invalid={!!problems.role}/>{locked.has('role') && lockedNote}{problem('role')}</label>
              <fieldset className="sw-choices"><legend>{t('audit.FirstInterview.howDoYouUsuallyWork')}</legend>{([
                ['employee', t('cmp.interview.work.employee'), t('cmp.interview.work.employeeHint')], ['independent', t('cmp.interview.work.independent'), t('cmp.interview.work.independentHint')], ['other', t('cmp.interview.work.other'), t('cmp.interview.work.otherHint')], ['', t('cmp.interview.work.later'), t('cmp.interview.work.laterHint')],
              ] as const).map(([work, name, hint]) => <label key={work} className="sw-choice"><input type="radio" name="work" checked={draft.work === work} onChange={() => change({ work })}/><span><b>{name}</b><small>{hint}</small></span></label>)}</fieldset>
            </div>}
            {id === 'folders' && <SetupFolders info={info} projects={projects} onPickProjects={() => void pickProjects()}/>}
            {id === 'done' && <div className="sw-stack">
              <dl className="sw-summary">
                {row(t('setup.done.language'), LANG_NATIVE[uiLang].name, 'language')}
                {row(t('setup.done.engines'), (draft.engines ?? []).map(e => ENGINE_NAMES[e] ?? e).join(', ') || t('setup.done.noEngines'), 'ai')}
                {row(t('setup.done.tools'), draft.tools || t('setup.done.toolsNone'), 'tools')}
                {row(t('audit.FirstInterview.name'), knownName(current) ? current!.name : answers.name.trim() || t('cmp.interview.toBeGiven'), 'you')}
                {row(t('audit.FirstInterview.role'), answers.role.trim() || inMeMd.role || t('auditExpression.FirstInterview.text46'), 'you')}
                {row(t('audit.FirstInterview.context'), draft.work === 'employee' ? t('auditExpression.FirstInterview.text43') : draft.work === 'independent' ? t('auditExpression.FirstInterview.text44') : draft.work === 'other' ? t('auditExpression.FirstInterview.text45') : t('auditExpression.FirstInterview.text46'), 'you')}
                {row(t('setup.memory.kicker'), brainReady ? <code>{info!.brainRoot}</code> : t('setup.done.memoryNew'), 'folders')}
                {row(t('setup.done.projects'), projects?.saved || projects?.detected?.path ? <code>{projects.saved ?? projects.detected!.path}</code> : t('setup.done.projectsNone'), 'folders')}
              </dl>
              {stepProblems(step, problems).map(message => <p key={message} role="alert" className="sw-field-error">{message}{' '}{t('audit.FirstInterview.goBackToCorrectIt')}</p>)}
              {primary
                ? <label className="sw-guide" data-testid="setup-guide-choice"><input type="checkbox" checked={guide} onChange={e => setGuide(e.target.checked)} data-testid="setup-guide"/><span className="sw-guide-icon" aria-hidden="true"><IconSparkle size={16}/></span><span><b>{t('setup.done.guide')}</b><small>{t('setup.done.guideHint', { name: ENGINE_NAMES[primary] ?? primary })}</small></span></label>
                : <p className="sw-note"><IconSparkle size={15}/><span>{t('setup.done.guideNoAi')}</span></p>}
              <p className="sw-note"><IconShield size={15}/><span>{t('audit.FirstInterview.setupDoesNotChangePermissionsOr')}</span></p>
            </div>}
            {error && <p role="alert" className="sw-error">{error}</p>}
          </fieldset>
          {/* Enter in a one-line answer moves on, like Continua */}
          <button type="submit" hidden tabIndex={-1}/>
        </form>
        <footer className="sw-foot">
          <button type="button" className="btn btn-m btn-subtle" disabled={busy} onClick={() => void exit('skip')}>{t('audit.FirstInterview.skipForNow')}</button>
          <small className="sw-saved" role="status">{busy ? t('auditExpression.FirstInterview.text51') : saved ? t('auditExpression.FirstInterview.text52') : ''}</small>
          <span className="sp"/>
          {step > 0 && <button type="button" className="btn btn-m btn-ghost" disabled={busy} onClick={() => goTo(step - 1)}><IconArrowLeft size={14}/>{t('audit.FirstInterview.back')}</button>}
          {step < LAST_STEP
            ? <button type="button" className="btn btn-m btn-primary" disabled={busy || blocked} onClick={() => goTo(step + 1)} data-testid="setup-next">{t('audit.FirstInterview.continue')}<IconArrowRight size={14}/></button>
            : <button type="button" className="btn btn-m btn-primary" disabled={busy || blocked} onClick={() => void exit('finish')} data-testid="setup-complete"><IconCheck size={14}/>{t('audit.FirstInterview.confirmMyWorkspace')}</button>}
        </footer>
      </section>
    </div>
  </Modal>;
}
