// Agents and automations: roles, avatars, work threads, routines, cloud agents, Pulse, approvals, connectors and MCP servers, the Guida.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { AgentImages } from '../agent-images';
import type { AgentLifecycleDecide, AgentLifecycleSnapshot } from '../agent-lifecycle';
import type { LearnedRuleProposal } from '../agent-pack';
import type { AgentCatalog, AgentDraft, AgentMetrics, AgentMetricsFilter, AgentProfile, AgentUndo, AgentVersion, JudgingEstimate } from '../agents';
import type { CloudAgent, CloudApplyResult, CloudState } from '../cloud';
import type { ConnectorId, ConnectorState, ConnectorToken } from '../connectors';
import type { FileViewResult } from '../file-view';
import type { FlowSnapshot } from '../flows';
import type { GuideAnswer, GuideAskRequest, GuideStaleState } from '../guide-ask';
import type { McpImportCandidate, McpServerDef, McpServersState, McpToolAccess } from '../mcp-servers';
import type { ApprovalDecision, ApprovalItem, PulseActResult, PulseDismissReason, PulseList, PulsePlace, PulseResult, PulseStatus } from '../pulse';
import type { RoleId } from '../roles';
import type { RoutineRunDetail, RoutineRunRef, RoutineTerminalExport, RoutinesSnapshot } from '../routines';
import type { RunEstimates } from '../task-estimate';
import type { WorkDecision, WorkThread } from '../workflows';

