// The "work map" area (ADR 0342, 0343): the list of the work maps, one map with its plan drawn, its buttons and its side
// panel (components/plans/*). English and German counterparts in work-map.en.ts and work-map.de.ts.
type N = { n: number };
export const workMapIt = {
  'pm.jobs': 'Lavori su questo progetto',
  'plans.lead': 'Una mappa per ogni lavoro: il piano si guarda, si approva e si segue qui.',
  'plans.open': 'Apri la mappa', 'plans.openShort': 'apri mappa', 'plans.openChat': 'Apri la chat', 'plans.none': 'Questo lavoro non ha ancora una mappa.',
  // the list
  'plans.list.label': 'Mappe dei lavori', 'plans.tab.open': 'Aperte', 'plans.tab.finished': 'Finite', 'plans.tab.label': 'Quali mappe',
  'plans.search': 'Cerca nei titoli, nelle idee e nei passi…', 'plans.project.all': 'Tutti i progetti', 'plans.project.label': 'Progetto', 'plans.sort.label': 'Ordine',
  'plans.sort.recent': 'Più recenti', 'plans.sort.oldest': 'Più vecchie', 'plans.sort.title': 'Titolo', 'plans.sort.progress': 'Più avanti',
  'plans.group.wait': 'Aspettano te', 'plans.group.running': 'In corso', 'plans.group.stopped': 'Ferme', 'plans.group.planned': 'Pianificate', 'plans.group.idea': 'Idee', 'plans.group.finished': 'Finite',
  'plans.unseen': 'nuova', 'plans.tab.unseen': (p: N) => (p.n === 1 ? '1 nuova' : `${p.n} nuove`),
  'plans.empty.open': 'Nessuna mappa aperta. Scrivi un’idea o chiedi un lavoro all’Orchestrator.', 'plans.empty.finished': 'Nessuna mappa finita.', 'plans.empty.search': 'Nessuna mappa trovata.', 'plans.empty.clear': 'Togli i filtri',
  'plans.loading': 'Leggo le mappe…', 'plans.failed': (p: { why: string }) => `Non riesco a leggere le mappe: ${p.why}`, 'plans.retry': 'Riprova',
  'plans.steps': (p: { done: number; n: number }) => `${p.done} di ${p.n} passi fatti`, 'plans.noPlan': 'senza piano',
  'plans.row.blocked': (p: N) => (p.n === 1 ? '1 bloccato' : `${p.n} bloccati`), 'plans.row.updated': (p: { at: string }) => `aggiornata ${p.at}`,
  // a new idea
  'plans.idea.new': 'Nuova idea', 'plans.idea.title': 'Titolo', 'plans.idea.text': 'Idea', 'plans.idea.project': 'Progetto', 'plans.idea.optional': 'facoltativo', 'plans.idea.save': 'Salva l’idea', 'plans.cancel': 'Annulla',
  // the states
  'plans.state.idea': 'Idea', 'plans.state.toApprove': 'Aspetta il tuo ok', 'plans.state.planned': 'Pianificata', 'plans.state.running': 'In corso', 'plans.state.stopped': 'Ferma', 'plans.state.finished': 'Finita', 'plans.state.archived': 'Nelle finite',
  'plans.planning': 'piano in preparazione', 'plans.stop.user': 'L’hai fermata tu.', 'plans.stop.closed': 'La sua chat è stata chiusa.', 'plans.stop.gone': 'La sua chat non c’è più.', 'plans.stop.replaced': 'La sua chat è passata a un altro lavoro.',
  // one map
  'plans.back': 'Mappe', 'plans.gone': 'Questa mappa non c’è più.', 'plans.version': 'Versione', 'plans.version.now': 'Adesso', 'plans.version.item': (p: { n: number; at: string; what: string }) => `${p.n} · ${p.at} · ${p.what}`,
  'plans.old': (p: N) => `Stai guardando la versione ${p.n}.`, 'plans.old.back': 'Torna a ora',
  'plans.do.approve': 'Approva e parti', 'plans.do.keep': 'Approva, parti dopo', 'plans.do.start': 'Parti', 'plans.do.plan': 'Fai il piano', 'plans.do.stop': 'Ferma', 'plans.do.resume': 'Riprendi', 'plans.do.replan': 'Cambia il piano', 'plans.do.archive': 'Archivia', 'plans.do.reopen': 'Riapri',
  'plans.note.toApprove': 'Niente parte prima del tuo ok.', 'plans.note.replanned': 'I passi già partiti vanno avanti. I nuovi partono dopo il tuo ok; quelli tolti si fermano al tuo ok.',
  'plans.note.planned': 'Approvato e tenuto per dopo: parte quando premi «Parti».', 'plans.note.planning': 'Lo Stratega sta preparando il piano.', 'plans.note.replanning': 'Lo Stratega sta cambiando il piano. I passi già partiti vanno avanti.', 'plans.note.idea': 'Nessuno ci lavora ancora.', 'plans.note.finished': 'Vista: adesso è nelle finite.',
  'plans.replan.label': 'Cosa cambiare nel piano', 'plans.replan.hint': 'Scrivi cosa cambiare: lo Stratega ridisegna il piano e ti chiede l’ok di nuovo.', 'plans.replan.send': 'Chiedi il nuovo piano',
  'plans.sent.replan': 'Richiesta mandata allo Stratega.', 'plans.failedDo': (p: { what: string; why: string }) => `${p.what}: ${p.why}`,
  'plans.draw.label': 'Il piano disegnato', 'plans.draw.dropped': 'Tolti dal nuovo piano: si fermano al tuo ok', 'plans.draw.drop': 'tolto', 'plans.self': 'Strategist', 'plans.by.user': 'tu', 'plans.by.app': 'app',
  // the side panel
  'plans.side.label': 'Dettagli', 'plans.side.job': 'Il lavoro', 'plans.side.idea': 'Richiesta', 'plans.side.doneWhen': 'Finito quando', 'plans.side.known': 'Già chiaro', 'plans.side.links': 'Link', 'plans.side.history': 'Storia', 'plans.side.pick': 'Tocca un passo per i dettagli.', 'plans.side.back': 'Tutto il lavoro', 'plans.side.step': (p: N) => `Passo ${p.n}`, 'plans.side.who': 'Chi lo fa', 'plans.side.when': 'Quando', 'plans.side.chats': 'Chat', 'plans.side.project': 'Progetto',
  'plans.outcome.partial': 'fatto in parte', 'plans.outcome.blocked': 'bloccato',
  // the live status (what its chats do now)
  'plans.say.waiting': 'in attesa', 'plans.say.working': 'al lavoro', 'plans.say.failed': 'ultimo turno fallito', 'plans.say.closed': 'chat chiusa senza rapporto', 'plans.say.gone': 'chat non più qui', 'plans.say.interrupted': 'turno interrotto', 'plans.say.between': 'turno finito, nessun rapporto', 'plans.say.blocked': 'ha riferito: bloccato', 'plans.say.partial': 'ha riferito: fatto in parte', 'plans.say.done': 'ha riferito: fatto', 'plans.say.unknown': 'non si sa',
  'plans.waits.user': 'aspetta te', 'plans.waits.credits': 'crediti finiti: aspetta un modello del livello con limite', 'plans.waits.parent': 'aspetta chi l’ha avviata', 'plans.waits.orchestrator': 'aspetta l’Orchestrator', 'plans.waits.colleagues': 'aspetta altre persone', 'plans.waits.work': 'aspetta un lavoro in corso',
  'plans.stale': (p: { at: string }) => `da verificare: ultima conferma ${p.at}`,
  'plans.why.user': 'L’hai fermata tu.', 'plans.why.closedByUser': 'Hai chiuso tu la sua chat.', 'plans.why.closedByAgent': 'Un agente ha chiuso la sua chat.', 'plans.why.closedByApp': 'L’app ha chiuso la sua chat a lavoro aperto.', 'plans.why.crash': 'Il motore della sua chat è caduto e non è ripartito.', 'plans.why.gone': 'La sua chat non c’è più.', 'plans.why.replaced': 'La sua chat è passata a un altro lavoro.',
  'plans.row.working': (p: { who: string }) => `al lavoro: ${p.who}`, 'plans.row.waiting': (p: N) => `${p.n} in attesa`, 'plans.row.failed': (p: N) => (p.n === 1 ? '1 chat fallita' : `${p.n} chat fallite`), 'plans.row.lost': (p: N) => (p.n === 1 ? '1 chat persa' : `${p.n} chat perse`),
  // the doubts and the questions (ADR 0344)
  'plans.doubts.label': 'Dubbi e domande', 'plans.doubts.title': 'Dubbi', 'plans.doubts.open': (p: N) => (p.n === 1 ? '1 dubbio aperto' : `${p.n} dubbi aperti`), 'plans.doubts.closed': (p: N) => (p.n === 1 ? 'chiuso' : `tutti e ${p.n} chiusi`),
  'plans.doubt.open': 'aperto: blocca l’ok', 'plans.doubt.by.user': 'risposta tua', 'plans.doubt.by.code': 'dal codice', 'plans.doubt.by.brain': 'dal cervello', 'plans.doubt.by.choice': 'scelta dello Stratega',
  'plans.doubt.blocks': (p: { n: number; text: string }) => (p.n === 1 ? `Si approva quando è chiuso il dubbio: «${p.text}»` : `Si approva quando sono chiusi ${p.n} dubbi. Il primo: «${p.text}»`),
  'plans.q.title': 'Domande delle chat', 'plans.q.open': (p: N) => (p.n === 1 ? '1 aperta' : `${p.n} aperte`), 'plans.q.allAnswered': (p: N) => (p.n === 1 ? 'con risposta' : `${p.n}, tutte con risposta`),
  'plans.q.you': 'te', 'plans.q.asked': (p: { who: string }) => `chiesta a ${p.who}`, 'plans.q.passed': (p: { who: string }) => `${p.who} la passa su`, 'plans.q.skipped': (p: { who: string }) => `${p.who} non risponde`, 'plans.q.held': (p: { who: string }) => `ce l’ha ${p.who}`,
  'plans.q.answered': (p: { who: string; answer: string }) => `${p.who} ha risposto: «${p.answer}»`, 'plans.q.youAnswered': (p: { answer: string }) => `Hai risposto: «${p.answer}»`, 'plans.q.why': (p: { why: string }) => `perché: ${p.why}`,
};
