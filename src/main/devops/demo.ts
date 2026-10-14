// Demo DevOps data (SB_DEMO=1): what devops-me.mjs --json and --prs --json would print for a made-up user, with neutral
// names and example URLs, relative to the demo clock; with --full also the details (description, comments, test cases)
// and each PR's open discussions and last comment; and what qa-status.mjs --mine --json prints ("Test e QA"). Lets the DevOps page, its badges and the feed be seen and tested
// with no Azure login and no network. From the second news read on, a new mention arrives (Marco on the SMS bug): the
// first read is the alerts' baseline, the second shows a DevOps alert with its chime (ADR 0029). Used by demo-wiring.ts (as the runner of a real DevopsService).
import type { RunResult } from '../brain/node';

const ORG = 'https://dev.azure.com/o';
const prUrl = (id: number) => `${ORG}/Shop/_git/shop-web/pullrequest/${id}`;
const wi = (id: number, type: string, title: string, state: string, priority: number, changedAt: string, assignedTo = 'Demo User') =>
  ({ id, type, title, state, project: 'Shop', priority, assignedTo, iteration: 'Shop\\Sprint 42', changedAt, url: `${ORG}/Shop/_workitems/edit/${id}` });
const pr = (id: number, title: string, author: string, createdAt: string) =>
  ({ id, title, repo: 'shop-web', project: 'Shop', author, createdAt, url: prUrl(id) });

const tc = (id: number, title: string, outcome: string | null) => ({ id, title, outcome, url: `${ORG}/Shop/_workitems/edit/${id}` });
function demoDetails(ago: (min: number) => string) {
  return {
    4711: { description: 'Con un reso parziale di un ordine scontato il totale del rimborso usa il prezzo pieno.\n\nPassi:\n1. Ordine con sconto 10% su due righe\n2. Reso di una sola riga\n3. Il rimborso proposto è 50,00 invece di 45,00',
      stateSince: ago(2 * 24 * 60), createdAt: ago(4 * 24 * 60),
      comments: [
        { who: 'Giulia Bianchi', mine: false, at: ago(12), text: '@Demo User riesci a guardarlo prima del rilascio di domani? Il cliente ha già fatto due resi così.' },
        { who: 'Demo User', mine: true, at: ago(26 * 60), text: 'Trovata la causa: lo sconto di riga non entra nel calcolo del reso. Fix nella PR 812.' },
      ],
      tests: [tc(5101, 'Reso parziale con sconto di riga', 'Failed'), tc(5102, 'Reso totale con sconto in testata', 'Passed'), tc(5103, 'Reso senza sconto', null)] },
    4702: { description: 'Il promemoria SMS del giorno prima parte due volte se l’appuntamento è stato spostato.', stateSince: ago(6 * 24 * 60), createdAt: ago(6 * 24 * 60),
      comments: [{ who: 'Sara Neri', mine: false, at: ago(26 * 60), text: 'Succede anche con le email? Allego il log del cliente.' }], tests: [] },
    4688: { description: 'Dal dettaglio fattura un pulsante «Invia PEC» con anteprima del messaggio e ricevuta salvata.', stateSince: ago(5 * 24 * 60), createdAt: ago(20 * 24 * 60),
      comments: [], tests: [tc(5120, 'Invio PEC dal dettaglio fattura', 'Passed')] },
    4630: { description: null, stateSince: ago(9 * 24 * 60), createdAt: ago(9 * 24 * 60), comments: [], tests: [] },
    4650: { description: 'Nel file di export la colonna IVA resta vuota per le fatture con split payment.', stateSince: ago(3 * 60), createdAt: ago(8 * 24 * 60),
      comments: [{ who: 'Sara Neri', mine: false, at: ago(3 * 60), text: 'Verificato in test: la colonna ora è piena. Lo chiudo.' }], tests: [tc(5130, 'Export fatture con split payment', 'Passed')] },
  };
}

