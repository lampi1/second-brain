// The one table of the tools each role must have on its chat's own MCP endpoint, on every engine (ADR 0356, owner,
// 2026-11-25: «ogni chat, su ogni harness, ha tutti gli strumenti dell'app previsti dal suo ruolo, dal primo all'ultimo
// turno»). Every place that decides what a chat sees reads it: the endpoint's filter never hides a required tool
// (chats/tool-visibility.ts), the compact list of a tight-budget engine keeps them small and never among the largest
// (Antigravity), the check at every start, resume and engine change compares it with what the engine was given
// (chats/tool-check.ts), and the fallback command reaches the same tools (chats/tool-cli.ts). Pure; pinned by
// test/unit/chats/role-tools-matrix.test.ts (harness × role × required tool).

/** What every chat of a role needs, as a child of another chat, and as the root of a plan with the user. */
export interface RoleToolNeeds { always: readonly string[]; asChild: readonly string[]; withPlan: readonly string[] }

const WORK: RoleToolNeeds = { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] };

/** The table: role → required tools. `plain` = a chat with no catalog role. */
export const ROLE_REQUIRED_TOOLS = {
  orchestrator: { always: ['show_ui', 'relay_question'], asChild: [], withPlan: [] },
  strategist: { always: ['show_ui', 'agent_delegate', 'agent_assign_task', 'agent_children'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: ['plan_propose', 'plan_update'] },
  scout: WORK,
  artisan: WORK,
  sentinel: WORK,
  herald: WORK,
  plain: WORK,
} as const satisfies Record<string, RoleToolNeeds>;

/** The app's own question tool, for an engine whose sessions have none of their own (every ACP engine). */
export const QUESTION_TOOL = 'ask_user';
/** The delegation tools a role that launches nobody never needs (its launches list is empty). */
const DELEGATING = new Set(['agent_delegate', 'agent_assign_task', 'agent_children']);

/** A chat as far as its required tools go. */
export interface ToolNeedView {
  /** its catalog role id, else null (a plain chat) */
  role: string | null;
  isOrchestrator: boolean;
  /** it has a parent that waits for its report */
  child: boolean;
  /** a Strategist with a plan with the user */
  plan: boolean;
  /** the roles it may launch (undefined = unknown) */
  launches?: readonly string[] | undefined;
  /** its engine has no question tool of its own */
  appAsks: boolean;
  /** an app job that must report (its task contract says so) */
  reportExpected?: boolean;
  /** the maintenance research: its own two tools, nothing else required */
  research?: boolean;
}

const needsOf = (role: string | null, isOrchestrator: boolean): RoleToolNeeds => {
  if (isOrchestrator) return ROLE_REQUIRED_TOOLS.orchestrator;
  const r = role && role !== 'orchestrator' && role in ROLE_REQUIRED_TOOLS ? role as keyof typeof ROLE_REQUIRED_TOOLS : 'plain';
  return ROLE_REQUIRED_TOOLS[r];
};

/** The tools this chat must have, in the table's order. */
export function requiredTools(v: ToolNeedView): string[] {
  if (v.research) return [];
  const n = needsOf(v.role, v.isOrchestrator);
  const out = [...n.always, ...(v.child ? n.asChild : []), ...(v.plan ? n.withPlan : []),
    ...(!v.child && v.reportExpected && !v.isOrchestrator ? ['agent_report'] : []), ...(v.appAsks ? [QUESTION_TOOL] : [])];
  return [...new Set(out)].filter(t => !(DELEGATING.has(t) && v.launches?.length === 0));
}

/** Every tool the table can require of someone (the compact list keeps these small: chats/tool-visibility.ts). */
export const ALL_REQUIRED_TOOLS: ReadonlySet<string> = new Set([...Object.values(ROLE_REQUIRED_TOOLS).flatMap(n => [...n.always, ...n.asChild, ...n.withPlan]), QUESTION_TOOL]);

/** Essential app-control tools the Orchestrator must have on its second-brain-app endpoint, on every engine (ADR 0356). */
export const ORCHESTRATOR_APP_REQUIRED: readonly string[] = [
  'app_create_chat', 'app_assign_task', 'app_config', 'plans',
  'app_chats', 'app_digest', 'app_pending', 'app_resolve_question',
  'app_send_to_chat', 'app_reopen_chat', 'app_close_chat', 'app_chat_items',
  'app_task_events', 'app_state', 'app_guide', 'app_agents_recap',
  'app_unblock', 'agent_catalog', 'task_estimate',
  'app_work_list', 'app_work_create', 'app_work_report',
];

/** The required tools that are not among `exposed`; [] = nothing missing. */
export function missingTools(required: readonly string[], exposed: Iterable<string>): string[] {
  const have = new Set([...exposed].map(bareTool));
  return required.filter(t => !have.has(t));
}

/** A tool name as an engine spells it, back to the app's: mcp__second-brain__agent_report (Claude, Codex),
 *  mcp_second-brain_agent_report (Antigravity), second-brain-agent_report, second-brain:agent_report. */
export function bareTool(name: string): string {
  const m = /^(?:mcp__?)?second-brain(?:-app)?(?:__|_|:|-|\.)(.+)$/.exec(name);
  return m ? m[1]! : name;
}

/** The chat the work of `id` goes on in now: its continuedBy chain followed to the end (an engine change, «Riprendi»);
 *  the chat itself when it never went on. A reuse (agent_assign_task, app_assign_task) lands there (ADR 0356). */
export function successorIn<T extends { id: string; continuedBy?: { id: string } | undefined }>(list: readonly T[], id: string): T | undefined {
  let cur = list.find(c => c.id === id), hops = 0;
  while (cur?.continuedBy && hops++ < 16) {
    const next = list.find(c => c.id === cur!.continuedBy!.id);
    if (!next) break;
    cur = next;
  }
  return cur;
}
