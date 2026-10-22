// Demo saved queries (SB_DEMO=1, ADR 0124): a few made-up queries in the demo brain's queries/ folder, one per common
// language, read by the real BrainQueries, so Memoria → Script & Query and its e2e screenshots work without the user's
// brain. Generic content only (example.com hosts). File dates are relative to `now` (frozen demo: the same every run);
// an existing file is not rewritten, so a delete in the demo stays deleted until the demo's userData is reset.
// Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import { queryNote, QUERIES_DIR } from './queries';

const DAY = 24 * 3600e3;
/** name → [language, title, description, runs on, tags, from, code, age in days] */
const QUERIES: [string, string, string, string, string, string[], string, string, number][] = [
  ['clienti-attivi', 'kusto', 'Clienti attivi negli ultimi 30 giorni', 'Clienti con almeno un accesso nell’ultimo mese, con il numero di sessioni: per il report del lunedì.',
    'Azure Data Explorer · cluster demo / database Telemetria', ['clienti', 'report', 'settimanale'], '`clienti/acme.md` (Report), 2026-10-22',
    'Sessions\n| where Timestamp > ago(30d)\n| summarize sessioni = count(), ultimo = max(Timestamp) by CustomerId\n| join kind=inner (Customers | project CustomerId, Name) on CustomerId\n| order by sessioni desc', 1],
  ['ordini-in-ritardo', 'sql', 'Ordini in ritardo di consegna', 'Gli ordini spediti oltre la data promessa, con i giorni di ritardo: da controllare prima della riunione con la logistica.',
    'PostgreSQL · db ordini (sola lettura)', ['ordini', 'logistica'], '`ambienti/test.md` (Controlli), 2026-10-22',
    "SELECT o.id, o.cliente, o.promessa_il, o.spedito_il,\n       o.spedito_il - o.promessa_il AS giorni_ritardo\nFROM ordini o\nWHERE o.spedito_il > o.promessa_il\n  AND o.creato_il >= now() - interval '14 days'\nORDER BY giorni_ritardo DESC;", 3],
  ['errori-5xx-per-servizio', 'promql', 'Errori 5xx per servizio', 'La quota di risposte 5xx per servizio negli ultimi 5 minuti: la prima cosa da guardare quando arriva un allarme.',
    'Prometheus · monitoring.example.com', ['allarmi', 'http'], 'Artisan, 2026-10-18',
    'sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))\n  /\nsum by (service) (rate(http_requests_total[5m]))', 4],
  ['issue-aperte-repo', 'graphql', 'Issue aperte di un repository', 'Le ultime 20 issue aperte con etichette e autore, per il riepilogo del venerdì.',
    'API GraphQL del tracker · api.example.com/graphql', ['issue', 'riepilogo'], '`progetti/app.md` (Riepilogo), 2026-10-22',
    'query IssueAperte($owner: String!, $repo: String!) {\n  repository(owner: $owner, name: $repo) {\n    issues(first: 20, states: OPEN, orderBy: { field: CREATED_AT, direction: DESC }) {\n      nodes { number title author { login } labels(first: 5) { nodes { name } } }\n    }\n  }\n}', 6],
  ['login-falliti', 'spl', 'Login falliti per utente', 'Gli utenti con più di cinque login falliti in un’ora: il controllo di sicurezza del mattino.',
    'Splunk · indice auth', ['sicurezza', 'login'], 'Sentinel, 2026-10-12',
    'index=auth action=failure earliest=-1h\n| stats count AS falliti BY user, src_ip\n| where falliti > 5\n| sort - falliti', 10],
];

export function writeDemoQueries(root: string, now: number): string {
  const dir = path.join(root, QUERIES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, lang, title, description, source, tags, from, code, age] of QUERIES) {
    const file = path.join(dir, `${name}.md`);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, queryNote(lang, code, { title, description, source, tags, from }), 'utf8');
    const at = new Date(now - age * DAY);
    fs.utimesSync(file, at, at);
  }
  return dir;
}
