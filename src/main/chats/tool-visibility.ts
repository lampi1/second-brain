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
import { ALL_REQUIRED_TOOLS, requiredTools, type ToolNeedView } from '../../shared/role-tools';

/** chat-endpoint tools the Orchestrator can never use (chatToolShown): it does not delegate, report, ask a parent or
 *  list children (its chats are roots), and
 *  agent_catalog / agent_learn_propose are on its own endpoint already */
const ORCHESTRATOR_HIDDEN: ReadonlySet<string> = new Set(['agent_work_decisions', 'plan_propose', 'plan_update', 'agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_report', 'agent_ask_parent', 'agent_answer_child', 'agent_close_child', 'agent_children', 'agent_catalog', 'agent_learn_propose',
  // it saves scripts with brain_script_save on its own endpoint
  'brain_script_add',
  // it has the plans on its own endpoint (ADR 0361); the chat endpoint's copy is the Strategists'
  'plans',
]);
/** the tools only a chat that may delegate can use (chatToolShown): only the Strategist among the work roles (the
 *  Orchestrator has its own endpoint); Scout, Artisan, Sentinel and Herald never see them (2026-11-23), nor a role that
 *  launches nobody (~1 500 tokens of schemas in every call, each call refused) */
const DELEGATING_ONLY: ReadonlySet<string> = new Set(['agent_delegate', 'agent_assign_task', 'agent_task_events', 'agent_children', 'agent_answer_child', 'agent_close_child', 'agent_catalog']);
/** the Strategist's plan tools (agents/strategy-tools.ts): shown only where a plan with the user exists */
const PLAN_TOOLS: ReadonlySet<string> = new Set(['plan_propose', 'plan_update']);
/** the chat-endpoint tools the maintenance research never sees (chatToolShown), beside every agent_* tool */
const RESEARCH_HIDDEN: ReadonlySet<string> = new Set([...APP_CHAT_TOOLS, 'brain_script_add', 'brain_query_add', 'plans', 'artifact_save']);
/** the maintenance research's tools (ADR 0132, 0195, brainmodel/research-tools.ts) */
const RESEARCH_TOOLS: ReadonlySet<string> = new Set(['maintenance_pack', 'maintenance_propose', 'maintenance_role_trial']);

/** chat-endpoint tools only the Orchestrator uses (single entry, ADR 0239: chats/relay.ts) */
const ORCHESTRATOR_ONLY: ReadonlySet<string> = new Set(['relay_question']);

/** the app's yes/no question (chats/ask-tool.ts): only for a chat whose engine has no question tool of its own */
const ASK_TOOL = 'ask_user';

/** No chat and no waiting engine: every tool but the research's. */
export const toolShownToUnknown = (tool: string): boolean => !RESEARCH_TOOLS.has(tool) && tool !== ASK_TOOL;

/** A waiting engine launched for a role: what that role's root chat would see (it lists tools once, at start); a
 *  Strategist's root may get a plan with the user, so its plan tools are listed (ADR 0356). */
export function toolShownToWarm(warm: NonNullable<WarmLaunch['view']>, tool: string): boolean {
  return !ORCHESTRATOR_ONLY.has(tool) && !(DELEGATING_ONLY.has(tool) && (warm.launches?.length === 0 || (warm.role !== undefined && !isDelegatorRole(warm.role)))) && (tool !== 'agent_ask_parent' || !!warm.child) && (!PLAN_TOOLS.has(tool) || (warm.role === 'strategist' && !warm.child)) && (tool !== 'plans' || (warm.role === 'strategist' && !warm.child)) && !RESEARCH_TOOLS.has(tool) && tool !== ASK_TOOL;
}

/** A chat of the app: `launches` = the roles it may launch (undefined = unknown); `appAsks` = its engine has no
 *  question tool of its own (engines/registry.ts appAsks), so it asks with ask_user. */
