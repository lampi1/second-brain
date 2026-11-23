// An agent's own page and the browser marker of a strip: English labels; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailEn: typeof agentDetailIt = {
  'agentDetail.back': 'All roles',
  'agentDetail.prompt': 'Role instructions',
  'agentDetail.promptHint': 'What the engine receives every time this role starts, after the rules every role shares.',
  'agentDetail.promptEmpty': 'No instructions written for this role.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 character' : `${n} characters`,
  'agentDetail.config': 'Configuration',
  'agentDetail.presets.hint': 'Whoever delegates picks Minimum, Base or Maximum for the task; with no pick, Base. Base is the role’s model and effort; empty Minimum and Maximum = the same as Base.',
  'agentDetail.presets.baseOnly': 'The Orchestrator is never delegated to: Base only, its model and effort.',
  'agentDetail.presets.saved': ({ preset }: { preset: string }) => `${preset} saved.`,
  'agentDetail.presets.undo': 'Undo',
  'agentDetail.results': 'Observed results',
  'agentDetail.tools': 'Tools',
  'agentDetail.toolsNone': 'None',
  
  'agentDetail.version': 'Version',
  'agentDetail.updated': 'Last edited',
  'agentDetail.closeEditor': 'Close without saving',
};
