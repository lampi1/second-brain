// The demo's maintenance findings (ADR 0132): a few made-up cards of a past research, written once into the real store,
// for Memoria → Proposte (a rule for Artisan, a skill section, the never-used «pulizia-ambiente» to forget, one bold
// idea) and «Idee dell'app» (a bug with its issue already written, an idea). And the canned findings a research started
// in the demo proposes while its demo chat answers. Used by demo-wiring.ts.
import type { ResearchProposal } from '../../shared/maintenance-research';
import type { ResearchStore } from './research-store';

type Card = Omit<ResearchProposal, 'id' | 'at' | 'state'>;
const PAST = 'demo-research';

export const DEMO_RESEARCH: readonly Card[] = [
  { chatId: PAST, kind: 'rule', title: 'Artisan lancia i test prima di dire «fatto»',
    adds: 'Una riga nel testo di Artisan: prima di riportare «fatto» lancia i test della parte toccata e scrive il risultato.',
    removes: '', why: '4 lavori di Artisan su 11 nell\'ultimo mese sono stati corretti con «i test erano rossi»: la stessa correzione, sempre dopo il report.',
    evidence: ['run artisan-12, artisan-15, artisan-19, artisan-22: corrections 1 each', 'correzione ripetuta: «hai detto fatto ma i test erano rossi»'],
    sources: [{ title: 'Claude Code: best practices for agentic coding', url: 'https://www.anthropic.com/engineering/claude-code-best-practices' }],
    expected: 'Meno correzioni dopo il report di Artisan: si vede su Apprendimento nelle prossime 20 esecuzioni.', risk: 'Lavori un po\' più lunghi (i test girano sempre). Si torna indietro con «Annulla».',
    change: { target: 'role', role: 'artisan', text: 'Prima di riportare «fatto», lancia i test della parte che hai toccato e scrivi nel report se sono verdi.' } },
  { chatId: PAST, kind: 'skill', title: 'Note di rilascio: il formato che l\'utente corregge sempre',
    adds: 'Una sezione nella skill «note-di-rilascio»: titoli per area, al massimo 5 righe ciascuno, niente nomi di branch.',
    removes: '', why: 'Le ultime 3 note di rilascio sono state riscritte dall\'utente nello stesso modo (titoli per area, niente branch).',
    evidence: ['run artisan-08, artisan-14, artisan-21', 'skill note-di-rilascio: 3 usi, 3 correzioni'], sources: [],
    expected: 'Le prossime note escono già nel formato giusto.', risk: 'Nessuno: tocca solo questa skill.',
    change: { target: 'skill', name: 'note-di-rilascio', text: 'Scrivi le note per area (un titolo per area), al massimo 5 righe per area. Mai nomi di branch o di commit.' } },
  { chatId: PAST, kind: 'forget', title: 'Dimenticare la skill «pulizia-ambiente»',
    adds: '', removes: 'La skill «pulizia-ambiente»: nessun ruolo la carica e nessun lavoro l\'ha usata da quando l\'app tiene il conto.',
    why: '0 usi in 60 giorni su 42 lavori: occupa posto nella scelta delle skill senza aiutare.', evidence: ['skill pulizia-ambiente: 0 usi in 60 giorni'], sources: [],
    expected: 'Una skill in meno tra cui scegliere.', risk: 'Se servisse ancora, «Annulla» la rimette com\'era.',
    forget: { what: 'skill', name: 'pulizia-ambiente', lastUsed: null, uses: 0 } },
  { chatId: PAST, kind: 'bold', title: 'Le correzioni diventano un test da rifare',
    adds: 'Ogni lavoro corretto dall\'utente diventa un caso da rifare: una modifica al brain si tiene solo se quei casi vanno meglio.',
    removes: 'Le modifiche tenute solo perché «sembrano giuste».', why: 'Delle 9 modifiche del mese, 3 non hanno cambiato le correzioni e 1 le ha peggiorate (Apprendimento).',
    evidence: ['Apprendimento: 3 «nessun effetto», 1 «peggiora» su 9'], sources: [],
    expected: 'Solo modifiche che migliorano davvero; si misura con le correzioni per lavoro.', risk: 'Costa token rifare i casi: va tenuto un tetto.',
    issue: { title: 'Replay of corrected runs as the gate for brain changes', labels: ['enhancement'],
      body: '**Context**\n\nThe maintenance keeps brain changes without checking them on the user\'s own corrected runs.\n\n**Proposal**\n\nTurn each run the user corrected into a replay case; keep a change only when the replay improves.\n\n**How to verify**\n\nOn the Apprendimento page, the share of changes with «peggiora» goes to zero over 20 runs.' } },
  { chatId: PAST, kind: 'app-bug', title: 'La lettura delle novità di DevOps fallisce con HTTP 503',
    adds: '', removes: 'L\'errore «Lettura delle novità failed» che torna ogni ora.', why: 'Nei log dell\'app: 12 errori uguali in 2 giorni, sempre sulla query wiql.',
    evidence: ['task | Lettura delle novità failed | Error: HTTP 503 on wiql ×12'], sources: [], expected: '', risk: '',
    issue: { title: 'Tasks: DevOps news read fails with HTTP 503 on wiql and is retried every hour', labels: ['bug'],
      body: '**What happens**\n\nThe Azure DevOps news read fails with `HTTP 503 on wiql` and the app retries it every hour, logging the same error.\n\n**Evidence**\n\n- log group `task | Lettura delle novità failed | Error: HTTP 503 on wiql`, 12 times in 2 days\n\n**Proposal**\n\nBack off after a 503 (15, 30, 60 minutes) and show the connector as «non raggiungibile» instead of logging each retry.\n\n**To verify**\n\nWith the service down, the log shows one line per back-off step, not one per hour.' } },
  { chatId: PAST, kind: 'app-idea', title: 'Stima del costo prima di avviare la ricerca',
    adds: 'Nel dialogo della Manutenzione, la stima dice anche quanto è costata l\'ultima ricerca simile.', removes: '',
    why: 'La stima mostra solo la mediana: con poche ricerche non dice se l\'ultima era più cara.', evidence: ['3 ricerche: 1,80 $, 2,40 $, 4,10 $'], sources: [], expected: '', risk: '',
    issue: { title: 'Maintenance dialog: show the last research\'s cost beside the median', labels: ['enhancement'],
      body: '**Context**\n\nThe dialog shows the median cost of past researches only.\n\n**Proposal**\n\nShow the last research\'s cost and model beside the median.\n\n**To verify**\n\nAfter two researches, the dialog shows both numbers.' } },
];

