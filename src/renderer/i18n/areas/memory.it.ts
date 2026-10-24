// Italian UI texts of the Memoria statistics and the "Manutenzione" button (MemoryInsights.tsx, MemoryPage.tsx,
// MaintenanceButton.tsx): key numbers, "Lo sapevi?", charts, recurring errors, skills used or never used, and the "?"
// that says how each number is computed. Spread into it.ts; memory.en.ts has the same keys (typed by this object).
type N = { n: number };
type FP = Record<string, string | number>;
const runs = (n: number | string | undefined) => (Number(n) === 1 ? '1 run' : `${n} run`);
const volte = (n: number | string | undefined) => (Number(n) === 1 ? '1 volta' : `${n} volte`);
export const memoryIt = {
  // the maintenance button
  'mm.maint.button': 'Manutenzione', 'mm.maint.running': 'Manutenzione in corso…',
  'mm.maint.helpTitle': 'Cosa fa la manutenzione',
  'mm.maint.help1': 'Un clic e basta: l’app mette in ordine skill, regole e memoria, legge i suoi log e un agente invisibile studia la tua storia per proporre miglioramenti. Lavora in background: puoi continuare a fare altro.',
  'mm.maint.help2': 'Tutto arriva come card in Memoria → Proposte: skill e regole nuove, cosa dimenticare, e le issue da aprire su GitHub (con il tuo sì si aprono subito). Le idee sull’app finiscono anche in Idee, dal lato IA. Niente cambia senza il tuo sì.',
  'mm.maint.help3': 'Succede solo quando la premi tu: idee, proposte e pulizia della memoria non partono mai da sole. La ricerca usa token, al massimo 5 $ per volta; quando finisce ti avviso.',
  'mm.one.tip': 'Manutenzione: un clic, poi lavora da sola in background',
  'mm.one.tipCleanup': 'Sto mettendo in ordine skill, regole e memoria…',
  'mm.one.tipResearch': (p: { cost: string; cap: string }) => `Un agente sta cercando miglioramenti: speso ${p.cost} su ${p.cap}. Ti avviso quando finisce.`,
  'mm.one.liveResearch': (p: { cost: string; cap: string; n: number }) => `Al lavoro in background · ${p.n === 1 ? '1 card' : `${p.n} card`} finora · ${p.cost} su ${p.cap}`,
  'mm.one.started': 'Manutenzione avviata: lavora in background, ti avviso quando ha finito.',
  'mm.one.stop': 'Ferma',
  'mm.one.last': (p: { at: string; what: string }) => `Ultima: ${p.at} · ${p.what}`,
  'mm.done.proposals': (p: N) => (p.n === 1 ? '1 proposta' : `${p.n} proposte`),
  'mm.done.ideas': (p: N) => (p.n === 1 ? '1 idea' : `${p.n} idee`),
  'mm.done.issues': (p: N) => (p.n === 1 ? '1 issue da aprire' : `${p.n} issue da aprire`),
  'mm.done.made': (p: { what: string }) => `Manutenzione finita: ${p.what}`,
  'mm.done.nothing': 'Manutenzione finita: era già tutto in ordine.',
  'mm.done.failed': 'Manutenzione finita, ma la ricerca non è riuscita',
  'mm.done.stopped': 'Manutenzione fermata prima della fine',
  'mm.done.capped': 'Manutenzione finita al tetto di spesa',
  'mm.done.label': 'Manutenzione finita', 'mm.done.title': 'Il tuo brain è in ordine',
  'mm.done.open': 'Apri Memoria',

  // shared bits
  'mm.openFile': 'Apri il file', 'mm.openNamed': (p: { name: string }) => `Apri il file di ${p.name}`,
  'mm.lines': 'Righe', 'mm.rule': 'Regola nata:', 
  'mm.time': 'volta', 'mm.times': 'volte', 'mm.timesTitle': (p: N) => `Successo ${volte(p.n)}`,
  'mm.again': (p: N) => `ricorrente ×${p.n}`,
  'mm.daysAgo': (p: N) => (p.n === 1 ? 'fermo da 1 giorno' : `fermo da ${p.n} giorni`),
  'mm.kind.agent': 'Memorie degli agenti', 'mm.kind.errors': 'Errori', 'mm.kind.journal': 'Diario', 'mm.kind.knowledge': 'Conoscenza',
  'mm.weekday.0': 'lunedì', 'mm.weekday.1': 'martedì', 'mm.weekday.2': 'mercoledì', 'mm.weekday.3': 'giovedì', 'mm.weekday.4': 'venerdì', 'mm.weekday.5': 'sabato', 'mm.weekday.6': 'domenica',

  // key numbers
  
  
  
  
  
  

  // Lo sapevi?
  'mm.facts': 'Lo sapevi?', 'mm.factsLead': 'Le cose più curiose che dicono i numeri della tua memoria.',
  'mm.factsHelp': 'Calcolate adesso dai file del brain e dai run registrati, senza modelli e senza token. Compaiono solo quando i numeri dicono qualcosa (per esempio un errore ripetuto almeno 2 volte).',
  'mm.fact.how': 'Come lo so?',
  'mm.fact.repeat.k': 'Errore ricorrente', 'mm.fact.repeat': (p: FP) => `«${p.label}» è successo **${volte(p.n)}** (${p.agents}). È il primo candidato per una regola.`,
  'mm.fact.repeat.help': 'Il gruppo più numeroso di ai-errors.md: righe con lo stesso tipo e la stessa area, o con almeno 3 parole importanti in comune.',
  'mm.fact.longest.k': 'La memoria più lunga', 'mm.fact.longest': (p: FP) => `**${p.name}** ricorda **${p.n} cose**: più di ogni altro agente.`,
  'mm.fact.longest.help': 'Le righe di elenco di agents/<ruolo>/memory.md, per ogni ruolo.',
  'mm.fact.oldest.k': 'Il ricordo più vecchio', 'mm.fact.oldest': (p: FP) => `Dal **${p.date}** ${p.owner} ricorda: «${p.text}».`,
  'mm.fact.oldest.help': 'La riga con la data più antica tra le memorie degli agenti e quella condivisa.',
  'mm.fact.unusedSkills.k': 'Skill dimenticate', 'mm.fact.unusedSkills': (p: FP) => `**${p.n} skill su ${p.total}** non sono mai servite a nessun run: ${p.names}.`,
  'mm.fact.unusedSkills.help': 'Skill vecchie di almeno 14 giorni che nessun run ha avuto. Forse il nome o la descrizione non fanno capire quando usarle, o non servono più.',
  'mm.fact.bestSkill.k': 'La skill più utile', 'mm.fact.bestSkill': (p: FP) => `**${p.name}**: ${runs(p.n)}, riuscita nel **${p.pct}%** dei casi verificati.`,
  'mm.fact.bestSkill.help': 'Tra le skill «utili» (almeno 2 esiti noti e 70% riusciti) quella con più run.',
  'mm.fact.weekday.k': 'Il giorno nero', 'mm.fact.weekday': (p: FP) => `Il **${p.day}** è il giorno con più errori: **${p.n}**.`,
  'mm.fact.weekday.help': 'Errori di ai-errors.md contati per giorno della settimana della loro data. Compare solo con almeno 4 errori e un giorno davanti agli altri.',
  'mm.fact.topWord.k': 'La parola degli errori', 'mm.fact.topWord': (p: FP) => `«**${p.word}**» torna in **${volte(p.n)}** negli errori registrati.`,
  'mm.fact.topWord.help': 'La parola di almeno 4 lettere più frequente nel testo degli errori, senza le parole comuni.',
  'mm.fact.errorsTrend.k': 'Come va', 'mm.fact.errorsTrend': (p: FP) => (Number(p.now) < Number(p.before) ? `Gli errori calano: **${p.now}** negli ultimi 30 giorni, ${p.before} nei 30 prima.` : Number(p.now) > Number(p.before) ? `Gli errori crescono: **${p.now}** negli ultimi 30 giorni, ${p.before} nei 30 prima.` : `Errori stabili: **${p.now}** negli ultimi 30 giorni, come nei 30 prima.`),
  'mm.fact.errorsTrend.help': 'Errori datati degli ultimi 30 giorni contro quelli dei 30 giorni prima.',
  'mm.fact.duplicates.k': 'Doppioni', 'mm.fact.duplicates': (p: FP) => (Number(p.n) === 1 ? '**1 ricordo** è scritto uguale in più agenti: «Unisci i doppioni» lo mette una volta nella memoria condivisa.' : `**${p.n} ricordi** sono scritti uguali in più agenti: «Unisci i doppioni» li mette una volta nella memoria condivisa.`),
  'mm.fact.duplicates.help': 'Righe uguali (senza data, maiuscole e punteggiatura) in due o più memorie di agenti.',
  'mm.fact.silent.k': 'Agenti senza ricordi', 'mm.fact.silent': (p: FP) => `**${p.n}** agenti non hanno ancora scritto nulla: ${p.names}.`,
  'mm.fact.silent.help': 'Ruoli senza il file agents/<ruolo>/memory.md. Non è un problema: lo scrivono quando imparano qualcosa.',
  'mm.fact.busiestDay.k': 'Il giorno più ricco', 'mm.fact.busiestDay': (p: FP) => `Il **${p.date}** la memoria è cresciuta di **${p.n} righe**: il record.`,
  'mm.fact.busiestDay.help': 'Il giorno con più righe nuove in tutti i file di memoria, errori e diario compresi. Una riga senza data conta nel giorno in cui il suo file è cambiato.',

  // charts
  'mm.growth': 'Come cresce la memoria',
  'mm.growthHelp': 'Righe nuove per settimana (da lunedì), divise per tipo, nelle ultime 12 settimane. La data è quella scritta all’inizio della riga; una riga senza data conta nella settimana in cui il suo file è cambiato l’ultima volta. Il diario conta ogni riga di ogni giorno.',
  'mm.growthFind': (p: { n: number; weeks: number }) => `${p.n} righe nuove nelle ultime ${p.weeks} settimane.`,
  'mm.growthNone': 'Nessuna riga nuova nelle ultime 12 settimane.',
  'mm.perAgent': 'Righe per agente',
  'mm.perAgentHelp': 'Le righe di elenco della memoria di ogni agente (agents/<ruolo>/memory.md). Gli agenti senza file non compaiono.',
  'mm.perAgentFind': (p: { name: string; n: number; silent: number }) => `${p.name} ricorda di più (${p.n} righe)${p.silent ? `; ${p.silent} agenti non hanno ancora una memoria` : ''}.`,
  'mm.perAgentEmpty': 'Nessun agente ha ancora scritto la sua memoria.',
  
  'mm.skills': 'Skill utili e inutili',
  'mm.skillsLead': (p: { useful: number; weak: number; unused: number; total: number }) => `Su ${p.total} skill: ${p.useful} utili, ${p.weak} da rivedere, ${p.unused} mai usate.`,
  'mm.skillsEmpty': 'Nessuna skill nel brain ancora.',
  'mm.skillsHelp': 'Per ogni skill del brain, i run registrati che l’hanno avuta (al lancio o caricata dal motore) e come sono finiti. Un esito conta solo quando è noto: riuscito, parziale o fallito, deciso da te o da una revisione.',
  'mm.col.skill': 'Skill', 'mm.col.skillHelp': 'Il nome della skill: un clic apre il suo SKILL.md.',
  'mm.col.verdict': 'Giudizio', 'mm.col.verdictHelp': 'Utile: almeno 10 esiti noti e il 70% riusciti. Da rivedere: almeno 10 esiti noti e meno del 50%. Incerta: tra i due. Pochi dati: meno di 10 esiti noti. Mai usata: nessun run da almeno 14 giorni. Nuova: più giovane di 14 giorni.',
  'mm.col.uses': 'Run', 'mm.col.usesHelp': 'Quanti run hanno avuto la skill.',
  'mm.col.success': 'Riusciti', 'mm.col.successHelp': 'Run riusciti su run con un esito noto (riuscito, parziale o fallito).',
  'mm.col.last': 'Ultimo uso', 'mm.col.lastHelp': 'L’inizio dell’ultimo run che l’ha avuta.',
  'mm.col.agents': 'Agenti', 'mm.col.agentsHelp': 'Quanti agenti la dichiarano: la ricevono a ogni loro run.',
  'mm.verdict.useful': 'Utile', 'mm.verdict.mixed': 'Incerta', 'mm.verdict.weak': 'Da rivedere', 'mm.verdict.few': 'Pochi dati', 'mm.verdict.unused': 'Mai usata', 'mm.verdict.new': 'Nuova',
  'mm.successTitle': (p: { ok: number; n: number }) => `${p.ok} riusciti su ${p.n} con esito noto`,
  'mm.stale': 'File fermi', 'mm.staleLead': (p: { days: number }) => `File di memoria non toccati da ${p.days} giorni o più: ancora veri?`,
  'mm.staleHelp': (p: { days: number }) => `I file di memoria (il diario escluso: i giorni passati non invecchiano) la cui ultima modifica è di ${p.days} giorni fa o più, dal più vecchio.`,
  'mm.staleEmpty': (p: { days: number }) => `Nessun file fermo da ${p.days} giorni: la memoria è fresca.`,

  // cards and page
  'mm.clean.title': 'La memoria è ancora vuota',
  'mm.clean.lead': 'Il brain è nuovo: qui si riempie da solo mentre gli agenti lavorano. Ecco cosa comparirà.',
  'mm.clean.lines': 'I ricordi degli agenti', 'mm.clean.linesText': 'Ogni agente scrive una riga quando impara qualcosa: la vedrai crescere settimana per settimana.',
  'mm.clean.errors': 'Gli errori ricorrenti', 'mm.clean.errorsText': 'Quando correggi un agente l’errore viene registrato; quelli che si ripetono diventano regole.',
  'mm.clean.skills': 'Le skill utili e inutili', 'mm.clean.skillsText': 'Per ogni skill: quante volte è servita, quanto bene e quando l’ultima volta.',
  'mm.clean.facts': 'Le curiosità', 'mm.clean.factsText': 'Il ricordo più usato, il giorno con più errori, la skill dimenticata.',
  // the one-click maintenance (ADR 0132, 0153)
};
