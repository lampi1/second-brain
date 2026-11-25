// Work maps of the demo (SB_DEMO=1, ADR 0343): more than twenty Strategist jobs and ideas, in every state and over three
// made-up projects, for the list's screenshots, its e2e and a look at how it reads when there are many. Added through
// __sbDemo.plans() (demo-wiring.ts), so the seed every other test reads stays as it is: the jobs are chats, and the real
// service (plans/service.ts) makes each map from its chat, at the moment the chat says (the hook moves the demo's clock).
// Some have their agents' chats (demo-plans-chats.ts), which is what the live status reads (ADR 0342).
// In the UI language through demo-text.ts (the English: demo-plans-text.ts). Fictional data; pinned by
// test/unit/demo-plans.test.ts.
import type { ChatItem, ChatSummary } from '../shared/contract';
import { ROLE_DEFAULTS } from '../shared/roles';
import type { PlanDoubt } from '../shared/plan-doubts';
import type { PlanPhase, StrategyPlan } from '../shared/strategy';
import type { PlanStep, StepState } from '../shared/plan-steps';
import type { WorkRoleId } from '../shared/roles';
import type { PresetId } from '../shared/model-presets';
import { demoWorkers } from './demo-plans-chats';
import { localize } from './demo-text';

const MIN = 60_000;
/** `ago` = minutes since its last change; `then` = what the user did with the map once it was there. */
/** A step as the demo writes it: `par` = together with the step before it, `on` is ignored, a «done» one carries its own proof. */
interface DemoStep { title: string; detail?: string; role?: WorkRoleId; state: 'todo' | 'now' | 'done' | 'blocked'; preset?: PresetId; par?: true; on?: string; drop?: true; chatIds?: string[]; startedAt?: number; endedAt?: number; minutes?: number; outcome?: 'partial' | 'blocked' }
/** The demo's steps as a plan holds them (ids, what each waits for, proofs). */
function toSteps(list: readonly DemoStep[]): PlanStep[] {
  let turn: string[] = [], before: string[] = [];
  return list.map((d, i): PlanStep => {
    const id = `s${i + 1}`;
    if (d.par && i > 0) turn.push(id); else { before = turn; turn = [id]; }
    const state: StepState = d.state === 'done' && d.outcome ? d.outcome : d.state;
    const after = d.par && i > 0 ? before : before.length && i > 0 ? before : [];
    return { id, title: d.title, ...(d.detail ? { detail: d.detail } : {}), ...(d.role ? { role: d.role } : {}), state, ...(d.preset ? { preset: d.preset } : {}), ...(d.drop ? { drop: true as const } : {}), ...(d.chatIds ? { chatIds: d.chatIds } : {}),
      ...(d.startedAt ? { startedAt: d.startedAt } : {}), ...(d.endedAt ? { endedAt: d.endedAt } : {}), ...(d.minutes ? { minutes: d.minutes } : {}), ...(after.length ? { after: [...after] } : {}),
      ...(state === 'done' || state === 'partial' ? { proof: { at: d.endedAt ?? 1, by: 'report' as const, text: state === 'done' ? 'Fatto e controllato: il report del passo lo conferma.' : 'Fatto in parte: resta il caso dei resi.' } } : {}) };
  });
}

interface DemoJob { id: string; title: string; goal?: string; project: string; ago: number; phase: PlanPhase; doneWhen?: string; stopped?: true; closedBy?: 'user' | 'auto'; then?: 'seen' | 'archive'; steps: DemoStep[]; doubts?: PlanDoubt[]; owner?: Partial<ChatSummary> }