/** qa-status.mjs --mine --json: the demo PRs' test plans, one half done with a QA bug, one not started. */
export function demoQa(ago: (min: number) => string) {
  const point = (id: number, tc: number, title: string, outcome: string | null, ranBy: string | null, min: number | null, tester: string, bugs: number[] = []) =>
    ({ id, suite: { id: 7001, name: 'Rimborsi' }, testCase: { id: tc, title, url: `${ORG}/Shop/_workitems/edit/${tc}` }, outcome, done: outcome !== null,
      ranBy, ranAt: min === null ? null : ago(min), tester, configuration: 'Windows 10', bugs });
  const totals = (ps: ReturnType<typeof point>[]) => {
    const by = new Map<string, { name: string; done: number; passed: number; failed: number; blocked: number }>();
    for (const p of ps.filter(x => x.ranBy)) {
      const x = by.get(p.ranBy!) ?? { name: p.ranBy!, done: 0, passed: 0, failed: 0, blocked: 0 };
      x.done++; if (p.outcome === 'passed' || p.outcome === 'failed' || p.outcome === 'blocked') x[p.outcome]++;
      by.set(p.ranBy!, x);
    }
    const n = (o: string) => ps.filter(p => p.outcome === o).length;
    return { total: ps.length, done: ps.filter(p => p.done).length, missing: ps.filter(p => !p.done).length, passed: n('passed'), failed: n('failed'), blocked: n('blocked'),
      notApplicable: n('notApplicable'), other: 0, byPerson: [...by.values()].sort((a, b) => b.done - a.done) };
  };
  const a = [
    point(1, 5101, 'Reso parziale con sconto di riga', 'failed', 'Giulia Bianchi', 50, 'Giulia Bianchi', [5201]),
    point(2, 5102, 'Reso totale con sconto in testata', 'passed', 'Giulia Bianchi', 70, 'Giulia Bianchi'),
    point(3, 5104, 'Reso di un ordine pagato in due rate', 'passed', 'Sara Neri', 3 * 60, 'Sara Neri'),
    point(4, 5105, 'Buono generato dal reso', 'blocked', 'Sara Neri', 4 * 60, 'Sara Neri'),
    point(5, 5103, 'Reso senza sconto', null, null, null, 'Sara Neri'),
    point(6, 5106, 'Report rimborsi del mese', null, null, null, 'Giulia Bianchi'),
  ];
  const b = [
    point(7, 5140, 'Promemoria in un fuso orario diverso', null, null, null, 'Sara Neri'),
    point(8, 5141, 'Promemoria spostato il giorno prima', null, null, null, 'Sara Neri'),
  ];
  const bugs = [
    { id: 5201, title: 'Rimborso parziale: lo sconto di riga si perde con due righe uguali', state: 'Active', open: true, assignedTo: 'Demo User', createdAt: ago(45), url: `${ORG}/Shop/_workitems/edit/5201`, testCases: [5101] },
    { id: 5202, title: 'Il messaggio di conferma del reso è in inglese', state: 'Resolved', open: false, assignedTo: 'Demo User', createdAt: ago(26 * 60), url: `${ORG}/Shop/_workitems/edit/5202`, testCases: [] },
  ];
  return {
    at: ago(0),
    reports: [
      { pr: pr(812, 'Rimborso: lo sconto in origine entra nel totale', 'Demo User', ago(26 * 60)),
        plans: [{ id: 7000, name: 'Rimborsi con sconto', url: `${ORG}/Shop/_testPlans/execute?planId=7000`, points: a, totals: totals(a) }],
        bugs, totals: { ...totals(a), bugs: 2, openBugs: 1 } },
      { pr: pr(809, 'SMS di promemoria: orario nel fuso del cliente', 'Demo User', ago(3 * 24 * 60)),
        plans: [{ id: 7010, name: 'Promemoria SMS nel fuso del cliente', url: `${ORG}/Shop/_testPlans/execute?planId=7010`, points: b, totals: totals(b) }],
        bugs: [], totals: { ...totals(b), bugs: 0, openBugs: 0 } },
    ],
  };
}