export function toolShownToChat(s: Pick<ChatSummary, 'research' | 'isOrchestrator' | 'parentId' | 'plan' | 'run'> & { agent?: Pick<NonNullable<ChatSummary['agent']>, 'id' | 'source'> }, launches: readonly string[] | undefined, tool: string, appAsks = false): boolean {
  // the role's required tools (shared/role-tools.ts, ADR 0356) are never hidden, whatever the rules below say
  if (requiredTools(needView(s, launches, appAsks)).includes(tool)) return true;
  if (tool === ASK_TOOL) return appAsks && !s.research;
  // the maintenance research (ADR 0132): its two tools and nothing of the app's mail, delegation or plans
  if (s.research) return RESEARCH_TOOLS.has(tool) || (!RESEARCH_HIDDEN.has(tool) && !tool.startsWith('agent_'));
  if (RESEARCH_TOOLS.has(tool)) return false;
  if (s.isOrchestrator) return !ORCHESTRATOR_HIDDEN.has(tool);
  if (ORCHESTRATOR_ONLY.has(tool)) return false;
  if (tool === 'agent_ask_parent' && !s.parentId) return false;
  // the plans: only a Strategist root chat (ADR 0361)
  if (tool === 'plans') return s.agent?.id === 'strategist' && !s.parentId;
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

/** A chat summary as the table of required tools reads it (shared/role-tools.ts). */
export function needView(s: Pick<ChatSummary, 'research' | 'isOrchestrator' | 'parentId' | 'plan' | 'run'> & { agent?: Pick<NonNullable<ChatSummary['agent']>, 'id' | 'source'> }, launches: readonly string[] | undefined, appAsks: boolean): ToolNeedView {
  return { role: s.agent?.source === 'catalog' ? s.agent.id : null, isOrchestrator: !!s.isOrchestrator, child: !!s.parentId, plan: !!s.plan, launches, appAsks,
    ...(s.run?.startedBy === 'app' && s.run.taskContract?.reportExpected ? { reportExpected: true } : {}), ...(s.research ? { research: true } : {}) };
}

const COMPACT_TOOL_DESC = 180;
const COMPACT_PROP_DESC = 80;
/** the tools a child cannot finish without (#463): agy drops the LARGEST tools first when over its budget, and
 *  agent_report was the second largest of the chat endpoint (≈2.6 KB compacted), so these get the shortest metadata */
const CORE_TOOLS: ReadonlySet<string> = ALL_REQUIRED_TOOLS;
const CORE_PROP_DESC = 40;
const CORE_TOOL_DESC = 140;
/** what a compact engine's list never carries (ADR 0356): the largest optional tools of the chat endpoint (#476's cause:
 *  agy dropped a large optional tool, then agent_report, the two largest, in the brain folder). They stay reachable through
 *  the fallback command (chats/tool-cli.ts) and Code Mode's run_code */
export const COMPACT_LEFT_OUT: ReadonlySet<string> = new Set(['plans', 'brain_script_add', 'brain_query_add']);
/** the whole compact list, well under agy's eager budget (it dropped tools from a 33.6 KB list plus the brain's skills) */
export const COMPACT_BUDGET = 24_000;

/** The compact list an engine with a tight schema budget gets (ADR 0332, 0356): the tools COMPACT_LEFT_OUT names out,
 *  then the largest optional tools out until the list fits COMPACT_BUDGET. Required tools are never removed (agy drops
 *  the largest first only when over its budget: a list under it keeps them all). `dropped` = what was left out. */
export function fitCompact(list: readonly McpTool[], required: ReadonlySet<string>): { tools: McpTool[]; dropped: string[] } {
  const sized = list.filter(t => required.has(t.name) || !COMPACT_LEFT_OUT.has(t.name)).map(t => ({ t, size: toolListSize([t]) }));
  const dropped = list.filter(t => !required.has(t.name) && COMPACT_LEFT_OUT.has(t.name)).map(t => t.name);
  const total = () => sized.reduce((n, x) => n + x.size, 0);
    const dropLargest = (): boolean => {
    const big = [...sized].sort((a, b) => b.size - a.size).find(x => !required.has(x.t.name));
    if (!big) return false;
    sized.splice(sized.indexOf(big), 1);
    dropped.push(big.t.name);
    return true;
  };
  while (total() > COMPACT_BUDGET && dropLargest());
  return { tools: sized.map(x => x.t), dropped };
}

const clipDesc = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

function compactSchemaNode(node: unknown, max = COMPACT_PROP_DESC): unknown {
  if (Array.isArray(node)) return node.map(x => compactSchemaNode(x, max));
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = k === 'description' && typeof v === 'string' ? clipDesc(v, max) : compactSchemaNode(v, max);
  }
  return out;
}

/** The size of a tool list as an engine reads it (name, description, schema): the log line of a compact chat (#463). */
export function toolListSize(tools: readonly McpTool[]): number {
  return tools.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0);
}

/** Compact MCP tool metadata for engines with a tight eager schema budget (Antigravity agy acp, ADR 0332): trims long
 *  prose descriptions while keeping every parameter name, type, enum and required field intact. run_code keeps its
 *  compact per-chat tool list untouched. */
export function compactMcpTool(tool: McpTool): McpTool {
  const description = clipDesc(tool.description, CORE_TOOLS.has(tool.name) ? CORE_TOOL_DESC : COMPACT_TOOL_DESC);
  if (tool.name === RUN_CODE) return { ...tool, description };
  const max = CORE_TOOLS.has(tool.name) ? CORE_PROP_DESC : COMPACT_PROP_DESC;
  const inputSchema = compactSchemaNode(tool.inputSchema, max) as Record<string, unknown>;
  const inputSchemaFor = tool.inputSchemaFor;
  return {
    ...tool,
    description,
    inputSchema,
    ...(inputSchemaFor ? { inputSchemaFor: (params: Record<string, string>) => compactSchemaNode(inputSchemaFor(params), max) as Record<string, unknown> } : {}),
  };
}
