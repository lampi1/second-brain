// The browser grant cannot escape through commands, external connectors or child workers. Narrows actual role policy.
import { browserAccess, narrowest, type AgentPolicy } from '../agents/tool-policy';
export const BROWSER_WORKER_TOOLS = new Set(['agent_report', 'show_ui', 'flow_output', 'flow_intake', 'flow_verdict', 'flow_downgrade', 'flow_step_history', 'agent_task_events']);
export function browserWorkerPolicy(base: AgentPolicy | null | undefined): AgentPolicy {
  if (browserAccess(base) !== 'all') throw new Error('This role lacks browser write tools; enable them in its role settings first');
  return narrowest(base, { tools: { allow: ['read', 'browser'] }, ceiling: null })!;
}
