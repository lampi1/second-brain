// First-run setup: ONE modal wizard from start to finish (owner, 2026-10-18: "si rimanga sempre sulla stessa modale").
// Seven steps, each with its own title: folders (the memory, new by default, and the projects folder, asked only when
// the app cannot find it: SetupFolders.tsx), your AI (sign-in in place: SetupEngines.tsx), tools (connectors, each
// ending in a real check: SetupConnectors.tsx), about you, your work, starting agents, summary. Nothing inside it closes it or navigates away: a sign-in opens in its
// own window and the step waits with a "Verifica"; the folder picker is the native dialog. It ends only through an
// explicit button: "Più tardi" (or Esc: answers saved as a draft, it reopens on the same step), "Salta per ora", or the
// confirmation; a click on the backdrop does nothing. Offline, resumable, optional and private: only preference fields are
// saved (setup:save), the me.md answers through 'profile:save' on confirm (lib/agent-setup.ts wizardProfile decides
// what), a projects folder the app found by itself is saved (projectsRoot) on confirm, and the brain is created on
// confirm only when none is connected. Step flow: lib/setup-wizard.ts.
// Mounted by App.tsx (FirstInterviewGate, modal 'setup'); opened by itself on a new or unfinished run, and from
// Settings, the agent studio and the new-chat dialog.
import { t } from '../i18n';
import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AgentCatalog, SetupDraft, SetupProfile, SetupState } from '@shared/agents';
import type { OwnerProfile } from '@shared/profile';
import type { ProjectsFolderInfo } from '@shared/contract';
import type { CreateBrainRequest } from '@shared/brain-create';
import { PROFILE_LIMITS } from '@shared/profile';
import { answerPatch, answerProblems, customReplyStyle, knownName, profileDraft, wizardLocked, wizardProfile } from '../lib/agent-setup';
import { LAST_STEP, SETUP_STEPS, canAdvance, canJump, clampStep, exitStatus, openingDraft, stepId, stepProblems, withEngine } from '../lib/setup-wizard';
import type { SetupExit, SetupStepId } from '../lib/setup-wizard';
import { profileError, workAreas } from '../lib/profile';
import { refreshSetup, saveSetup, useAgents } from '../store/agents';
import { closeModal, openModal, toast, ui } from '../store/ui';
import { refreshInfo, useApp } from '../store/store';
import { sb } from '../sb';
import { AgentAvatar } from './AgentAvatar';
import { SetupEngines } from './SetupEngines';
import { SetupFolders } from './SetupFolders';
import { SetupConnectors } from './SetupConnectors';
import { IconArrowLeft, IconArrowRight, IconCheck, IconInfo, IconShield } from './Icons';
import { Modal } from './ui';
import '../styles/setup-wizard.css';

const ENGINE_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };

