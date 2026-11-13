// The demo's project map (ADR 0271): the made-up shop the demo chats work on, drawn in four versions (so the history
// slider plays it from the first drawing to now), with the demo's chats bound to the parts they work on. Written into the
// demo brain once (a map already there is left alone). Used by demo-wiring.ts.
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
    el('negozio', 'system', 'Negozio web', { description: 'Il sito e le API degli ordini', evidence: ['src/'] }),
    el('carrello', 'part', 'Carrello', { parent: 'negozio', description: 'Prodotti, quantità, codici sconto', evidence: ['src/Cart/'] }),
    el('ordini', 'part', 'Ordini e sconti', { parent: 'negozio', description: 'Calcola il totale e crea l\'ordine', evidence: ['src/Orders/'] }),
    el('rimborsi', 'part', 'Rimborsi', { parent: 'negozio', description: 'Resi e rimborsi sul metodo di pagamento', evidence: ['src/Refunds/'] }),
    el('db', 'part', 'Database ordini', { parent: 'negozio', description: 'SQL Server: ordini, righe, rimborsi', evidence: ['db/migrations/'] }),
    el('pagamenti', 'external', 'Gateway pagamenti', { description: 'Addebiti e storni con carta' }),
    el('gestionale', 'external', 'Gestionale magazzino', { description: 'Il fornitore: giacenze e spedizioni' }),
    el('test', 'env', 'Ambiente di test', { description: 'test.app.example.com', evidence: ['deploy/test/'] }),
    el('pipeline', 'env', 'Pipeline di rilascio', { description: 'Build, test e pubblicazione', evidence: ['pipelines/'] }),
    el('manuale', 'doc', 'Manuale ordini', { description: 'Come si gestiscono ordini e resi', evidence: ['docs/ordini.md'] }),
  ];
  const links: MapLink[] = [
    ln('cliente', 'carrello', 'compra e paga'), ln('operatore', 'rimborsi', 'approva i rimborsi'), ln('operatore', 'manuale', 'consulta'),
    ln('carrello', 'ordini', 'crea l\'ordine'), ln('ordini', 'db', 'salva'), ln('rimborsi', 'db', 'legge e scrive'),
    ln('ordini', 'pagamenti', 'addebita il totale'), ln('rimborsi', 'pagamenti', 'storna'), ln('ordini', 'gestionale', 'scarica il magazzino'),
    ln('pipeline', 'test', 'pubblica'), ln('test', 'negozio', 'ospita la prova'),
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
  const set = (m: ProjectMap, id: string, patch: Partial<MapElement & MapLink>) => ({
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
  for (const m of [v1, v2, v3, v4, v5]) store.save(m);
  bind(maps);
}

function bind(maps: ProjectMaps): void {
  for (const [chatId, elements] of [['fix', ['ordini']], ['qa', ['rimborsi']], ['sms', ['notifiche']]] as const) {
    try { maps.update('alfa-shop', { workingOn: [...elements], chatId, by: 'demo' }); } catch { /* a map edited by hand without that element: no binding */ }
  }
}