const jobs = (E: number): DemoJob[] => [
  { id: 'coupon', title: 'Codici sconto alla cassa', project: 'alfa-shop', ago: 4, phase: 'proposed', goal: 'Aggiungi i codici sconto alla cassa: un codice per ordine, con scadenza.', doneWhen: 'Un codice valido cambia il totale, uno scaduto spiega il motivo.', doubts: [
    { text: 'Un codice vale anche sui prodotti già scontati?', state: 'closed', by: 'user', answer: 'No, mai insieme a un altro sconto', source: 'Un codice vale anche sui prodotti già scontati?' },
    { text: 'Dove si calcola il totale?', state: 'closed', by: 'code', answer: 'In un punto solo, prima della spedizione', source: 'ordini/totale.ts, riga 88' },
    { text: 'Quanto dura un codice?', state: 'closed', by: 'brain', answer: '30 giorni, come i buoni', source: 'nota «Regole degli sconti»' },
    { text: 'Che testo legge chi usa un codice scaduto?', state: 'closed', by: 'choice', answer: 'Il giorno in cui è scaduto', source: 'hai detto «Basta domande»: è il testo più chiaro' },
  ], steps: [
    { title: 'Trovo dove entra il codice alla cassa', role: 'scout', state: 'todo', preset: 'min', on: 'ordini' },
    { title: 'Guardo come fanno gli altri negozi', role: 'scout', state: 'todo', par: true, preset: 'min' },
    { title: 'Scrivo il campo e la regola del codice', role: 'artisan', state: 'todo', preset: 'max', on: 'ordini', detail: 'Un codice per ordine, mai sotto zero' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
    { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo', par: true, preset: 'min' },
  ] },
  { id: 'login-sms', title: 'Accesso con codice via SMS', project: 'app-mobile', ago: 22, phase: 'proposed', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min' },
    { title: 'Aggiungo la schermata del codice', role: 'artisan', state: 'todo', preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'export', title: 'Esportazione mensile più veloce', project: 'gestionale', ago: 41, phase: 'proposed', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 170 * MIN, endedAt: E - 160 * MIN },
    { title: 'Leggo i dati a blocchi', role: 'artisan', state: 'now', preset: 'base', startedAt: E - 150 * MIN, chatIds: ['pl-export-blocks'] },
    { title: 'Provo una memoria più grande', role: 'artisan', state: 'now', par: true, preset: 'base', startedAt: E - 150 * MIN, drop: true, chatIds: ['pl-export-memory'] },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'returns', title: 'Resi senza scontrino', project: 'alfa-shop', ago: 2, phase: 'running', owner: { state: 'idle' }, steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 64 * MIN, endedAt: E - 52 * MIN, chatIds: ['pl-returns-read'] },
    { title: 'Cerco l’ordine dal numero della carta', role: 'artisan', state: 'now', preset: 'max', startedAt: E - 50 * MIN, chatIds: ['pl-returns-card'] },
    { title: 'Preparo i casi di prova', role: 'sentinel', state: 'now', par: true, preset: 'base', startedAt: E - 50 * MIN, chatIds: ['pl-returns-cases'] },
    { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo', preset: 'min' },
  ] },
  { id: 'push', title: 'Notifiche di consegna', project: 'app-mobile', ago: 9, phase: 'running', owner: { state: 'idle' }, steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 200 * MIN, endedAt: E - 190 * MIN },
    { title: 'Invio la notifica alla partenza', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 188 * MIN, endedAt: E - 90 * MIN },
    { title: 'Provo su telefono vero', role: 'sentinel', state: 'blocked', preset: 'base', startedAt: E - 80 * MIN, outcome: 'blocked', chatIds: ['pl-push-old', 'pl-push-phone'] },
    { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo', preset: 'min' },
  ] },
  { id: 'search', title: 'Ricerca prodotti che perdona gli errori', project: 'alfa-shop', ago: 15, phase: 'running', owner: { state: 'idle' }, steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 120 * MIN, endedAt: E - 100 * MIN },
    { title: 'Confronto due modi di cercare', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 99 * MIN, endedAt: E - 40 * MIN },
    { title: 'Metto il migliore nel catalogo', role: 'artisan', state: 'now', preset: 'base', startedAt: E - 39 * MIN, chatIds: ['pl-search-catalog'] },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'billing', title: 'Fatture con più aliquote', project: 'gestionale', ago: 33, phase: 'revising', owner: { state: 'closed' }, steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 400 * MIN, endedAt: E - 390 * MIN },
    { title: 'Calcolo le aliquote riga per riga', role: 'artisan', state: 'now', preset: 'base', startedAt: E - 380 * MIN, chatIds: ['pl-billing-rates'] },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'dark', title: 'Tema scuro nel negozio', project: 'alfa-shop', ago: 300, phase: 'running', stopped: true, steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 900 * MIN, endedAt: E - 880 * MIN },
    { title: 'Cambio i colori delle pagine', role: 'artisan', state: 'now', preset: 'base', startedAt: E - 870 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'stock', title: 'Giacenze in tempo reale', project: 'gestionale', ago: 1500, phase: 'running', closedBy: 'user', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 1900 * MIN, endedAt: E - 1880 * MIN },
    { title: 'Leggo le giacenze dal magazzino', role: 'artisan', state: 'todo', preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'offline', title: 'App che funziona senza rete', project: 'app-mobile', ago: 2900, phase: 'running', closedBy: 'auto', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min' },
    { title: 'Salvo gli ultimi ordini sul telefono', role: 'artisan', state: 'todo', preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'gift', title: 'Buoni regalo', project: 'alfa-shop', ago: 120, phase: 'approved', goal: 'Vendi buoni regalo dal negozio e falli usare alla cassa.', closedBy: 'auto', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min', on: 'ordini' },
    { title: 'Creo il buono e il suo codice', role: 'artisan', state: 'todo', preset: 'max', on: 'ordini' },
    { title: 'Aggiungo la mail con il buono', role: 'artisan', state: 'todo', par: true, preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
    { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo', par: true, preset: 'min' },
  ] },
  { id: 'backup', title: 'Copia notturna degli archivi', project: 'gestionale', ago: 700, phase: 'approved', closedBy: 'auto', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min' },
    { title: 'Preparo la copia', role: 'artisan', state: 'todo', preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'widgets', title: 'Riquadro degli ordini sul telefono', project: 'app-mobile', ago: 1600, phase: 'approved', closedBy: 'auto', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min' },
    { title: 'Disegno il riquadro', role: 'artisan', state: 'todo', preset: 'base' },
    { title: 'Verifico con i test', role: 'sentinel', state: 'todo', preset: 'base' },
  ] },
  { id: 'loyalty', title: 'Punti fedeltà', project: 'alfa-shop', ago: 12, phase: 'asking', owner: { waitsOn: 'user' }, steps: [], doubts: [
    { text: 'I punti scadono?', state: 'open' },
    { text: 'Chi guadagna i punti', state: 'closed', by: 'user', answer: 'Solo chi ha un account', source: 'Chi guadagna i punti' },
    { text: 'Dove si vede quanto ha speso un cliente?', state: 'closed', by: 'code', answer: 'Nella scheda del cliente, già sommato', source: 'clienti/scheda.ts, riga 41' },
  ] },
  { id: 'vat', title: 'Correzione IVA sui resi', project: 'gestionale', ago: 50, phase: 'done', closedBy: 'auto', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'done', preset: 'min', startedAt: E - 300 * MIN, endedAt: E - 290 * MIN },
    { title: 'Correggo il calcolo', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 289 * MIN, endedAt: E - 200 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 199 * MIN, endedAt: E - 180 * MIN },
  ] },
  { id: 'images', title: 'Foto prodotto più leggere', project: 'alfa-shop', ago: 90, phase: 'done', closedBy: 'auto', steps: [
    { title: 'Riduco le foto', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 220 * MIN, endedAt: E - 150 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 149 * MIN, endedAt: E - 140 * MIN },
  ] },
  { id: 'wish', title: 'Lista dei desideri', project: 'alfa-shop', ago: 4300, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 4390 * MIN, endedAt: E - 4320 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 4319 * MIN, endedAt: E - 4305 * MIN },
  ] },
  { id: 'langs', title: 'Negozio in tedesco', project: 'alfa-shop', ago: 8600, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 8690 * MIN, endedAt: E - 8620 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 8619 * MIN, endedAt: E - 8605 * MIN },
  ] },
  { id: 'crash', title: 'Blocco all’avvio su tablet', project: 'app-mobile', ago: 5800, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 5890 * MIN, endedAt: E - 5820 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 5819 * MIN, endedAt: E - 5805 * MIN },
  ] },
  { id: 'roles', title: 'Permessi per ruolo', project: 'gestionale', ago: 11500, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 11590 * MIN, endedAt: E - 11520 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 11519 * MIN, endedAt: E - 11505 * MIN },
  ] },
  { id: 'print', title: 'Stampa delle etichette', project: 'gestionale', ago: 14400, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 14490 * MIN, endedAt: E - 14420 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 14419 * MIN, endedAt: E - 14405 * MIN },
  ] },
  { id: 'tracking', title: 'Pagina «dov’è il mio pacco»', project: 'alfa-shop', ago: 20000, phase: 'done', closedBy: 'auto', then: 'seen', steps: [
    { title: 'Faccio la modifica', role: 'artisan', state: 'done', preset: 'base', startedAt: E - 20090 * MIN, endedAt: E - 20020 * MIN },
    { title: 'Verifico con i test', role: 'sentinel', state: 'done', preset: 'base', startedAt: E - 20019 * MIN, endedAt: E - 20005 * MIN },
  ] },
  { id: 'kiosk', title: 'Totem in negozio', project: 'alfa-shop', ago: 6000, phase: 'approved', closedBy: 'auto', then: 'archive', steps: [
    { title: 'Leggo come funziona oggi', role: 'scout', state: 'todo', preset: 'min' },
    { title: 'Adatto le pagine al totem', role: 'artisan', state: 'todo', preset: 'base' },
  ] },
];
/** Ideas nobody works on yet. */
const IDEAS: { title: string; idea?: string; project: string; ago: number }[] = [
  { title: 'Confronto prezzi con i fornitori', idea: 'Capire ogni settimana dove compriamo troppo caro.', project: 'gestionale', ago: 60 },
  { title: 'Recensioni con foto', project: 'alfa-shop', ago: 1000 },
  { title: 'Risposte vocali nell’app', idea: 'Chi guida non può leggere: provare con le risposte più comuni.', project: 'app-mobile', ago: 3000 },
];

