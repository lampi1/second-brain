// Agent cards of the Agenti catalogue (components/AgentCatalogCard.tsx, AgentCatalogPage.tsx): short metric labels,
// status, details toggle and the team summary, in Italian. English counterpart in agents-grid.en.ts (ADR 0057).
export const agentsGridIt = {
  'agentsGrid.runs': 'Concluse', 'agentsGrid.open': 'In corso', 'agentsGrid.success': 'Successo', 'agentsGrid.cost': 'Costo',
  'agentsGrid.working': 'Al lavoro','agentsGrid.openProfile': 'Apri profilo', 'agentsGrid.origin': 'Origine',
  'agentsGrid.count': ({ n }: { n: number }) => n === 1 ? '1 agente' : `${n} agenti`,
  'agentsGrid.workingCount': ({ n }: { n: number }) => `${n} al lavoro`,
  'agentsGrid.probationCount': ({ n }: { n: number }) => `${n} in prova`,
};
