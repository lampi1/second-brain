// Agent cards of the Agenti catalogue: English labels; parity checked against the Italian source (agents-grid.it.ts).
import type { agentsGridIt } from './agents-grid.it';
export const agentsGridEn: typeof agentsGridIt = {
  'agentsGrid.runs': 'Ended', 'agentsGrid.open': 'Open', 'agentsGrid.success': 'Success', 'agentsGrid.cost': 'Cost',
  'agentsGrid.working': 'Working', 'agentsGrid.details': 'Details', 'agentsGrid.openProfile': 'Open profile', 'agentsGrid.origin': 'Origin',
  'agentsGrid.count': ({ n }) => n === 1 ? '1 agent' : `${n} agents`,
  'agentsGrid.workingCount': ({ n }) => `${n} working`,
  'agentsGrid.probationCount': ({ n }) => `${n} on probation`,
};
