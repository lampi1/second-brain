// The demo's project maps (ADR 0271): a small second project nobody works on (ADR 0302), a third told as phases and steps in a line (#443, ADR 0322) and the made-up shop the demo chats work on, drawn in four versions (so the history
// slider plays it from the first drawing to now), with the demo's chats bound to the parts they work on. Written into the
// demo brain once (a map already there is left alone). The orders part holds pieces of its own, tells its rules, what
// it keeps, why and its key files, and the last version has two paths told stop by stop (ADR 0316). Used by demo-wiring.ts.
import type { MapElement, MapLink, ProjectMap } from '@shared/project-map';
import type { ProjectMaps } from './service';
import { ProjectMapStore } from './store';

const H = 3600_000, MIN = 60_000;

export function seedDemoMap(brainRoot: string, maps: ProjectMaps, now: number): void {
  const store = new ProjectMapStore(() => brainRoot);
  if (store.get('alfa-shop')) { bind(maps); return; }
  const el = (id: string, kind: MapElement['kind'], name: string, extra: Partial<MapElement> = {}): MapElement =>
    ({ id, kind, name, status: 'ok', evidence: [], confirmedAt: now - 2 * 24 * H, ...extra });
  const ln = (from: string, to: string, label: string, extra: Partial<MapLink> = {}): MapLink =>
    ({ id: `${from}--${to}`, from, to, label, status: 'ok', confirmedAt: now - 2 * 24 * H, ...extra });
  const base: MapElement[] = [
    el('cliente', 'person', 'Cliente', { description: 'Compra sul sito e chiede i rimborsi' }),
    el('operatore', 'person', 'Operatore del negozio', { description: 'Gestisce ordini, resi e rimborsi' }),
    el('negozio', 'system', 'Negozio web', { description: 'Il sito e le API degli ordini', evidence: ['src/'],
      details: 'Il cliente riempie il carrello, paga e riceve la conferma; l\'operatore segue ordini, resi e rimborsi dallo stesso sito.\nDentro ci sono cinque parti: il carrello, gli ordini con gli sconti, i rimborsi, le notifiche SMS e il database. Ogni ordine passa dal carrello agli ordini, che calcolano il totale, lo addebitano sul gateway e scaricano il magazzino del fornitore.' }),
    el('carrello', 'part', 'Carrello', { parent: 'negozio', description: 'Prodotti, quantità, codici sconto', evidence: ['src/Cart/'] }),
    el('ordini', 'part', 'Ordini e sconti', { parent: 'negozio', description: 'Calcola il totale e crea l\'ordine', evidence: ['src/Orders/'],
      rules: ['Lo sconto va sul prezzo pieno, prima dell\'IVA (oggi è dopo: il piano lo corregge)', 'Si arrotonda una volta sola, sul totale', 'Senza addebito riuscito niente esce dal magazzino'],
      keeps: ['Ordini e righe nel Database ordini (tabelle Orders e OrderLines)', 'Lo stato del pagamento sull\'ordine: in attesa, pagato o rifiutato'],
      why: ['Dopo «Paga» un ordine non cambia più: una modifica ne crea uno nuovo, così il totale addebitato resta quello salvato (docs/ordini.md)'],
      keyFiles: [{ path: 'src/Orders/Checkout.cs', what: 'Dove nasce l\'ordine e parte l\'addebito' }, { path: 'src/Orders/Totals.cs', what: 'Somma delle righe, IVA e arrotondamento' }, { path: 'src/Orders/Discounts.cs', what: 'I codici sconto' }],
      details: 'Riceve il carrello confermato e ne fa un ordine: somma le righe, applica il codice sconto, aggiunge l\'IVA e arrotonda una volta sola alla fine.\nSalva l\'ordine nel database, chiede l\'addebito al gateway e, se va a buon fine, scarica le quantità dal gestionale del fornitore e fa partire l\'SMS.\nSe l\'addebito fallisce l\'ordine resta «in attesa di pagamento» e niente viene scaricato dal magazzino. Oggi lo sconto è applicato dopo l\'IVA: è l\'errore che il piano corregge.' }),
    el('totale', 'part', 'Calcolo del totale', { parent: 'ordini', description: 'Righe, IVA, arrotondamento', evidence: ['src/Orders/Totals.cs'] }),
    el('sconti', 'part', 'Codici sconto', { parent: 'ordini', description: 'Valida il codice e ne calcola lo sconto', evidence: ['src/Orders/Discounts.cs'] }),
    el('conferma', 'part', 'Conferma e addebito', { parent: 'ordini', description: 'Salva l\'ordine e chiede il pagamento', evidence: ['src/Orders/Checkout.cs'] }),
    el('rimborsi', 'part', 'Rimborsi', { parent: 'negozio', description: 'Resi e rimborsi sul metodo di pagamento', evidence: ['src/Refunds/'],
      details: 'L\'operatore apre un reso su un ordine pagato e sceglie le righe da rimborsare. Il rimborso è calcolato sul prezzo pagato, sconto compreso, e torna sullo stesso metodo di pagamento con uno storno sul gateway.\nUn rimborso sopra i 200 € chiede una seconda approvazione. Il reso parziale non è ancora gestito: si rimborsa l\'ordine intero.' }),
    el('db', 'part', 'Database ordini', { parent: 'negozio', description: 'SQL Server: ordini, righe, rimborsi', evidence: ['db/migrations/'] }),
    el('pagamenti', 'external', 'Gateway pagamenti', { description: 'Addebiti e storni con carta' }),
    el('gestionale', 'external', 'Gestionale magazzino', { description: 'Il fornitore: giacenze e spedizioni' }),
    el('test', 'env', 'Ambiente di test', { description: 'test.app.example.com', evidence: ['deploy/test/'] }),
    el('pipeline', 'env', 'Pipeline di rilascio', { description: 'Build, test e pubblicazione', evidence: ['pipelines/'] }),
    el('manuale', 'doc', 'Manuale ordini', { description: 'Come si gestiscono ordini e resi', evidence: ['docs/ordini.md'] }),
  ];
  const links: MapLink[] = [
    ln('cliente', 'carrello', 'compra e paga'), ln('operatore', 'rimborsi', 'approva i rimborsi'), ln('operatore', 'manuale', 'consulta'),
    ln('carrello', 'ordini', 'crea l\'ordine', { details: 'Quando il cliente preme «Paga» il carrello passa le righe, le quantità e il codice sconto. Da qui il carrello è bloccato: una modifica crea un ordine nuovo.' }), ln('ordini', 'db', 'salva'), ln('rimborsi', 'db', 'legge e scrive'),
    ln('ordini', 'pagamenti', 'addebita il totale', { details: 'Alla conferma dell\'ordine parte una chiamata al gateway con il totale e il riferimento dell\'ordine. Torna «pagato» o il motivo del rifiuto; senza risposta entro 30 secondi l\'ordine resta in attesa e si riprova una volta.' }), ln('rimborsi', 'pagamenti', 'storna'), ln('ordini', 'gestionale', 'scarica il magazzino'),
    ln('pipeline', 'test', 'pubblica'), ln('test', 'negozio', 'ospita la prova'),
    ln('totale', 'sconti', 'chiede lo sconto'), ln('totale', 'conferma', 'passa il totale'),
  ];
  const head = { project: 'alfa-shop', title: 'Alfa · negozio online', root: 'C:\\progetti\\alfa-shop', corrections: [] as string[] };
  const v1: ProjectMap = { ...head, version: 1, updatedAt: now - 3 * 24 * H, by: 'Scout · Mappa Alfa', summary: 'prima mappa: sito, ordini, rimborsi, pagamenti',
    elements: base.map(e => ({ ...e, confirmedAt: now - 3 * 24 * H })), links: links.map(l => ({ ...l, confirmedAt: now - 3 * 24 * H })) };
  const sms: MapElement[] = [
    el('notifiche', 'part', 'Notifiche SMS', { parent: 'negozio', description: 'Avvisa il cliente a ordine spedito', evidence: ['src/Notifications/'] }),
    el('provider-sms', 'external', 'Provider SMS', { description: 'Invia gli SMS' }),
  ];
  const smsLinks = [ln('ordini', 'notifiche', 'avvisa il cliente'), ln('notifiche', 'provider-sms', 'invia l\'SMS')];
  const v2: ProjectMap = { ...head, version: 2, updatedAt: now - 2 * 24 * H, by: 'Scout · Mappa Alfa', summary: 'aggiunte le notifiche SMS e il provider',
    elements: [...base, ...sms], links: [...links, ...smsLinks], corrections: ['Il gestionale non è nostro: è del fornitore, non va modificato'] };
  const set = (m: ProjectMap, id: string, patch: Partial<Pick<MapElement, 'status' | 'note' | 'actor' | 'confirmedAt'>>) => ({
    ...m, elements: m.elements.map(e => (e.id === id ? { ...e, ...patch } as MapElement : e)), links: m.links.map(l => (l.id === id ? { ...l, ...patch } as MapLink : l)),
  });
  let v3: ProjectMap = { ...v2, version: 3, updatedAt: now - 3 * H, by: 'Bug notifiche SMS', summary: 'notifiche SMS in lavorazione' };
  v3 = set(v3, 'notifiche', { status: 'work', note: 'SMS doppio quando l\'ordine cambia stato due volte', confirmedAt: now - 3 * H });
  v3 = set(v3, 'notifiche--provider-sms', { status: 'unknown', note: 'risposta lenta del provider in test?', confirmedAt: now - 3 * H });
  let v4: ProjectMap = { ...v3, version: 4, updatedAt: now - 30 * MIN, by: 'Fix totale ordine', summary: 'ordini in lavorazione: sconto sul prezzo pieno' };
  v4 = set(v4, 'ordini', { status: 'work', note: 'Sconto applicato dopo l\'IVA: lo sposto sul prezzo pieno', confirmedAt: now - 30 * MIN });
  v4 = set(v4, 'negozio', { status: 'work', confirmedAt: now - 30 * MIN });
  let v5: ProjectMap = { ...v4, version: 5, updatedAt: now - 4 * MIN, by: 'QA · Rimborsi', summary: 'rimborsi bloccati: il test case 7 aspetta la tua decisione' };
  v5 = set(v5, 'rimborsi', { status: 'blocked', actor: 'user', note: 'Il test case 7 fallisce anche su master: decidi tu', confirmedAt: now - 4 * MIN });
  v5 = set(v5, 'operatore--rimborsi', { status: 'blocked', actor: 'user', note: 'Rimborso senza sconto', confirmedAt: now - 4 * MIN });
  v5 = { ...v5, paths: [
    { id: 'paga', question: 'Cosa succede quando un cliente paga?', stops: [
      { on: 'cliente', text: 'Il cliente ha riempito il carrello e preme «Paga».' },
      { on: 'carrello', text: 'Il carrello si blocca e passa righe, quantità e codice sconto agli ordini. Da qui una modifica crea un ordine nuovo.', file: 'src/Cart/CartController.cs' },
      { on: 'totale', text: 'Somma le righe, aggiunge l\'IVA e arrotonda una volta sola alla fine.', file: 'src/Orders/Totals.cs' },
      { on: 'sconti', text: 'Controlla il codice e toglie lo sconto. Oggi lo toglie dopo l\'IVA: è l\'errore che il piano corregge.', file: 'src/Orders/Discounts.cs' },
      { on: 'conferma', text: 'Salva l\'ordine «in attesa di pagamento» e chiede l\'addebito del totale.', file: 'src/Orders/Checkout.cs' },
      { on: 'pagamenti', text: 'Il gateway risponde «pagato» o il motivo del rifiuto. Senza risposta in 30 secondi si riprova una volta.' },
      { on: 'gestionale', text: 'Solo se è pagato: le quantità escono dal magazzino del fornitore.' },
      { on: 'notifiche', text: 'Parte l\'SMS di conferma al cliente.', file: 'src/Notifications/SmsSender.cs' },
    ] },
    { id: 'rimborso', question: 'Come si rimborsa un ordine?', stops: [
      { on: 'operatore', text: 'L\'operatore apre un reso su un ordine pagato.' },
      { on: 'rimborsi', text: 'Calcola il rimborso sul prezzo pagato, sconto compreso. Sopra i 200 € serve una seconda approvazione.', file: 'src/Refunds/RefundService.cs' },
      { on: 'db', text: 'Il reso e il rimborso sono scritti accanto all\'ordine.' },
      { on: 'pagamenti', text: 'Lo storno torna sullo stesso metodo di pagamento.' },
    ] },
  ] };
  for (const m of [v1, v2, v3, v4, v5]) store.save(m);
  // a second, quiet project: with more than one the view lists them beside the drawing (ADR 0302)
  const old = now - 5 * 24 * H, at = <T extends { confirmedAt: number }>(x: T): T => ({ ...x, confirmedAt: old });
  store.save({ project: 'beta-crm', title: 'Beta · gestionale clienti', root: 'C:\\progetti\\beta-crm', corrections: [], version: 1, updatedAt: old, by: 'Scout · Mappa Beta', summary: 'prima mappa: anagrafica, contratti, posta',
    elements: [
      el('commerciale', 'person', 'Commerciale', { description: 'Segue i clienti e i contratti' }),
      el('crm', 'system', 'Gestionale clienti', { description: 'Anagrafica, contratti e scadenze', evidence: ['src/'] }),
      el('anagrafica', 'part', 'Anagrafica', { parent: 'crm', description: 'Clienti, sedi e contatti', evidence: ['src/Customers/'] }),
      el('contratti', 'part', 'Contratti', { parent: 'crm', description: 'Contratti, rinnovi e scadenze', evidence: ['src/Contracts/'] }),
      el('posta', 'external', 'Posta', { description: 'Invia i promemoria di scadenza' }),
    ].map(at),
    links: [ln('commerciale', 'anagrafica', 'cerca e aggiorna'), ln('anagrafica', 'contratti', 'intesta'), ln('contratti', 'posta', 'manda i promemoria')].map(at) });
  // a third one told as a sequence (#443, ADR 0322): phases in a line, the steps inside each in a line too, two of
  // them together, proofs and links on what is done
  const done = now - 26 * H, ph = (id: string, name: string, extra: Partial<MapElement>) => el(id, 'phase', name, { confirmedAt: done, ...extra });
  const stp = (id: string, parent: string, name: string, extra: Partial<MapElement> = {}) => el(id, 'step', name, { parent, confirmedAt: done, ...extra });
  store.save({ project: 'gamma-migrazione', title: 'Gamma · migrazione del gestionale', root: 'C:\\progetti\\gamma', corrections: [], version: 1, updatedAt: done, by: 'Scout · Mappa Gamma', summary: 'prima mappa: le fasi della migrazione',
    elements: [
      ph('analisi', 'Analisi', { description: 'Cosa c\'è oggi e cosa deve passare', details: 'Si contano i dati del vecchio gestionale e si decide cosa migra, cosa si archivia e cosa si butta.\nNe esce l\'elenco delle tabelle con il loro destino, firmato dal responsabile.' }),
      stp('inventario', 'analisi', 'Inventario dei dati', { description: 'Tabelle, righe e chi le usa', proofs: [{ text: '48 tabelle censite, 12 da archiviare', file: 'docs/inventario.md' }], refs: [{ label: 'Verbale della riunione', href: 'https://docs.example.com/gamma/verbale-1' }] }),
      stp('destino', 'analisi', 'Destino di ogni tabella', { description: 'Migra, archivia o elimina', proofs: [{ text: 'Elenco approvato dal responsabile' }] }),
      ph('preparazione', 'Preparazione', { status: 'work', confirmedAt: now - 20 * MIN, description: 'Script, prove e via libera', note: 'La prova di ripristino è in corso',
        details: 'Si scrivono gli script di copia e li si prova su una copia dei dati. La fase finisce con il via libera: senza una prova di ripristino riuscita non si parte.' }),
      stp('script', 'preparazione', 'Script di copia', { description: 'Uno per tabella, rilanciabili', evidence: ['scripts/copy/'], proofs: [{ text: '36 script, tutti passati sulla copia di prova', href: 'https://ci.example.com/gamma/run/212' }] }),
      stp('ripristino', 'preparazione', 'Prova di ripristino', { status: 'work', confirmedAt: now - 20 * MIN, description: 'Dal backup al sistema acceso', note: 'Ripristino a metà: mancano gli allegati' }),
      stp('avviso', 'preparazione', 'Avviso ai clienti', { par: true, status: 'ok', description: 'Data e ore di fermo', proofs: [{ text: 'Mail inviata a 214 clienti' }] }),
      stp('via-libera', 'preparazione', 'Via libera', { status: 'planned', description: 'Si parte solo con il ripristino provato' }),
      ph('migrazione', 'Migrazione', { status: 'planned', description: 'Il fine settimana del passaggio' }),
      stp('fermo', 'migrazione', 'Fermo del vecchio sistema', { status: 'planned', description: 'Sola lettura dalle 20 di venerdì' }),
      stp('copia', 'migrazione', 'Copia dei dati', { status: 'planned', description: 'Gli script, nell\'ordine delle dipendenze' }),
      stp('controlli', 'migrazione', 'Controlli', { status: 'planned', description: 'Conteggi e campioni, tabella per tabella' }),
      ph('verifica', 'Verifica', { status: 'planned', description: 'Una settimana con i due sistemi affiancati' }),
    ],
    // one arrow to the next step with a condition, and one way back that goes under the line
    links: [{ id: 'ripristino--via-libera', from: 'ripristino', to: 'via-libera', label: 'solo se riesce', kind: 'next', status: 'ok', confirmedAt: done },
      { id: 'verifica--preparazione', from: 'verifica', to: 'preparazione', label: 'se un controllo fallisce', status: 'planned', confirmedAt: done }] });
  bind(maps);
}

function bind(maps: ProjectMaps): void {
  for (const [chatId, elements] of [['fix', ['ordini']], ['qa', ['rimborsi']], ['sms', ['notifiche']]] as const) {
    try { maps.update('alfa-shop', { workingOn: [...elements], chatId, by: 'demo' }); } catch { /* a map edited by hand without that element: no binding */ }
  }
}
