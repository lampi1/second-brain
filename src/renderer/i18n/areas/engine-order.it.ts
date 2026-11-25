// The one order of the engines (ADR 0358, EngineOrder.tsx), in Italian: Impostazioni → Motori and a role's page. The source: the
// other languages are typed by it.
export const engineOrderIt = {
  'engineOrder.title': 'Ordine dei motori',
  'engineOrder.hint': 'Ogni ruolo prova i motori in quest’ordine e parte sul primo disponibile. Vale dal prossimo avvio, riuso o «Riprendi».',
  'engineOrder.off': 'Nessun ordine: ogni ruolo segue le liste dei suoi livelli.',
  'engineOrder.use': 'Usa un ordine unico',
  'engineOrder.clear': 'Togli l’ordine',
  'engineOrder.threshold': 'Passa al successivo oltre',
  'engineOrder.noThreshold': 'Solo al limite',
  'engineOrder.orchestrator': 'L’Orchestrator resta sul motore scelto per la sua chat.',
  'engineOrder.role': 'Ordine dei motori',
  'engineOrder.roleOwn': 'Eccezione per questo ruolo',
  'engineOrder.roleClear': 'Togli l’eccezione',
  'engineOrder.roleOwnHint': 'Eccezione: questo ruolo non segue l’ordine di tutti.',
  'engineOrder.up': (p: { engine: string }) => `Sposta su ${p.engine}`,
  'engineOrder.down': (p: { engine: string }) => `Sposta giù ${p.engine}`,
  'engineOrder.thresholdOf': (p: { engine: string }) => `Soglia di ${p.engine}`,
  'engineOrder.roleAll': (p: { order: string }) => `Segue l’ordine di tutti: ${p.order}.`,
  'engineOrder.exception': (p: { role: string; order: string }) => `Eccezione: ${p.role} usa ${p.order}`,
  'engineOrder.held': (p: { n: number }) => p.n === 1 ? 'Una modifica è da applicare: rispondi al suo pannello.' : `${p.n} modifiche sono da applicare: rispondi ai loro pannelli.`,
};
