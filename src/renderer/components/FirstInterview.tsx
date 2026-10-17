// First-run interview: offline, resumable, optional and private. Existing installations never get a forced wizard.
// Only preference fields are saved; permission, trust, accounts and provider calls remain separate explicit actions.
import { useEffect, useRef, useState } from 'react';
import type { AgentCatalog, SetupDraft, SetupState } from '@shared/agents';
import { INTERVIEW_STEPS, recommendedAgents, validSetupStep } from '../lib/agent-setup';
import { refreshSetup, saveSetup, useAgents } from '../store/agents';
import { closeModal, openModal, ui } from '../store/ui';
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

export function FirstInterviewGate() {
  const { setup, catalog, error } = useAgents(), modal = ui.use(s => s.modal);
  const offered = useRef(false);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (modal === 'setup') offered.current = true;
    if (!offered.current && setup && (setup.status === 'new' || setup.status === 'draft') && !modal) { offered.current = true; openModal('setup'); }
  }, [setup?.status, modal]);
  if (modal !== 'setup') return null;
  if (!setup) return <Modal onClose={closeModal} label="Configura il tuo spazio di lavoro" testid="first-interview"><div className="modal-body"><p role="status">{error ?? 'Caricamento della configurazione…'}</p>{error && <button type="button" className="btn" onClick={() => void refreshSetup()}>Riprova</button>}<button type="button" className="btn btn-ghost" onClick={closeModal}>Chiudi</button></div></Modal>;
  if (!fallback && (setup.status === 'new' || (setup.preferences.guide && setup.preferences.guide.stage !== 'fallback'))) return <AiFirstGate setup={setup} onFallback={() => setFallback(true)}/>;
  return <FirstInterview initial={setup} catalog={catalog} onConnectAi={async preferences => { await saveSetup({ ...preferences, guide: { stage: 'choosing' } }, 'draft'); setFallback(false); }}/>;
}