/** Written once (an empty store): the cards above, as a past research made them. */
export function writeDemoResearch(store: ResearchStore, now: number): void {
  if (store.all().length || store.runs().length) return;
  for (const c of DEMO_RESEARCH) store.add(c);
  store.saveRun({ chatId: PAST, startedAt: now - 3 * 86_400_000, endedAt: now - 3 * 86_400_000 + 14 * 60_000, harness: 'claude', model: 'opus', effort: 'high', capUsd: 5, costUsd: 2.4, state: 'done', proposals: DEMO_RESEARCH.length });
}

/** What a research started in the demo proposes while its chat answers. */
export const DEMO_LIVE: readonly Record<string, unknown>[] = [
  { kind: 'memory', title: 'Il server di staging si chiama «stg-eu»', adds: 'Un fatto nella memoria condivisa: il server di staging è «stg-eu» (non «staging-1»).', removes: '',
    why: 'In 3 lavori su 5 di questa settimana Scout ha cercato «staging-1», che non esiste più.', evidence: ['run scout-31, scout-33, scout-36'], expected: 'Nessuna ricerca a vuoto del server.', risk: 'Se il nome cambia di nuovo, va aggiornato.',
    change: { text: 'Il server di staging si chiama stg-eu (staging-1 non esiste più).' } },
  { kind: 'app-idea', title: 'Un filtro «solo errori» nella pagina Log', adds: 'Un interruttore nella pagina Log che mostra solo gli errori.', removes: '',
    why: 'La pagina Log ha 400 righe al giorno, di cui 6 errori: oggi si scorre a mano.', evidence: ['log: 412 righe, 6 error, 2026-10-22'], expected: '', risk: '',
    issue: { title: 'Log page: an «only errors» switch', labels: ['enhancement'], body: '**Context**\n\nThe Log page lists every line of the day.\n\n**Proposal**\n\nAdd a switch that shows only errors.\n\n**To verify**\n\nWith the switch on, only `error` lines are listed.' } },
];
