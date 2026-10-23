// The developer's live cockpit: outstanding decisions first, persistent work threads and explicit fresh recap.
// Reading the board starts no model; only Fai il punto sends a user request through the existing chat queue.
import { useEffect, useState } from 'react';
import type { LearnedRuleProposal } from '@shared/agent-pack';
import { WORK_LABELS, WORK_ROUTES, type WorkThread } from '@shared/workflows';
import { useApp, send } from '../store/store';
import { useWorkflows, decideWork, reloadWorkflows } from '../store/workflows';
import { useTasks } from '../store/tasks';
import { planAskKeys } from '../lib/plan-ask';
import { sameList } from '../store/state';
import { openQueue } from '../lib/later';
import { openChatRef } from '../actions';
import { toast } from '../store/ui';
import '../styles/work-cockpit.css';
const RECAP = 'Fai il punto: leggi ora app_work_list e app_digest, senza affidarti alla memoria. Aggiorna i fili dalle evidenze disponibili. Mostrami prima ciò che aspetta me e i rischi, poi cosa gira e chi aspetta chi, in poche righe. Produzione e supporto hanno precedenza. Per PR e QA indica quando i dati sono stati letti; se servono controlli nuovi delegali a Scout. Non dare nulla per approvato. Apri app_unblock per le decisioni sospese.';
export function RecapButton() {
  const orch = useApp(s => Object.values(s.chats).find(c => c.isOrchestrator && !c.closedAt));
  const queued = useApp(s => orch ? (s.queued[orch.id] ?? []).some(m => m.text === RECAP) : false);
  return <button className="btn btn-primary btn-s" type="button" data-testid="work-recap" disabled={!orch || queued}
    title="Chiede un nuovo riepilogo all’Orchestrator: utilizza il suo modello" onClick={() => {
      if (!orch) return;
      if (orch.pending || orch.state === 'waiting') openQueue(null);
      const result = send(orch.id, RECAP);
      if (result !== 'empty') toast(result === 'queued' ? 'Riepilogo in coda: il lavoro in corso continua.' : 'L’Orchestrator sta facendo il punto.', 'ok');
    }}>{queued ? 'Riepilogo in coda' : 'Fai il punto'}</button>;
}
function WorkCard({ row }: { row: WorkThread }) {
  const [saving, setSaving] = useState(false);
  const decide = async (yes: boolean) => { if (saving) return; setSaving(true); try { await decideWork(row, yes); } finally { setSaving(false); } };
  const route = WORK_ROUTES[row.profile];
  const chats = useApp(s => s.chats);
  const eventLabel = { created: 'Aperto', updated: 'Aggiornato', completed: 'Verifiche dichiarate', proposed: 'Proposto', approved: 'Approvato', rejected: 'Rifiutato', rework: 'Da correggere', blocked: 'Bloccato' };
  return <article className={`work-card work-${row.status}`} data-testid="work-thread">
    <header><span className={`work-priority work-${row.priority}`}>{row.priority === 'production' ? 'Produzione' : row.priority === 'support' ? 'Supporto' : 'Feature'}</span><strong>{row.title}</strong><span className="work-state">{row.status === 'approval' ? 'Aspetta te' : row.status === 'blocked' ? 'Bloccato' : row.status === 'done' ? 'Completato' : WORK_LABELS[row.stage]}</span></header>
    <ol className="work-stages" aria-label="Fasi del lavoro">{route.map((stage, i) => <li key={stage} className={stage === row.stage ? 'current' : i < route.indexOf(row.stage) ? 'past' : ''} aria-current={stage === row.stage ? 'step' : undefined}>{WORK_LABELS[stage]}</li>)}</ol>
    <p>{row.summary}</p>
    {row.waitingOn && <p className="work-next">Aspetta: <strong>{row.waitingOn}</strong></p>}
    {row.nextAction && <p className="work-next">Prossimo passo: {row.nextAction}</p>}
    {row.proposal && <div className="work-decision" role="group" aria-label={row.proposal.text}><span>Ti va bene questa proposta?</span><button type="button" className="btn btn-primary btn-s" disabled={saving} onClick={() => void decide(true)}>Sì, procedi</button><button type="button" className="btn btn-ghost btn-s" disabled={saving} onClick={() => void decide(false)}>No, proponi altro</button></div>}
    <footer>{row.chatIds.map(id => <button key={id} type="button" className="btn btn-ghost btn-xs" onClick={() => openChatRef(id)}>{chats[id]?.title ?? 'Chat archiviata'}</button>)}<details><summary>Decisioni e verifiche · {row.events.length}</summary><ul>{row.events.slice(-15).reverse().map((e, i) => <li key={`${e.at}-${i}`}><strong>{eventLabel[e.kind]} · {WORK_LABELS[e.stage]}</strong> · {new Date(e.at).toLocaleString()}<br />{e.text}</li>)}</ul></details></footer>
  </article>;
}
function LearningProposals() {
  const [lessons, setLessons] = useState<LearnedRuleProposal[]>([]), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => { void window.sb.invoke('work:lessons', undefined).then(rows => { if (alive) { setLessons(rows); setError(''); } }, () => { if (alive) setError('Proposte di miglioramento non disponibili.'); }); };
    load(); const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const decide = async (p: LearnedRuleProposal, approve: boolean) => {
    setSaving(true);
    try { await window.sb.invoke('work:lessonDecide', { id: p.id, rule: p.rule, approve }); setLessons(rows => rows.filter(x => x.id !== p.id)); }
    catch (e) { toast(`Modifica non applicata: ${String(e)}`, 'err'); }
    finally { setSaving(false); }
  };
  return <>{error && <p role="status">{error}</p>}{lessons.length > 0 && <details className="work-learning"><summary>Miglioramenti da approvare · {lessons.length}</summary>{lessons.map(p => <article className="work-card" key={p.id}><strong>{p.agentId} · {p.target ?? 'role'}</strong><p>{p.rule}</p><p className="work-next">Da cosa nasce: {p.evidence}</p><div className="work-decision"><button type="button" className="btn btn-primary btn-s" disabled={saving} onClick={() => void decide(p, true)}>Sì, applica</button><button type="button" className="btn btn-ghost btn-s" disabled={saving} onClick={() => void decide(p, false)}>No</button></div></article>)}</details>}</>;
}
export function WorkCockpit() {
  const { rows, error } = useWorkflows();
  const pending = useApp(s => s.pending.length);
  const plans = useApp(s => planAskKeys(s).length);
  const running = useApp(s => Object.values(s.chats).filter(c => !c.isOrchestrator && !c.closedAt && ['running', 'starting'].includes(c.state)).length);
  const blocked = useApp(s => Object.values(s.chats).filter(c => !c.isOrchestrator && !c.closedAt && c.state === 'error'), sameList);
  const tasks = useTasks(s => s);
  const active = rows.filter(r => r.status !== 'done'), finished = rows.filter(r => r.status === 'done');
  const [history, setHistory] = useState(false);
  const risky = tasks?.prs.filter(p => p.autoComplete && (p.activeThreads || p.reviewers.some(r => r.vote < 0) || p.build?.result === 'failed')) ?? [];
  return <section className="work-cockpit" aria-label="Regia del lavoro" data-testid="work-cockpit">
    <header className="work-heading"><div><span className="work-eyebrow">IL TUO LAVORO, IN UN POSTO SOLO</span><h2>Regia</h2></div><span className="work-live">Stato live · nessun token</span></header>
    <div className="work-counts"><button type="button" onClick={() => openQueue(null)}><strong>{pending + plans}</strong> domande e permessi</button><span><strong>{active.filter(r => r.status === 'approval').length}</strong> proposte qui sotto</span><span><strong>{running}</strong> agenti al lavoro</span></div>
    {(blocked.length > 0 || risky.length > 0 || tasks?.urgent.length || tasks?.error) ? <div className="work-alerts" aria-label="Da tenere d’occhio">
      {blocked.slice(0, 3).map(c => <button type="button" key={c.id} onClick={() => openChatRef(c.id)}>Agente bloccato · {c.title}</button>)}
      {risky.map(p => <p key={p.id}>PR #{p.id} in auto-complete con discussioni aperte o verifiche negative: {p.title}</p>)}
      {!!tasks?.urgent.length && <p>{tasks.urgent.length} bug urgenti assegnati a te.</p>}
      {tasks?.error && <p>DevOps non aggiornato: {tasks.error.message}</p>}
    </div> : null}
    {tasks?.at && <small className="work-next">DevOps: {new Date(tasks.at).toLocaleString()} · ultimo controllo disponibile</small>}
    <LearningProposals />
    {error && <p role="alert">Impossibile leggere i fili: {error} <button type="button" onClick={() => void reloadWorkflows()}>Riprova</button></p>}
    {!active.length && <p className="work-empty">Descrivi un obiettivo all’Orchestrator: qui resteranno il filo, le proposte e il prossimo passo, anche dopo la chiusura delle chat.</p>}
    <div className="work-cards">{active.map(row => <WorkCard key={row.id} row={row} />)}</div>
    {finished.length > 0 && <><button type="button" className="btn btn-ghost btn-s" aria-expanded={history} onClick={() => setHistory(x => !x)}>Completati · {finished.length}</button>{history && finished.map(row => <WorkCard key={row.id} row={row} />)}</>}
  </section>;
}
