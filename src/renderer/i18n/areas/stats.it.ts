// (dashboard/AppErrors.tsx, dashboard/errors.ts; once the Dashboard's Errori view). Every "?" says exactly how its number is
// computed. Spread into it.ts.
type N = { n: number };

export const statsIt = {
  // ── cost facts (brain/lib/cost-facts.ts)
  'stats.cost.factDay': (p: { day: string; usd: string; x: string }) => `Il giorno più caro è stato ${p.day}: ${p.usd}, ${p.x}× la media del periodo.`,
  'stats.cost.factModel': (p: { model: string; pct: string }) => `${p.model} vale ${p.pct} della spesa del periodo.`,
  'stats.cost.factKind': (p: { kind: string; usd: string }) => `Il lavoro che costa di più è «${p.kind}»: ${p.usd} nel periodo.`,

  // ── Qualità → the app's errors (dashboard/AppErrors.tsx)
  'stats.err.recurring': 'Errori che si ripetono',
  'stats.err.recurringHelp': 'Gruppi di errori dell’app e degli strumenti con la stessa causa (limite d’uso, rete, accesso…) o, se la causa non è nota, lo stesso testo una volta tolti numeri, id, percorsi e link; contano quelli visti almeno 2 volte nei dati conservati (feed e chat aperte).',
  'stats.err.events': 'Eventi di errore',
  'stats.err.eventsHelp': 'Ogni errore conservato nel feed dell’app e nei messaggi delle chat ancora in memoria: un turno finito male, uno strumento fallito, un avviso di sistema. Non è lo storico completo dei log.',
  'stats.err.recurringNote': 'Visti almeno 2 volte nei dati conservati', 'stats.err.eventsNote': 'Nel feed e nelle chat in memoria',
  'stats.err.groups': 'Errori dell’app e degli strumenti, raggruppati',
  'stats.err.groupsLead': 'Ogni scheda è un errore che torna: quante volte, quando l’ultima, dove, cosa vuol dire e cosa fare.',
  'stats.err.groupsEmpty': 'Nessun errore dell’app o degli strumenti nei dati conservati. Se ne capita uno, qui trovi cosa vuol dire e cosa fare.',
  'stats.err.times': (p: N) => (p.n === 1 ? '1 volta' : `${p.n} volte`),
  'stats.err.last': (p: { at: string }) => `ultima ${p.at}`,
  'stats.err.first': (p: { at: string }) => `prima volta ${p.at}`,
  'stats.err.where': 'Dove',
  'stats.err.skills': 'Skill in uso',
  'stats.err.what': 'Cosa vuol dire',
  'stats.err.todo': 'Cosa fare',
  'stats.err.trend.up': 'in aumento', 'stats.err.trend.down': 'in calo', 'stats.err.trend.flat': 'stabile',
  'stats.err.trendHelp': 'Confronta gli ultimi 7 giorni con i 7 prima: in aumento se ne ha di più, in calo se meno. Le barrette sono un giorno ciascuna, oggi è l’ultima.',
  'stats.err.memory': 'Ogni errore registrato con la regola nata da ciascuno è anche nella pagina Memoria.',
  'stats.err.openMemory': 'Apri Memoria',
  'stats.err.factWorst': (p: { pct: string; what: string }) => `${p.pct} degli errori dell’app ha una sola causa: ${p.what}.`,

  // causes: title, meaning, what to do
  'stats.cause.rateLimit.t': 'Limite d’uso raggiunto', 'stats.cause.rateLimit.w': 'Il motore ha rifiutato altre richieste per un po’: hai usato la quota del piano o troppe chat chiedono insieme.', 'stats.cause.rateLimit.f': 'Aspetta il reset (lo vedi nella barra in alto) o metti in pausa le chat meno urgenti; se capita spesso, sposta i lavori leggeri su un modello più economico.',
  'stats.cause.overloaded.t': 'Servizio sovraccarico', 'stats.cause.overloaded.w': 'Il fornitore del modello era temporaneamente pieno: non dipende da te né dall’app.', 'stats.cause.overloaded.f': 'Riprova fra qualche minuto; se dura, controlla la pagina di stato del fornitore.',
  'stats.cause.context.t': 'Contesto pieno', 'stats.cause.context.w': 'La chat ha raggiunto lo spazio massimo che il modello può leggere in una volta.', 'stats.cause.context.f': 'Continua in una nuova chat (il passaggio porta con sé il riassunto) o abbassa «Contesto massimo» nel profilo del ruolo.',
  'stats.cause.auth.t': 'Accesso scaduto o negato', 'stats.cause.auth.w': 'Il motore o un servizio non riconosce più il tuo accesso.', 'stats.cause.auth.f': 'Rifai l’accesso dalla riga di comando del motore o da Impostazioni → Motori; l’app non tocca le tue credenziali.',
  'stats.cause.timeout.t': 'Tempo scaduto', 'stats.cause.timeout.w': 'Un comando o una richiesta ha impiegato più del tempo concesso ed è stato fermato.', 'stats.cause.timeout.f': 'Riprova; se torna sullo stesso comando, chiedi all’agente di spezzarlo in passi più piccoli.',
  'stats.cause.network.t': 'Problema di rete', 'stats.cause.network.w': 'Un servizio non era raggiungibile: rete assente, VPN spenta o indirizzo sbagliato.', 'stats.cause.network.f': 'Controlla la connessione e la VPN, poi riprova.',
  'stats.cause.notFound.t': 'File o risorsa mancante', 'stats.cause.notFound.w': 'Un agente ha cercato un file, una cartella o una pagina che non c’è (spesso un percorso scritto a memoria).', 'stats.cause.notFound.f': 'Se torna sullo stesso percorso, scrivilo in una regola o nella memoria dell’agente.',
  'stats.cause.permission.t': 'Permesso negato', 'stats.cause.permission.w': 'Un’azione è stata bloccata: da te, dal ruolo (sola lettura) o dal sistema operativo.', 'stats.cause.permission.f': 'Se il ruolo ne ha bisogno davvero, allarga i suoi permessi dalla sua scheda in Agenti; altrimenti va bene così.',
  'stats.cause.mcp.t': 'Strumento MCP non disponibile', 'stats.cause.mcp.w': 'Un server di strumenti (MCP) non ha risposto o si è scollegato.', 'stats.cause.mcp.f': 'Riavvia la chat; se riguarda sempre lo stesso server, controllalo in Impostazioni → Connettori.',
  'stats.cause.turn.t': 'Turno finito con un errore', 'stats.cause.turn.w': 'Il motore ha chiuso la risposta segnalando un errore, senza dire quale.', 'stats.cause.turn.f': 'Apri la chat e leggi l’ultimo messaggio; i log dell’app (npm run logs) hanno il dettaglio.',
  'stats.cause.tool.t': 'Strumento fallito', 'stats.cause.tool.w': 'Una chiamata a uno strumento (comando, lettura, ricerca) è tornata con un errore; l’agente di solito riprova da solo.', 'stats.cause.tool.f': 'Se si ripete sullo stesso strumento, guarda l’esempio: spesso è un comando o un percorso da correggere in una skill.',
  'stats.cause.other.t': 'Errore', 'stats.cause.other.w': 'Un errore senza una causa riconosciuta: il testo dice cosa è successo.', 'stats.cause.other.f': 'Se torna, discutilo con l’Orchestrator: ha i dettagli e può proporre una regola.',
};
