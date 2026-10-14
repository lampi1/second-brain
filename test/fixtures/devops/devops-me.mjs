// Fake ops/tools/devops-me.mjs for the e2e tests (test/e2e/devops.spec.ts): prints what the brain's real script prints
// with --json and --prs --json (with --full: the work items' details and the PRs' last comment), with neutral sample data and example URLs, and no network. When a file "devops-fail"
// sits in the brain folder (two levels up) it exits 2 with the real script's "az login" message, like an expired login.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const brain = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (fs.existsSync(path.join(brain, 'devops-fail'))) {
  console.error('DevOps: login di Azure mancante o scaduto. Lancia: az login');
  process.exit(2);
}
const ORG = 'https://dev.azure.com/o';
const prUrl = id => `${ORG}/Shop/_git/shop-web/pullrequest/${id}`;
const ago = min => new Date(Date.now() - min * 60_000).toISOString();
const wi = (id, type, title, state, priority) => ({ id, type, title, state, project: 'Shop', priority, assignedTo: 'Test User', iteration: 'Shop', changedAt: ago(30), url: `${ORG}/Shop/_workitems/edit/${id}` });
const pr = (id, title) => ({ id, title, repo: 'shop-web', project: 'Shop', author: 'Test User', createdAt: ago(600), url: prUrl(id) });
// --full: what the app shows inside a work item (the real script reads it from DevOps)
const FULL = process.argv.includes('--full');
const tc = (id, title, outcome) => ({ id, title, outcome, url: `${ORG}/Shop/_workitems/edit/${id}` });
const details = !FULL ? {} : { details: {
  4711: { description: 'Con un reso parziale il rimborso usa il prezzo pieno.\nPassi: reso di una riga scontata.', stateSince: ago(2 * 1440), createdAt: ago(4 * 1440),
    comments: [{ who: 'Giulia Bianchi', mine: false, at: ago(12), text: 'Riesci a guardarlo oggi? Il cliente ha già fatto due resi così.' }],
    tests: [tc(5101, 'Reso parziale con sconto di riga', 'Failed'), tc(5102, 'Reso totale con sconto', 'Passed')] },
  4688: { description: 'Pulsante «Invia PEC» nel dettaglio fattura.', stateSince: ago(5 * 1440), createdAt: ago(20 * 1440), comments: [], tests: [] },
} };

if (process.argv.includes('--prs')) {
  console.log(JSON.stringify({ at: ago(0), me: 'Test User', prs: [
    { ...pr(812, 'Rimborso: lo sconto entra nel totale'), target: 'master', draft: false, autoComplete: true,
      reviewers: [{ name: 'Giulia Bianchi', vote: 10, label: 'approvata', required: true }, { name: 'Marco Verdi', vote: -5, label: 'in attesa autore', required: false }],
      build: { result: 'failed', status: 'completed', number: '20261011.4', url: `${ORG}/Shop/_build/results?buildId=9912`, at: ago(40) },
      workItems: [wi(4711, 'Bug', 'Il totale del rimborso ignora lo sconto', 'Active', 2)],
      ...(FULL ? { activeThreads: 1, lastComment: { who: 'Marco Verdi', mine: false, at: ago(95), text: 'Manca il test per lo sconto percentuale.', url: `${prUrl(812)}?discussionId=3` } } : {}) },
  ], ...details }));
} else {
  console.log(JSON.stringify({ at: ago(0), me: 'Test User', days: 3,
    news: [
      { at: ago(12), kind: 'mention', who: 'Giulia', title: 'Il totale del rimborso ignora lo sconto', detail: 'Riesci a guardarlo oggi?', body: 'Riesci a guardarlo oggi? Il cliente ha già fatto due resi così.', url: `${ORG}/Shop/_workitems/edit/4711`, key: 'mention:1' },
      { at: ago(60), kind: 'followed', who: 'Sara', title: 'Export fatture: colonna IVA vuota', detail: 'stato Active → Resolved', url: `${ORG}/Shop/_workitems/edit/4650`, key: 'followed:4650:12' },
    ],
    oldReviews: [pr(790, 'Clienti: ricerca per codice fiscale')],
    urgent: [wi(4702, 'Bug', 'Promemoria SMS inviati due volte', 'New', 2)],
    assigned: [wi(4711, 'Bug', 'Il totale del rimborso ignora lo sconto', 'Active', 2), wi(4688, 'User Story', 'Fatture: invio PEC dal dettaglio', 'Active', 3)],
    ...details,
  }));
}