export function demoDevopsRun(now: () => number): (script: string, args: string[]) => Promise<RunResult> {
  let newsReads = 0;
  return async (script, args) => {
    const ago = (min: number) => new Date(now() - min * 60_000).toISOString();
    if (script.includes('qa-status')) return { stdout: JSON.stringify(demoQa(ago)), stderr: '', code: 0 };
    const out = args.includes('--prs') ? {
      at: ago(0), me: 'Demo User',
      prs: [
        { ...pr(812, 'Rimborso: lo sconto in origine entra nel totale', 'Demo User', ago(26 * 60)), target: 'master', draft: false, autoComplete: true,
          reviewers: [{ name: 'Giulia Bianchi', vote: 10, label: 'approvata', required: true }, { name: 'Marco Verdi', vote: -5, label: 'in attesa autore', required: false }, { name: 'QA Team', vote: 0, label: 'nessun voto', required: true }],
          build: { result: 'failed', status: 'completed', number: '20261011.4', url: `${ORG}/Shop/_build/results?buildId=9912`, at: ago(40) },
          workItems: [wi(4711, 'Bug', 'Il totale del rimborso ignora lo sconto applicato', 'Active', 2, ago(90))],
          activeThreads: 1, lastComment: { who: 'Marco Verdi', mine: false, at: ago(95), text: 'Manca il test per lo sconto percentuale: aggiungilo in RefundTotalTests e per me è ok.', url: `${prUrl(812)}?discussionId=3` } },
        { ...pr(809, 'SMS di promemoria: orario nel fuso del cliente', 'Demo User', ago(3 * 24 * 60)), target: 'master', draft: true, autoComplete: false,
          reviewers: [{ name: 'Giulia Bianchi', vote: 0, label: 'nessun voto', required: false }],
          build: { result: 'succeeded', status: 'completed', number: '20261009.2', url: `${ORG}/Shop/_build/results?buildId=9870`, at: ago(2 * 24 * 60) },
          workItems: [], activeThreads: 0, lastComment: null },
      ],
      details: demoDetails(ago),
    } : {
      at: ago(0), me: 'Demo User', days: 3,
      news: [
        ...(newsReads++ > 0 ? [{ at: ago(1), kind: 'mention', who: 'Marco', title: 'Promemoria SMS inviati due volte', detail: 'Puoi dirmi se il fix entra nel rilascio di stasera?', body: '@Demo User puoi dirmi se il fix entra nel rilascio di stasera? Il cliente chiama di nuovo.', url: `${ORG}/Shop/_workitems/edit/4702`, key: 'mention:demo-2', item: wi(4702, 'Bug', 'Promemoria SMS inviati due volte', 'New', 2, ago(1)) }] : []),
        { at: ago(12), kind: 'mention', who: 'Giulia', title: 'Il totale del rimborso ignora lo sconto applicato', detail: 'Riesci a guardarlo prima del rilascio di domani?', body: '@Demo User riesci a guardarlo prima del rilascio di domani? Il cliente ha già fatto due resi così.', url: `${ORG}/Shop/_workitems/edit/4711`, key: 'mention:demo-1', item: wi(4711, 'Bug', 'Il totale del rimborso ignora lo sconto applicato', 'Active', 2, ago(12)) },
        { at: ago(40), kind: 'build', who: null, title: 'Rimborso: lo sconto in origine entra nel totale', detail: 'failed (20261011.4)', url: `${ORG}/Shop/_build/results?buildId=9912`, key: 'build:9912', pr: pr(812, 'Rimborso: lo sconto in origine entra nel totale', 'Demo User', ago(26 * 60)) },
        { at: ago(95), kind: 'comment', who: 'Marco', title: 'Rimborso: lo sconto in origine entra nel totale', detail: 'Manca il test per lo sconto percentuale.', body: 'Manca il test per lo sconto percentuale: aggiungilo in RefundTotalTests e per me è ok.', url: `${prUrl(812)}?discussionId=3`, key: 'comment:812:3:1', pr: pr(812, 'Rimborso: lo sconto in origine entra nel totale', 'Demo User', ago(26 * 60)) },
        { at: ago(3 * 60), kind: 'followed', who: 'Sara', title: 'Export fatture: colonna IVA vuota', detail: 'stato Active → Resolved · commento: "Verificato in test: la colonna ora è piena. Lo chiudo."', body: 'Verificato in test: la colonna ora è piena. Lo chiudo.', url: `${ORG}/Shop/_workitems/edit/4650`, key: 'followed:4650:12', item: wi(4650, 'Bug', 'Export fatture: colonna IVA vuota', 'Resolved', 2, ago(3 * 60), 'Sara Neri') },
        { at: ago(5 * 60), kind: 'review', who: 'Bruno', title: 'Magazzino: giacenze negative in rosso', url: prUrl(815), key: 'review:815', pr: pr(815, 'Magazzino: giacenze negative in rosso', 'Bruno Gialli', ago(5 * 60)) },
        { at: ago(26 * 60), kind: 'touched', who: 'Sara', title: 'Promemoria SMS inviati due volte', url: `${ORG}/Shop/_workitems/edit/4702`, key: 'touched:4702:8', item: wi(4702, 'Bug', 'Promemoria SMS inviati due volte', 'New', 2, ago(26 * 60)) },
      ],
      oldReviews: [pr(790, 'Clienti: ricerca per codice fiscale', 'Bruno Gialli', ago(6 * 24 * 60))],
      urgent: [wi(4702, 'Bug', 'Promemoria SMS inviati due volte', 'New', 2, ago(26 * 60))],
      assigned: [
        wi(4711, 'Bug', 'Il totale del rimborso ignora lo sconto applicato', 'Active', 2, ago(12)),
        wi(4702, 'Bug', 'Promemoria SMS inviati due volte', 'New', 2, ago(26 * 60)),
        wi(4688, 'User Story', 'Fatture: invio PEC dal dettaglio', 'Active', 3, ago(2 * 24 * 60)),
        wi(4630, 'Task', 'Aggiornare la guida del modulo ordini', 'New', 4, ago(5 * 24 * 60)),
      ],
      details: demoDetails(ago),
    };
    return { stdout: JSON.stringify(out), stderr: '', code: 0 };
  };
}
