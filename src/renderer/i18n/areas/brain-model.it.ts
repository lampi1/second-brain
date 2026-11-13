// Italian UI texts of the Brain section (ADR 0077): the Skill, Regole, Memoria and Mappa pages, the
// maintenance panel with its change log and undo, the migration report and the agent card's back. Spread into it.ts;
// brain-model.en.ts has the same keys (typed by this object).
type N = { n: number };
export const brainModelIt = {
  'bm.loading': 'Leggo il brain…',
  'bm.noBrain': 'Scegli prima la cartella del brain.',
  'bm.open': 'Apri',
  'bm.lines': (p: N) => (p.n === 1 ? '1 riga' : `${p.n} righe`),
  'bm.changed': (p: { at: string }) => `modificato ${p.at}`,

  // who made a change
  'bm.job.upgrade': 'Aggiornamento del brain', 'bm.job.migration': 'Migrazione', 'bm.job.corrections': 'Correzioni', 'bm.job.repeated-task': 'Lavoro ripetuto',
  'bm.job.merge-skills': 'Skill doppie', 'bm.job.merge-memory': 'Memorie doppie', 'bm.job.user': 'Tu', 'bm.job.research': 'Manutenzione approvata da te', 'bm.job.orchestrator': 'Orchestrator',
  'bm.kind.skill': 'Skill', 'bm.kind.agent': 'Agente', 'bm.kind.rule': 'Regola', 'bm.kind.memory': 'Memoria', 'bm.kind.script': 'Script',

  // maintenance panel
  'bm.maint.title': 'Manutenzione',
  'bm.maint.lead': 'Parte solo quando premi «Manutenzione»: pulisce la memoria e propone come card in Memoria → Proposte le nuove skill, le idee e le issue da aprire. Niente cambia le skill prima del tuo sì. Ogni modifica fatta è qui, con il motivo e «Annulla».',
  'bm.maint.approvalNote': 'Ti chiede conferma anche per le azioni in produzione, i permessi (strumenti e permessi massimi di un agente), le impostazioni e gli hook (compreso il motore di un agente), e i testi per colleghi o sistemi esterni.',
  'bm.maint.last': (p: { at: string }) => `Ultimo passaggio: ${p.at}`,
  'bm.maint.never': 'Nessun passaggio ancora: parte quando premi «Manutenzione».',
  'bm.maint.empty': 'Nessuna modifica ancora.',
  'bm.maint.listLabel': 'Modifiche della manutenzione',
  'bm.maint.undo': 'Annulla', 'bm.maint.undone': 'Annullata', 'bm.maint.undoneToast': 'Modifica annullata.',
  'bm.maint.locked': 'Non si annulla più: è cambiata dopo',
  'bm.maint.evidence': 'Prove', 'bm.maint.why': 'Perché',
  'bm.maint.more': (p: N) => `Mostra altre ${p.n}`,

  // migration report
  'bm.mig.title': 'Runbook e routine diventati skill',
  'bm.mig.lead': (p: { moved: number; existing: number; skipped: number; at: string }) => `${p.at}: ${p.moved} spostate${p.existing ? `, ${p.existing} già presenti` : ''}${p.skipped ? `, ${p.skipped} saltate` : ''}. I file originali restano dove erano, senza modifiche.`,
  'bm.mig.moved': 'Spostata', 'bm.mig.existing': 'Già presente', 'bm.mig.skipped': 'Saltata',
  'bm.mig.lessons': (p: { lines: number; agents: number }) => `${p.lines} regole imparate spostate nel ruolo di ${p.agents === 1 ? '1 agente' : `${p.agents} agenti`}.`,
  'bm.mig.noAgent': 'nessun agente',

  // Skill page
  // Regole page
  'bm.rules.lead': (p: { n: number; chars: number; budget: number; app: boolean }) => `Quello che ogni chat riceve all’avvio: ${p.n === 1 ? '1 file' : `${p.n} file`} del tuo brain, ${p.chars.toLocaleString('it-IT')} caratteri su ${p.budget.toLocaleString('it-IT')}${p.app ? ', più le regole fisse dell’app' : ''}. Tutto il resto sono skill, caricate quando servono.`,
  'bm.rules.lead0': 'Quello che ogni chat riceve all’avvio. Tutto il resto sono skill, caricate quando servono.',
  'bm.rules.loaded.always': 'Sempre', 'bm.rules.loaded.topic': 'Quando serve', 'bm.rules.loaded.none': 'Non più caricata',
  'bm.rules.loadedHint.always': 'Entra in ogni chat dall’inizio.',
  'bm.rules.loadedHint.topic': 'Entra nella chat quando la richiesta, uno strumento o un file la riguardano.',
  'bm.rules.loadedHint.none': 'Non entra più nelle chat: le regole per argomento sono diventate skill. La migrazione porta le sue procedure nelle skill.',
  'bm.rules.oldTitle': 'Non più caricate',
  'bm.rules.empty': 'Nessun file fisso nel brain: ogni chat riceve solo le regole fisse dell’app.',

  // Memoria page
  'bm.mem.title': 'Memoria',

  // Mappa page
  'bm.map.eyebrow': 'IL TUO BRAIN, COLLEGATO', 'bm.map.legendLabel': 'Legenda',
  'bm.map.title': 'Mappa',
  'bm.map.lead': 'Chi usa cosa: ogni agente con le sue skill, le regole che riceve e la sua memoria.',
  'bm.map.viewLabel': 'Vista', 'bm.map.view.links': 'Agenti e skill', 'bm.map.view.notes': 'Note del brain',
  'bm.map.choose': 'Scegli un nodo', 'bm.map.chooseHint': 'Seleziona un agente, una skill, una regola o una memoria per vederne i collegamenti.',
  'bm.map.openAgent': 'Apri l’agente', 'bm.map.openSkill': 'Vai alla skill', 'bm.map.openFile': 'Apri il file',
  'bm.map.empty': 'La mappa compare quando c’è almeno un agente.',
  'bm.map.allRules': 'Le regole valgono per ogni agente.',
  'bm.map.legend.agent': 'Agente', 'bm.map.legend.skill': 'Skill', 'bm.map.legend.rule': 'Regola', 'bm.map.legend.memory': 'Memoria',
  'bm.map.usedBy': (p: N) => (p.n === 1 ? 'usata da 1 agente' : `usata da ${p.n} agenti`),
  'bm.map.agentSkills': (p: N) => (p.n === 1 ? '1 skill' : `${p.n} skill`),
  'bm.map.view.projects': 'Progetti',
  // Mappa → Progetti (ADR 0271)
  'pm.lead': 'I tuoi progetti disegnati al posto del codice: sistemi, collegamenti, persone e a che punto è ogni agente.',
  'pm.steps': (p: { done: number; total: number }) => `${p.done} passi fatti su ${p.total}`,
  'pm.on': 'su', 'pm.asks': 'Ti chiede:', 'pm.now': 'Ora:', 'pm.openChat': 'Apri la chat',
  'pm.emptyTitle': 'Nessun progetto disegnato ancora',
  'pm.emptyLead': 'Chiedi all’Orchestrator di disegnare un progetto: un agente legge codice, configurazione e pipeline e lo disegna qui, con sistemi, collegamenti e persone. Poi gli agenti al lavoro lo tengono aggiornato.',
  'pm.emptyExample': '«Disegna la mappa del progetto in C:\\progetti\\negozio»',
  'pm.mapsTitle': 'Mappe dei progetti',
  'pm.mapsSub': 'Clicca un sistema per entrarci, le briciole per tornare su',
  'pm.mapsButton': 'Mappe dei progetti',
  'pm.fullscreen': 'Schermo intero',
  'pm.upTip': 'Torna su di un livello · Backspace · doppio clic sullo sfondo',
  'pm.talk': 'Discuti con l’Orchestrator',
  'pm.talkOn': (p: { name: string }) => `Discuti «${p.name}» con l’Orchestrator`,
  'pm.noOrchestrator': 'Nessun Orchestrator aperto: aprilo e riprova',
  'pm.talkDraft': (p: { project: string; where: string; kind: string; name: string; state: string; note: string; desc: string }) => `Mappa «${p.project}»${p.where}: ${p.kind} «${p.name}», stato ${p.state}${p.note}.${p.desc} Voglio parlarne: `,
  'pm.projects': 'Progetti', 'pm.flow': 'I passi del piano, in ordine', 'pm.together': 'insieme', 'pm.runningNow': 'ci lavorano ora',
  'pm.turn': (p: N) => `Passo del turno ${p.n}: parte quando il turno prima è finito`, 'pm.turnPar': (p: N) => `Turno ${p.n}: va insieme ad altri passi, in parallelo`,
  'pm.project': 'Progetto', 'pm.trail': 'Dove sei nella mappa', 'pm.top': 'Tutto il progetto',
  'pm.waiting': (p: N) => (p.n === 1 ? '1 aspetta te' : `${p.n} aspettano te`),
  'pm.updated': (p: { at: string }) => `Aggiornata ${p.at}`,
  'pm.past': (p: { v: number; at: string; by: string }) => `Versione ${p.v}, ${p.at}, salvata da ${p.by}`,
  'pm.ago': (p: { at: string }) => `${p.at} fa`,
  'pm.backNow': 'Torna a ora', 'pm.you': 'Tu', 'pm.youMeans': 'tocca a te',
  'pm.kind.person': 'Persone', 'pm.kind.system': 'Il tuo sistema', 'pm.kind.external': 'Sistema esterno', 'pm.kind.env': 'Ambiente', 'pm.kind.doc': 'Documento', 'pm.kind.part': 'Parte',
  'pm.state.ok': 'funziona', 'pm.state.work': 'in lavorazione', 'pm.state.blocked': 'bloccato', 'pm.state.unknown': 'da capire', 'pm.state.stale': 'da verificare',
  'pm.state.planned': 'previsto', 'pm.new': 'nuovo', 'pm.plan': 'Piano', 'pm.planPhase.proposed': 'aspetta il tuo ok', 'pm.planPhase.revising': 'in revisione', 'pm.planPhase.running': 'in corso', 'pm.planPhase.done': 'finito',
  'pm.planSteps': (p: { done: number; total: number }) => `${p.done} di ${p.total} passi fatti`, 'pm.planApprove': 'Approva e parti', 'pm.planChange': 'Cambia qualcosa', 'pm.planChangeDraft': (p: { title: string }) => `Cambia il piano «${p.title}»: `, 'pm.planGone': 'Il piano è cambiato: guarda la versione nuova.',
  'pm.changeSent': (p: { at: string }) => `Modifica inviata ${p.at}:`, 'pm.changeSeen': (p: { at: string }) => `Modifica ricevuta ${p.at}:`, 'pm.worksMore': (p: { n: number; done: number; total: number }) => `+${p.n} altri · ${p.done}/${p.total} fatti`,
  'pm.parts': (p: N) => (p.n === 1 ? '1 parte' : `${p.n} parti`),
  'pm.zoomIn': 'Ingrandisci', 'pm.zoomOut': 'Rimpicciolisci', 'pm.fit': 'Adatta alla finestra',
  'pm.confirmed': (p: { at: string }) => `Stato confermato ${p.at}`, 'pm.files': 'Letto da:',
  'pm.agents': 'Agenti', 'pm.agentsCount': (p: { n: number; run: number }) => `${p.n} · ${p.run} al lavoro`, 'pm.agentsPast': 'solo nella versione di ora',
  'pm.noAgents': 'Nessun agente sta lavorando su questo progetto.',
  'pm.group.wait': 'Aspettano te', 'pm.group.work': 'Al lavoro', 'pm.group.done': 'Finiti o fermi',
  'pm.corrections': 'Le tue correzioni', 'pm.history': 'Storia',
  'pm.version': (p: { v: number; n: number }) => `versione ${p.v} di ${p.n}`,

  // agent card back (#81) and agent page
  'bm.card.flip': (p: { name: string }) => `Gira la scheda di ${p.name}: dettagli e skill`,
  'bm.card.flipBack': (p: { name: string }) => `Torna al fronte della scheda di ${p.name}`,
  'bm.card.skills': 'Skill', 'bm.card.noSkills': 'Nessuna skill dichiarata: lavora con il suo ruolo.',

  'bm.card.back': 'Torna',
  'bm.studio.manage': 'Gestisci le skill',
};
