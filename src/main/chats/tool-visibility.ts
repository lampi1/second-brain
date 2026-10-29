// Which of the tools on a chat's own MCP endpoint that chat sees (ChatManager.chatToolShown): only those its kind could
// never use are left out (refused for that kind of chat, or already on its own endpoint), so nothing that works today is
// lost. Pure: the chat's summary, the roles it may launch, or a waiting engine's view in, a yes or no out. Used by
// manager.ts.
import type { ChatSummary } from '../../shared/contract';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import type { WarmLaunch } from './warm';

/** chat-endpoint tools the Orchestrator can never use (chatToolShown): it does not delegate, report, ask a parent or
 *  rate a child (its chats are roots: agent_child_feedback takes only a child's run), and
 *  agent_catalog / agent_learn_propose are on its own endpoint already */
const ORCHESTRATOR_HIDDEN: ReadonlySet<string> = new Set(['agent_work_decisions', 'plan_propose', 'plan_update', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_report', 'agent_ask_parent', 'agent_answer_child', 'agent_children', 'agent_child_feedback', 'agent_catalog', 'agent_learn_propose',
  // it saves scripts with brain_script_save on its own endpoint
  'brain_script_add',
]);
/** the tools only a chat that may delegate can use (chatToolShown): a role that launches no role (Scout, Judge) never
 *  sees them (~1 500 tokens of schemas in every call, each call refused) */
const DELEGATING_ONLY: ReadonlySet<string> = new Set(['agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_children', 'agent_answer_child', 'agent_child_feedback', 'agent_catalog', 'skills_suggest']);
/** the Strategist's plan tools (agents/strategy-tools.ts): shown only where a plan with the user exists */
const PLAN_TOOLS: ReadonlySet<string> = new Set(['plan_propose', 'plan_update']);
/** the chat-endpoint tools Flash never sees (chatToolShown), beside every agent_* tool */
const LAMPO_HIDDEN: ReadonlySet<string> = new Set([...APP_CHAT_TOOLS, 'brain_script_add', 'brain_query_add', 'skills_suggest']);
/** the maintenance research's two tools (ADR 0132, brainmodel/research-tools.ts) */
const RESEARCH_TOOLS: ReadonlySet<string> = new Set(['maintenance_pack', 'maintenance_propose']);

/** No chat and no waiting engine: every tool but the research's. */
export const toolShownToUnknown = (tool: string): boolean => !RESEARCH_TOOLS.has(tool);

/** A waiting engine launched for a role: what that role's root chat would see (it lists tools once, at start). */
export function toolShownToWarm(warm: NonNullable<WarmLaunch['view']>, tool: string): boolean {
  return !(DELEGATING_ONLY.has(tool) && warm.launches?.length === 0) && (tool !== 'agent_ask_parent' || !!warm.child) && !PLAN_TOOLS.has(tool) && !RESEARCH_TOOLS.has(tool);
}

/** A chat of the app: `launches` = the roles it may launch (undefined = unknown). */
export function toolShownToChat(s: Pick<ChatSummary, 'research' | 'isOrchestrator' | 'quick' | 'parentId' | 'plan' | 'run'>, launches: readonly string[] | undefined, tool: string): boolean {
  // the maintenance research (ADR 0132): its two tools and nothing of the app's mail, delegation or plans
  if (s.research) return RESEARCH_TOOLS.has(tool) || (!LAMPO_HIDDEN.has(tool) && !tool.startsWith('agent_'));
  if (RESEARCH_TOOLS.has(tool)) return false;
  if (s.isOrchestrator) return !ORCHESTRATOR_HIDDEN.has(tool);
  // Flash starts no work (ADR 0105): no mail to other chats, no delegation, no report, no saved script
  if (s.quick) return !LAMPO_HIDDEN.has(tool) && !tool.startsWith('agent_');
  if (tool === 'agent_ask_parent' && !s.parentId) return false;
  // the plan with the user: only a Strategist root chat has one (ADR 0108)
  if (PLAN_TOOLS.has(tool)) return !!s.plan;
  // a role that launches nobody; launches unknown (a chat saved before they were kept) = shown, as before
  if (DELEGATING_ONLY.has(tool) && launches?.length === 0) return false;
  // App background jobs report only when their creation explicitly supplied a task contract.
  if (tool === 'agent_report' && !s.parentId && s.run?.startedBy === 'app' && !s.run.taskContract?.reportExpected) return false;
  return true;
}