function FirstInterview({ initial, catalog, onConnectAi }: { initial: SetupState; catalog: AgentCatalog | null; onConnectAi: (preferences: SetupDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<SetupDraft>(() => ({ ...initial.preferences, step: ['new', 'draft'].includes(initial.status) ? validSetupStep(initial.preferences.step) : 0 }));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const saving = useRef(false), terminal = useRef(false), suggestionsMade = useRef(initial.preferences.step >= 3);
  const info = useApp(s => s.info);
  const change = (patch: Partial<SetupDraft>) => { setDraft(d => ({ ...d, ...patch })); setSaved(false); };
  useEffect(() => {
    if (terminal.current || busy) return;
    let live = true;
    const timer = setTimeout(() => { void saveSetup(draft, 'draft').then(() => { if (live) setSaved(true); }, () => { if (live) setError('La bozza non è stata salvata. Le risposte restano aperte: riprova.'); }); }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [draft, busy]);
  const saveAndClose = async (status: 'draft' | 'completed' | 'skipped') => {
    if (saving.current || busy) return;
    saving.current = true; terminal.current = true; setBusy(true); setError(null);
    try { await saveSetup(draft, status); if (ui.get().modal === 'setup') closeModal(); }
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
      {draft.step === 0 && <fieldset><legend>Come lavori di solito?</legend>{([
        ['employee', 'Lavoro in un’organizzazione', 'Progetti, documenti, riunioni e collaborazione.'], ['independent', 'Lavoro in autonomia', 'Clienti, incarichi, offerte e organizzazione.'], ['other', 'Un altro contesto', 'Studio, attività personali o un mix di lavori.'], ['', 'Lo deciderò più avanti', 'Puoi iniziare senza scegliere un profilo.'],
      ] as const).map(([work, name, hint]) => <label key={work} className="interview-choice"><input type="radio" name="work" checked={draft.work === work} onChange={() => change({ work })} /><span><b>{name}</b><small>{hint}</small></span></label>)}</fieldset>}
      {draft.step === 1 && <label className="field"><span>Che cosa ti aiuterebbe nelle prossime giornate?</span><textarea rows={5} maxLength={2000} value={draft.goals} onChange={e => change({ goals: e.target.value })} placeholder={draft.work === 'independent' ? 'Per esempio: preparare offerte, seguire i clienti, pianificare gli incarichi' : 'Per esempio: preparare riunioni, sintetizzare documenti, confrontare dati'} data-testid="setup-goals" /><small>Descrivi risultati utili. I dettagli possono arrivare dopo.</small></label>}
      {draft.step === 2 && <><label className="field"><span>Quali strumenti e materiali usi?</span><textarea rows={4} maxLength={2000} value={draft.tools} onChange={e => change({ tools: e.target.value })} placeholder="Documenti, fogli di calcolo, app, siti o cartelle che vuoi usare" data-testid="setup-tools" /><small>È facoltativo. Non vengono collegati account o caricati file in automatico.</small></label><label className="field"><span>Come preferisci le risposte?</span><select value={draft.style} onChange={e => change({ style: e.target.value === 'concise' ? 'concise' : e.target.value === 'detailed' ? 'detailed' : 'balanced' })}><option value="balanced">Chiare, con il dettaglio utile</option><option value="concise">Brevi e dirette</option><option value="detailed">Approfondite e spiegate</option></select></label></>}
      {draft.step === 3 && <><h3>Una squadra di partenza, modificabile</h3><p>Seleziona gli agenti che vuoi ritrovare come preferiti. Puoi creare e cambiare i profili nella sezione Agenti.</p>{catalog?.profiles.map(p => <label key={p.id} className="interview-choice"><input type="checkbox" checked={draft.agentIds.includes(p.id)} onChange={e => change({ agentIds: e.target.checked ? [...draft.agentIds, p.id] : draft.agentIds.filter(id => id !== p.id) })} /><AgentAvatar avatar={p.avatar} name={p.name} /><span><b>{p.name}</b><small>{p.purpose}</small></span></label>)}{!catalog?.profiles.length && <p role="status">Il catalogo non è ancora disponibile. Il setup può essere completato: sceglierai gli agenti quando un motore sarà pronto.</p>}</>}
      {draft.step === 4 && <><h3>Ecco la tua configurazione</h3><dl className="setup-summary"><dt>Contesto</dt><dd>{draft.work === 'employee' ? 'Organizzazione' : draft.work === 'independent' ? 'Autonomia' : draft.work === 'other' ? 'Altro' : 'Da definire'}</dd><dt>Obiettivi</dt><dd>{draft.goals || 'Da definire durante il lavoro'}</dd><dt>Strumenti e materiali</dt><dd>{draft.tools || 'Da scegliere quando servono'}</dd><dt>Agenti preferiti</dt><dd>{selected.map(p => p.name).join(', ') || 'Da scegliere più tardi'}</dd><dt>Memoria di lavoro</dt><dd>{info?.brainRoot ? 'Cartella collegata' : 'Da collegare, senza perdere questa configurazione'}</dd></dl><button type="button" className="btn btn-ghost" onClick={() => void pickBrain()} disabled={busy}>{info?.brainRoot ? 'Cambia cartella della memoria' : 'Collega una cartella della memoria'}</button><h4>Disponibilità rilevata</h4>{catalog?.models.map(e => <AgentReadiness key={e.engine} choice={e} />)}<p>Il setup non modifica permessi o account. Gli agenti inizieranno a lavorare quando il rispettivo motore sarà disponibile e avrà accesso.</p></>}
      {draft.step===4&&<CreateMemory onBusy={setBusy}/>}
      {error && <p role="alert">{error}</p>}<small role="status">{busy ? 'Operazione in corso…' : saved ? 'Bozza salvata su questo computer' : 'Puoi salvare e riprendere più tardi'}</small>
    </fieldset></div>
    <div className="modal-foot"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('skipped')}>Salta per ora</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void saveAndClose('draft')}>Salva e riprendi più tardi</button><span className="sp" />{draft.step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => change({ step: draft.step - 1 })}>Indietro</button>}{draft.step < 4 ? <button type="button" className="btn btn-primary" disabled={busy} onClick={next}>Continua</button> : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveAndClose('completed')} data-testid="setup-complete">Conferma il mio spazio di lavoro</button>}</div>
  </Modal>;
}
