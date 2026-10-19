// An agent's own page and the browser marker of a strip: English labels; parity checked against agent-detail.it.ts.
import type { agentDetailIt } from './agent-detail.it';
export const agentDetailEn: typeof agentDetailIt = {
  'agentDetail.back': 'All roles',
  'agentDetail.prompt': 'Role instructions',
  'agentDetail.promptHint': 'What the engine receives every time this role starts, after the rules every role shares.',
  'agentDetail.promptEmpty': 'No instructions written for this role.',
  'agentDetail.promptSize': ({ n }) => n === 1 ? '1 character' : `${n} characters`,
  'agentDetail.purpose': 'Purpose',
  'agentDetail.config': 'Configuration',
  'agentDetail.results': 'Observed results',
  'agentDetail.tools': 'Tools',
  'agentDetail.toolsNone': 'None', 'agentDetail.toolsAll': 'The engine’s own',
  'agentDetail.ceiling': 'Maximum permissions',
  'agentDetail.ceilingNone': 'Your settings',
  'agentDetail.ceiling.plan': 'Plan only', 'agentDetail.ceiling.default': 'Asks first', 'agentDetail.ceiling.acceptEdits': 'Accepts edits',
  'agentDetail.version': 'Version',
  'agentDetail.updated': 'Last edited',
  'agentDetail.closeEditor': 'Close without saving',
  'agentDetail.browserOn': ({ n }) => n === 1 ? 'Hide the browser' : `Hide the ${n} browsers`,
  'agentDetail.browserOff': ({ n }) => n === 1 ? 'Show the attached browser' : `Show the ${n} attached browsers`,
};
