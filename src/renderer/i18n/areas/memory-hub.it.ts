// Italian UI texts of the Memoria hub (ADR 0122, 0340): its live head (counters, latest changes), the tab bar, and the two
// parts the Dashboard handed to Costi («Contesto adesso») and Qualità (the app's own errors). Spread into it.ts;
// memory-hub.en.ts and memory-hub.de.ts have the same keys (typed by this object).
type N = { n: number };
export const memoryHubIt = {
  'mh.eyebrow': 'Il cervello, adesso',
  'mh.lead': 'Il diario, gli artifact, le skill con tutti i loro file e le proposte della manutenzione da decidere. Si aggiorna da solo mentre gli agenti lavorano.',
  'mh.pulseLabel': 'Contatori dal vivo',
  'mh.pulse.proposals': 'Proposte da decidere', 'mh.pulse.proposalsHelp': 'Le proposte che aspettano un tuo sì o no: si aprono in Proposte.',
  'mh.pulse.working': 'Agenti al lavoro', 'mh.pulse.workingHelp': 'Le chat di lavoro aperte che stanno girando adesso (l’Orchestrator escluso).',
  'mh.pulse.waiting': 'Ti aspettano', 'mh.pulse.waitingHelp': 'Le chat ferme su una tua risposta: domanda o permesso.',
  'mh.pulse.changes': 'Modifiche in 24 ore', 'mh.pulse.changesHelp': 'Quello che il brain ha cambiato nelle ultime 24 ore (skill, regole, memoria, ruoli, script), annullate escluse: i dettagli in Andamento → Apprendimento.',

  'mh.activity': 'Ultime modifiche',
  'mh.activityEmpty': 'Ancora nessuna modifica: appariranno qui appena la manutenzione o tu cambiate qualcosa.',
  'mh.ago.now': 'adesso', 'mh.ago.min': (p: N) => `${p.n} min fa`, 'mh.ago.hours': (p: N) => (p.n === 1 ? '1 ora fa' : `${p.n} ore fa`), 'mh.ago.days': (p: N) => (p.n === 1 ? 'ieri' : `${p.n} giorni fa`),
  'mh.tabsLabel': 'Sezioni della memoria',
  'mh.tab.proposte': 'Proposte', 'mh.tab.skill': 'Skill', 'mh.tab.file': 'Diario',
  'mh.badge': (p: N) => (p.n === 1 ? '1 proposta da decidere' : `${p.n} proposte da decidere`),
  // Diario e note (#368): components/brain-model/MemoryBrowser.tsx
  'mb.lead': (p: N) => `${p.n === 1 ? 'Un documento' : `${p.n} documenti`} della memoria fuori dalle skill: cosa stai facendo adesso, il diario giorno per giorno, gli errori dell’AI e le note. Cerca in tutto, apri quello che ti serve.`,
  'mb.lead0': 'La memoria fuori dalle skill: cosa stai facendo adesso, il diario, gli errori dell’AI e le note.',
  'mb.search': 'Cerca nel diario, negli errori, nelle note…', 'mb.searchLabel': 'Cerca nella memoria', 'mb.clear': 'Cancella la ricerca',
  'mb.shelfLabel': 'Cosa mostrare', 'mb.shelf.all': 'Tutto', 'mb.shelf.diary': 'Diario', 'mb.shelf.errors': 'Errori', 'mb.shelf.notes': 'Note',
  'mb.kind.now': 'Adesso', 'mb.kind.journal': 'Diario', 'mb.kind.ideas': 'Idee', 'mb.kind.errors': 'Errori', 'mb.kind.knowledge': 'Nota', 'mb.kind.shared': 'Condivisa', 'mb.kind.agent': 'Vecchia memoria',
  'mb.title.now': 'Adesso', 'mb.title.ideas': 'Idee', 'mb.title.errors': 'Errori dell’AI',
  'mb.group.Clienti': 'Clienti', 'mb.group.Ambienti': 'Ambienti', 'mb.group.Persone': 'Persone', 'mb.group.Riferimenti': 'Riferimenti',
  'mb.omitted': (p: N) => `${p.n} giorni di diario più vecchi non mostrati: il visore li apre`,
  'mb.count': (p: { shown: number; n: number }) => (p.shown === p.n ? (p.n === 1 ? '1 documento' : `${p.n} documenti`) : `${p.shown} di ${p.n} documenti`),
  'mb.matches': (p: N) => (p.n === 1 ? '1 riga trovata' : `${p.n} righe trovate`),
  'mb.empty': 'Ancora niente: now.md, il diario, ideas.md e ai-errors.md nascono al primo uso e appariranno qui.',
  'mb.emptySearch': 'Niente che corrisponda alla ricerca.',
  'mb.open': 'Apri nel visore', 'mb.truncated': 'Il file è lungo: qui c’è la prima parte, il visore lo apre intero.',
  'mb.noBrain': 'Scegli prima la cartella del brain.', 'mb.loadError': 'La memoria non si è caricata:',
  // what the Dashboard handed to Costi and Qualità
  'mh.ctx.title': 'Contesto adesso',
  'mh.ctx.note': 'Quanto è pieno il contesto di ogni chat aperta: un contesto lungo fa costare di più ogni messaggio.',
  'mh.ctx.noteLong': (p: N) => (p.n === 1 ? '1 chat sopra la soglia di Impostazioni: ripartire da un riassunto costa meno.' : `${p.n} chat sopra la soglia di Impostazioni: ripartire da un riassunto costa meno.`),
  'mh.q.appErrors': 'Errori dell’app e degli strumenti',
  'mh.q.appErrorsNote': 'Quelli visti in questa sessione (limiti, rete, login, contesto pieno, strumenti), raggruppati per causa, con cosa fare.',
};