export interface DemoWorkMap { at: number; chat: ChatSummary; items: ChatItem[]; workers: { chat: ChatSummary; items: ChatItem[] }[]; then?: 'seen' | 'archive' }
export interface DemoIdea { at: number; title: string; idea?: string; project: string }

function chatOf(j: DemoJob, E: number): ChatSummary {
  const id = `pl-${j.id}`, at = E - j.ago * MIN, started = at - 30 * MIN, working = j.phase === 'running' && !j.stopped && !j.closedBy;
  const plan: StrategyPlan = { phase: j.phase, at, clarified: j.phase === 'asking' ? [{ q: 'Chi guadagna i punti', a: 'Solo chi ha un account' }] : [], steps: toSteps(j.steps), ...(j.doneWhen ? { doneWhen: j.doneWhen } : {}), ...(j.stopped ? { stopped: true as const } : {}), ...(j.doubts ? { doubts: j.doubts } : {}) };
  return {
    id, title: j.title, harness: 'claude', origin: 'app', cwd: `C:\\progetti\\${j.project}`, sessionId: `demo-${id}`, model: 'claude-opus-5-5', effort: 'high', permissionMode: 'default',
    state: j.closedBy ? 'closed' : working ? 'running' : 'idle', costUsd: 0.2, pending: 0, isOrchestrator: false, lastText: 'Trova i passi, proponi il piano, poi segui gli agenti.', updatedAt: at, browserTabIds: [],
    agent: { id: 'strategist', name: 'Strategist', purpose: ROLE_DEFAULTS.strategist.summary, avatar: { kind: 'character', value: 'strategist' }, engine: 'claude', model: 'claude-opus-5-5', revision: 1, version: 1, source: 'catalog' },
    run: { runId: `r_${id}`, chatId: id, agentId: 'strategist', version: 1, goal: j.goal ?? j.title, startedBy: 'orchestrator', startedAt: started, costUsd: 0.2, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } },
    plan, ...(j.closedBy ? { closedAt: at, closedBy: j.closedBy } : {}), ...j.owner,
  };
}

/** The demo's work maps at the moment E, oldest first: the jobs as their chats, and the ideas. */
export function demoPlans(E: number): { jobs: DemoWorkMap[]; ideas: DemoIdea[] } {
  const workers = demoWorkers(E);
  return localize({
    jobs: jobs(E).map(j => { const chat = chatOf(j, E); return { at: chat.updatedAt, chat, items: [{ kind: 'user', id: `${chat.id}-u1`, at: chat.run!.startedAt, text: chat.run!.goal } as ChatItem], workers: workers.filter(w => w.chat.parentId === chat.id), ...(j.then ? { then: j.then } : {}) }; }).sort((a, b) => a.at - b.at),
    ideas: IDEAS.map(({ ago, ...i }) => ({ ...i, at: E - ago * MIN })).sort((a, b) => a.at - b.at),
  });
}