/** renderer → main, agents: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface AgentsInvokeMap {
  // the Routine section (ADR 0175, 0176): packages, their trigger and secrets, runs read from the run folders
  'routines:list': [void, RoutinesSnapshot];
  'routines:import': [{ data: string }, RoutinesSnapshot];
  /** writes the filled zip under %LOCALAPPDATA%/routine-runtime/packages/<id>/ in main: the zip never crosses IPC */
  'routines:export': [{ id: string }, RoutineTerminalExport];
  'routines:setSecrets': [{ id: string; values: Record<string, string> }, RoutinesSnapshot];
  'routines:image': [{ ref: RoutineRunRef; path: string }, FileViewResult];
  'routines:watch': [{ ref: RoutineRunRef; subscription: string }, RoutineRunDetail];
  'routines:unwatch': [{ subscription: string }, void];
  'routines:convert': [{ flowId: string }, RoutinesSnapshot];
  'routines:archive': [void, FlowSnapshot];
  /** the routine package (ADR 0156): what it would hold; then built, guard-scanned and saved where the user picks (null = cancelled) */
  /** a routine package zip (base64): what importing it would write; then the routine as a new draft plus the ticked items */
  // the app's routine runner (ADR 0155): the user's own controls on the Routine page
  /** «Esegui» on a prod step: only this click runs a prod command; `command` is the exact text the user saw */
  'work:lessons': [void, LearnedRuleProposal[]];
  'work:lessonDecide': [{ id: string; rule: string; approve: boolean; feedback?: string }, void];
  'work:list': [void, WorkThread[]];
  'work:decide': [WorkDecision, WorkThread];
  'connectors:list': [void, ConnectorState[]];
  'connectors:login': [{ provider: ConnectorId }, void];
  'connectors:cancelLogin': [void, void];
  'connectors:probe': [{ provider: ConnectorId }, ConnectorState];
  'connectors:select': [{ provider: ConnectorId; projects: string[] }, ConnectorState];
  'connectors:disconnect': [{ provider: ConnectorId }, void];
  /** a tool tile of the setup / Settings catalog (ADR 0119): the token the user pasted there (GitHub: a fine-grained
   *  token; Jira Cloud: site, email and API token) is kept encrypted for the account and probed at once */
  'connectors:useToken': [ConnectorToken, ConnectorState];
  // the app-managed MCP servers (ADR 0086): only the user's clicks in Settings → Connettori and on the agent card
  'mcpservers:state': [void, McpServersState];
  'mcpservers:save': [{ def: McpServerDef; previousId?: string }, McpServersState];
  'mcpservers:remove': [{ id: string }, McpServersState];
  'mcpservers:setSecret': [{ id: string; slot: string; value: string }, McpServersState];
  'mcpservers:deleteSecret': [{ id: string; slot: string }, McpServersState];
  'mcpservers:setAccess': [{ role: string; server: string; access: McpToolAccess }, McpServersState];
  'mcpservers:test': [{ id: string }, McpServersState];
  'mcpservers:importScan': [void, McpImportCandidate[]];
  'mcpservers:importApply': [{ keys: string[] }, { state: McpServersState; added: string[]; errors: { key: string; message: string }[] }];
  'agents:list': [void, AgentCatalog];
  /** the user's Annulla on a change the app applied (feed card, change log) */
  'agents:undo': [AgentUndo, AgentProfile];
  /** ends a role's open trial: keep its version or roll back to the baseline */
  'agents:trialDecide': [{ id: string; decision: 'keep' | 'rollback' }, AgentProfile];
  /** the user's decision on one "Da approvare" entry (AgentLifecycleProposal, read at /api/agents/lifecycle): approve does
   *  what its kind says (agent-lifecycle.ts), dismiss drops it for a while; returns the queue after the decision */
  'agents:lifecycleDecide': [AgentLifecycleDecide, AgentLifecycleSnapshot];
  /** the user's edit of a role (Brain → Agenti) */
  'agents:save': [{ profile: AgentDraft; id: string }, AgentProfile];
  /** "Ripristina predefinito": the shipped role again */
  'agents:reset': [{ id: string }, AgentProfile];
  'agents:history': [{ id: string }, AgentVersion[]];
  /** the §5 metrics per agent and version (A6); since = only runs ended from then on; skill/app/repo = only runs with that
   *  tag (untagged runs never match) */
  'agents:metrics': [AgentMetricsFilter | undefined, AgentMetrics[]];
  /** the task estimates of these runs (estimate made before each started, actual once ended) and the estimator's weekly
   *  accuracy (ADR 0087, src/main/agents/run-estimates.ts) */
  'agents:estimates': [{ runIds?: string[] } | undefined, RunEstimates];
  /** what «Abilita controllo livello e performance» costs a day (agents/judge-sample.ts judgingEstimate), zero tokens */
  'agents:judgingEstimate': [void, JudgingEstimate];
  'agents:restoreVersion': [{ id: string; version: number }, AgentProfile];
  /** the user's own pictures for the roles (shared/agent-images.ts): the role's page sets one (a square PNG the
   *  renderer cropped) or removes it to bring the character back. Main renderer only. */
  'avatars:get': [void, AgentImages];
  'avatars:set': [{ id: RoleId; bytes: Uint8Array }, AgentImages];
  'avatars:reset': [{ id: RoleId }, AgentImages];
  'pulse:list': [{ place: PulsePlace }, PulseList];
  'pulse:status': [void, PulseStatus];
  'pulse:seen': [{ ids: string[] }, void];
  'pulse:save': [{ id: string }, PulseResult];
  'pulse:act': [{ id: string }, PulseActResult];
  'pulse:dismiss': [{ id: string; reason?: PulseDismissReason }, PulseResult];
  'approvals:list': [{ agentId?: string }, ApprovalItem[]];
  'approvals:decide': [ApprovalDecision, PulseResult];
  /** cloud agents (ADR 0080, main/cloud/): the known ones (refresh = ask the vendors now, at most every 30 s) */
  'cloud:list': [{ refresh?: boolean } | void, CloudState];
  'cloud:followUp': [{ id: string; text: string }, CloudAgent];
  'cloud:stop': [{ id: string }, CloudAgent];
  /** "Porta in locale": the result into a NEW worktree beside the repo (never into the checkout itself) */
  'cloud:apply': [{ id: string }, CloudApplyResult];
  /** the strip expanded now (its messages stream while it stays open, Cursor), or null */
  'cloud:watch': [{ id: string | null }, void];
  /** forget a finished agent (the vendor keeps it) */
  'cloud:dismiss': [{ id: string }, CloudState];
  /** «Chiedi alla Guida» (ADR 0196): one light model, no tools, the Guida cards as context */
  'guide:ask': [GuideAskRequest, GuideAnswer];
  /** the Guida cards whose anchored code changed (a run from the repo; checked: false in a packaged build) */
  'guide:stale': [void, GuideStaleState];
}
