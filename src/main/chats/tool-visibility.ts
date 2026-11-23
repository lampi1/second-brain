// Which of the tools on a chat's own MCP endpoint that chat sees (ChatManager.chatToolShown): only those its kind could
// never use are left out (refused for that kind of chat, or already on its own endpoint), so nothing that works today is
// lost. Pure: the chat's summary, the roles it may launch, or a waiting engine's view in, a yes or no out. Used by
// manager.ts.
import type { ChatSummary } from '../../shared/contract';
import type { McpTool } from '../mcp/server';
import { RUN_CODE } from '../code-mode/policy';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import type { WarmLaunch } from './warm';
import { isDelegatorRole } from '../../shared/roles';

/** chat-endpoint tools the Orchestrator can never use (chatToolShown): it does not delegate, report, ask a parent or
 *  list children (its chats are roots), and
 *  agent_catalog / agent_learn_propose are on its own endpoint already */
const ORCHESTRATOR_HIDDEN: ReadonlySet<string> = new Set(['agent_work_decisions', 'plan_propose', 'plan_update', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_report', 'agent_ask_parent', 'agent_answer_child', 'agent_close_child', 'agent_children', 'agent_catalog', 'agent_learn_propose',
  // it saves scripts with brain_script_save on its own endpoint
  'brain_script_add',
  // it reads, opens and corrects the project maps with app_project_map, and has a Scout draw them (ADR 0271)
  'project_map_read', 'project_map_save', 'project_map_update',
]);
/** the tools only a chat that may delegate can use (chatToolShown): only the Strategist among the work roles (the
 *  Orchestrator has its own endpoint); Scout, Artisan, Sentinel and Herald never see them (2026-11-23), nor a role that
 *  launches nobody (~1 500 tokens of schemas in every call, each call refused) */
const DELEGATING_ONLY: ReadonlySet<string> = new Set(['agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_children', 'agent_answer_child', 'agent_close_child', 'agent_catalog']);
/** the Strategist's plan tools (agents/strategy-tools.ts): shown only where a plan with the user exists */
const PLAN_TOOLS: ReadonlySet<string> = new Set(['plan_propose', 'plan_update']);
/** the chat-endpoint tools the maintenance research never sees (chatToolShown), beside every agent_* tool */
const RESEARCH_HIDDEN: ReadonlySet<string> = new Set([...APP_CHAT_TOOLS, 'brain_script_add', 'brain_query_add', 'project_map_save', 'project_map_update', 'artifact_save']);
/** the maintenance research's tools (ADR 0132, 0195, brainmodel/research-tools.ts) */
const RESEARCH_TOOLS: ReadonlySet<string> = new Set(['maintenance_pack', 'maintenance_propose', 'maintenance_role_trial']);

/** chat-endpoint tools only the Orchestrator uses (single entry, ADR 0239: chats/relay.ts) */
const ORCHESTRATOR_ONLY: ReadonlySet<string> = new Set(['relay_question']);

/** the app's yes/no question (chats/ask-tool.ts): only for a chat whose engine has no question tool of its own */
const ASK_TOOL = 'ask_user';

/** No chat and no waiting engine: every tool but the research's. */
export const toolShownToUnknown = (tool: string): boolean => !RESEARCH_TOOLS.has(tool) && tool !== ASK_TOOL;

/** A waiting engine launched for a role: what that role's root chat would see (it lists tools once, at start). */
export function toolShownToWarm(warm: NonNullable<WarmLaunch['view']>, tool: string): boolean {
  return !ORCHESTRATOR_ONLY.has(tool) && !(DELEGATING_ONLY.has(tool) && (warm.launches?.length === 0 || (warm.role !== undefined && !isDelegatorRole(warm.role)))) && (tool !== 'agent_ask_parent' || !!warm.child) && !PLAN_TOOLS.has(tool) && !RESEARCH_TOOLS.has(tool) && tool !== ASK_TOOL;
}

/** A chat of the app: `launches` = the roles it may launch (undefined = unknown); `appAsks` = its engine has no
 *  question tool of its own (engines/registry.ts appAsks), so it asks with ask_user. */
export function toolShownToChat(s: Pick<ChatSummary, 'research' | 'isOrchestrator' | 'parentId' | 'plan' | 'run'> & { agent?: Pick<NonNullable<ChatSummary['agent']>, 'id' | 'source'> }, launches: readonly string[] | undefined, tool: string, appAsks = false): boolean {
  if (tool === ASK_TOOL) return appAsks && !s.research;
  // the maintenance research (ADR 0132): its two tools and nothing of the app's mail, delegation or plans
  if (s.research) return RESEARCH_TOOLS.has(tool) || (!RESEARCH_HIDDEN.has(tool) && !tool.startsWith('agent_'));
  if (RESEARCH_TOOLS.has(tool)) return false;
  if (s.isOrchestrator) return !ORCHESTRATOR_HIDDEN.has(tool);
  if (ORCHESTRATOR_ONLY.has(tool)) return false;
  if (tool === 'agent_ask_parent' && !s.parentId) return false;
  // the plan with the user: only a Strategist root chat has one (ADR 0108)
  if (PLAN_TOOLS.has(tool)) return !!s.plan;
  // a role that launches nobody; launches unknown (a chat saved before they were kept) = shown, as before
  if (DELEGATING_ONLY.has(tool) && launches?.length === 0) return false;
  // a catalog role that does not delegate, whatever a stale launches list says (shared/roles.ts DELEGATOR_ROLE_IDS)
  if (DELEGATING_ONLY.has(tool) && s.agent?.source === 'catalog' && !isDelegatorRole(s.agent.id)) return false;
  // App background jobs report only when their creation explicitly supplied a task contract.
  if (tool === 'agent_report' && !s.parentId && s.run?.startedBy === 'app' && !s.run.taskContract?.reportExpected) return false;
  return true;
}

const COMPACT_TOOL_DESC = 180;
const COMPACT_PROP_DESC = 80;

const clipDesc = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

function compactSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchemaNode);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = k === 'description' && typeof v === 'string' ? clipDesc(v, COMPACT_PROP_DESC) : compactSchemaNode(v);
  }
  return out;
}

/** Compact MCP tool metadata for engines with a tight eager schema budget (Antigravity agy acp, ADR 0332): trims long
 *  prose descriptions while keeping every parameter name, type, enum and required field intact. run_code keeps its
 *  compact per-chat tool list untouched. */
export function compactMcpTool(tool: McpTool): McpTool {
  const description = clipDesc(tool.description, COMPACT_TOOL_DESC);
  if (tool.name === RUN_CODE) return { ...tool, description };
  const inputSchema = compactSchemaNode(tool.inputSchema) as Record<string, unknown>;
  const inputSchemaFor = tool.inputSchemaFor;
  return {
    ...tool,
    description,
    inputSchema,
    ...(inputSchemaFor ? { inputSchemaFor: (params: Record<string, string>) => compactSchemaNode(inputSchemaFor(params)) as Record<string, unknown> } : {}),
  };
}
