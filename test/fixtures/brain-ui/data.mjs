// Test fixture for the brain pages of the UI (test/e2e/brain-ui.spec.ts): a synthetic brain with the same API shapes
// as a real brain's data server (ops/tools/brain-site.mjs: /api/tables, now, cost, day, map, files, file, search,
// version), dates relative to "today" so every run looks current. Fictional content only (the repo is public): the
// owner is "Alex", work areas are generic, links point to dev.example.com. Pure: build(now) returns the whole dataset.
// The map's labels come in English when SB_LANG=en (the README screenshots, test/shots/readme.spec.ts); Italian otherwise.

const DAY = 864e5;
const iso = t => new Date(t).toISOString();
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dm = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
// deterministic pseudo-random numbers (same data every run)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const OWNER = 'Alex';

/** opts.mapExtra adds that many synthetic notes to the full map (clusters of linked notes under a few areas, plus
 *  some loose ones), to see the brain map with a large brain (issue #77). */
export function build(now = Date.now(), opts = {}) {
  const today = ymd(now);
  const d = n => ymd(now - n * DAY);
  const r = rng(42);

  // ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const types = ['fatto-non-verificato', 'non-capito', 'regola-ignorata', 'richiesta-fraintesa', 'azione-pericolosa', 'fuori-ruolo', 'test-passato-a-torto', 'altro'];
  const chats = ['Orchestrator', 'Prodotto · Fix calcolo sconto', 'Clienti · Export fatture', 'OS · Mappa 3D', 'QA ordini', 'OS · Agenti'];
  const errors = [];
  for (let i = 0; i < 46; i++) {
    const t = types[Math.min(types.length - 1, Math.floor(r() * r() * types.length * 1.4))];
    const day = d(Math.floor(r() * 14));
    errors.push({ data: day, ora: `${String(8 + Math.floor(r() * 12)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`, chi: chats[i % chats.length], area: ['QA', 'produzione', 'PR', 'memoria', 'mappa 3D'][i % 5], tipo: t,
      detto: ['test case passato', 'il deploy è finito', 'la query è sola lettura', 'nessun file cambiato', 'la PR è verde'][i % 5],
      vero: ['passo 2 saltato, non verificato', 'deploy ancora in coda', 'la query scriveva una tabella temporanea', 'due file cambiati', 'build rossa su un test'][i % 5],
      visto: i % 3 ? `${OWNER}` : 'agente stesso (reviewer)', regola: i % 4 === 0 ? 'rules/qa.md "verifica sempre lo screenshot"' : '', riga: '' });
  }
  errors.sort((a, b) => a.data.localeCompare(b.data));
  const wins = [
    { data: d(0), ora: '10:12', harness: 'claude', chat: 'Orchestrator', area: 'Orchestrator', esito: 'pieno', parole: 'perfetto, ora è chiaro', consegnato: 'Il piano della giornata in 3 righe, con il prossimo passo per ogni filo.' },
    { data: d(1), ora: '17:40', harness: 'claude', chat: 'OS · Mappa 3D', area: 'OS', esito: 'parziale', parole: 'bella, però i nomi si sovrappongono', consegnato: 'La mappa 3D con la vista essenziale e i percorsi passo per passo.' },
    { data: d(2), ora: '12:03', harness: 'cursor', chat: 'Prodotto · Fix calcolo sconto', area: 'Prodotto', esito: 'pieno', parole: 'ora funziona', consegnato: 'Fix del calcolo dello sconto con test rosso → verde.' },
    { data: d(3), ora: '09:30', harness: 'claude', chat: 'Orchestrator', area: 'Orchestrator', esito: 'pieno', parole: 'grazie, esattamente questo', consegnato: 'Il riepilogo delle mail della notte.' },
    { data: d(5), ora: '15:22', harness: 'claude', chat: 'QA ordini', area: 'QA', esito: 'pieno', parole: 'perfetto', consegnato: '9 test case su 9 con screenshot.' },
  ];
  const journal = [];
  const jl = (day, ora, tag, testo) => journal.push({ data: day, ora, tag, area: /^\[personale\]/.test(testo) ? 'personale' : 'lavoro', testo: testo.replace(/^\[personale\]\s*/, ''), utc: false });
  jl(d(2), '09:10', 'fatto', 'Prodotto · Fix calcolo sconto: PR aperta con test rosso → verde');
  jl(d(2), '16:45', 'lezione', 'Un test che passa al primo colpo va guardato due volte');
  jl(d(1), '09:05', 'fatto', 'QA ordini: 9 test case passati su test 3, screenshot nel report');
  jl(d(1), '11:20', 'decisione', 'Export fatture: si parte dal CSV, il PDF dopo');
  jl(d(1), '14:02', 'attrito', 'Login scaduto sul nodo di test: 20 minuti persi');
  jl(d(1), '18:30', 'fatto', '[personale] OS · Mappa 3D: vista essenziale in main');
  jl(d(0), '08:50', 'fatto', 'Clienti · Export fatture: prima versione del CSV verificata a mano');
  jl(d(0), '10:40', 'verificato', 'Prodotto · Fix calcolo sconto: build verde dopo il rebase');
  jl(d(0), '11:15', 'decisione', 'Le chat finite sopra 200k di contesto si chiudono');
  jl(d(0), '12:30', 'lezione', 'La stima dei costi va sempre mostrata con il suo intervallo');
  jl(d(0), '13:05', 'fatto', 'Procedure · pagina Procedure al posto di Comunicazione');
  const nowRows = [
    { sezione: 'Lavoro', filo: 'Prodotto · Fix calcolo sconto', dove: 'PR 51002, branch fix/sconto', prossimo: 'prossimo: aspetta la revisione della PR 51002', stato: 'build verde', aggiornato: d(0) },
    { sezione: 'Lavoro', filo: 'Clienti · Export fatture', dove: 'chat Clienti · Export fatture', prossimo: `prossimo: ${OWNER} decide se il PDF entra in questa versione`, stato: 'CSV fatto', aggiornato: d(1) },
    { sezione: 'Lavoro', filo: 'QA ordini', dove: 'test 3', prossimo: 'prossimo: rieseguire il test case 7 dopo il fix #90680', stato: '8 su 9 passati', aggiornato: d(2) },
    { sezione: 'Lavoro', filo: 'Produzione · lentezza login', dove: 'runbook lentezza', prossimo: 'aspetta i log di stanotte', stato: 'in osservazione', aggiornato: d(5) },
    { sezione: 'Lavoro', filo: 'Prodotto · Stampa elenco', dove: 'PR 51004', prossimo: 'prossimo: scegli tra le due opzioni di layout', stato: 'bozza', aggiornato: d(9) },
    { sezione: 'Personale e OS', filo: 'OS · Mappa 3D', dove: 'worktree mappa-3d', prossimo: 'prossimo: i nomi non si sovrappongono più', stato: 'v2 in main', aggiornato: d(1) },
    { sezione: 'Personale e OS', filo: 'OS · Costi per chat', dove: 'ops/tools/cost.mjs', prossimo: 'prossimo: aggiungere il risparmio per chat lunga', stato: '', aggiornato: d(4) },
    { sezione: 'Personale e OS', filo: 'Pers · Lettura serale', dove: '', prossimo: 'resta: nessuna fretta', stato: '', aggiornato: d(12) },
    { sezione: 'Agenti e sessioni attive', filo: 'Orchestrator', dove: 'chat principale', prossimo: 'prossimo: scaletta di domani', stato: 'al lavoro', aggiornato: d(0) },
    { sezione: 'Agenti e sessioni attive', filo: 'OS · Agenti', dove: 'worktree agenti', prossimo: 'FATTO: taccuini dei 7 specialisti', stato: '', aggiornato: d(3) },
  ];
  const idea = (o) => ({ data: today, area: 'personale', titolo: '', stato: 'aperta', idea: '', come: '', perche: '', riprendere: '', fonte: '', per: '', notato: '', penso: '', sicurezza: '', nonso: '', testo: '', chi: OWNER, scaduta: '', ...o });
  const ideas = [
    idea({ data: d(20), area: 'lavoro', titolo: 'Un comando per riaprire l\'ultima QA', stato: 'aperta', idea: 'Riaprire la QA interrotta dal punto in cui era.', riprendere: d(3), scaduta: d(3), testo: '- **Idea:** riaprire la QA interrotta dal punto in cui era.\n- **Riprendere:** ' + d(3) }),
    idea({ data: d(15), area: 'personale', titolo: 'Diario vocale a fine giornata', stato: 'in corso', idea: 'Dettare tre righe a fine giornata.', riprendere: 'quando la dettatura è affidabile', testo: '- **Idea:** dettare tre righe a fine giornata.' }),
    idea({ data: d(11), area: 'lavoro', titolo: 'Template per i bug con screenshot', stato: 'fatta', idea: 'Un modello unico per aprire un bug.', testo: '- **Idea:** un modello unico.' }),
    idea({ data: d(8), area: 'personale', titolo: 'Pausa automatica dei test lenti', stato: 'aperta', idea: 'Fermare i test oltre 10 minuti e avvisare.', riprendere: d(-2), scaduta: d(-2), testo: '- **Idea:** fermare i test lenti.' }),
    idea({ data: d(6), area: 'lavoro', titolo: 'Vista unica delle PR in revisione', stato: 'scartata', idea: 'Tutte le PR da rivedere in una pagina.', testo: '- **Idea:** tutte le PR in una pagina.' }),
    idea({ data: d(4), area: 'personale', titolo: 'Una chat finita si chiude da sola', stato: 'aperta', chi: 'IA', fonte: 'IA · Orchestrator, revisione serale', per: 'second-brain', idea: 'Quando una chat ha finito, si chiude; il lavoro nuovo parte in una chat nuova.', notato: 'tre chat finite hanno continuato a rileggere 400k token di storia', penso: 'chiuderle farebbe risparmiare un terzo della spesa', sicurezza: 'media: misurato su 7 giorni', nonso: 'se ti serve rileggerle il giorno dopo', come: 'l’Orchestrator propone di chiudere le chat finite sopra 200k', testo: '- **Idea:** chiudere le chat finite.' }),
    idea({ data: d(2), area: 'personale', titolo: 'Le domande in fila, una alla volta', stato: 'aperta', chi: 'IA', fonte: 'IA · OS · Agenti', per: OWNER.toLowerCase(), idea: 'Le domande delle chat arrivano una alla volta, la più vecchia prima.', notato: 'ieri quattro domande sono arrivate insieme e due sono rimaste senza risposta', penso: 'una fila unica riduce le domande perse', sicurezza: 'alta', nonso: 'se preferisci vederle tutte insieme', testo: '- **Idea:** una fila unica.' }),
    idea({ data: d(1), area: 'personale', titolo: 'Rileggere i propri errori prima di dire "fatto"', stato: 'aperta', chi: 'IA', fonte: 'IA · Orchestrator', per: 'ia', idea: 'Prima di dire fatto, controllo gli ultimi errori dello stesso tipo.', notato: 'il 40% dei miei errori è "fatto non verificato"', penso: 'un controllo di 10 secondi lo dimezza', sicurezza: 'bassa', nonso: 'quanto rallenta le risposte', testo: '- **Idea:** controllare prima.' }),
    idea({ data: d(9), area: 'personale', titolo: 'Spesa per tipo di lavoro nel brief', stato: 'fatta', chi: 'IA', fonte: 'IA · OS · Costi per chat', per: 'second-brain', idea: 'Il brief mostra la spesa per tipo di lavoro.', notato: 'leggere costa più di scrivere', penso: 'vederlo ogni mattina cambia le abitudini', sicurezza: 'media', testo: '- **Idea:** spesa nel brief.' }),
  ];
  const reflections = [
    { data: d(0), chat: 'Orchestrator', titolo: 'Ho fatto più da centralino che da orchestrator', notato: 'ieri ho girato decine di messaggi tra te e sei chat; due volte una tua risposta in una chat contraddiceva quella data a me.', penso: 'meglio che le chat si scrivano tra loro e io tenga solo le decisioni.', sicurezza: 'media: un giorno solo', nonso: 'se ti fidi delle chat che si scrivono da sole' },
    { data: d(3), chat: 'OS · Agenti', titolo: 'Gli specialisti imparano solo se li correggi', notato: 'i taccuini crescono solo nei giorni con molte correzioni.', penso: 'una lode vale quanto una correzione per imparare.', sicurezza: 'bassa', nonso: 'come contare le lodi parziali' },
  ];
  const pst = ['proposta', 'accettata', 'applicata', 'confermata', 'rifiutata', 'inutile', 'peggiorata'];
  const ptype = ['regola', 'script', 'hook', 'agente', 'permesso'];
  const proposals = Array.from({ length: 34 }, (_, i) => ({ id: `P-${String(i + 1).padStart(3, '0')}`, data: d(30 - i), proposta: ['Le chat creano i dati di test senza chiedere', 'Un hook ferma i comandi di produzione', 'Lo specialista QA usa sempre lo screenshot', 'L’Orchestrator riparte ogni mattina', 'Un tool unico per la memoria'][i % 5], tipo: ptype[Math.floor(r() * r() * 5)], stato: pst[Math.floor(r() * 7)], dettaglio: 'metrica: blocchi sui dati di test, 2 → 0' }));
  const bugs = Array.from({ length: 16 }, (_, i) => ({ data: d(28 - i * 2), area: ['App web/fatture', 'App web/QA', 'API/login', 'App web/stampa'][i % 4], bug: ['totale ricalcolato prima dello sconto', 'campo data vuoto dopo il salvataggio', 'sessione non rinnovata', 'colonna tagliata in stampa'][i % 4], pattern: ['R1', 'R2', 'R3', 'R1'][i % 4], fonte: i % 2 ? 'reviewer' : 'QA', rif: `PR ${52000 + i}` }));
  const measures = Array.from({ length: 7 }, (_, i) => {
    const b = { correzione: 12 - i, non_capito: 4 - Math.floor(i / 2), sollecito: 3, testo_lungo: 20 - i * 2, ok_fuori_orchestrator: 6 - Math.floor(i / 3) };
    return { date: d(6 - i), metric: 'interventi_forzati', value: Object.values(b).reduce((a, x) => a + x, 0), breakdown: b, human: 90 + i * 3, model: 'claude-opus-5-5', brain: `a1b2c${i}d`, recorded: iso(now - (6 - i) * DAY) };
  });
  const envs = [];
  const envNames = ['stack-locale', 'nodo-test-2', 'nodo-test-3', 'pannello-browser'];
  for (let i = 0; i < 18; i++) {
    const t = now - (9 - i / 2) * DAY;
    const env = envNames[i % 4];
    envs.push({ ts: iso(t), env, chat: chats[(i + 1) % chats.length], action: 'take', why: 'verifica solo lettura' });
    if (i % 5 === 2) envs.push({ ts: iso(t + 6e5), env, chat: chats[(i + 2) % chats.length], action: 'wait' });
    envs.push({ ts: iso(t + 18e5), env, chat: chats[(i + 1) % chats.length], action: 'release', heldMin: 10 + Math.floor(r() * 50) });
  }
  // held right now (no release yet): the Collaborazione page shows it on top
  envs.push({ ts: iso(now - 25 * 6e4), env: 'test-2', chat: 'QA ordini', action: 'take', why: 'test case 7, build 4.12' });
  const recurrence = {
    totals: types.map(t => [t, errors.filter(e => e.tipo === t).length]).sort((a, b) => b[1] - a[1]),
    rules: [
      { date: d(20), type: 'fatto-non-verificato', area: 'QA', rule: 'rules/qa.md "verifica sempre lo screenshot"', again: 3, againLines: [] },
      { date: d(18), type: 'azione-pericolosa', area: 'produzione', rule: 'safety "produzione: propone l\'agente"', again: 0, againLines: [] },
      { date: d(15), type: 'non-capito', area: 'Orchestrator', rule: 'stile "domande una alla volta"', again: 1, againLines: [] },
      { date: d(10), type: 'regola-ignorata', area: 'memoria', rule: 'map.md "dove salvare"', again: 0, againLines: [] },
      { date: d(7), type: 'fuori-ruolo', area: 'PR', rule: 'code.md "codice degli altri"', again: 0, againLines: [] },
      { date: d(4), type: 'test-passato-a-torto', area: 'QA', rule: 'rules/qa.md "mai passare ciò che la QA boccia"', again: 0, againLines: [] },
    ],
  };
  // recurrence.mjs quality(): who saw each error per day (the owner's name in the real brain), rules in a 14-day window
  const seen = new Map();
  for (const e of errors) { const x = seen.get(e.data) ?? { date: e.data, owner: 0, other: 0, unknown: 0 }; x[e.visto === OWNER ? 'owner' : 'other']++; seen.set(e.data, x); }
  const quality = {
    today, windowDays: 14, from: errors[0].data, to: errors.at(-1).data, lines: errors.length + 3, typed: errors.length - 4,
    unparsed: [0, 1, 2].map(i => ({ date: d(i + 1), line: `- ${d(i + 1)} 10:0${i} · Orchestrator · app · disattenzione · testo senza i campi detto e vero` })),
    invalid: [['bug-introdotto', 2], ['shell', 3], ['bug-introdotto', 5], ['conto parziale', 6]].map(([type, n]) => ({ date: d(n), type, line: '' })),
    seenByDay: [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)),
    totals: recurrence.totals,
    rules: [
      { date: d(20), type: 'fatto-non-verificato', area: 'QA', rule: 'rules/qa.md "verifica sempre lo screenshot"', status: 'tornato', ageDays: 20, again: [{ date: d(12), line: '' }] },
      { date: d(18), type: 'azione-pericolosa', area: 'produzione', rule: 'safety "produzione: propone l’agente"', status: 'non-tornato', ageDays: 18, again: [] },
      { date: d(15), type: 'non-capito', area: 'Orchestrator', rule: 'stile "domande una alla volta"', status: 'non-tornato', ageDays: 15, again: [] },
      { date: d(10), type: 'regola-ignorata', area: 'memoria', rule: 'map.md "dove salvare"', status: 'troppo-presto', ageDays: 10, again: [] },
      { date: d(7), type: 'fuori-ruolo', area: 'PR', rule: 'code.md "codice degli altri"', status: 'tornato', ageDays: 7, again: [{ date: d(3), line: '' }] },
      { date: d(4), type: 'test-passato-a-torto', area: 'QA', rule: 'rules/qa.md "mai passare ciò che la QA boccia"', status: 'troppo-presto', ageDays: 4, again: [] },
      { date: d(2), type: 'bug-introdotto', area: 'app', rule: 'code.md "test rosso prima del fix"', status: 'senza-tipo', ageDays: 2, again: [] },
    ],
  };
  const boxes = [
    { box: 'orchestrator', unread: 0, listening: true, since: iso(now - 3 * 36e5) },
    { box: 'prodotto-fix-calcolo-sconto', unread: 0, listening: true, since: iso(now - 36e5) },
    { box: 'clienti-export-fatture', unread: 2, listening: false, since: null },
    { box: 'os-mappa-3d', unread: 0, listening: false, since: null },
    { box: 'qa-ordini', unread: 0, listening: true, since: iso(now - 2 * 36e5) },
    { box: 'os-agenti', unread: 1, listening: false, since: null },
  ];
  const stats = {
    'os-agenti -> os-mappa-3d': { sent: 6, delivered: 6 }, 'orchestrator -> qa-ordini': { sent: 5, delivered: 4 },
    'os-mappa-3d -> os-agenti': { sent: 4, delivered: 4 }, 'qa-ordini -> orchestrator': { sent: 3, delivered: 3 }, 'orchestrator -> clienti-export-fatture': { sent: 2, delivered: 0 },
  };
  const log = [];
  for (const [pair, s] of Object.entries(stats)) {
    const [from, to] = pair.split(' -> ');
    for (let i = 0; i < s.sent; i++) {
      const t = now - (3 - i * 0.4) * DAY - log.length * 6e5;
      log.push({ ts: iso(t), action: 'sent', id: `m${log.length}`, from, to, hop: i + 1 });
      if (i < s.delivered) log.push({ ts: iso(t + 9e4), action: 'delivered', id: `m${log.length}`, from, to, via: i % 2 ? 'hook-claude' : 'wait' });
    }
  }
  // a month of older mail, so the mail log is long enough to be virtualized (1000+ rows)
  const pairsList = Object.keys(stats).map(p => p.split(' -> '));
  for (let i = 0; i < 1100; i++) {
    const [from, to] = pairsList[i % pairsList.length];
    const t = now - 4 * DAY - i * 37 * 6e4;
    log.push({ ts: iso(t), action: i % 2 ? 'delivered' : 'sent', id: `old${i}`, from, to, ...(i % 2 ? { via: i % 4 === 1 ? 'wait' : 'hook-claude' } : { hop: 1 + (i % 3) }) });
  }
  log.sort((a, b) => a.ts.localeCompare(b.ts));
  const tables = {
    today, errors, wins, journal, now: nowRows, ideas, reflections, proposals, bugs, measures, envs,
    briefs: [`journal/brief/${d(1)}.md`, `journal/brief/${today}.md`], recurrence, quality, inbox: { boxes, stats, log },
  };

  // ── now (chats.mjs + mailbox + now.md line) ─────────────────────────────────────────────────────────────────────
  const ch = (o) => ({ harness: 'Claude', folder: 'workspace', when: `${dm(now)}, 10:00`, state: 'finito', id: 'c0000000', ageMin: 5, box: null, now: null, ...o });
  const nowLine = filo => nowRows.find(x => x.filo === filo) ?? null;
  const nowData = {
    chats: [
      ch({ title: 'QA ordini', state: 'aspetta te (domanda)', id: 'c1000001', ageMin: 12, box: { name: 'qa-ordini', listening: true, unread: 0 }, now: nowLine('QA ordini'), last: 'Il test case 7 fallisce anche su master: apro un bug o lo segno e vado avanti?', [`last${OWNER}`]: 'riprendi dal test case 7' }),
      ch({ title: 'Clienti · Export fatture', state: 'aspetta te (permesso)', id: 'c1000002', ageMin: 40, box: { name: 'clienti-export-fatture', listening: false, unread: 2 }, now: nowLine('Clienti · Export fatture'), last: 'Permesso: git commit sul branch della PR 51002' }),
      ch({ title: 'Prodotto · Fix calcolo sconto', harness: 'Cursor', state: 'in corso', id: 'c1000003', ageMin: 2, box: { name: 'prodotto-fix-calcolo-sconto', listening: true, unread: 0 }, now: nowLine('Prodotto · Fix calcolo sconto'), last: 'Ho trovato la causa: il totale si ricalcola prima dello sconto. Correggo e rilancio i test.', [`last${OWNER}`]: 'vai pure' }),
      ch({ title: 'Orchestrator', state: 'in corso', id: 'c1000004', ageMin: 1, box: { name: 'orchestrator', listening: true, unread: 0 }, now: nowLine('Orchestrator'), last: 'Preparo la scaletta di domani: tre cose attorno alle due call.' }),
      ch({ title: 'OS · Mappa 3D', state: 'finito', id: 'c1000005', ageMin: 95, folder: 'workspace (worktree)', box: { name: 'os-mappa-3d', listening: false, unread: 0 }, now: nowLine('OS · Mappa 3D') }),
      ch({ title: 'OS · Agenti', state: 'fermo', id: 'c1000006', ageMin: 600, box: { name: 'os-agenti', listening: false, unread: 1 }, now: nowLine('OS · Agenti') }),
      ch({ title: 'Ricerca librerie grafici', harness: 'Cursor', state: 'finito', id: 'c1000007', ageMin: 1300 }),
    ],
    boxes,
  };

  // ── cost (cost.mjs --json) ─────────────────────────────────────────────────────────────────────────────────────
  const cost = days => {
    const rc = rng(7 + days);
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) { const u = i === 0 ? 38.2 : 20 + Math.round(rc() * 60 * 100) / 100 + (i % 7 === 3 ? 25 : 0); byDay[d(i)] = { usd: u, calls: Math.round(u * 12) }; }
    const total = Object.values(byDay).reduce((a, x) => a + x.usd, 0);
    const split = (parts) => Object.fromEntries(parts.map(([k, w]) => [k, { usd: total * w, calls: Math.round(total * w * 12) }]));
    const chatsList = Array.from({ length: Math.min(60, 8 + days * 3) }, (_, i) => {
      const usd = Math.round(total * 0.3 / (i + 1.4) * 100) / 100;
      return { title: [...chats, 'Ricerca librerie grafici', 'Pers · Lettura serale', 'Prodotto · Stampa elenco'][i % 9] + (i >= 9 ? ` (${Math.floor(i / 9) + 1})` : ''), folder: i % 3 ? 'C:\\work\\app' : 'C:\\work\\brain', usd, calls: Math.round(usd * 14), ctxMax: Math.round(80000 + rc() * 700000), from: now - (i % days + 1) * DAY, to: now - (i % days) * DAY - i * 6e5, longSave: i % 3 === 0 ? Math.round(usd * 0.3 * 100) / 100 : 0 };
    });
    return {
      from: d(days - 1), to: today, total, calls: Math.round(total * 12), responses: Math.round(total * 10), byDay,
      byModel: { '<synthetic>': { usd: 0, calls: 0 }, ...split([['opus-5-5', 0.86], ['sonnet-5-5', 0.11], ['haiku-5-5', 0.03]]) },
      byKind: split([['leggere', 0.24], ['altri comandi', 0.2], ['testo e ragionamento', 0.12], ['scrivere file', 0.1], ['browser', 0.08], ['coordinare chat', 0.06], ['build e test', 0.05], ['DevOps', 0.04], ['memoria', 0.04], ['web', 0.03], ['SQL', 0.02], ['pannelli', 0.02]]),
      byArea: split([['Orchestrator', 0.24], ['Prodotto', 0.22], ['Clienti', 0.18], ['OS', 0.14], ['Produzione', 0.05], ['Pers', 0.09], ['altro', 0.08]]),
      chats: chatsList, long: total * 0.45, longSave: total * 0.28, uncalibrated: [d(0)],
      cursor: { total: 4.2 * Math.min(days, 7) / 7 + 1, byDay: { [d(1)]: { usd: 3.1, calls: 12 } }, byModel: { 'fast-model': { usd: 3.1, calls: 12 } }, file: 'usage.csv', downloaded: iso(now - DAY), lastRow: iso(now - DAY - 36e5) },
      fixed: { chars: 14200, usd: total * 0.012 },
      advice: [
        { usd: total * 0.28, text: `Chat lunghe: 5 chat oltre 400k token di contesto; ripartire (chat nuova o /clear) a ~200k avrebbe risparmiato ~${Math.round(total * 0.28)} $. Le più care: Orchestrator, QA ordini` },
        { usd: total * 0.07, text: 'Orchestrator: 24% della spesa: l’Orchestrator resta "libera" solo se fa poche chiamate e riparte spesso' },
        { usd: total * 0.04, text: 'Browser: i passi fissi di QA vanno in script (E2E)' },
        { usd: total * 0.01, text: 'Contesto fisso del cervello: 14.2k caratteri: pesa poco, accorciarlo non è la leva' },
      ],
    };
  };

  // ── map (brain-map.mjs --json) ─────────────────────────────────────────────────────────────────────────────────
  // the map in English when the UI is (SB_LANG=en: the README screenshots); anything without an entry stays as written
  const MAP_EN = {
    'tu e i colleghi': 'you and your colleagues',
    'l’Orchestrator e le chat di lavoro': 'the Orchestrator and the work chats',
    'specialisti, taccuini, skill': 'specialists, notebooks, skills',
    'script e hook che scattano da soli': 'scripts and hooks that fire by themselves',
    'dove il cervello scrive quello che succede': 'where the brain writes what happens',
    'come devono lavorare gli agenti': 'how the agents must work',
    'servizi fuori dal PC e i due programmi': 'services outside the PC and the two programs',
    'Persone': 'People',
    'Chat': 'Chats',
    'Agenti e skill': 'Agents and skills',
    'Tool e hook': 'Tools and hooks',
    'Memoria': 'Memory',
    'Regole': 'Rules',
    'Esterni': 'External',
    'decide e lancia lui la produzione': 'decides, and runs production himself',
    'Lo sviluppatore: lavora con le chat, decide.': 'The developer: works with the chats, decides.',
    'Colleghi e QA': 'Colleagues and QA',
    'chi taggare e come scrivere': 'whom to tag and how to write',
    'Colleghi, ruoli, chi taggare.': 'Colleagues, roles, whom to tag.',
    'l\'unica chat con cui parli': 'the one chat you talk to',
    'La chat che coordina le altre.': 'The chat that coordinates the others.',
    'Chat di lavoro': 'Work chats',
    'una per ogni lavoro vero': 'one for every real job',
    'Le chat aperte dall’Orchestrator.': 'The chats the Orchestrator opens.',
    'il programma delle chat': 'the chats’ program',
    'l\'altro programma': 'the other program',
    'Revisore del codice': 'Code reviewer',
    'rilegge ogni diff prima del fatto': 'reads every diff before done',
    'Revisione di correttezza.': 'Correctness review.',
    'Tester nel browser': 'Browser tester',
    'esegue i test case': 'runs the test cases',
    'QA nel browser.': 'QA in the browser.',
    'comandi brevi: /stato, /opzioni…': 'short commands: /stato, /opzioni…',
    'Stato di tutto': 'Status of everything',
    'Stato di tutto il lavoro aperto': 'Status of all open work',
    'Cosa posso fare': 'What can I do',
    'Cosa puoi fare adesso': 'What you can do now',
    'Spiegami a domande': 'Explain with questions',
    'Spiega a domande': 'Explains with questions',
    'Urgenze': 'Urgent',
    'Corsia urgenze': 'The urgent lane',
    'Scrittura memoria': 'Memory writer',
    'scrive la memoria, una riga': 'writes memory, one line',
    'Il tool unico della memoria.': 'The one memory tool.',
    'Posta tra chat': 'Mail between chats',
    'la posta tra chat': 'mail between chats',
    'Caselle di posta tra chat.': 'Mailboxes between chats.',
    'Costi del cervello': 'Brain costs',
    'quanto costa e dove': 'what it costs and where',
    'I costi per giorno, modello, chat.': 'Costs by day, model, chat.',
    'scattano da soli a fine turno': 'fire by themselves at the end of a turn',
    'Salvataggio automatico': 'Automatic save',
    'Salva il cervello a fine turno': 'Saves the brain at the end of a turn',
    'Notizie all’Orchestrator': 'News to the Orchestrator',
    'Le novità delle chat': 'The chats’ news',
    'Guardia dei comandi': 'Command guard',
    'Ferma i comandi pericolosi': 'Stops dangerous commands',
    'Fili aperti': 'Open threads',
    'i fili aperti, una riga ciascuno': 'the open threads, one line each',
    'Stato di ogni filo.': 'The state of every thread.',
    'Diario': 'Journal',
    'cosa è successo, giorno per giorno': 'what happened, day by day',
    'Errori dell\'IA': 'AI errors',
    'ogni errore dell\'IA': 'every AI error',
    'Errori registrati.': 'Logged errors.',
    'Idee da riprendere': 'Ideas to pick up',
    'idee tue e dell\'IA': 'your ideas and the AI’s',
    'Le idee.': 'The ideas.',
    'Regole di lavoro': 'Work rules',
    'chi sei e come lavori': 'who you are and how you work',
    'Preferenze e sicurezza.': 'Preferences and safety.',
    'Regole del codice': 'Code rules',
    'regole per il codice': 'rules for code',
    'Fix, PR, commit.': 'Fixes, PRs, commits.',
    'PR, bug, build': 'PRs, bugs, builds',
    'Il tracker.': 'The tracker.',
    'Posta e chat': 'Mail and chat',
    'mail e messaggi': 'mail and messages',
    'Outlook e Teams.': 'Outlook and Teams.',
    'scrive solo all’Orchestrator': 'writes only to the Orchestrator',
    'apre una chat per ogni lavoro': 'opens a chat for every job',
    'chiama il reviewer prima del fatto': 'calls the reviewer before done',
    'chiama la QA': 'calls QA',
    'scrive alle altre chat': 'writes to the other chats',
    'consegna all’Orchestrator': 'delivers to the Orchestrator',
    'salva una riga di memoria': 'saves a memory line',
    'aggiorna il filo': 'updates the thread',
    'registra l\'errore': 'logs the error',
    'un errore che torna diventa una regola': 'an error that comes back becomes a rule',
    'a fine turno': 'at the end of a turn',
    'legge sempre': 'always reads',
    'legge per il codice': 'reads for code',
    'taccuino': 'notebook',
    'legge mail e messaggi': 'reads mail and messages',
    'apre PR e bug': 'opens PRs and bugs',
    'usa': 'uses',
    'usa le skill': 'uses the skills',
    'chat su Cursor': 'a chat on Cursor',
    'l’Orchestrator su Claude': 'the Orchestrator on Claude',
    'commentano su DevOps': 'comment on DevOps',
    'Parli con l’Orchestrator': 'You talk to the Orchestrator',
    'salva lo stato': 'saves the state',
    'Un errore diventa una regola': 'An error becomes a rule',
    'una riga in ai-errors.md': 'one line in ai-errors.md',
    'se torna, diventa una regola': 'if it comes back, it becomes a rule',
    'Prima del fatto, il reviewer': 'Before done, the reviewer',
    'il lavoro parte': 'the work starts',
    'rilegge il diff': 'reads the diff',
    'Le chat si scrivono': 'The chats write to each other',
    'scrive alla casella': 'writes to the mailbox',
    'l’Orchestrator legge': 'the Orchestrator reads',
    'scatta': 'fires',
    'regole dell’Orchestrator': 'the Orchestrator’s rules',
    'cita': 'cites',
    'Skill (4)': 'Skills (4)',
    'Hook (3)': 'Hooks (3)',
  };
  const L = t => (process.env.SB_LANG === 'en' && typeof t === 'string' && MAP_EN[t]) || t;
  const root = 'C:/brains/demo';
  const layers = [
    { id: 'persone', label: 'Persone', hint: 'tu e i colleghi' }, { id: 'chat', label: 'Chat', hint: 'l’Orchestrator e le chat di lavoro' },
    { id: 'agenti', label: 'Agenti e skill', hint: 'specialisti, taccuini, skill' }, { id: 'tool', label: 'Tool e hook', hint: 'script e hook che scattano da soli' },
    { id: 'memoria', label: 'Memoria', hint: 'dove il cervello scrive quello che succede' }, { id: 'regole', label: 'Regole', hint: 'come devono lavorare gli agenti' },
    { id: 'esterni', label: 'Esterni', hint: 'servizi fuori dal PC e i due programmi' },

  ].map(l => ({ ...l, label: L(l.label), hint: L(l.hint) }));
  const N = (id, layer, kind, label, short, what, extra = {}) => ({ id, layer, kind, label: L(label), short: L(short), what: L(what), file: `${root}/${extra.file ?? `${id.replace(/^\w+:/, '')}.md`}`, modified: iso(now - (extra.age ?? 2) * DAY), degree: extra.degree ?? 3, members: [], ...extra });
  const simpleNodes = [
    N('owner', 'persone', 'persona', OWNER, 'decide e lancia lui la produzione', 'Lo sviluppatore: lavora con le chat, decide.', { degree: 6, file: 'me.md' }),
    N('colleghi', 'persone', 'persona', 'Colleghi e QA', 'chi taggare e come scrivere', 'Colleghi, ruoli, chi taggare.', { degree: 1, file: 'people.md' }),
    N('chat:orchestrator', 'chat', 'orchestrator', 'Orchestrator', 'l\'unica chat con cui parli', 'La chat che coordina le altre.', { degree: 8, file: 'hub.md' }),
    N('chat:lavoro', 'chat', 'chat', 'Chat di lavoro', 'una per ogni lavoro vero', 'Le chat aperte dall’Orchestrator.', { degree: 6, file: 'hub.md' }),
    N('harness:claude', 'esterni', 'harness', 'Claude', 'il programma delle chat', 'Claude Code.', { degree: 4, file: 'AGENTS.md' }),
    N('harness:cursor', 'esterni', 'harness', 'Cursor', 'l\'altro programma', 'Cursor CLI.', { degree: 3, file: 'AGENTS.md' }),
    N('agent:reviewer', 'agenti', 'agente', 'Revisore del codice', 'rilegge ogni diff prima del fatto', 'Revisione di correttezza.', { name: 'reviewer', degree: 4, file: 'agents/reviewer.md', uses: 14, fields: { model: 'opus', effort: 'high' } }),
    N('agent:qa', 'agenti', 'agente', 'Tester nel browser', 'esegue i test case', 'QA nel browser.', { name: 'qa-runner', degree: 3, file: 'agents/qa-runner.md', uses: 9 }),
    { id: 'grp:skill', layer: 'agenti', kind: 'gruppo', label: 'Skill (4)', short: 'comandi brevi: /stato, /opzioni…', degree: 2, members: [
      { id: 'skill:stato', label: 'Stato di tutto', name: '/stato', what: 'Stato di tutto il lavoro aperto', uses: 12 }, { id: 'skill:opzioni', label: 'Cosa posso fare', name: '/opzioni', what: 'Cosa puoi fare adesso', uses: 0 },
      { id: 'skill:explain', label: 'Spiegami a domande', name: '/explain', what: 'Spiega a domande', uses: 5 }, { id: 'skill:urgente', label: 'Urgenze', name: '/urgente', what: 'Corsia urgenze', uses: 1 }] },
    N('tool:mem', 'tool', 'tool', 'Scrittura memoria', 'scrive la memoria, una riga', 'Il tool unico della memoria.', { name: 'mem.mjs', degree: 6, file: 'ops/tools/mem.mjs', uses: 120 }),
    N('tool:inbox', 'tool', 'tool', 'Posta tra chat', 'la posta tra chat', 'Caselle di posta tra chat.', { name: 'inbox.mjs', degree: 5, file: 'ops/tools/inbox.mjs', uses: 40 }),
    N('tool:cost', 'tool', 'tool', 'Costi del cervello', 'quanto costa e dove', 'I costi per giorno, modello, chat.', { name: 'cost.mjs', degree: 2, file: 'ops/tools/cost.mjs', uses: 18 }),
    { id: 'grp:hook', layer: 'tool', kind: 'gruppo', label: 'Hook (3)', short: 'scattano da soli a fine turno', degree: 3, members: [
      { id: 'hook:commit', label: 'Salvataggio automatico', name: 'auto-commit.mjs', what: 'Salva il cervello a fine turno' }, { id: 'hook:feed', label: 'Notizie all’Orchestrator', name: 'chat-feed.mjs', what: 'Le novità delle chat' }, { id: 'hook:guard', label: 'Guardia dei comandi', name: 'guard.mjs', what: 'Ferma i comandi pericolosi' }] },
    N('mem:now', 'memoria', 'file', 'Fili aperti', 'i fili aperti, una riga ciascuno', 'Stato di ogni filo.', { name: 'now.md', degree: 5, file: 'now.md', reads: 60 }),
    N('mem:journal', 'memoria', 'cartella', 'Diario', 'cosa è successo, giorno per giorno', 'journal/', { degree: 3, file: 'journal' }),
    N('mem:errors', 'memoria', 'file', 'Errori dell\'IA', 'ogni errore dell\'IA', 'Errori registrati.', { name: 'ai-errors.md', degree: 4, file: 'ai-errors.md' }),
    N('mem:ideas', 'memoria', 'file', 'Idee da riprendere', 'idee tue e dell\'IA', 'Le idee.', { name: 'ideas.md', degree: 2, file: 'ideas.md' }),
    N('rule:me', 'regole', 'file', 'Regole di lavoro', 'chi sei e come lavori', 'Preferenze e sicurezza.', { name: 'me.md', degree: 4, file: 'me.md' }),
    N('rule:code', 'regole', 'file', 'Regole del codice', 'regole per il codice', 'Fix, PR, commit.', { name: 'code.md', degree: 2, file: 'code.md' }),
    N('ext:devops', 'esterni', 'servizio', 'DevOps', 'PR, bug, build', 'Il tracker.', { degree: 3, file: 'ops/AGENTS.md' }),
    N('ext:mail', 'esterni', 'servizio', 'Posta e chat', 'mail e messaggi', 'Outlook e Teams.', { degree: 1, file: 'hub.md' }),
  ];
  for (const g of simpleNodes.filter(n => n.kind === 'gruppo')) Object.assign(g, { label: L(g.label), short: L(g.short), members: g.members.map(m => ({ ...m, label: L(m.label), what: L(m.what) })) });
  const E = (from, to, kind, label, src) => ({ from, to, kind, label: L(label), ...(src ? { source: { file: src[0], text: src[1] } } : {}) });
  const simpleEdges = [
    E('owner', 'chat:orchestrator', 'flusso', 'scrive solo all’Orchestrator', ['hub.md', 'talks only to the hub chat']),
    E('chat:orchestrator', 'chat:lavoro', 'flusso', 'apre una chat per ogni lavoro', ['hub.md', 'one chat per real job']),
    E('chat:lavoro', 'agent:reviewer', 'flusso', 'chiama il reviewer prima del fatto', ['code.md', 'reviewer on the diff before done']),
    E('chat:lavoro', 'agent:qa', 'flusso', 'chiama la QA', ['rules/qa.md', 'QA runs in the browser pane']),
    E('chat:lavoro', 'tool:inbox', 'posta', 'scrive alle altre chat'), E('tool:inbox', 'chat:orchestrator', 'posta', 'consegna all’Orchestrator'),
    E('chat:lavoro', 'tool:mem', 'flusso', 'salva una riga di memoria', ['map.md', 'every write goes through mem.mjs']),
    E('tool:mem', 'mem:now', 'flusso', 'aggiorna il filo', ['map.md', 'now.md: one line per thread']),
    E('tool:mem', 'mem:errors', 'flusso', 'registra l\'errore', ['AGENTS.md', 'Every AI error gets logged at once']),
    E('mem:errors', 'rule:me', 'flusso', 'un errore che torna diventa una regola', ['brain-rules.md', 'a repeated error becomes a rule']),
    E('grp:hook', 'tool:mem', 'hook', 'a fine turno'), E('harness:claude', 'grp:hook', 'hook', 'Stop'),
    E('chat:orchestrator', 'rule:me', 'contesto', 'legge sempre'), E('chat:lavoro', 'rule:code', 'contesto', 'legge per il codice'),
    E('agent:reviewer', 'mem:journal', 'legge', 'taccuino'), E('chat:orchestrator', 'ext:mail', 'esterno', 'legge mail e messaggi'),
    E('chat:lavoro', 'ext:devops', 'esterno', 'apre PR e bug'), E('tool:cost', 'mem:journal', 'usa', 'usa'),
    E('chat:orchestrator', 'grp:skill', 'flusso', 'usa le skill', ['hub.md', 'skills: /stato, /opzioni']),
    E('harness:cursor', 'chat:lavoro', 'istanza', 'chat su Cursor'), E('harness:claude', 'chat:orchestrator', 'istanza', 'l’Orchestrator su Claude'),
    E('colleghi', 'ext:devops', 'esterno', 'commentano su DevOps'),
  ];
  const label = id => simpleNodes.find(n => n.id === id)?.label ?? id;
  const step = (from, to, l, file, text, verified = true) => ({ from, to, label: L(l), verified, source: { file, text }, fromLabel: label(from), toLabel: label(to) });
  const flows = [
    { id: 'orchestrator', title: L('Parli con l’Orchestrator'), steps: [step('owner', 'chat:orchestrator', 'scrive solo all’Orchestrator', 'hub.md', 'talks only to the hub chat'), step('chat:orchestrator', 'chat:lavoro', 'apre una chat per ogni lavoro', 'hub.md', 'one chat per real job'), step('chat:lavoro', 'tool:mem', 'salva lo stato', 'map.md', 'every write goes through mem.mjs')] },
    { id: 'errore', title: L('Un errore diventa una regola'), steps: [step('chat:lavoro', 'tool:mem', 'registra l\'errore', 'AGENTS.md', 'logged at once'), step('tool:mem', 'mem:errors', 'una riga in ai-errors.md', 'AGENTS.md', 'one line'), step('mem:errors', 'rule:me', 'se torna, diventa una regola', 'brain-rules.md', 'a repeated error becomes a rule', false)] },
    { id: 'review', title: L('Prima del fatto, il reviewer'), steps: [step('chat:orchestrator', 'chat:lavoro', 'il lavoro parte', 'hub.md', 'one chat per job'), step('chat:lavoro', 'agent:reviewer', 'rilegge il diff', 'code.md', 'reviewer on the diff')] },
    { id: 'posta', title: L('Le chat si scrivono'), steps: [step('chat:lavoro', 'tool:inbox', 'scrive alla casella', 'hub.md', 'mail between chats'), step('tool:inbox', 'chat:orchestrator', 'l’Orchestrator legge', 'hub.md', 'delivered at the end of the turn')] },
  ];
  // the full view: the same pieces plus one node per member and a few more files
  const extra = [];
  for (const g of simpleNodes.filter(n => n.kind === 'gruppo')) for (const m of g.members) extra.push({ id: m.id, layer: g.layer, kind: g.id === 'grp:skill' ? 'skill' : 'hook', label: m.label, name: m.name, what: m.what, file: `${root}/${m.id.replace(':', '/')}.md`, modified: iso(now - 3 * DAY), degree: 1, uses: m.uses });
  const fullNodes = [...simpleNodes.filter(n => n.kind !== 'gruppo'), ...extra,
    ...['routines.md', 'people.md', 'hub.md', 'map.md', 'brain-rules.md'].map((f, i) => ({ id: `rule:${f}`, layer: i < 2 ? 'memoria' : 'regole', kind: 'file', label: f, what: `Il file ${f}.`, file: `${root}/${f}`, modified: iso(now - i * DAY), degree: 2 }))];
  const fullEdges = [...simpleEdges.filter(e => !e.from.startsWith('grp:') && !e.to.startsWith('grp:')), ...extra.map(m => E(m.kind === 'skill' ? 'chat:orchestrator' : 'harness:claude', m.id, m.kind === 'skill' ? 'usa' : 'hook', m.kind === 'skill' ? 'usa' : 'scatta')),
    E('rule:hub.md', 'chat:orchestrator', 'contesto', 'regole dell’Orchestrator'), E('rule:map.md', 'tool:mem', 'cita', 'cita'), E('rule:brain-rules.md', 'rule:me', 'cita', 'cita')];
  if (opts.mapExtra > 0) {
    const r = rng(77), topics = ['Clienti', 'Prodotto', 'Rilasci', 'Persone', 'Idee', 'Ricerca', 'Fornitori', 'Viaggi'];
    const words = ['piano', 'note', 'verbale', 'bozza', 'idea', 'domande', 'decisione', 'riepilogo', 'contatti', 'lista', 'analisi', 'appunti'];
    topics.forEach((t, i) => { fullNodes.push({ id: `area:${i}`, layer: 'memoria', kind: 'cartella', label: t, what: `L'area ${t}.`, file: `${root}/${t.toLowerCase()}`, degree: 0 }); fullEdges.push(E('mem:now', `area:${i}`, 'cita', 'cita')); });
    for (let i = 0; i < opts.mapExtra; i++) {
      const area = Math.floor(r() * topics.length), id = `note:${i}`;
      fullNodes.push({ id, layer: 'memoria', kind: 'file', label: `${topics[area]} · ${words[i % words.length]} ${i + 1}`, what: 'Nota sintetica.', file: `${root}/${topics[area].toLowerCase()}/n${i}.md`, degree: 1 });
      if (r() < .85) fullEdges.push(E(`area:${area}`, id, 'cita', 'cita'));
      if (i > 0 && r() < .2) fullEdges.push(E(id, `note:${Math.floor(r() * i)}`, 'cita', 'cita'));
    }
  }
  const map = {
    generated: iso(now), root, layers, nodes: fullNodes, edges: fullEdges, flows,
    weak: [
      { kind: 'mai usati', text: 'skill mai usati in 30 giorni: /opzioni', ids: ['skill:opzioni'] },
      { kind: 'contesto fisso', text: 'Il contesto fisso è 16.800 caratteri, oltre il tetto di 15.000: ogni chat lo rilegge a ogni chiamata.', ids: ['rule:me', 'rule:code'] },
      { kind: 'senza test', text: 'cost.mjs non ha test', ids: ['tool:cost'] },
      { kind: 'regola che non ferma', text: 'la regola "verifica lo screenshot" non ha fermato il suo errore (3 volte)', ids: ['mem:errors'] },
    ],
    warnings: ['map.md nomina brain-settings.json, che non esiste'], problems: ['pezzo mem:brain-settings.json: il file non esiste'],
    simple: { nodes: simpleNodes, edges: simpleEdges, flows },
  };

  // ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const texts = {
    'AGENTS.md': '# Il cervello\n\nIndice breve: tutto il resto si legge quando serve.\n\n## Regole\n\n1. **Produzione**: l\'agente propone, tu esegui.\n2. Niente segreti nei file.\n\nVedi `map.md` e `now.md`.\n\n| Quando | Leggi |\n|---|---|\n| Codice | `code.md` |\n| Produzione | `ops/AGENTS.md` |\n',
    'map.md': '# Mappa della memoria\n\n- `now.md`: i fili aperti\n- `ideas.md`: le idee\n- `journal/`: il diario\n',
    'now.md': `# Adesso\n\n## Lavoro\n\n${nowRows.filter(x => x.sezione === 'Lavoro').map(x => `- **${x.filo}** · ${x.dove} · ${x.prossimo} · (${x.aggiornato})`).join('\n')}\n`,
    'ideas.md': `# Idee\n\n${ideas.map(i => `## ${i.data} · [${i.area}] · ${i.titolo} · \`${i.stato}\`\n${i.testo}`).join('\n\n')}\n`,
    'code.md': '# Codice\n\n- Prima del fatto, il reviewer sul diff.\n- Commit solo dove permesso.\n',
    [`journal/${today}.md`]: `# ${today}\n\n${journal.filter(j => j.data === today).map(j => `- ${j.ora} · ${j.tag} · ${j.testo}`).join('\n')}\n`,
    [`journal/${d(1)}.md`]: `# ${d(1)}\n\n${journal.filter(j => j.data === d(1)).map(j => `- ${j.ora} · ${j.tag} · ${j.testo}`).join('\n')}\n`,
    'measures.jsonl': measures.map(m => JSON.stringify(m)).join('\n'),
    'ops/tools/cost.mjs': '// cost.mjs: the cost of every chat, by day, model, kind and area.\nexport function cost(days) {\n  return days * 2;\n}\n',
    // a hostile file (an agent can write any markdown): nothing in it may run or navigate the app window
    'notes/trappola.md': '# Trappola\n\n<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m"><map name="m"><area shape="default" href="../../fuori.html"></map>\n\n<a href="../fuori.html">relativo</a> · <a href="file:///C:/fuori.html">file</a> · <a href="javascript:alert(1)">js</a> · [esterno](https://example.com)\n\n<base href="https://example.com/"><script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2">\n\n<svg><a xlink:href="../fuori.html"><text>svg</text></a></svg>\n\n<form action="../fuori.html"><button formaction="../fuori.html">invia</button></form>\n',
    'ops/runbook/review.md':'# Revisione\n\n1. Controlla i null sui campi opzionali.\n2. Un test nuovo deve fallire prima del fix.\n',
  };
  const more = ['README.md', 'hub.md', 'people.md', 'routines.md', 'brain-rules.md', 'ai-errors.md', 'ai-wins.md', 'ai-reflections.md', 'proposals.md', 'bug-log.md', 'ops/AGENTS.md', 'ops/runbook/urgenze.md', 'ops/runbook/sql.md',
    'ops/tools/mem.mjs', 'ops/tools/inbox.mjs', 'ops/tools/day.mjs', 'rules/qa.md', 'rules/qa-runner.md', 'agents/reviewer.md', 'agents/qa-runner.md', `journal/brief/${today}.md`, `journal/brief/${d(1)}.md`];
  for (const f of more) texts[f] ??= `# ${f}\n\nContenuto di prova di ${f}.\n`;
  const files = Object.keys(texts).sort();

  return {
    tables, now: nowData, cost, map, files, texts,
    version: { site: 'abc1234 2026-10-11T10:00:00+02:00', root, here: `${root}/ops/tools` },
    fileMeta: f => ({ path: f, size: texts[f].length, modified: iso(now - (f.length % 5) * DAY), text: texts[f] }),
  };
}