export function FirstInterviewGate() {
  const { setup, catalog, error } = useAgents(), modal = ui.use(s => s.modal);
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
  return <SetupWizard initial={setup} catalog={catalog}/>;
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

function SetupWizard({ initial, catalog }: { initial: SetupState; catalog: AgentCatalog | null }) {
  const enabledEngines = useApp(s => s.settings?.engineOn);
  const [draft, setDraft] = useState<SetupDraft>(() => openingDraft(initial, enabledEngines));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const saving = useRef(false), terminal = useRef(false);
  const info = useApp(s => s.info);
  // the projects folder, saved or found by main by itself (undefined = still looking, null = the look failed: it asks)
  const [projects, setProjects] = useState<ProjectsFolderInfo | null | undefined>(undefined);
  useEffect(() => { void sb.invoke('app:projectsFolder', undefined).then(setProjects, () => setProjects(null)); }, [info?.brainRoot]);
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
  const exit = async (how: SetupExit) => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try {
      if (how === 'finish') {
        const latest = await sb.invoke('app:info', undefined);
        // the folder found by itself becomes the owner's (before a new memory is created: it points there)
        if (projects && !projects.saved && projects.detected) await sb.invoke('settings:set', { projectsRoot: projects.detected.path });
        if (!latest.brainRoot) {
          const created = await sb.invoke('app:createBrain', { language: /^en/i.test(answers.language) ? 'en' : 'it', harness: (draft.engines?.[0] ?? 'none') as CreateBrainRequest['harness'] });
          if (!created?.connected) throw new Error('memory not connected');
          await refreshInfo();
        }
        if (draft.engines) await sb.invoke('settings:set', { engineOn: Object.fromEntries(['claude', 'codex', 'cursor'].map(e => [e, draft.engines!.includes(e)])) });
        if (await saveProfile(draft)) {
          if (!latest.brainRoot) throw new Error('profile not saved');
          toast(t('cmp.interview.profileNotWritable'), 'info');
        }
      }
      await saveSetup(draft, exitStatus(how));
      if (ui.get().modal === 'setup') closeModal();
    }
    catch { terminal.current = false; setError(t('cmp.interview.saveFailed')); }
    finally { saving.current = false; setBusy(false); }
  };
  const goTo = (target: number) => {
    const to = clampStep(target);
    if (busy || !canJump(step, to, problems)) return;
    change({ step: to });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (busy || blocked) return; if (step < LAST_STEP) goTo(step + 1); else void exit('finish'); };
  const pickBrain = async () => {
    setBusy(true); setError(null);
    try { await sb.invoke('app:pickBrain', undefined); await refreshInfo(); }
    catch { setError(t('cmp.interview.pickFailed')); }
    finally { setBusy(false); }
  };
  const pickProjects = async () => {
    setBusy(true); setError(null);
    try { const dir = await sb.invoke('app:pickProjects', undefined); if (dir) setProjects(p => ({ newMemoryIn: p?.newMemoryIn ?? '', detected: p?.detected ?? null, saved: dir })); }
    catch { setError(t('cmp.interview.pickFailed')); }
    finally { setBusy(false); }
  };
  const team = catalog?.profiles.filter(p => p.scope === 'role') ?? [];
  const brainReady = !!info?.brainRoot && !info.brainProblem;
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
            {id === 'memory' && <SetupFolders info={info} projects={projects} onPickBrain={() => void pickBrain()} onPickProjects={() => void pickProjects()}/>}
            {id === 'ai' && <SetupEngines engines={draft.engines ?? []} onUse={(engine, on) => { setDraft(d => ({ ...d, engines: withEngine(d.engines, engine, on) })); setSaved(false); }}/>}
            {id === 'tools' && <div className="sw-stack">
              <SetupConnectors/>
              <label className="field"><span>{t('audit.FirstInterview.whichToolsAndMaterialsDoYou')}</span><textarea rows={3} maxLength={2000} value={draft.tools} onChange={e => change({ tools: e.target.value })} placeholder={t('audit.FirstInterview.documentsSpreadsheetsAppsSitesOrFolders')} data-testid="setup-tools"/><small>{t('audit.FirstInterview.optionalNoAccountsAreConnectedAnd')}</small></label>
            </div>}
            {id === 'you' && <div className="sw-stack">
              {knownName(current)
                ? <p className="sw-known" data-testid="setup-known-name">{t('audit.FirstInterview.hello')}{' '}<b>{current!.name}</b>{t('audit.FirstInterview.letSCompleteTheRest')}</p>
                : <label className="field"><span>{t('audit.FirstInterview.whatIsYourName')}</span><input value={answers.name} maxLength={PROFILE_LIMITS.name} onChange={e => answer({ name: e.target.value })} disabled={locked.has('name')} data-testid="setup-name" aria-invalid={!!problems.name}/>{locked.has('name') ? lockedNote : <small>{t('audit.FirstInterview.agentsWillCallYouThis')}</small>}{problem('name')}</label>}
              <div className="sw-grid2">
                <label className="field"><span>{t('audit.FirstInterview.yourRoleInOneLine')}</span><input value={answers.role} maxLength={PROFILE_LIMITS.role} onChange={e => answer({ role: e.target.value })} disabled={locked.has('role')} placeholder={t('audit.FirstInterview.forExampleBackendDeveloperProductManager')} data-testid="setup-role" aria-invalid={!!problems.role}/>{locked.has('role') && lockedNote}{problem('role')}</label>
                <label className="field"><span>{t('audit.FirstInterview.chatLanguage')}</span><input value={answers.language} maxLength={PROFILE_LIMITS.language} list="setup-languages" onChange={e => answer({ language: e.target.value })} disabled={locked.has('language')} data-testid="setup-language" aria-invalid={!!problems.language}/><datalist id="setup-languages"><option value="italiano"/><option value="English"/></datalist>{locked.has('language') && lockedNote}{problem('language')}</label>
              </div>
              <fieldset className="sw-choices"><legend>{t('audit.FirstInterview.howDoYouUsuallyWork')}</legend>{([
                ['employee', t('cmp.interview.work.employee'), t('cmp.interview.work.employeeHint')], ['independent', t('cmp.interview.work.independent'), t('cmp.interview.work.independentHint')], ['other', t('cmp.interview.work.other'), t('cmp.interview.work.otherHint')], ['', t('cmp.interview.work.later'), t('cmp.interview.work.laterHint')],
              ] as const).map(([work, name, hint]) => <label key={work} className="sw-choice"><input type="radio" name="work" checked={draft.work === work} onChange={() => change({ work })}/><span><b>{name}</b><small>{hint}</small></span></label>)}</fieldset>
            </div>}
            {id === 'work' && <div className="sw-stack">
              <label className="field"><span>{t('audit.FirstInterview.yourWorkAreas')}</span><textarea rows={4} value={answers.areas} maxLength={2000} onChange={e => answer({ areas: e.target.value })} disabled={locked.has('mainWork')} placeholder={t('auditExpression.FirstInterview.text40')} data-testid="setup-areas" aria-invalid={!!problems.areas}/>{locked.has('mainWork') ? lockedNote : <small>{t('audit.FirstInterview.projectsClientsOrTopicsYouFollow')}</small>}{problem('areas')}</label>
              <label className="field"><span>{t('audit.FirstInterview.whatWouldHelpYouOverThe')}</span><textarea rows={3} maxLength={2000} value={draft.goals} onChange={e => change({ goals: e.target.value })} placeholder={draft.work === 'independent' ? t('auditExpression.FirstInterview.text41') : t('auditExpression.FirstInterview.text42')} data-testid="setup-goals"/><small>{t('audit.FirstInterview.describeUsefulOutcomesDetailsCanCome')}</small></label>
              <label className="field"><span>{t('audit.FirstInterview.howDoYouPreferResponses')}</span><Select value={answers.style} disabled={fixedStyle} onChange={e => { const style = e.target.value === 'concise' ? 'concise' : e.target.value === 'detailed' ? 'detailed' : 'balanced'; change({ style, profile: answerPatch(draft, { style }) }); }} data-testid="setup-style"><option value="balanced">{t('audit.FirstInterview.clearWithUsefulDetail')}</option><option value="concise">{t('audit.FirstInterview.shortAndDirect')}</option><option value="detailed">{t('audit.FirstInterview.thoroughAndExplained')}</option></Select>{fixedStyle && <small>{t('audit.FirstInterview.youAlreadyHaveYourOwnStyle')}</small>}</label>
            </div>}
            {id === 'agents' && <div className="sw-stack">
              {catalog?.profiles.length
                ? <><p className="sw-lead">{t('setup.team.lead')}</p><ul className="sw-agent-grid" data-testid="setup-team">{team.map(p => <li key={p.id} className="sw-choice sw-agent"><AgentAvatar avatar={p.avatar} name={p.name} size={40}/><span><b>{p.name}</b><small>{p.purpose}</small></span></li>)}</ul></>
                : <div className="sw-card" role="status"><span className="sw-card-icon"><IconInfo size={16}/></span><div className="sw-card-text"><p>{t('audit.FirstInterview.theCatalogueIsNotAvailableYet')}</p></div></div>}
            </div>}
            {id === 'done' && <div className="sw-stack">
              <dl className="sw-summary">
                {row(t('setup.memory.kicker'), brainReady ? <code>{info!.brainRoot}</code> : t('setup.done.memoryNew'), 'memory')}
                {row(t('setup.done.projects'), projects?.saved || projects?.detected?.path ? <code>{projects.saved ?? projects.detected!.path}</code> : t('setup.done.projectsNone'), 'memory')}
                {row(t('setup.done.engines'), (draft.engines ?? []).map(e => ENGINE_NAMES[e] ?? e).join(', ') || t('setup.done.noEngines'), 'ai')}
                {row(t('audit.FirstInterview.toolsAndMaterials'), draft.tools || t('cmp.interview.chooseWhenNeeded'), 'tools')}
                {row(t('audit.FirstInterview.name'), knownName(current) ? current!.name : answers.name.trim() || t('cmp.interview.toBeGiven'), 'you')}
                {row(t('audit.FirstInterview.role'), answers.role.trim() || inMeMd.role || t('auditExpression.FirstInterview.text46'), 'you')}
                {row(t('audit.FirstInterview.chatLanguage'), answers.language.trim() || inMeMd.language || t('auditExpression.FirstInterview.text46'), 'you')}
                {row(t('audit.FirstInterview.context'), draft.work === 'employee' ? t('auditExpression.FirstInterview.text43') : draft.work === 'independent' ? t('auditExpression.FirstInterview.text44') : draft.work === 'other' ? t('auditExpression.FirstInterview.text45') : t('auditExpression.FirstInterview.text46'), 'you')}
                {row(t('audit.FirstInterview.workAreas'), (workAreas(answers.areas).length ? workAreas(answers.areas) : workAreas(inMeMd.areas)).join(', ') || t('auditExpression.FirstInterview.text46'), 'work')}
                {row(t('audit.FirstInterview.goals'), draft.goals || t('cmp.interview.toDefine'), 'work')}
                {row(t('setup.team.title'), team.map(p => p.name).join(', ') || t('cmp.interview.chooseLater'), 'agents')}
              </dl>
              {stepProblems(step, problems).map(message => <p key={message} role="alert" className="sw-field-error">{message}{' '}{t('audit.FirstInterview.goBackToCorrectIt')}</p>)}
              <p className="sw-note"><IconInfo size={15}/><span>{t('audit.FirstInterview.onConfirmationYourNameRoleLanguage')}</span></p>
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
            ? <button type="button" className="btn btn-m btn-primary" disabled={busy || blocked} onClick={() => goTo(step + 1)}>{t('audit.FirstInterview.continue')}<IconArrowRight size={14}/></button>
            : <button type="button" className="btn btn-m btn-primary" disabled={busy || blocked} onClick={() => void exit('finish')} data-testid="setup-complete"><IconCheck size={14}/>{t('audit.FirstInterview.confirmMyWorkspace')}</button>}
        </footer>
      </section>
    </div>
  </Modal>;
}
