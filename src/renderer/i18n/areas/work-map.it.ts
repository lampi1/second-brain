// The "work map" area (ADR 0342, 0343): the list of the work maps, one map with its plan drawn, its buttons and its side
// panel (components/work-map/*). English and German counterparts in work-map.en.ts and work-map.de.ts.
type N = { n: number };
export const workMapIt = {
  'pm.jobs': 'Lavori su questo progetto',
  'wm.lead': 'Una mappa per ogni lavoro: il piano si guarda, si approva e si segue qui.',
  'wm.open': 'Apri la mappa', 'wm.openShort': 'apri mappa', 'wm.openChat': 'Apri la chat', 'wm.none': 'Questo lavoro non ha ancora una mappa.',
  // the list
  'wm.list.label': 'Mappe dei lavori', 'wm.tab.open': 'Aperte', 'wm.tab.finished': 'Finite', 'wm.tab.label': 'Quali mappe',
  'wm.search': 'Cerca nei titoli, nelle idee e nei passi…', 'wm.project.all': 'Tutti i progetti', 'wm.project.label': 'Progetto', 'wm.sort.label': 'Ordine',
  'wm.sort.recent': 'Più recenti', 'wm.sort.oldest': 'Più vecchie', 'wm.sort.title': 'Titolo', 'wm.sort.progress': 'Più avanti',
  'wm.group.wait': 'Aspettano te', 'wm.group.running': 'In corso', 'wm.group.stopped': 'Ferme', 'wm.group.planned': 'Pianificate', 'wm.group.idea': 'Idee', 'wm.group.finished': 'Finite',
  'wm.unseen': 'nuova', 'wm.tab.unseen': (p: N) => (p.n === 1 ? '1 nuova' : `${p.n} nuove`),
  'wm.empty.open': 'Nessuna mappa aperta. Scrivi un’idea o chiedi un lavoro all’Orchestrator.', 'wm.empty.finished': 'Nessuna mappa finita.', 'wm.empty.search': 'Nessuna mappa trovata.', 'wm.empty.clear': 'Togli i filtri',
  'wm.loading': 'Leggo le mappe…', 'wm.failed': (p: { why: string }) => `Non riesco a leggere le mappe: ${p.why}`, 'wm.retry': 'Riprova',
  'wm.steps': (p: { done: number; n: number }) => `${p.done} di ${p.n} passi fatti`, 'wm.noPlan': 'senza piano',
  'wm.row.blocked': (p: N) => (p.n === 1 ? '1 bloccato' : `${p.n} bloccati`), 'wm.row.updated': (p: { at: string }) => `aggiornata ${p.at}`,
  // a new idea
  'wm.idea.new': 'Nuova idea', 'wm.idea.title': 'Titolo', 'wm.idea.text': 'Idea', 'wm.idea.project': 'Progetto', 'wm.idea.optional': 'facoltativo', 'wm.idea.save': 'Salva l’idea', 'wm.cancel': 'Annulla',
  // the states
  'wm.state.idea': 'Idea', 'wm.state.toApprove': 'Aspetta il tuo ok', 'wm.state.planned': 'Pianificata', 'wm.state.running': 'In corso', 'wm.state.stopped': 'Ferma', 'wm.state.finished': 'Finita', 'wm.state.archived': 'Nelle finite',
  'wm.planning': 'piano in preparazione', 'wm.stop.user': 'L’hai fermata tu.', 'wm.stop.closed': 'La sua chat è stata chiusa.', 'wm.stop.gone': 'La sua chat non c’è più.', 'wm.stop.replaced': 'La sua chat è passata a un altro lavoro.',
  // one map
  'wm.back': 'Mappe', 'wm.gone': 'Questa mappa non c’è più.', 'wm.version': 'Versione', 'wm.version.now': 'Adesso', 'wm.version.item': (p: { n: number; at: string; what: string }) => `${p.n} · ${p.at} · ${p.what}`,
  'wm.old': (p: N) => `Stai guardando la versione ${p.n}.`, 'wm.old.back': 'Torna a ora',
  'wm.do.approve': 'Approva e parti', 'wm.do.keep': 'Approva, parti dopo', 'wm.do.start': 'Parti', 'wm.do.plan': 'Fai il piano', 'wm.do.stop': 'Ferma', 'wm.do.resume': 'Riprendi', 'wm.do.replan': 'Cambia il piano', 'wm.do.archive': 'Archivia', 'wm.do.reopen': 'Riapri',
  'wm.note.toApprove': 'Niente parte prima del tuo ok.', 'wm.note.replanned': 'I passi già partiti vanno avanti. I nuovi partono dopo il tuo ok; quelli tolti si fermano al tuo ok.',
  'wm.note.planned': 'Approvato e tenuto per dopo: parte quando premi «Parti».', 'wm.note.planning': 'Lo Stratega sta preparando il piano.', 'wm.note.replanning': 'Lo Stratega sta cambiando il piano. I passi già partiti vanno avanti.', 'wm.note.idea': 'Nessuno ci lavora ancora.', 'wm.note.finished': 'Vista: adesso è nelle finite.',
  'wm.replan.label': 'Cosa cambiare nel piano', 'wm.replan.hint': 'Scrivi cosa cambiare: lo Stratega ridisegna il piano e ti chiede l’ok di nuovo.', 'wm.replan.send': 'Chiedi il nuovo piano',
  'wm.sent.replan': 'Richiesta mandata allo Stratega.', 'wm.failedDo': (p: { what: string; why: string }) => `${p.what}: ${p.why}`,
  'wm.draw.label': 'Il piano disegnato', 'wm.draw.dropped': 'Tolti dal nuovo piano: si fermano al tuo ok', 'wm.draw.drop': 'tolto', 'wm.self': 'Strategist', 'wm.by.user': 'tu', 'wm.by.app': 'app',
  // the side panel
  'wm.side.label': 'Dettagli', 'wm.side.job': 'Il lavoro', 'wm.side.idea': 'Richiesta', 'wm.side.doneWhen': 'Finito quando', 'wm.side.known': 'Già chiaro', 'wm.side.links': 'Link', 'wm.side.history': 'Storia', 'wm.side.pick': 'Tocca un passo per i dettagli.', 'wm.side.back': 'Tutto il lavoro', 'wm.side.step': (p: N) => `Passo ${p.n}`, 'wm.side.who': 'Chi lo fa', 'wm.side.when': 'Quando', 'wm.side.chats': 'Chat', 'wm.side.project': 'Progetto',
  'wm.outcome.partial': 'fatto in parte', 'wm.outcome.blocked': 'bloccato',
};
