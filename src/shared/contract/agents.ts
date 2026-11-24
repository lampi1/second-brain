// Agents: roles, avatars, work threads, connectors and MCP servers.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { AgentImages } from '../agent-images';
import type { DailyQuips } from '../agent-quips';
import type { AgentLifecycleDecide, AgentLifecycleSnapshot } from '../agent-lifecycle';
import type { LearnedRuleProposal } from '../agent-pack';
import type { AgentCatalog, AgentDraft, AgentMetrics, AgentMetricsFilter, AgentProfile, AgentUndo, AgentVersion, JudgingEstimate } from '../agents';
import type { ConnectorId, ConnectorState, ConnectorToken } from '../connectors';
import type { McpImportCandidate, McpServerDef, McpServersState, McpToolAccess } from '../mcp-servers';
import type { RoleId } from '../roles';
import type { RunEstimates } from '../task-estimate';
import type { WorkDecision, WorkThread } from '../workflows';
import type { Lang } from './settings';

/** renderer → main, agents: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface AgentsInvokeMap {
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
  /** «Annulla» of a connector change the Orchestrator made (ADR 0207): the key on its feed card */
  'mcpservers:undo': [{ undo: string }, McpServersState];
  /** «Attiva» (ADR 0207): the user's click on a server the Orchestrator added or changed, naming what it runs */
  'mcpservers:activate': [{ id: string; runs: string }, McpServersState];
  /** «Accedi» / «Esci» of a remote connector's MCP OAuth login (ADR 0273); login opens the system browser, then tests */
  'mcpservers:login': [{ id: string }, McpServersState];
  'mcpservers:logout': [{ id: string }, McpServersState];
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
  /** the model each level of a role would start on now, and why (ADR 0347: its engines on, its plans' room) */
  'agents:levelRoute': [{ id: string }, Record<'min' | 'base' | 'max', { engine: string; model: string | null; index: number; reason: string; state: 'ok' | 'pace' | 'out' | 'unknown' } | null>];
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
  /** the little people's lines of the day (main/quips/daily.ts, ADR 0305): the lines to say now; `wait` writes
   *  today's first when they are due (three light model calls, at most twice a day per language) */
  'agents:quips': [{ lang: Lang; wait?: boolean }, { lines: DailyQuips; pending: boolean }];
}
