// The agents' chats of some of the demo's work maps (demo-work-maps.ts, ADR 0342 and 0344): one at work, one that reported,
// one whose last turn failed, one nobody vouches for since a restart, and the questions: one answered by the Strategist, one
// held by the Orchestrator, one that went up to the user, each with the lines its own chat shows. Fictional data, in Italian
// (English: demo-work-maps-text.ts); pinned by test/unit/demo-work-maps.test.ts.
import type { ChatItem, ChatSummary } from '../shared/contract';
import type { LadderQuestion, LadderStep } from '../shared/question-ladder';
import { ROLE_DEFAULTS } from '../shared/roles';
import { sysEn, type SysCode, type SysParams } from '../shared/sys';

const MIN = 60_000;
type Worker = 'scout' | 'artisan' | 'sentinel';
export interface DemoWorker { chat: ChatSummary; items: ChatItem[] }

export function demoWorkers(E: number): DemoWorker[] {
  const worker = (id: string, job: string, role: Worker, title: string, text: string, ago: number, extra: Partial<ChatSummary>, lines: [number, SysCode, SysParams][] = []): DemoWorker => {
    const chatId = `wm-${id}`, at = E - ago * MIN, started = at - 40 * MIN;
    const run: ChatSummary['run'] = { runId: `r_${chatId}`, chatId, agentId: role, version: 1, goal: title, startedBy: 'parent', startedAt: started, costUsd: 0.1, tokens: null, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null } } as ChatSummary['run'];
    return {
      chat: {
        id: chatId, title, parentId: `wm-${job}`, harness: 'claude', origin: 'app', cwd: 'C:\\progetti\\demo', sessionId: `demo-${chatId}`, model: 'claude-opus-5-5', effort: 'high', permissionMode: 'default',
        state: 'idle', costUsd: 0.1, pending: 0, isOrchestrator: false, lastText: text, updatedAt: at, browserTabIds: [],
        agent: { id: role, name: role[0]!.toUpperCase() + role.slice(1), purpose: ROLE_DEFAULTS[role].summary, avatar: { kind: 'character', value: role }, engine: 'claude', model: 'claude-opus-5-5', revision: 1, version: 1, source: 'catalog' },
        ...extra, run: { ...run!, ...extra.run },
      },
      items: [
        { kind: 'user', id: `${chatId}-u1`, at: started, text: title } as ChatItem,
        { kind: 'assistant', id: `${chatId}-a1`, at: started + MIN, text } as ChatItem,
        ...lines.map(([when, code, params], i): ChatItem => ({ kind: 'system', id: `${chatId}-s${i}`, at: when, text: sysEn(code, params), level: 'info', code, params })),
      ],
    };
  };
  const q = (id: string, at: number, question: string, options: string[], rest: Pick<LadderQuestion, 'level' | 'trail'> & Partial<LadderQuestion>): LadderQuestion => ({ id, asks: [{ question, options }], at, levelAt: rest.trail.at(-1)!.at, via: 'message', ...rest });
  const step = (level: LadderStep['level'], name: string, at: number, action: LadderStep['action'], why?: string): LadderStep => ({ level, name, at, action, ...(why ? { why } : {}) });
  const report = (outcome: 'done' | 'partial', at: number) => ({ run: { report: { at, outcome, verified: 'yes', summary: '' } } as unknown as ChatSummary['run'] });

  const returns = 'Strategist «Resi senza scontrino»', push = 'Strategist «Notifiche di consegna»';
  const cash = 'Cerco anche tra gli ordini pagati in contanti?', late = 'Un reso senza scontrino vale anche dopo 30 giorni?', real = 'Mando la notifica di prova ai clienti veri?';
  const cashWhy = 'L’obiettivo del lavoro dice «dal numero della carta»', lateWhy = 'Non è scritto nella richiesta né nel codice', realWhy = 'Cambia quello che vedono i clienti', realWhy2 = 'Non c’è una tua decisione scritta su questo';
  const a = E - 45 * MIN, b = E - 14 * MIN, c = E - 26 * MIN;
  return [
    worker('returns-read', 'returns', 'scout', 'Lettura dei resi', 'Ho letto come funzionano i resi: lo scontrino si cerca in un punto solo.', 52, { ...report('done', E - 52 * MIN), lastResult: { at: E - 52 * MIN, isError: false } }),
    worker('returns-card', 'returns', 'artisan', 'Ordine dal numero della carta', 'Cerco l’ordine dal numero della carta.', 2, {
      state: 'running', questions: [q('q-cash', a, cash, ['Solo carta', 'Anche contanti'], { level: 'strategist', trail: [step('strategist', returns, a, 'asked'), step('strategist', returns, a + 2 * MIN, 'answered', cashWhy)], answered: { by: 'strategist', chatId: 'wm-returns', name: returns, answer: 'No, solo quelli pagati con carta', why: cashWhy, at: a + 2 * MIN } })],
    }, [[a, 'ladderAsked', { question: cash, who: returns }], [a + 2 * MIN, 'ladderAnswered', { question: cash, who: returns, answer: 'No, solo quelli pagati con carta', why: cashWhy }]]),
    worker('returns-cases', 'returns', 'sentinel', 'Casi di prova dei resi', 'Preparo i casi di prova dei resi.', 12, {
      questions: [q('q-late', b, late, ['Sì, vale', 'No, non vale'], { level: 'orchestrator', holder: 'orchestrator', trail: [step('strategist', returns, b, 'asked'), step('strategist', returns, b + 2 * MIN, 'passed', lateWhy), step('orchestrator', 'Orchestrator', b + 2 * MIN, 'asked')] })],
    }, [[b, 'ladderAsked', { question: late, who: returns }], [b + 2 * MIN, 'ladderPassed', { question: late, from: returns, who: 'Orchestrator', why: lateWhy }]]),
    worker('push-phone', 'push', 'sentinel', 'Prova su telefono vero', 'Provo la notifica su un telefono vero.', 9, {
      questions: [q('q-real', c, real, ['Sì, a tutti', 'No, solo a noi'], { level: 'user', trail: [step('strategist', push, c, 'asked'), step('strategist', push, c + 3 * MIN, 'passed', realWhy), step('orchestrator', 'Orchestrator', c + 3 * MIN, 'asked'), step('orchestrator', 'Orchestrator', c + 5 * MIN, 'passed', realWhy2), step('user', 'utente', c + 5 * MIN, 'asked')] })],
    }, [[c, 'ladderAsked', { question: real, who: push }], [c + 3 * MIN, 'ladderPassed', { question: real, from: push, who: 'Orchestrator', why: realWhy }], [c + 5 * MIN, 'ladderPassed', { question: real, from: 'Orchestrator', who: 'utente', why: realWhy2 }]]),
    worker('search-catalog', 'search', 'artisan', 'Ricerca nel catalogo', 'La ricerca nel catalogo si è fermata a metà.', 15, { lastResult: { at: E - 15 * MIN, isError: true } }),
    worker('billing-rates', 'billing', 'artisan', 'Aliquote riga per riga', 'Calcolo le aliquote riga per riga.', 190, { state: 'closed' }),
    worker('export-blocks', 'export', 'artisan', 'Lettura a blocchi', 'Leggo i dati a blocchi di mille.', 41, { state: 'running' }),
    worker('export-memory', 'export', 'artisan', 'Memoria più grande', 'Provo con il doppio della memoria.', 42, { state: 'running' }),
  ];
}
