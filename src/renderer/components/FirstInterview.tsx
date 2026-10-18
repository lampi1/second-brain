// First-run interview: offline, resumable, optional and private. Existing installations never get a forced wizard.
// Only preference fields are saved; permission, trust, accounts and provider calls remain separate explicit actions.
// Five steps, nothing asked twice: who you are (what me.md already knows is prefilled), your work areas, how we work
// (reply style, GitHub/Jira sign-in in place), agents, summary. Confirm writes the answers into me.md through
// 'profile:save' (lib/agent-setup.ts wizardProfile decides what); Settings → Il mio profilo edits them later.
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
  if (connectors) return <Modal onClose={closeModal} label="Collega i tuoi strumenti" testid="connector-setup"><div className="modal-body"><AppConnectorScreen onClose={() => { setConnectors(false); closeModal(); }}/></div></Modal>;
  if (!setup) return <Modal onClose={closeModal} label="Configura il tuo spazio di lavoro" testid="first-interview"><div className="modal-body"><p role="status">{error ?? 'Caricamento della configurazione…'}</p>{error && <button type="button" className="btn" onClick={() => void refreshSetup()}>Riprova</button>}<button type="button" className="btn btn-ghost" onClick={closeModal}>Chiudi</button></div></Modal>;
  if (!fallback && (setup.status === 'new' || (setup.preferences.guide && setup.preferences.guide.stage !== 'fallback'))) return <AiFirstGate setup={setup} onFallback={() => setFallback(true)} onConnected={() => setConnectors(true)}/>;
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
  // a finished or skipped run starts over from what me.md says now: its old answers are never written again
  const [draft, setDraft] = useState<SetupDraft>(() => { const resume = ['new', 'draft'].includes(initial.status); return { ...initial.preferences, step: resume ? validSetupStep(initial.preferences.step) : 0, profile: resume ? initial.preferences.profile : undefined }; });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const saving = useRef(false), terminal = useRef(false), suggestionsMade = useRef(initial.preferences.step >= 3);
  const info = useApp(s => s.info);
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
  const lockedNote = <small>Scritto a mano in me.md: lo cambi in Impostazioni → Il mio profilo.</small>;
  const problem = (key: keyof typeof problems) => problems[key] && <small role="alert">{problems[key]}</small>;
  useEffect(() => {
    if (terminal.current || busy) return;
    let live = true;
    const timer = setTimeout(() => { void saveSetup(draft, 'draft').then(() => { if (live) setSaved(true); }, () => { if (live) setError('La bozza non è stata salvata. Le risposte restano aperte: riprova.'); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, busy]);
  const saveAndClose = async (status: 'draft' | 'completed' | 'skipped') => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try {
      await saveSetup(draft, status);
      if (status === 'completed' && await saveProfile(draft).catch(() => true)) toast('Configurazione salvata, ma il profilo in me.md non è stato aggiornato: puoi completarlo in Impostazioni → Il mio profilo.', 'info');
      if (ui.get().modal === 'setup') closeModal();
    }
    catch { terminal.current = false; setError('Salvataggio non completato. Le risposte restano qui: riprova.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const next = () => {
    if (draft.step === 2 && !suggestionsMade.current) { suggestionsMade.current = true; change({ step: 3, agentIds: recommendedAgents(draft, catalog?.profiles ?? []) }); }
    else change({ step: validSetupStep(draft.step + 1) });
  };
  const pickBrain = async () => {
    setBusy(true); setError(null);
    try { await sb.invoke('app:pickBrain', undefined); await refreshInfo(); }
    catch { setError('La cartella della memoria non è stata collegata. Puoi riprovare o farlo più tardi.'); }
    finally { setBusy(false); }
  };
  const selected = catalog?.profiles.filter(p => draft.agentIds.includes(p.id)) ?? [];
  const connectAi = async () => {
    if (busy) return;
    terminal.current = true; setBusy(true);
    try { await onConnectAi(draft); }
    catch { terminal.current = false; setBusy(false); setError('Configurazione non salvata. Riprova.'); }
  };
  return <Modal onClose={() => void saveAndClose('draft')} label="Configura il tuo spazio di lavoro" testid="first-interview" className="modal-interview">
    <div className="modal-head"><h2>Facciamo spazio al tuo lavoro</h2><span className="sp" /><small>Passo {draft.step + 1} di {INTERVIEW_STEPS.length}</small></div>
    <div className="modal-body"><fieldset disabled={busy} className="agent-editor-fields">
      <button type="button" className="btn" onClick={() => void connectAi()}>{aiCopy[lang()].title}</button>
      <p>Le risposte restano su questo computer. Puoi saltare, tornare indietro o riprendere più tardi. Non servono risposte AI per completare il setup.</p>
      <ol className="interview-steps" aria-label="Passi del setup">{INTERVIEW_STEPS.map((step, i) => <li key={step} aria-current={i === draft.step ? 'step' : undefined}>{step}</li>)}</ol>
      {draft.step === 0 && <>
        {knownName(current) ? <p data-testid="setup-known-name">Ciao <b>{current!.name}</b>: completiamo il resto.</p>
          : <label className="field"><span>Come ti chiami?</span><input value={answers.name} maxLength={PROFILE_LIMITS.name} onChange={e => answer({ name: e.target.value })} disabled={locked.has('name')} data-testid="setup-name"/>{locked.has('name') ? lockedNote : <small>Gli agenti ti chiameranno così.</small>}{problem('name')}</label>}
        <label className="field"><span>Il tuo ruolo, in una riga</span><input value={answers.role} maxLength={PROFILE_LIMITS.role} onChange={e => answer({ role: e.target.value })} disabled={locked.has('role')} placeholder="Per esempio: sviluppatore backend, product manager, consulente" data-testid="setup-role"/>{locked.has('role') && lockedNote}{problem('role')}</label>
        <label className="field"><span>Lingua in chat</span><input value={answers.language} maxLength={PROFILE_LIMITS.language} list="setup-languages" onChange={e => answer({ language: e.target.value })} disabled={locked.has('language')} data-testid="setup-language"/><datalist id="setup-languages"><option value="italiano"/><option value="English"/></datalist>{locked.has('language') && lockedNote}{problem('language')}</label>
      </>}
      {draft.step === 0 && <fieldset><legend>Come lavori di solito?</legend>{([
        ['employee', 'Lavoro in un’organizzazione', 'Progetti, documenti, riunioni e collaborazione.'], ['independent', 'Lavoro in autonomia', 'Clienti, incarichi, offerte e organizzazione.'], ['other', 'Un altro contesto', 'Studio, attività personali o un mix di lavori.'], ['', 'Lo deciderò più avanti', 'Puoi iniziare senza scegliere un profilo.'],
      ] as const).map(([work, name, hint]) => <label key={work} className="interview-choice"><input type="radio" name="work" checked={draft.work === work} onChange={() => change({ work })} /><span><b>{name}</b><small>{hint}</small></span></label>)}</fieldset>}
      {draft.step === 1 && <label className="field"><span>Le tue aree di lavoro</span><textarea rows={4} value={answers.areas} maxLength={2000} onChange={e => answer({ areas: e.target.value })} disabled={locked.has('mainWork')} placeholder={'Una per riga, per esempio:\nCheckout e pagamenti\nApp mobile'} data-testid="setup-areas"/>{locked.has('mainWork') ? lockedNote : <small>Progetti, clienti o temi che segui, uno per riga (al massimo 12): finiscono nel tuo profilo e gli agenti li ritrovano in ogni chat.</small>}{problem('areas')}</label>}
      {draft.step === 1 && <label className="field"><span>Che cosa ti aiuterebbe nelle prossime giornate?</span><textarea rows={5} maxLength={2000} value={draft.goals} onChange={e => change({ goals: e.target.value })} placeholder={draft.work === 'independent' ? 'Per esempio: preparare offerte, seguire i clienti, pianificare gli incarichi' : 'Per esempio: preparare riunioni, sintetizzare documenti, confrontare dati'} data-testid="setup-goals" /><small>Descrivi risultati utili. I dettagli possono arrivare dopo.</small></label>}
      {draft.step === 2 && <><label className="field"><span>Quali strumenti e materiali usi?</span><textarea rows={4} maxLength={2000} value={draft.tools} onChange={e => change({ tools: e.target.value })} placeholder="Documenti, fogli di calcolo, app, siti o cartelle che vuoi usare" data-testid="setup-tools" /><small>È facoltativo. Non vengono collegati account o caricati file in automatico.</small></label><label className="field"><span>Come preferisci le risposte?</span><Select value={answers.style} disabled={fixedStyle} onChange={e => { const style = e.target.value === 'concise' ? 'concise' : e.target.value === 'detailed' ? 'detailed' : 'balanced'; change({ style, profile: answerPatch(draft, { style }) }); }} data-testid="setup-style"><option value="balanced">Chiare, con il dettaglio utile</option><option value="concise">Brevi e dirette</option><option value="detailed">Approfondite e spiegate</option></Select>{fixedStyle && <small>Hai già uno stile tuo in me.md: resta com’è. Lo cambi in Impostazioni → Il mio profilo.</small>}</label><AppConnectorScreen/></>}
      {draft.step === 3 && <><h3>Una squadra di partenza, modificabile</h3><p>Seleziona gli agenti che vuoi ritrovare come preferiti. Puoi creare e cambiare i profili nella sezione Agenti.</p>{catalog?.profiles.map(p => <label key={p.id} className="interview-choice"><input type="checkbox" checked={draft.agentIds.includes(p.id)} onChange={e => change({ agentIds: e.target.checked ? [...draft.agentIds, p.id] : draft.agentIds.filter(id => id !== p.id) })} /><AgentAvatar avatar={p.avatar} name={p.name} /><span><b>{p.name}</b><small>{p.purpose}</small></span></label>)}{!catalog?.profiles.length && <p role="status">Il catalogo non è ancora disponibile. Il setup può essere completato: sceglierai gli agenti quando un motore sarà pronto.</p>}</>}
      {draft.step === 4 && <><h3>Ecco la tua configurazione</h3><dl className="setup-summary"><dt>Nome</dt><dd>{knownName(current) ? current!.name : answers.name.trim() || 'Da indicare'}</dd><dt>Ruolo</dt><dd>{answers.role.trim() || inMeMd.role || 'Da definire'}</dd><dt>Lingua in chat</dt><dd>{answers.language.trim() || inMeMd.language || 'Da definire'}</dd><dt>Aree di lavoro</dt><dd>{(workAreas(answers.areas).length ? workAreas(answers.areas) : workAreas(inMeMd.areas)).join(', ') || 'Da definire'}</dd><dt>Contesto</dt><dd>{draft.work === 'employee' ? 'Organizzazione' : draft.work === 'independent' ? 'Autonomia' : draft.work === 'other' ? 'Altro' : 'Da definire'}</dd><dt>Obiettivi</dt><dd>{draft.goals || 'Da definire durante il lavoro'}</dd><dt>Strumenti e materiali</dt><dd>{draft.tools || 'Da scegliere quando servono'}</dd><dt>Agenti preferiti</dt><dd>{selected.map(p => p.name).join(', ') || 'Da scegliere più tardi'}</dd><dt>Memoria di lavoro</dt><dd>{info?.brainRoot ? 'Cartella collegata' : 'Da collegare, senza perdere questa configurazione'}</dd></dl><button type="button" className="btn btn-ghost" onClick={() => void pickBrain()} disabled={busy}>{info?.brainRoot ? 'Cambia cartella della memoria' : 'Collega una cartella della memoria'}</button><h4>Disponibilità rilevata</h4>{catalog?.models.map(e => <AgentReadiness key={e.engine} choice={e} />)}<p>Il setup non modifica permessi o account. Gli agenti inizieranno a lavorare quando il rispettivo motore sarà disponibile e avrà accesso.</p></>}
      {draft.step===4&&<CreateMemory onBusy={setBusy} initial={answers}/>}
      {draft.step === 4 && Object.values(problems).map(message => <p key={message} role="alert">{message} Torna indietro per correggerlo.</p>)}
      {draft.step === 4 && <p>Alla conferma nome, ruolo, lingua, aree e stile delle risposte vanno nel tuo profilo (me.md). Li rivedi in Impostazioni → Il mio profilo.</p>}
      {error && <p role="alert">{error}</p>}<small role="status">{busy ? 'Operazione in corso…' : saved ? 'Bozza salvata su questo computer' : 'Puoi salvare e riprendere più tardi'}</small>
    </fieldset></div>
    <div className="modal-foot"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('skipped')}>Salta per ora</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('draft')}>Salva e riprendi più tardi</button><span className="sp" />{draft.step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => change({ step: draft.step - 1 })}>Indietro</button>}{draft.step < 4 ? <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={next}>Continua</button> : <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={() => void saveAndClose('completed')} data-testid="setup-complete">Conferma il mio spazio di lavoro</button>}</div>
  </Modal>;
}
