// Role cards of the Agenti catalogue (components/AgentCatalogCard.tsx, AgentCatalogPage.tsx): short metric labels,
// status, details toggle and the team summary, in Italian. English counterpart in agents-grid.en.ts (ADR 0057).
export const agentsGridIt = {
  'agentsGrid.runs': 'Concluse', 'agentsGrid.open': 'In corso', 'agentsGrid.cost': 'Costo',
  'agentsGrid.working': 'Al lavoro','agentsGrid.openProfile': 'Modifica il ruolo', 'agentsGrid.count': ({ n }: { n: number }) => n === 1 ? '1 ruolo' : `${n} ruoli`,
  'agentsGrid.workingCount': ({ n }: { n: number }) => `${n} al lavoro`,
  'agentsGrid.trialCount': ({ n }: { n: number }) => `${n} in prova`,
  // level and performance on the card's front (main/agents/standing.ts: the formulas below must match it)
  'agentsGrid.level': 'Livello', 'agentsGrid.levelShort': ({ n }: { n: number }) => `Lv ${n}`,
  'agentsGrid.levelTitle': ({ n }: { n: number }): string => n >= 100 ? 'Mito' : n >= 75 ? 'Leggenda' : n >= 50 ? 'Gran maestro' : n >= 35 ? 'Maestro' : n >= 20 ? 'Veterano' : n >= 10 ? 'Esperto' : n >= 5 ? 'Praticante' : n >= 2 ? 'Apprendista' : 'Recluta',
  'agentsGrid.levelWins': ({ n }: { n: number }) => n === 1 ? '1 riuscito verificato' : `${n} riusciti verificati`,
  'agentsGrid.levelXp': ({ n }: { n: number }) => `${n} XP`,
  'agentsGrid.levelNext': ({ left, next }: { left: number; next: number }) => `${left} XP al Lv ${next}`,
  'agentsGrid.levelTop': 'Livello massimo',
  'agentsGrid.levelHelpTitle': 'Come si calcola il livello',
  'agentsGrid.levelHelp1': 'Il livello sale solo con lavori riusciti e verificati: il tuo voto, una revisione indipendente, le ricevute dell\'app (test del progetto passati dopo l\'ultima modifica). Mai col giudizio dell\'agente su sé stesso, mai col silenzio.',
  'agentsGrid.levelHelp2': 'Un lavoro riuscito vale da 1 a 5 XP secondo quanto è grande: turni, tempo di lavoro, file cambiati, chat delegate. Lv 2 a 6 XP (circa 3 lavori), Lv 10 a 202, Lv 50 a 3.037, Lv 100 (il massimo) a 9.358. A un ritmo tipico (4 lavori verificati al giorno): una settimana per il Lv 5, un mese per il Lv 10, circa 4 anni per il Lv 100.',
  'agentsGrid.levelHelp3': 'Titoli: Recluta (Lv 1), Apprendista (2–4), Praticante (5–9), Esperto (10–19), Veterano (20–34), Maestro (35–49), Gran maestro (50–74), Leggenda (75–99), Mito (100).',
  'agentsGrid.levelHelpOrchestrator': 'Orchestrator: guadagna con i lavori che ha avviato e sono riusciti verificati, più 1 XP per un piano approvato senza modifiche. XP dimezzati se il compito è passato a un altro ruolo o è stato rifatto.',
  'agentsGrid.levelHelpEx': ({ xp, wins, runs, level, next, left }: { xp: number; wins: number; runs: number; level: number; next: number | null; left: number }) =>
    `${xp} XP da ${wins} ${wins === 1 ? 'riuscito verificato' : 'riusciti verificati'} su ${runs} ${runs === 1 ? 'lavoro concluso' : 'lavori conclusi'}: Lv ${level}` + (next === null ? ', il massimo.' : `; mancano ${left} XP per il Lv ${next}.`),
  // the user's pats and whacks on the role's little person (ADR 0297)
  'agentsGrid.success': 'Riuscite',
  'agentsGrid.successFew': ({ n, min }: { n: number; min: number }) => `Troppo pochi esiti verificati: ${n} su ${min}`,
  'agentsGrid.successNote': ({ n, min }: { n: number; min: number }) => `verificati: ${n} su ${min} necessari`,
  'agentsGrid.successHelp': ({ min }: { min: number }) => `La quota dei lavori conclusi con un esito verificato, tuo o di una revisione indipendente, che sono riusciti; un parziale vale mezzo. Sotto ${min} esiti verificati nessuna percentuale: solo quanti sono su ${min}. Diversa da Performance, che pesa anche i voti dell’Orchestrator e dei revisori.`,
  'agentsGrid.costHelp': 'Il costo mediano di un lavoro concluso: metà dei lavori è costata meno, metà di più. Conta solo i lavori di cui il motore riporta il costo.',
  'agentsGrid.medianTime': 'Tempo',
  'agentsGrid.medianTimeFull': 'Tempo mediano di esecuzione',
  'agentsGrid.noRuns': 'Nessun lavoro riuscito verificato ancora: il primo lo porta verso il Lv 2.',
};
