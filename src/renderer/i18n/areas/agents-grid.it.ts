// Role cards of the Agenti catalogue (components/AgentCatalogCard.tsx, AgentCatalogPage.tsx): short metric labels,
// status, details toggle and the team summary, in Italian. English counterpart in agents-grid.en.ts (ADR 0057).
export const agentsGridIt = {
  'agentsGrid.runs': 'Concluse', 'agentsGrid.open': 'In corso', 'agentsGrid.success': 'Successo', 'agentsGrid.cost': 'Costo',
  'agentsGrid.working': 'Al lavoro','agentsGrid.openProfile': 'Apri il ruolo', 'agentsGrid.count': ({ n }: { n: number }) => n === 1 ? '1 ruolo' : `${n} ruoli`,
  'agentsGrid.workingCount': ({ n }: { n: number }) => `${n} al lavoro`,
  'agentsGrid.trialCount': ({ n }: { n: number }) => `${n} in prova`,
  // level and performance on the card's front (main/agents/standing.ts: the formulas below must match it)
  'agentsGrid.level': 'Livello', 'agentsGrid.levelShort': ({ n }: { n: number }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }: { n: number }): string => n >= 10 ? 'Leggenda' : n >= 6 ? 'Maestro' : ['Recluta', 'Apprendista', 'Praticante', 'Esperto', 'Veterano'][n - 1] ?? 'Recluta',
  'agentsGrid.levelWins': ({ n }: { n: number }) => n === 1 ? '1 riuscito verificato' : `${n} riusciti verificati`,
  'agentsGrid.levelNext': ({ left, next }: { left: number; next: number }) => left === 1 ? `1 lavoro riuscito al Lv ${next}` : `${left} lavori riusciti al Lv ${next}`,
  'agentsGrid.levelTop': 'Livello massimo',
  'agentsGrid.levelHelpTitle': 'Come si calcola il livello',
  'agentsGrid.levelHelp1': 'Il livello cresce solo con i lavori riusciti e verificati di questo agente: riusciti secondo il tuo voto, secondo una revisione indipendente verificata o secondo i fatti (tutti i criteri soddisfatti, nessuna tua correzione, non rifatto nei 7 giorni dopo). Un lavoro fallito, non verificato o ancora provvisorio non conta, e nemmeno il giudizio dell\'agente su sé stesso. L\'Orchestrator non ha lavori suoi: per lui conta ogni lavoro che ha avviato ed è riuscito verificato.',
  'agentsGrid.levelHelp2': 'Ogni livello chiede 5 lavori riusciti in più del precedente: Lv 2 a 5, Lv 3 a 15, Lv 4 a 30, Lv 5 a 50, Lv 6 a 75 (per il Lv N ne servono 5 × N × (N − 1) ÷ 2). Massimo Lv 50.',
  'agentsGrid.levelHelp3': 'Titoli: Recluta (Lv 1), Apprendista, Praticante, Esperto, Veterano (Lv 5), Maestro (Lv 6–9), Leggenda (Lv 10 e oltre). È un gioco, ma solo su dati verificati: dice quanti lavori ha portato a termine bene, non quanti ne ha fatti.',
  'agentsGrid.levelHelpEx': ({ wins, runs, level, next, left }: { wins: number; runs: number; level: number; next: number | null; left: number }) =>
    `${wins} ${wins === 1 ? 'riuscito verificato' : 'riusciti verificati'} su ${runs} ${runs === 1 ? 'lavoro concluso' : 'lavori conclusi'}: Lv ${level}` + (next === null ? ', il massimo.' : `; ${left === 1 ? 'ne manca 1' : `ne mancano ${left}`} per il Lv ${next}.`),
  'agentsGrid.perf': 'Performance',
  'agentsGrid.perfBand': ({ v }: { v: number }): string => v >= 0.85 ? 'Ottima' : v >= 0.7 ? 'Buona' : v >= 0.5 ? 'Discreta' : 'Da rivedere',
  'agentsGrid.perfWarmup': 'In rodaggio',
  'agentsGrid.perfWarmupCount': ({ n, min }: { n: number; min: number }) => `${n} su ${min} valutati`,
  'agentsGrid.perfJudged': ({ n }: { n: number }) => n === 1 ? '1 lavoro valutato' : `${n} lavori valutati`,
  'agentsGrid.perfHelpTitle': 'Come si calcola la performance',
  'agentsGrid.perfHelp1': 'È la media dei voti ai suoi lavori: riuscito vale 100%, riuscito in parte 50%, fallito 0%. I lavori senza nessun voto non contano. Il numero sotto dice su quanti lavori si basa.',
  'agentsGrid.perfHelp2': 'Ogni voto pesa per chi l\'ha dato (tu, una revisione indipendente o i fatti × 1, l\'Orchestrator × 0,6; il resoconto dell\'agente su sé stesso non conta) e per quanto è recente: un voto di 30 giorni fa pesa la metà di uno di oggi, uno di 60 giorni un quarto.',
  'agentsGrid.perfHelp3': ({ min }: { min: number }) => `Compare dopo ${min} lavori valutati; prima l'agente è «in rodaggio». Fasce: 85% e oltre ottima, 70–84% buona, 50–69% discreta, sotto il 50% da rivedere.`,
  'agentsGrid.perfSources': ({ human, review, facts, orchestrator, self }: { human: number; review: number; facts: number; orchestrator: number; self: number }) =>
    `Voti finora: ${human} tuoi, ${review} di revisioni indipendenti, ${facts} dai fatti, ${orchestrator} dell'Orchestrator` + (self ? `; ${self} solo dell'agente stesso, che non contano.` : '.'),
  'agentsGrid.costHelp': 'Il costo mediano di un lavoro concluso: metà dei lavori è costata meno, metà di più. Conta solo i lavori di cui il motore riporta il costo.',
  'agentsGrid.noRuns': 'Nessun lavoro riuscito verificato ancora: il primo lo porta verso il Lv 2.',
};
