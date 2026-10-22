// Italian UI texts of the Memoria hub (ADR 0122): its live head (headline, counters, latest changes), the tab bar, the
// «Approvate» tab with its trash and «Annulla», the «Idee» split with «Rispolvera», the Script tab's line, and the two
// parts the Dashboard handed to Costi («Contesto adesso») and Qualità (the app's own errors). Spread into it.ts;
// memory-hub.en.ts and memory-hub.de.ts have the same keys (typed by this object).
type N = { n: number };
type S = Record<string, string | number>;
export const memoryHubIt = {
  'mh.eyebrow': 'Il cervello, adesso',
  'mh.lead': 'Tutto quello che il brain sa e fa, in un posto: le proposte da decidere, quello che è già dentro, le skill, le regole, gli script, le idee e i file. Si aggiorna da solo mentre gli agenti lavorano.',
  'mh.pulseLabel': 'Contatori dal vivo',
  'mh.pulse.proposals': 'Proposte da decidere', 'mh.pulse.proposalsHelp': 'Le proposte che aspettano un tuo sì o no: si aprono in Proposte.',
  'mh.pulse.working': 'Agenti al lavoro', 'mh.pulse.workingHelp': 'Le chat di lavoro aperte che stanno girando adesso (l’Orchestrator escluso).',
  'mh.pulse.waiting': 'Ti aspettano', 'mh.pulse.waitingHelp': 'Le chat ferme su una tua risposta: domanda o permesso.',
  'mh.pulse.changes': 'Modifiche in 24 ore', 'mh.pulse.changesHelp': 'Quello che il brain ha cambiato nelle ultime 24 ore (skill, regole, memoria, ruoli, script), annullate escluse: i dettagli in Apprendimento.',
  'mh.pulse.lines': 'Righe in memoria', 'mh.pulse.linesHelp': 'Le righe di elenco dei file di memoria: conoscenza, cose successe e memorie degli agenti. Si aprono in File.',
  'mh.activity': 'Ultime modifiche',
  'mh.activityEmpty': 'Ancora nessuna modifica: appariranno qui appena la manutenzione o tu cambiate qualcosa.',
  'mh.ago.now': 'adesso', 'mh.ago.min': (p: N) => `${p.n} min fa`, 'mh.ago.hours': (p: N) => (p.n === 1 ? '1 ora fa' : `${p.n} ore fa`), 'mh.ago.days': (p: N) => (p.n === 1 ? 'ieri' : `${p.n} giorni fa`),
  'mh.tabsLabel': 'Sezioni della memoria',
  'mh.tab.proposte': 'Proposte', 'mh.tab.approvate': 'Approvate', 'mh.tab.skill': 'Skill', 'mh.tab.regole': 'Regole', 'mh.tab.script': 'Script & Query',
  'mh.tab.idee': 'Idee', 'mh.tab.file': 'File', 'mh.tab.apprendimento': 'Apprendimento', 'mh.tab.statistiche': 'Statistiche',
  'mh.badge': (p: N) => (p.n === 1 ? '1 proposta da decidere' : `${p.n} proposte da decidere`),
  // Approvate
  'mh.ap.lead': (p: N) => (p.n === 1 ? 'Una cosa è nel brain adesso. Un clic sul cestino la toglie; per qualche secondo puoi annullare.' : `${p.n} cose sono nel brain adesso. Un clic sul cestino ne toglie una; per qualche secondo puoi annullare.`),
  'mh.ap.search': 'Cerca in tutto quello che è nel brain',
  'mh.ap.g.skill': 'Skill', 'mh.ap.g.rule': 'Regole', 'mh.ap.g.fact': 'Fatti confermati', 'mh.ap.g.script': 'Script',
  'mh.ap.empty.skill': 'Nessuna skill nel brain.', 'mh.ap.empty.rule': 'Nessuna regola.', 'mh.ap.empty.fact': 'Nessun fatto confermato: quelli che approvi nelle Proposte arrivano qui.', 'mh.ap.empty.script': 'Nessuno script nel brain.',
  'mh.ap.noMatch': 'Niente che corrisponda alla ricerca.',
  'mh.ap.delete': (p: S) => `Elimina «${p.name}»`,
  'mh.ap.deleted': (p: S) => `«${p.name}» eliminato`,
  'mh.ap.restored': (p: S) => `«${p.name}» rimesso al suo posto`,
  'mh.ap.notDeleted': 'Non eliminato',
  'mh.ap.undo': 'Annulla',
  'mh.ap.locked': 'File sempre caricato: si modifica, non si elimina da qui',
  'mh.ap.note': 'Skill, regole e script eliminati restano nella cronologia delle modifiche (Apprendimento) con il loro «Annulla»; un fatto confermato invece si cancella davvero quando il messaggio sparisce.',
  // Idee
  'mh.idee.mine': 'Le tue', 'mh.idee.ai': 'Dell’AI',
  'mh.idee.mineHint': 'Scritte da te', 'mh.idee.aiHint': 'Notate dagli agenti mentre lavorano',
  'mh.idee.splitLine': (p: S) => `${p.open} aperte · l’ultima ${p.last}`,
  'mh.idee.dust': 'Rispolvera',
  'mh.idee.dustedK': (p: S) => `Dal cassetto · ${p.age}`,
  'mh.idee.again': 'Un’altra', 'mh.idee.close': 'Chiudi',
  'mh.idee.months': (p: N) => `${p.n} mesi fa`, 'mh.idee.days': (p: N) => (p.n === 1 ? 'ieri' : `${p.n} giorni fa`), 'mh.idee.today': 'oggi',
  // Script
  'mh.script.lead': (p: S) => `${p.n} script che funzionano: si cercano, si aprono qui e non partono mai da soli.`,
  // what the Dashboard handed to Costi and Qualità
  'mh.ctx.title': 'Contesto adesso',
  'mh.ctx.note': 'Quanto è pieno il contesto di ogni chat aperta: un contesto lungo fa costare di più ogni messaggio.',
  'mh.ctx.noteLong': (p: N) => (p.n === 1 ? '1 chat sopra la soglia di Impostazioni: ripartire da un riassunto costa meno.' : `${p.n} chat sopra la soglia di Impostazioni: ripartire da un riassunto costa meno.`),
  'mh.q.appErrors': 'Errori dell’app e degli strumenti',
  'mh.q.appErrorsNote': 'Quelli visti in questa sessione (limiti, rete, login, contesto pieno, strumenti), raggruppati per causa, con cosa fare.',
};
