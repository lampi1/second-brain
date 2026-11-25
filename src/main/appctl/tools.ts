// App control tools: the app itself, usable by AI (the user, 2026-10-11: "l'IA deve sapere perfettamente come testarla da
// sola ... perché dovrà usarla al meglio"). Mounted on the local MCP server at /mcp/app (127.0.0.1 only, Host/Origin
// checked). An agent (the Orchestrator, a test agent) can read the app's state, chats, pending requests, feed and logs, take
// screenshots of the whole window, and steer the UI. Rules (ADR 0006):
// - It can NEVER answer a permission or start a command: only the user's click in the app is their ok. One exception
//   for questions (ADR 0017): app_resolve_question closes a work chat's question panel with the answer the user gave
//   the Orchestrator, marked "Risposto nell’Orchestrator dall'utente", and only if he wrote to the Orchestrator or answered it since the
//   question opened (the user, 2026-10-12: "anche se rispondi te alle chat, rimane la UI della domanda nella chat").
// - Messages it sends to chats are labelled as not written by the user (like mail between chats).
// - No production, no secrets: the logs it returns are already redacted by log.ts.
// - It can close a chat like the user's ✕ (app_close_chat), never an Orchestrator nor a chat waiting for the user.
// - Several Orchestrators (ADR 0021): each calls on its own endpoint, so the tools know the caller (appControlTools callerId).
// - Long chats: it can ask a chat's hand-off and "Riprendi" it in a new chat (app_handoff_chat, app_continue_chat),
//   under the same rule for chats across engines as messages (engines/policy.ts; an agent never starts a stopped
//   chat on another engine).
// - Both mounts see the shared Grindhouse. Only an Orchestrator's own mount brings the app's code folder up to date
//   when the user asks (app_update_code, ADR 0074); no tool promotes or restarts the app (only the user's click on
//   "Aggiorna" in Settings, ADR 0075).
// - After a recap the user asked for, an Orchestrator's own mount opens the questions window with everything waiting
//   for him (app_unblock, ADR 0135); it never answers any of it.
// - The user's call recordings and their local transcripts (app_recordings, ADR 0154): the Orchestrator's mount only.
// - A lesson in Impara when the user asks to understand something (app_learn, ADR 0190): the Orchestrator's mount only.
// - The latest report of any chat in its tree, delegates included (app_child_output, ADR 0226); the recap (app_agents_recap, 0260).
// - The skill library (app_skills, app_skill_write, app_skill_roles, app_skill_undo, ADR 0241): the Orchestrator's mount only.
import { successorIn } from '../../shared/role-tools';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ChatItem, ChatSummary, TasksState, Effort, EventMap, Harness, NewChat, PendingRequest, RunInfo, TaskKind, Usage } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { pickLines } from '../../shared/model-levels';
import { engineLabel, engineOf } from '../engines/registry';
import { agentsMayOpen, openRefusal } from '../engines/policy';
import type { BrainService, BrowserService, ChatService } from '../services';
import { log, redact } from '../log';
import { answerableInWords, sameWords } from '../../shared/answer-in-words';
import { heldQuestions, openQuestions } from '../../shared/question-ladder';
import { isPlanApproval } from '../../shared/strategy';
import { withPasswordsHidden } from '../browser/shot-mask';
import { fmtFactor, previewOf } from '../browser/preview';
import { healthSnapshot } from '../health';
import { timerSnapshot } from '../timers';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { isLongChat } from '../../shared/context';
import { describeUi } from '../../shared/genui';
import { digest } from './digest';
import { gitBranch } from '../chats/branch';
import { closeRefusal } from '../chats/close-rules';
import { unreadInstructions } from '../../shared/user-events';
import type { PullResult } from '../update/source';
import type { AgentCatalog } from '../../shared/agents';
import { isWorkRole, ROLE_IDS } from '../../shared/roles';
import { contractField, taskPrompt } from './task-contract';
import { routingFor } from '../agents/catalog';
import { agentCatalogTool, routingOf, userModelOf, type SkillToolsSource } from '../agents/discovery';
import { splitMode } from '../../shared/newchat';
import { gapLines, skillGaps } from '../agents/skill-needs';
import type { ResolvedRole } from '../agents/catalog';
import { PRESET_SCHEMA } from '../agents/preset-schema';
import { presetAskOf } from '../../shared/model-presets';

/** app_state's usage for agents: the harnesses' account e-mails stay in the app (the popover shows them to the user). */
export const usageForAgents = (u: Usage): Usage => u.harnesses ? { ...u, harnesses: u.harnesses.map(h => ({ ...h, accountEmail: null })) } : u;
import { metricsTool, type RunFeedback } from '../agents/run-feedback';
import { estimateTool, estimateTask, SimilarIndex } from '../agents/task-estimate';
import type { PriceOf } from '../agents/standing';
import { agentLearnTool, lessonReviewTool, type AgentPackLearning } from '../agents/pack/learning';
import type { McpTool } from '../mcp/server';
import { ToolRefusal } from '../mcp/refusal';
import { DELTA_REVIEW, hasReported, nextReviewOf, REVIEW_ROLES, reviewsSameWork, rootReviewer, type ReviewWorld } from '../agents/one-review';
import type { BrainScripts } from '../brain/scripts';
import type { BrainChangelog } from '../brain/changelog';
import { scriptWriteTools } from '../brain/scripts-tools';
import { AGENT_LABEL, ORCHESTRATOR_USER_LABEL } from '../../shared/agent-label';
import { voiceDiagnostics } from '../voice/diagnostics';
import { workflowTools, type WorkAway } from '../workflows/tools';
import type { Workflows } from '../workflows/service';
import { guideTool, screenOutline } from './guide';
import { CONFIG_ASK_MIN, CONFIG_TURN_MIN, configTool, type ConfigDeps } from './config';
import { lastAnswered, lastTyped, userAsked } from './user-words';
import { recordingTools, type RecordingsRead } from './recordings';
import { newsTools, type NewsControl } from './news';
import { imparaTools, type ImparaControl } from './impara';
import { childOutputTool } from './child-output';
import { agentsRecapTool } from './agents-recap';
import { MAP_LINK_SCHEMA, appProjectMapTool, mapHint, mapLinkOf } from '../projectmap/tools';
import { userShellName } from '../platform';
import type { ProjectMaps } from '../projectmap/service';
import type { WorkMaps } from '../workmap/service';
import { skillTools } from './skills';
import type { SkillLibrary } from '../skills/library';

export type ToolOut = string | { text?: string; images?: { data: string; mimeType: string; caption?: string }[] } | object;
export interface ToolDef { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(args: Record<string, unknown>): Promise<ToolOut> | ToolOut }

export interface AppCtlDeps {
  workflows?: Workflows;
  /** «Modalità notte» (ADR 0191): proposals approved for the absent user (workflows/tools.ts) */
  away?: WorkAway;
  agentLearning?: AgentPackLearning;
  agents?: () => AgentCatalog;
  /** the catalog's resolve (agents/catalog.ts): the engine, model and effort a role chat starts with */
  resolveRole?: (req: NewChat, o?: { exclude?: readonly string[]; freePick?: boolean }) => ResolvedRole;
  /** the one credit rule's verdict for an engine and model now (ADR 0354, agents/credit-live.ts) */
  creditOf?: (engine: Harness, model: string | null) => { state: 'free' | 'pace' | 'out' | 'probation' | 'unknown'; why: string; until: number | null };
  /** reads again, before a pick, the engines that look stopped without a valid reading (shared, at most a few seconds) */
  creditFresh?: () => Promise<void>;
  /** agent_metrics for the Orchestrator's own endpoint */
  runFeedback?: RunFeedback;
  /** list prices for the estimates' runs whose engine reported no cost (agents/list-price.ts, ADR 0284) */
  priceOf?: PriceOf;
  /** when a chat's context last began again (a new session or a compaction): app_digest since "last" answers in full
   *  after it, because the summary may have dropped what the earlier digests said */
  contextSince?: (chatId: string) => number | undefined;
  chats: ChatService; browser: BrowserService; brain: BrainService;
  window: () => BrowserWindow | null;
  emitUi: (cmd: EventMap['ui:command']) => void;
  version: string;
  /** the code blocks the user ran with "Esegui" (read-only: no tool starts a run) */
  runs?: (chatId?: string) => RunInfo[];
  /** the "Comando da eseguire" requests (shell blocks left for the user), listed with the other open requests */
  commandAsks?: () => PendingRequest[];
  /** the app's code folder (update/source.ts): a chat there works on the app (routing area App); pull = app_update_code */
  code?: { repo: () => string | null; inRepo?: (dir: string) => Promise<boolean>; pull?: () => Promise<PullResult> };
  /** the Task page's last read (the user's PRs, unread news) for app_digest; absent = not shown */
  tasks?: () => TasksState | null;
  /** a role version's results line for its route's reason ("12 run, 9 con esito, 78% riuscite"); absent = none */
  agentStats?: (agentId: string, version: number) => string | null;
  /** the brain's skills with the tools each calls: app_create_chat and agent_catalog warn about a skill a role lacks
   *  the tools for (agents/skill-needs.ts, issue #93); absent = no warnings */
  skillTools?: SkillToolsSource;
  /** the brain's scripts and changelog (ADR 0076): the Orchestrator's brain_script_save / _delete / brain_changelog_add */
  brainScripts?: { scripts: BrainScripts; changelog: BrainChangelog };
  /** the project maps (ADR 0271): app_project_map on the Orchestrator's own endpoint */
  projectMaps?: ProjectMaps;
  /** the work maps (ADR 0342): the job actions of app_project_map */
  workMaps?: WorkMaps;
  /** the call recordings (ADR 0154): app_recordings / app_recording_import on the Orchestrator's own endpoint */
  recordings?: RecordingsRead;
  /** the skill library (ADR 0241): app_skills / app_skill_write / app_skill_roles / app_skill_undo on the Orchestrator's own endpoint */
  skillLibrary?: SkillLibrary;
  /** Impara (ADR 0190): app_learn on the Orchestrator's own endpoint */
  impara?: ImparaControl;
  /** the «Giornale» (ADR 0280): app_news, app_news_edition, app_news_source, app_news_refresh on the Orchestrator's own endpoint */
  news?: NewsControl;
  /** the configuration the Orchestrator changes for the user (app_config, ADR 0149); settings come from `brain` */
  config?: Omit<ConfigDeps, 'callerId' | 'userAsked' | 'brain'>;
}


/** agent_learn_propose on the app endpoints: all proposals require a renderer user decision before application;
 *  on any other app endpoint the lesson waits like a work chat's (no rule). */
function learnTool(d: AppCtlDeps, callerId: string | undefined, authenticated: boolean): ToolDef {
  return toolDef(authenticated && callerId ? agentLearnTool(d.agentLearning!) : agentLearnTool(d.agentLearning!, `app:${callerId ?? 'orchestrator'}`.slice(0, 120)));
}
/** An McpTool that answers JSON text, as an app-control ToolDef (the parsed object). */
function toolDef(tool: McpTool): ToolDef {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, run: async a => JSON.parse(String(await tool.run(a, { params: {} } as unknown as Parameters<typeof tool.run>[1]))) as object };
}

/** app_digest since "last": when each caller (Orchestrator endpoint) last asked, for this app run */
const lastDigest = new Map<string, number>();

const obj = (props: Record<string, object> = {}, required: string[] = []) => ({ type: 'object', properties: props, required });
const ROUTING_SCHEMA = { type: 'object', additionalProperties: false, description: 'the user\'s choice for the whole work tree (ADR 0359): the engine/model per role and the engines left out; children at any depth follow it',
  properties: { picks: { type: 'object', description: 'roleId → {engine?, model, effort?}, only roles the user named', additionalProperties: { type: 'object', additionalProperties: false, required: ['model'], properties: { engine: { type: 'string' }, model: { type: 'string', maxLength: 128 }, effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] } } } },
    exclude: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'engine ids no chat of the tree may use or be moved to' } } };
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
/** what a Fast turn's delegation gets back (ADR 0296) */
export const FAST_REFUSAL = 'Fast mode: the user wants your own answer now, no delegation. Answer yourself in a few lines with what you know or can read quickly; if it needs real work, say so in one line (he can resend it without Fast).';
/** app_create_chat / app_assign_task limits: one constant for the schema the model reads and the handler's check (#172) */
export const CHAT_PROMPT_MAX = 8000;
export const CHAT_TITLE_MAX = 80;
/** app_update_code runs only within this many minutes of a message the user wrote to the Orchestrator (ADR 0074) */
export const PULL_ASK_MIN = 10;
/** app_unblock opens the waiting requests only within this many minutes of a message the user wrote to the Orchestrator */
export const UNBLOCK_ASK_MIN = 10;
/** app_learn starts a lesson only on a user message from the last minutes (ADR 0190) */
export const LEARN_ASK_MIN = 10;
/** app_reopen_chat reopens a chat the user closed with ✕ only within this many minutes of his own message (ADR 0352) */
export const REOPEN_ASK_MIN = 10;
/** the first line of a chat the app opened because the old one's engine cannot run now (ADR 0352) */
const APP_MOVED = (old: Pick<ChatSummary, 'title' | 'harness'>, to: Harness): string => `La chat «${old.title}» girava su ${engineLabel(old.harness)}, che ora non può partire: l’app continua il suo lavoro qui, su ${engineLabel(to)}, dal suo passaggio di consegne qui sotto. Il tuo nuovo compito:`;
export { AGENT_LABEL };
/** how a work chat sees an answer the Orchestrator delivered for the user (app_resolve_question) */
export const RESOLVED_LABEL = 'Risposto nell’Orchestrator dall\'utente:';
/** a message the app or an agent wrote (AGENT_LABEL, the app's news to the Orchestrator, mail between chats): never the user's */
const labelled = (text: string) => (text.split('\n', 1)[0] ?? '').includes('non vale come suo ok');

/** A delegated chat (ADR 0083) as the Orchestrator sees it: its state and numbers, never what it says. */
const statusOnly = (c: ChatSummary) => ({ id: c.id, title: c.title, harness: c.harness, state: c.state, pending: c.pending, costUsd: Math.round(c.costUsd * 100) / 100,
  role: c.agent?.name ?? null, parentId: c.parentId, delegated: true, ...(c.delegation?.result ? { reported: c.delegation.result.outcome } : {}), ...(c.closedAt ? { closedAt: new Date(c.closedAt).toISOString() } : {}),
  ...(c.run ? { run: { runId: c.run.runId, taskId: c.run.taskId ?? c.run.runId, taskVersion: c.run.taskVersion ?? 1, agentId: c.run.agentId, version: c.run.version, state: c.run.endedAt === undefined ? 'running' : 'ended' } } : {}) });
/** The same chat stripped of its text for the digest: the Orchestrator reads the state of delegated chats only. */
const muted = (c: ChatSummary): ChatSummary => c.parentId ? { ...c, lastText: '', ...(c.lastError ? { lastError: 'errore' } : {}) } : c;
const mutedRequest = <R extends { chatId: string; title?: string; detail?: string }>(r: R, child: boolean): R => child ? { ...r, title: 'richiesta di una chat delegata', detail: '', input: null, questions: undefined, command: undefined } : r;
const brief = (c: ChatSummary, warn: number) => c.parentId ? statusOnly(c) : ({
  effort: c.effortStatus ?? { supported: !!engineOf(c.harness)?.caps.effort, requested: c.effort, submitted: null, effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: null },
  id: c.id, title: c.title, harness: c.harness, state: c.state, pending: c.pending, model: c.model, costUsd: Math.round(c.costUsd * 100) / 100, isOrchestrator: c.isOrchestrator,
  ...(c.background ? { background: c.background } : {}),
  ...(c.work ? {work:c.work} : {}), last: c.lastText.slice(0, 200),
  ...(c.userEvents ? { userEvents: c.userEvents } : {}),
  ...(c.contextTokens ? { contextTokens: c.contextTokens, ...(c.contextEstimated ? { contextEstimated: true } : {}), long: isLongChat(c, warn) } : {}),
  ...(c.handoffAt ? { handoffAt: new Date(c.handoffAt).toISOString() } : {}),
  ...(c.continuedBy ? { continuedBy: c.continuedBy.id } : {}), ...(c.continuedFrom ? { continuedFrom: c.continuedFrom.id } : {}),
  ...(c.queued ? { queued: queuedLine(c.queued) } : {}),
  // a role chat's run: its runId is what agent_metrics and agent_children show (never the chat id)
  ...(c.run ? { run: { runId: c.run.runId, taskId: c.run.taskId ?? c.run.runId, taskVersion: c.run.taskVersion ?? 1, agentId: c.run.agentId, version: c.run.version, state: c.run.endedAt === undefined ? 'running' : 'ended' } } : {}),
});
/** What the Orchestrator reads after writing to a chat that waits on the user (ADR 0329; on the owner's PC, 2026-11-19,
 *  it passed his answer as a message twice and the row stayed): a chat reads no message while its own question is
 *  open, and a plan's row stays until the plan is decided. Null: the chat waits on nothing of his. */
export function waitsOnUser(chat: Pick<ChatSummary, 'id' | 'title' | 'plan' | 'closedAt' | 'questions'>, pending: readonly PendingRequest[]): string | null {
  const ask = pending.find(p => p.chatId === chat.id && answerableInWords(p));
  if (ask) return `But «${chat.title}» waits on its open question (requestId ${ask.id}) and reads this message only after the answer: the user still sees the question. If his last message decides it, call app_resolve_question now (chatId ${chat.id}, requestId ${ask.id}, words quoted from his message, or answers): its row closes.`;
  const held = heldQuestions(chat.questions).find(q => q.level === 'orchestrator');
  if (!chat.closedAt && held) return `But «${chat.title}» waits on a question YOU hold (requestId ${held.id}) and may read this message only after it: answer it with app_resolve_question (chatId ${chat.id}, requestId ${held.id}, answer and why), or askUser true: it goes to the user.`;
  if (!chat.closedAt && chat.plan?.phase === 'proposed') return `But the plan of «${chat.title}» still waits for the user's ok and its row stays open. What he wants changed in a plan goes with app_resolve_question (chatId ${chat.id}, requestId plan, decision change with text, or words quoted from his message): its row closes and the plan comes back revised.`;
  return null;
}
/** "queued (CPU 92%, RAM 40% free, 7/7 cold starts, position 1)": an agent's cold start waiting for a slot or for the
 *  emergency brake (ADR 0222) */
export const queuedLine = (q: NonNullable<ChatSummary['queued']>): string => `queued (CPU ${q.cpu}%, RAM ${q.freeRam}% free${q.slots ? `, ${q.starting ?? 0}/${q.slots} cold starts` : ''}, position ${q.position})`;
/** closed (archived) chats the Orchestrator may reopen: the last 7 days, newest first, at most 20 */
const RECENT_CLOSED_MS = 7 * 24 * 3600_000;
export function recentClosed(list: ChatSummary[], now = Date.now()): ChatSummary[] {
  return list.filter(c => c.closedAt && now - c.closedAt <= RECENT_CLOSED_MS).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 20);
}

/** The Orchestrator's endpoint /mcp/app/o/:chatId/:token answers only the open Orchestrator presenting its own token: the id
 *  names the caller, whose engine decides the rule for chats across engines, so it may not be picked by anyone else. */
export function orchestratorEndpointAuth(tokens: { check(key: string, token: string): boolean }, list: () => Pick<ChatSummary, 'id' | 'isOrchestrator'>[]) {
  return (p: Record<string, string>): boolean => !!p.chatId && !!p.token && tokens.check(p.chatId, p.token) && list().some(c => c.id === p.chatId && c.isOrchestrator);
}

/** callerId = the Orchestrator calling on its own endpoint (/mcp/app/o/<id>/<token>); none = /mcp/app (test agents), which acts
 *  for the Orchestrator without its write tools. Its messages are signed with its title. */
export function appControlTools(d: AppCtlDeps, callerId?: string): ToolDef[] {
  /** true when this endpoint is the Orchestrator's own (/mcp/app/o/<id>/<token>, checked by orchestratorEndpointAuth) */
  const authed = () => !!callerId && d.chats.list().some(c => c.id === callerId && c.isOrchestrator && !c.closedAt);
  /** the Orchestrator this endpoint acts for */
  const caller = (): ChatSummary | undefined => d.chats.list().find(c => c.isOrchestrator && !c.closedAt && (!callerId || c.id === callerId));
  /** what the one-review rule reads (#387, agents/one-review.ts): chats, runs and the open work threads */
  const reviewWorld = (): ReviewWorld => {
    const threads = d.workflows?.list().filter(r => r.status !== 'done') ?? [];
    return { chats: d.chats.list(), runs: d.runFeedback?.runList() ?? [],
      threadOf: id => threads.find(r => r.chatIds.includes(id))?.id ?? null };
  };
  /** the authenticated Orchestrator writes to a work chat as the user (ADR 0269); the plain mount as an agent */
  const voice = (): string => (authed() ? ORCHESTRATOR_USER_LABEL : AGENT_LABEL);
  const intakeField = str('For a new Strategist plan only: the exact question from your latest answered intake panel for this task. The host supplies the answer.');
  const intakeOf = (a: Record<string, unknown>, newPlan: boolean) => {
    if (a.intakeQuestion === undefined) return {};
    const source = caller();
    if (!authed() || !source || !newPlan || typeof a.intakeQuestion !== 'string' || !a.intakeQuestion.trim() || !d.chats.bindPlanIntake) {
      throw new Error('intakeQuestion requires an authenticated Orchestrator starting a new Strategist plan.');
    }
    return { intake: d.chats.bindPlanIntake(source.id, a.intakeQuestion) };
  };
  /** Chat visibility is shared; ownership checks remain on operations that require an owner. */
  /** a chat another role delegated: the Orchestrator sees its state, never its content (ADR 0083) */
  const delegated = (chatId: string) => d.chats.list().some(c => c.id === chatId && !!c.parentId);
  /** a worker's question that climbed the ladder to the user (ADR 0344): it passed the Orchestrator, which sees it whole */
  const climbed = (p: { chatId: string; id: string }) => d.chats.list().some(c => c.id === p.chatId && openQuestions(c.questions).some(q => q.level === 'user' && (q.requestId === p.id || p.id === `ladder-${q.id}`)));
  const muteAsk = <R extends { id: string; chatId: string; title?: string; detail?: string }>(r: R): R => mutedRequest(r, delegated(r.chatId) && !climbed(r));
  const contentOf = (chatId: string) => { if (delegated(chatId)) throw new Error('chat delegata da un altro ruolo: il suo contenuto lo legge il genitore; tu ne vedi lo stato (app_chats, app_digest)'); return chatId; };
  // app_guide's own list of the caller's tools is read when asked, so it names exactly what this endpoint offers
  const guideDeps = { window: d.window, settings: { schema: () => d.brain.settingsSchema(), get: () => d.brain.settings() },
    tools: () => tools.map(t => ({ name: t.name, description: t.description })), showValues: authed,
    ...(d.agents ? { codeModeRoles: () => d.agents!().profiles.filter(p => p.codeMode === true).map(p => p.id) } : {}) };
  const tools: ToolDef[] = [
    guideTool(guideDeps),
    ...(authed() ? [{ name: 'app_voice_diagnostics', description: 'Read local content-free voice diagnostics: rolling recognition/synthesis timing samples, stale events, cancellations and failures. No audio or transcript content. Coverage explicitly excludes end-to-end latency and accuracy. Unknown values stay null; small-sample p95 is not a reliability claim.', inputSchema: obj(), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, run: () => { if (!authed()) throw new Error('Authenticated Orchestrator required'); return { diagnostics: voiceDiagnostics() }; } }] : []),
    ...(d.config && authed() ? [configTool({ ...d.config, brain: d.brain, callerId: callerId!, userAsked: () => configAsked(callerId!) })] : []),
    ...(d.workflows && authed() ? workflowTools(d.workflows, id => d.chats.list().some(c => c.id === id && !c.parentId && !c.isOrchestrator), id => d.chats.list().find(c => c.id === id), d.away) : []),
    ...(d.agentLearning ? [learnTool(d, callerId, authed())] : []),
    ...(d.agentLearning && authed() ? [toolDef(lessonReviewTool(d.agentLearning))] : []),
    ...(d.brainScripts && authed() ? scriptWriteTools(d.brainScripts.scripts, d.brainScripts.changelog, () => caller()?.title || 'Orchestrator') : []),
    ...(d.agents ? [toolDef(agentCatalogTool(d.agents, d.skillTools))] : []),
    ...(d.recordings && authed() ? recordingTools(d.recordings, d.emitUi) : []),
    ...(d.projectMaps && authed() ? [appProjectMapTool(d.projectMaps, d.emitUi, d.workMaps)] : []),
    ...(d.impara && authed() ? imparaTools(d.impara, d.emitUi, () => imparaAsked(callerId!)) : []),
    ...(d.news && authed() ? newsTools(d.news, d.emitUi) : []),
    ...(d.skillLibrary && authed() ? skillTools(d.skillLibrary, () => caller()?.title || 'Orchestrator') : []),
    ...(authed() ? [childOutputTool({ chats: () => d.chats.list(), runs: () => d.runFeedback?.runList() ?? [] }), agentsRecapTool({ chats: () => d.chats.list(), items: id => d.chats.items(id), pending: () => [...d.chats.pending(), ...(d.commandAsks?.() ?? [])], runs: () => d.runFeedback?.runList() ?? [] })] : []),
    ...(d.runFeedback && authed() ? [metricsTool(d.runFeedback)] : []),
    ...(d.runFeedback && authed() ? [estimateTool(() => d.runFeedback!.runList(), d.priceOf ?? null)] : []),
    {
      name: 'app_set_chat_effort',
      description: 'Select the reasoning effort for one running app chat, for this conversation only (a role\'s lasting effort is the user\'s, in Brain → Agenti). Changes the next turn, never approvals, sandbox, model or a running turn. Returns requested, submitted, provider-reported effective and pending separately; null is unknown/default, never medium.',
      inputSchema: obj({ chatId: str('chat id from app_chats'), effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] } }, ['chatId', 'effort']),
      run: async a => {
        const chatId = typeof a.chatId === 'string' ? a.chatId : '';
        if (!chatId || typeof a.effort !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(a.effort)) throw new Error('chatId ed effort validi sono obbligatori.');
        const target = need(chatId);
        if (!engineOf(target.harness)?.caps.effort) throw new Error('Questo motore non supporta la scelta dell’effort.');
        const updated = await d.chats.set(target.id, { effort: a.effort as Effort });
        return { chatId: updated.id, effort: updated.effortStatus ?? { supported: true, requested: updated.effort, submitted: null, effective: null, pending: true, effectiveSource: 'unknown', sessionDefault: null } };
      },
    },
    ...(authed() && d.chats.setRouting && d.agents ? [{
      name: 'app_set_routing',
      description: 'Record, on a work tree\'s root chat, what the USER said about engines and models for ALL its work (ADR 0359): `picks` = the engine and model per role (e.g. scout = opencode gpt-6.2-sol), `exclude` = engines no chat of the tree may use or be moved to. Every chat the tree opens, at any depth, follows it at its launch; workers still never choose, and a change holds for chats that start after it. It replaces the root\'s record; {} clears it. Only when the user named an engine or model for the work or said "not X". With every allowed engine out the delegation is refused with the reason.',
      inputSchema: obj({ chatId: str('the root chat of the tree (app_chats)'), routing: ROUTING_SCHEMA }, ['chatId']),
      run: async (a: Record<string, unknown>) => {
        const id = String(a.chatId ?? ''), target = d.chats.list().find(c => c.id === id);
        if (!target || target.isOrchestrator) throw new Error('app_set_routing: chatId is a work chat (the root of the tree), not an Orchestrator.');
        const routing = routingOf(a.routing ?? {}, d.agents!().models, r => d.agents!().profiles.find(p => p.id === r)?.engine ?? target.harness);
        const s = d.chats.setRouting!(id, routing ?? null);
        return { chatId: id, routing: s.routing ?? null };
      },
    }] : []),
    {
      name: 'app_set_chat_work',
      description:'Declare an explicit assignment or future-mailbox wait, or explicitly complete it. Holds prevent automatic archive and idle-session release across turns/restarts; they never approve actions or confirm a successful result. Completion never closes a chat immediately.',
      inputSchema:obj({chatId:str('chat id in your scope'),status:{type:'string',enum:['assigned','waiting-mail','completed']}},['chatId','status']),
      run:async a=>{
        const id=String(a.chatId??''),target=d.chats.list().find(c=>c.id===id);
        const owner=caller();
        if(!target||!owner)throw new Error('Agente fuori dal tuo gruppo.');
        if(!['assigned','waiting-mail','completed'].includes(String(a.status)))throw new Error('Stato incarico non valido.');
        const result=await d.chats.set(id,{workStatus:a.status as 'assigned'|'waiting-mail'|'completed'});
        return {chatId:id,work:result.work};
      },
    },
    {
      name: 'app_state', description: 'Overview of the app: version, brain folder, chats by state, open questions/permissions, browser tabs, today usage, context use of the Claude chats (calls over 200k, cold cache rewrites over 100k, compactions, cold hand-off notes written vs used, $ per call after a continuation vs after a compaction; ADR 0031), health (MCP port and whether it fell back to a random one, main-window renderer crashes/hangs/reloads, engines killed by force, Job Object guard) since the app started.',
      inputSchema: obj(),
      run: () => {
        const chats = d.chats.list();
        const by: Record<string, number> = {};
        for (const c of chats) if (!c.closedAt) by[c.state] = (by[c.state] ?? 0) + 1;
        const q = d.chats.queueState();
        const queue = q && { enabled: q.enabled, cpu: q.cpu, freeRam: q.freeRam, ...(q.slots ? { coldStarts: q.starting ?? 0, coldStartSlots: q.slots } : {}), waiting: q.waiting.map(w => ({ chatId: w.chatId, kind: w.kind, position: w.position })) };
        return { version: d.version, brainRoot: d.brain.info().brainRoot, chats: by, ...(queue ? { queue } : {}), closedChats: chats.filter(c => c.closedAt).length, pending: d.chats.pending().length, tabs: d.browser.list().length, usage: usageForAgents(d.brain.usage()), ...(d.chats.contextStats ? { context: d.chats.contextStats() } : {}), logs: log.folder, health: healthSnapshot(), timers: timerSnapshot() };
      },
    },
    {
      name: 'app_chats', description: 'The chats in the app (Claude and Cursor engines): "app" = on the grid (state, open questions, model, cost, last line, background tasks still running, context size (long=true is a passive threshold observation, not a reason to change session), hand-off and "Riprendi" links, and for a role chat its run: run.runId, never the chat id); "closed" = finished chats that closed by themselves or by hand in the last 7 days (newest first): reopen one with app_reopen_chat, or just app_send_to_chat.',
      inputSchema: obj(),
      run: () => {
        const all = d.chats.list();
        const warn = d.brain.settings().contextWarnTokens;
        return {
          app: all.filter(c => !c.closedAt).map(c => brief(c, warn)),
          closed: recentClosed(all).map(c => ({ ...brief(c, warn), closedAt: new Date(c.closedAt!).toISOString(), closedBy: c.closedBy ?? 'auto', ...(c.closedWith ? { closedWith: c.closedWith } : {}) })),
        };
      },
    },
    {
      name: 'app_digest',
      description: `The status in ONE call, zero tokens: every open chat with its state, what it waits for from the user (question text, permission, command), errors, last line, git branch, long context; chats closed and commands the user ran; the user's PRs (build, votes, QA failures) and unread Task news from the app's last Task read (Azure DevOps). Use it for "stato" and when woken, instead of app_chats + app_chat_items per chat + app_pending; read a chat's items only when its line is not enough. since: "last" (what changed since your previous app_digest), an ISO time, or omit for everything; chats waiting or failed are always named, with their text when it is new since then (call without since for all of it).`,
      inputSchema: obj({ since: str('"last", an ISO time, or omit') }),
      run: a => {
        const key = `app:${callerId ?? ''}`;
        const now = Date.now();
        const raw = typeof a.since === 'string' ? a.since.trim() : '';
        const prev = lastDigest.get(key), restarted = callerId ? d.contextSince?.(callerId) : undefined;
        const since = raw === 'last' ? (prev !== undefined && !(restarted !== undefined && restarted > prev) ? prev : null) : raw ? Date.parse(raw) : null;
        if (since !== null && Number.isNaN(since)) throw new Error('since: "last" oppure un orario ISO (es. 2026-10-13T18:00:00Z)');
        lastDigest.set(key, now);
        return digest({
          works: d.workflows?.projection(),
          chats: d.chats.list().map(muted), pending: [...d.chats.pending(), ...(d.commandAsks?.() ?? [])].map(muteAsk),
          runs: (d.runs?.() ?? []).filter(r => !delegated(r.chatId)), tasks: d.tasks?.() ?? null,
          now, since, selfId: caller()?.id, warnTokens: d.brain.settings().contextWarnTokens, branch: gitBranch,
        });
      },
    },
    {
      name: 'app_reopen_chat', description: `Reopen a closed (archived) chat listed under "closed" by app_chats, on any engine: it goes back on the grid with its whole history and its own engine, and its session resumes on the next message (app_send_to_chat or app_assign_task). Returns reopened: true, or a refusal that says why not (its engine off or not for the Orchestrators, its worktree gone). A chat that closed by itself also reopens with a message. A chat the user closed with ✕ (its work was cancelled) reopens only here, only from the Orchestrator, and only within ${REOPEN_ASK_MIN} minutes of the user's own message asking for it.`,
      inputSchema: obj({ chatId: str('chat id from app_chats "closed"') }, ['chatId']),
      run: async a => {
        const id = String(a.chatId ?? '');
        const before = d.chats.list().find(c => c.id === id);
        if (!before) throw new ToolRefusal(`chat non trovata: ${id} (vedi app_chats)`);
        const warn = d.brain.settings().contextWarnTokens;
        if (!before.closedAt) return { ...brief(before, warn), reopened: true, note: 'already open' };
        if (before.closedBy === 'user') {
          const orchestrator = caller();
          if (!authed() || !orchestrator?.isOrchestrator || !userTurn(orchestrator.id, Date.now() - REOPEN_ASK_MIN * 60_000, true)) throw new ToolRefusal(`The user closed this chat with ✕ and cancelled its work: only the Orchestrator reopens it, right after the user's own message asking for it (within ${REOPEN_ASK_MIN} minutes).`);
        }
        const refused = openRefusal(d.brain.settings(), before.harness);
        if (refused) throw new ToolRefusal(`non riaperta: ${refused}. Si riapre quando il motore è acceso e consentito (Impostazioni → Motori).`);
        const c = await d.chats.reopen(id);
        if (c.closedAt) throw new Error(`non riaperta: la chat «${c.title}» è ancora chiusa`);
        log.info('appctl', 'agent reopened a chat', { chat: id, data: { closedBy: before.closedBy ?? 'auto' } });
        // an open chat whose engine is not running shows state 'closed': said plainly, so it never reads as a failure
        return { ...brief(c, warn), ...(c.state === 'closed' ? { state: 'stopped' } : {}), reopened: true, note: 'back on the grid with its whole history; its engine resumes on its next message' };
      },
    },
    {
      name: 'app_close_chat', description: 'Close an app chat for the user, like his ✕ / Ctrl+W: it leaves the grid and its engine ends with every tool it started (MCP servers, shells, dev servers); the transcript stays. Its delegation tree stops with it (ADR 0217). Never an Orchestrator; refused while the chat or an open descendant waits for the user (his open questions are his).',
      inputSchema: obj({ chatId: str('chat id from app_chats "app"') }, ['chatId']),
      run: async a => {
        const id = String(a.chatId ?? '');
        const c = d.chats.list().find(x => x.id === id);
        // already closed (its tree's close took it, or the auto-close) or never the caller's: a stale id of the agent,
        // answered to it and logged at info (#306, #307)
        if (!c) throw new ToolRefusal(`chat non trovata o già chiusa: ${id} (vedi app_chats)`);
        // the close cancels the whole tree (ADR 0217): a descendant's open question would be withdrawn unanswered
        const refused = closeRefusal(c, d.chats.list());
        if (refused) throw new Error(refused);
        await d.chats.close(id, 'agent');
        log.info('appctl', 'agent closed a chat', { chat: id, data: { title: c.title, state: c.state } });
        d.brain.publish([{ kind: 'chat-closed', title: c.title, detail: 'chiusa dall’Orchestrator', chatId: id, who: c.harness }]);
        return 'closed';
      },
    },
    {
      name: 'app_agent_context', description: 'Read the frozen launch context manifest for one visible work chat: selected memory IDs/provenance, omission reasons, skill hashes and estimated host-instruction size. No fact values, no live archive injection, no vendor-system prompt. Lexical scores are not probabilities; token estimates are characters/3. Legacy chats return unknown.',
      inputSchema: obj({ chatId: str('chat id') }, ['chatId']),
      run: a => { const id = contentOf(String(a.chatId)); const chat = d.chats.list().find(c => c.id === id); if (!chat) throw new Error('Chat unavailable'); return { manifest: chat.launchContext ?? null, known: !!chat.launchContext }; },
    },
    {
      name: 'app_chat_items', description: 'Last items of one app chat (messages, tool rows, results), texts truncated.',
      inputSchema: obj({ chatId: str('chat id from app_chats'), last: num('how many, default 30') }, ['chatId']),
      // image previews stay out (base64, up to 10 per message): the count `images` says enough to an agent
      run: a => d.chats.items(contentOf(String(a.chatId))).slice(-(Number(a.last) || 30)).map(({ thumbs: _thumbs, ...i }: ChatItem & { thumbs?: unknown }) => ({ ...i, ...('text' in i ? { text: i.text.slice(0, 1500) } : {}), ...('output' in i && i.output ? { output: i.output.slice(0, 800) } : {}), ...(i.kind === 'artifact' ? { ui: describeUi(i.ui) } : {}) })),
    },
    {
      name: 'app_command_runs',
      description: `Commands the user ran from a chat code block with "Esegui" (${userShellName().name} in the app): state, exit code, output tail. Read-only: only the user starts a run, by his click. Pass chatId to see the runs of one chat (yours: read the outcome of the command you proposed). duplicateOf = the id of the first run of the identical command (one command, one run: an identical running command never starts twice, ADR 0299).`,
      inputSchema: obj({ chatId: str('chat id from app_chats (optional)'), last: num('how many, newest last, default 5') }),
      run: a => (d.runs?.(a.chatId ? contentOf(String(a.chatId)) : undefined) ?? []).filter(r => !delegated(r.chatId)).slice(-(Number(a.last) || 5))
        .map(r => ({ id: r.id, chatId: r.chatId, state: r.state, exitCode: r.exitCode, code: redact(r.code.slice(0, 1500)), cwd: r.cwd, output: redact(r.output.slice(-4000)), startedAt: new Date(r.startedAt).toISOString(), endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null, ...(r.prod ? { prod: r.prod } : {}), ...(r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}) })),
    },
    {
      name: 'app_pending', description: 'What waits. type "held": a worker\'s question YOU hold (ADR 0344), not the user\'s yet: answer it with app_resolve_question answer + why, or askUser true. The rest is waiting for the user: open questions, permission requests and commands left for the user to run (type "command": a shell block waiting for his Esegui; command.duplicateOf = the id of the first run of the identical command, when it already ran) . Answer them for him with app_resolve_question (a delegated chat\'s question: only with his words); a command goes to him with relay_question.',
      inputSchema: obj(), run: () => [...(callerId && authed() ? d.chats.ladderHeldBy?.(callerId) ?? [] : []).map(h => ({ id: h.q.id, chatId: h.chatId, type: 'held', title: h.title, questions: h.q.asks, trail: h.q.trail, at: h.q.at })),
        ...[...d.chats.pending(), ...(d.commandAsks?.() ?? [])].map(muteAsk)],
    },
    {
      name: 'app_resolve_question',
      description: 'A worker\'s question you hold (app_pending type "held", or its message): answer + why (the source: his request, his recorded decisions, the brain, the code), as an agent, never his consent; askUser true when you do not know or it is his (his goal, what colleagues, QA or customers do, production, databases, Azure, what cannot be undone): it reaches his row with its own words, never ask it again as yours. For the rest, answer for the user (ADR 0269, 0275): what you answer counts as his own, always. Any chat\'s open question (an option label or free words, every question of the request), any permission (allow true/false, message), a Strategist\'s proposed plan (requestId "plan", decision approve/change, text). Pick what his goal, the brain or the plan settle, then tell him in one line what you answered. A delegated chat\'s question that reached his row takes only his own words (words), never an answer of yours; its permissions and its plan are its parent\'s or his. The other exception: a permission that runs on production, a database or Azure — show him what it runs, and only after his yes pass confirmed true. A command waiting for Esegui: relay_question shows it to him and his «sì» runs it. When his last message to you answers a request, pass words (quoted from it) instead: his whole message reaches the chat.',
      inputSchema: obj({
        chatId: str('the chat, from app_pending'), requestId: str('the request\'s id, from app_pending; "plan" for a Strategist\'s proposed plan'),
        answer: str('a question you hold: your answer'), why: str('a question you hold: where the answer comes from, or why you pass it up'),
        askUser: { type: 'boolean', description: 'a question you hold: true passes it to the user' },
        answers: { type: 'object', description: '{ "<question text>": "<an option label, or free words>" } for every question', additionalProperties: { type: 'string' } },
        allow: { type: 'boolean', description: 'a permission: true allows it once, false refuses it' },
        message: str('a refused permission: what the chat should do instead'),
        confirmed: { type: 'boolean', description: 'a permission on production, a database or Azure: true only after the user said yes to it in his last message' },
        decision: str('a plan: approve or change'), text: str('a plan change: what to change'),
        words: str('his exact words from his last message to you, when they answer this request (instead of answers)'),
      }, ['chatId', 'requestId']),
      run: async a => {
        const chatId = String(a.chatId ?? ''), requestId = String(a.requestId ?? '');
        need(chatId);
        if (!authed()) throw new Error('bloccato: solo l’Orchestrator risponde per l’utente');
        // a question this Orchestrator holds on the ladder (ADR 0344), a delegated chat's too: its own answer, or one level up
        const held = d.chats.ladderHeldBy?.(callerId!).find(h => h.chatId === chatId && (h.q.id === requestId || h.q.requestId === requestId));
        if (held) {
          const done = await d.chats.ladderReply!(callerId!, { chatId, requestId: held.q.id, ...(a.answer !== undefined ? { answer: String(a.answer) } : {}), ...(a.why !== undefined ? { why: String(a.why) } : {}), ...(a.askUser === true ? { askUser: true } : {}) });
          return done.askUser ? 'passata all’utente: è nella sua riga con le stesse parole' : `risposto a «${done.answered}» come agente (non come l’utente)`;
        }
        // a delegated chat: you see its state only (ADR 0083); its parent answers it, or the user in his row
        if (delegated(chatId) && !climbed({ chatId, id: requestId })) throw new Error('bloccato: è una chat delegata (ne vedi solo lo stato): la risponde la chat che l’ha delegata, o l’utente nella sua riga');
        if (delegated(chatId) && a.words === undefined) throw new Error('bloccato: è la domanda di una chat delegata arrivata all’utente: la risponde lui nella sua riga, o tu solo con le sue parole (words)');
        // a Strategist's proposed plan: his own words, or the Orchestrator's decision for him (ADR 0274, 0275)
        if (requestId === 'plan') {
          const chats = d.chats.list(), plan = chats.find(c => c.id === chatId)?.plan;
          if (!plan || plan.phase !== 'proposed') throw new Error('questo piano non aspetta più una risposta');
          if (a.words !== undefined) {
            const said = d.chats.userSaid?.();
            if (!said || said.at < plan.at || !sameWords(said.text, String(a.words))) throw new Error('bloccato: words deve essere copiato dal suo ultimo messaggio, scritto dopo il piano; se non parla di questo piano lascialo aperto');
            const only = chats.filter(c => c.plan?.phase === 'proposed').length === 1;
            await d.chats.planDecide(chatId, only && isPlanApproval(said.text) ? 'approve' : 'change', plan.at, said.text.trim());
            return 'consegnato al piano con il suo messaggio: la sua riga è chiusa';
          }
          const decision = a.decision === 'approve' ? 'approve' : a.decision === 'change' ? 'change' : null;
          if (!decision) throw new Error('decision: approve o change');
          await d.chats.planDecide(chatId, decision, plan.at, decision === 'change' ? String(a.text ?? '') : undefined);
          return decision === 'approve' ? 'piano approvato per l’utente' : 'modifica mandata allo Strategist';
        }
        const req = d.chats.pending().find(p => p.chatId === chatId && p.id === requestId);
        if (!req) throw new Error('questa richiesta non è più aperta (quelle aperte: app_pending; un comando si mostra all’utente con relay_question e parte al suo sì)');
        // your own question panel is his to answer: a relayed question or command there runs on his pick (#425)
        if (chatId === callerId && req.type === 'question') throw new Error('bloccato: è una tua domanda: la risponde l’utente nel pannello');
        // his own message (ADR 0274): the chats check it is his and after the request
        if (a.words !== undefined) {
          if (!d.chats.answerWithUserWords) throw new Error('non disponibile');
          d.chats.answerWithUserWords(chatId, requestId, String(a.words));
          return 'consegnata con il suo messaggio: la sua riga è chiusa';
        }
        if (req.type === 'permission') {
          if (typeof a.allow !== 'boolean') throw new Error('è un permesso: allow true o false');
          d.chats.answerForUser(chatId, requestId, { kind: 'permission', allow: a.allow, ...(a.message ? { message: String(a.message) } : {}) }, a.confirmed === true);
          return a.allow ? 'consentito per l’utente' : 'negato per l’utente';
        }
        if (!a.answers || typeof a.answers !== 'object') throw new Error('answers (un’opzione o parole per ogni domanda) o words (le sue parole) servono');
        d.chats.answerForUser(chatId, requestId, { kind: 'question', answers: Object.fromEntries(Object.entries(a.answers as Record<string, unknown>).map(([k, v]) => [k, String(v)])) });
        return 'risposto per l’utente';
      },
    },
    {
      name: 'app_feed', description: 'Recent live feed events (ideas, errors, chats done/waiting...).',
      inputSchema: obj({ limit: num('default 30') }), run: a => d.brain.feed().filter(e => !e.chatId || !delegated(e.chatId)).slice(0, Number(a.limit) || 30),
    },
    {
      name: 'app_logs', description: 'Recent structured log entries of the app (redacted). Filters: level (debug|info|warn|error), scope, chat, grep.',
      inputSchema: obj({ level: str('minimum level'), scope: str('module scope, e.g. chats'), chat: str('chat id'), grep: str('text'), tail: num('default 50') }),
      run: a => {
        const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
        const min = order[(a.level as keyof typeof order) ?? 'debug'] ?? 0;
        const g = typeof a.grep === 'string' ? a.grep.toLowerCase() : null;
        return log.recent.filter(e => order[e.lvl] >= min && (!a.scope || e.scope === a.scope) && (!a.chat || e.chat === a.chat) && (!g || JSON.stringify(e).toLowerCase().includes(g)))
          .slice(-(Number(a.tail) || 50));
      },
    },
    {
      name: 'app_screenshot', description: 'Screenshot of the app window (the UI) plus each browser tab visible on screen with its position. Images scaled to a long side of ~1000 px (the text gives each factor). To know what the app shows, try app_state, app_chats or app_chat_items first (far fewer tokens); take a screenshot only to really see the UI.',
      inputSchema: obj(),
      run: async () => {
        const win = d.window();
        if (!win) return 'no window';
        const images: { data: string; mimeType: string; caption: string }[] = [];
        const left: string[] = [];
        const ui = await win.webContents.capturePage();
        const p = previewOf(ui);
        images.push({ data: p.data, mimeType: p.mimeType, caption: `app UI ${ui.getSize().width}x${ui.getSize().height}, image ${p.width}x${p.height} (UI px = image px × ${fmtFactor(p.factor)})` });
        for (const v of win.contentView.children) {
          const wc = (v as { webContents?: Electron.WebContents }).webContents;
          if (!wc) continue;
          const b = v.getBounds();
          // an agent tab may show a password ("show password"): hidden for the capture, or the tab is left out
          let img = await withPasswordsHidden(wc.mainFrame?.framesInSubtree ?? [], frameRun, () => wc.capturePage()).catch(() => null);
          if (!img) { left.push(`browser tab ${redact(wc.getURL())} not captured: its password fields could not be hidden`); continue; }
          // an agent tab drawn scaled (browser/tabs.ts emulate) captures a desktop-size surface with the view in its corner
          const k = ui.getSize().width / Math.max(1, win.getContentSize()[0]!), s = img.getSize();
          if (s.width > Math.round(b.width * k) + 1) img = img.crop({ x: 0, y: 0, width: Math.min(s.width, Math.round(b.width * k)), height: Math.min(s.height, Math.round(b.height * k)) });
          const t = previewOf(img);
          images.push({ data: t.data, mimeType: t.mimeType, caption: `browser tab ${redact(wc.getURL())} at x=${b.x} y=${b.y} ${b.width}x${b.height}, image ${t.width}x${t.height} (capture px = image px × ${fmtFactor(t.factor)})` });
        }
        return { text: [`${images.length} images`, ...left].join('; '), images };
      },
    },
    {
      name: 'app_ui', description: 'Steer the UI (visual only, never the keyboard focus): action "maximize" (a chat id or a browser tab id: full screen over the whole app; a chat and its browser are one window), "restore", "page" (value: a page id from app_guide, optionally with a tab or section: "memoria/skill", "impostazioni/notifications"), "palette", or "outline" (read only: what is on screen now, one line per heading, tab and control with its state, section and position, the ones in view first; value = optional words to keep only one section of a long page; chats show only title and state).',
      inputSchema: obj({ action: str('maximize|restore|page|palette|outline'), value: str('argument of the action') }, ['action']),
      // only visual steering: never actions that move the keyboard focus (next, focus…): an agent must not be able to
      // put the user's next keystroke on a permission or into another chat's input (review 2026-10-11)
      run: a => {
        const action = String(a.action);
        if (action === 'outline') return screenOutline(guideDeps, a.value === undefined ? '' : String(a.value));
        if (!['maximize', 'restore', 'page', 'palette'].includes(action)) throw new Error(`app_ui: action not allowed for agents: ${action} (maximize|restore|page|palette|outline)`);
        // a root chat and its browser can be maximized; a delegated chat's (or its browser's) cannot: maximize then
        // app_screenshot would show the Orchestrator its content (ADR 0083: it sees only the state)
        if (action === 'maximize' && a.value !== undefined) {
          const v = String(a.value).replace(/^(chat|browser):/, '');
          const tab = d.browser.list().find(t => t.id === v);
          contentOf(tab?.ownerChatId ?? v);
        }
        d.emitUi({ action, value: a.value === undefined ? undefined : String(a.value) });
        return 'ok';
      },
    },
    {
      name: 'app_create_chat',
      description: 'Delegate: create a work chat that runs one role (roleId, from agent_catalog) and start it with a self-contained prompt. Fast path first (task_estimate): a short question needs no chat; a change that is not small and already clear is ONE strategist chat; a small clear change, read-only work or a message is ONE chat that works alone. The answer carries the estimate from similar past tasks; it shows under you in the sidebar tree and reports back to you. Never an Orchestrator: only the user picks it. Title "Area · cosa". The role\'s card decides engine, model and effort: `preset` picks one of its three (omitted = base); `userModel` only when the user named one of those presets\' models for THIS task (how to choose: app_guide topic «model choice»). `skills` = the brain skills the chat may use (their SKILL.md names; without a skill the role cannot use it; `warnings` in the answer names a skill that needs tools the role lacks). Its permissions are its role\'s (tools, ceiling) within the user\'s defaults, not yours: you plan, the chat does the work. reviewOf / reworkOf = the run it reviews or redoes; goal = the run\'s goal. One review chat per piece of work (#387): when a review chat already reported on that work the call is refused and names it; re-review the fix there with app_assign_task (only the fix delta). freshReview true only when the user asked for a fresh reviewer or the review covers a part no review chat covers. The chat starts in the brain folder unless cwd is given (pick the repo or worktree from the task). The prompt is labelled as written by an agent.',
      inputSchema: obj({
        title: { ...str('"Area · cosa", e.g. "Ordini · Fix totale"'), maxLength: CHAT_TITLE_MAX }, contract: contractField, prompt: { ...str(`fallback when there is no contract: what the chat must do, self-contained; at most ${CHAT_PROMPT_MAX} characters`), maxLength: CHAT_PROMPT_MAX },
        roleId: { type: 'string', enum: ROLE_IDS.filter(r => r !== 'orchestrator'), description: 'the role the chat runs (agent_catalog)' },
        roleVersion: { type: 'integer', description: 'Expected active role version; refused if it changed.' },
        doneWhen: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } },
        deliveryPolicy: { type: 'string', enum: ['display', 'notify', 'synthesize'], description: 'display expands the full result without AI; notify also adds quiet news; synthesize requests an AI integration turn' },
        ...PRESET_SCHEMA,
        skills: { type: 'array', items: { type: 'string' }, maxItems: 16, description: 'the brain skills this chat may use (their SKILL.md names)' },
        intakeQuestion: intakeField, reviewOf: str('Run being reviewed'), reworkOf: str('Run being reworked'), goal: str('Run goal, up to 2000 characters'),
        freshReview: { type: 'boolean', description: 'with reviewOf: open a fresh review chat although one already reported on this work; only when the user asked for it or it reviews a part no review chat covers' },
        kind: str(`optional kind of task: ${TASK_KINDS.join(' | ')}; omitted: read from title and prompt`),
        cwd: str('optional absolute folder (repo or worktree); default: the brain folder'),
        map: MAP_LINK_SCHEMA,
        userModel: { type: 'object', additionalProperties: false, required: ['model'], description: 'only when the user named the model: one of the card\'s presets (agent_catalog presets), see app_guide «model choice»',
          properties: { engine: { type: 'string' }, model: { type: 'string', maxLength: 128 }, effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] } } },
        routing: ROUTING_SCHEMA,
      }, ['title']),
      run: async a => {
        // only the user chooses the Orchestrator (one at a time: a new one would take the role from the agent's own chat)
        const intake = intakeOf(a, a.roleId === 'strategist'), task = taskPrompt(a, String(a.roleId ?? ''));
        const links: { reviewOf?: string; reworkOf?: string; goal?: string; roleVersion?: number; doneWhen?: string[]; deliveryPolicy?: 'display' | 'notify' | 'synthesize'; contractFields?: string[] } = {};
        Object.assign(links, task.doneWhen ? { doneWhen: task.doneWhen, contractFields: task.contractFields } : {});
        if (a.doneWhen !== undefined) {
          if (!Array.isArray(a.doneWhen) || a.doneWhen.length > 12 || !a.doneWhen.every(c => typeof c === 'string' && c.trim() && c.length <= 300)) throw new Error('Invalid doneWhen criteria.');
          links.doneWhen = a.doneWhen as string[];
        }
        if (a.deliveryPolicy !== undefined) {
          if (!['display', 'notify', 'synthesize'].includes(String(a.deliveryPolicy))) throw new Error('Invalid delivery policy.');
          links.deliveryPolicy = a.deliveryPolicy as 'display' | 'notify' | 'synthesize';
        }
        for (const key of ['reviewOf', 'reworkOf', 'goal'] as const) if (a[key] !== undefined) {
          if (!authed() || typeof a[key] !== 'string' || !a[key].trim() || a[key].length > (key === 'goal' ? 2000 : 80)) throw new Error('Invalid or unauthorized run link/goal.');
          links[key] = a[key];
        }
        if (a.roleVersion !== undefined) {
          if (!Number.isSafeInteger(a.roleVersion) || Number(a.roleVersion) < 1) throw new Error('Invalid role version.');
          links.roleVersion = Number(a.roleVersion);
        }
        const cwd = typeof a.cwd === 'string' && a.cwd.trim() ? a.cwd.trim() : d.brain.info().brainRoot;
        if (!cwd) throw new Error('nessuna cartella: il brain non è collegato');
        // the map pieces this work is on (#456): checked before the chat exists, linked once it does
        const mapLink = mapLinkOf(authed() ? d.projectMaps : undefined, a.map);
        if (a.freshReview !== undefined && typeof a.freshReview !== 'boolean') throw new Error('freshReview: true or false.');
        // one review chat per piece of work (#387, ADR 0309): a second one for work a review chat already reported on is
        // refused, naming the chat that re-reviews the fix delta
        if (links.reviewOf && a.freshReview !== true && typeof a.roleId === 'string') {
          const has = rootReviewer(reviewWorld(), { role: a.roleId, reviewOf: links.reviewOf, cwd });
          if (has) throw new ToolRefusal(`One review chat per piece of work: «${has.title}» (chatId ${has.id}) already reviewed this work. Re-review the fix there: app_assign_task { chatId: "${has.id}", roleId: "${a.roleId}", cwd: "${has.cwd}", mode: "continue", reviewOf: "${links.reviewOf}" } with a contract that names only the fix delta (what changed since its review). If it is still busy, wait for its report. A fresh review chat only when the user asked for one, this reviews a part no review chat covers, or app_assign_task refuses that chat: then pass freshReview true.`);
        }
        // a chat in the app's code folder or one of its worktrees works on the app (routing area App)
        const app = await d.code?.inRepo?.(cwd) ?? false;
        if (fastTurn(caller()?.id)) throw new ToolRefusal(FAST_REFUSAL);
        if (a.orchestrator !== undefined && a.orchestrator !== false) throw new Error('app_create_chat crea solo chat di lavoro: l’Orchestrator lo sceglie l’utente (Nuova chat → «È l’Orchestrator» o «Cambia motore»)');
        const title = String(a.title ?? '').trim().slice(0, CHAT_TITLE_MAX), prompt = task.prompt;
        if (!title || !prompt) throw new Error(!title ? 'title: required' : 'contract (or prompt): required');
        if (prompt.length > CHAT_PROMPT_MAX) throw new Error(`${task.what}: at most ${CHAT_PROMPT_MAX} characters (this one has ${prompt.length})`);
        // a former Orchestrator's title is the Orchestrator's mail box: a new chat may not take its mail
        if (title.trim().toLowerCase() === ORCHESTRATOR_TITLE.toLowerCase()) throw new Error(`The title «${title}» is reserved for the Orchestrator's mail: choose another.`);
        const s = d.brain.settings();
        // the cloud agents (where "cloud", ADR 0080) were removed by ADR 0201: every chat is local
        if (a.where !== undefined && a.where !== 'local') throw new Error('where: only "local" (the cloud agents were removed)');
        const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
        const kind = text(a.kind);
        if (kind && !(TASK_KINDS as readonly string[]).includes(kind)) throw new Error(`kind sconosciuto: ${kind} (${TASK_KINDS.join(' | ')})`);
        for (const key of ['harness', 'model', 'effort'] as const) if (a[key] !== undefined) throw new Error(`${key}: the role decides it (Brain → Agenti).`);
        if (typeof a.roleId !== 'string' || !isWorkRole(a.roleId)) throw new Error(`roleId required: ${ROLE_IDS.filter(r => r !== 'orchestrator').join(' | ')} (agent_catalog).`);
        if (a.tier !== undefined) throw new Error('tier: gone; pass preset (min | base | max, app_guide «model choice»).');
        if (a.balanced !== undefined) throw new Error('balanced: Balanced mode is gone; the role\'s card decides, preset picks one of its three.');
        const skills = a.skills === undefined ? [] : Array.isArray(a.skills) && a.skills.length <= 16 && a.skills.every(x => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(x)) ? [...new Set(a.skills as string[])] : null;
        if (!skills) throw new Error('skills: up to 16 skill names (SKILL.md names).');
        if (!d.resolveRole || !d.agents) throw new Error('Catalogo dei ruoli non disponibile.');
        // the caller is the Orchestrator (the only chat given these tools), on any engine: the role's card picks the
        // engine, and only the user's engine switches can refuse it (engines/policy.ts openRefusal, ADR 0352)
        const orchestrator = caller();
        const from = orchestrator?.harness ?? 'claude';
        const roleId = a.roleId;
        // the preset of the role's card (ADR 0336): one of its three, why in one line, never above the Orchestrator's own model
        const ask = presetAskOf(a, '');
        const delegator = { role: 'orchestrator', model: orchestrator?.model ?? d.agents().profiles.find(p => p.id === 'orchestrator')?.model ?? null };
        const presetFields = { ...(ask.preset ? { preset: ask.preset } : {}), ...(ask.presetWhy ? { presetWhy: ask.presetWhy } : {}), ...(ask.taskKind ? { taskKind: ask.taskKind } : {}), delegator };
        // the role's card decides engine, model and effort (ADR 0210, 0336); the user's own pick must be one of its presets
        const roleEngine = (r: string) => d.agents!().profiles.find(p => p.id === r)?.engine ?? from;
        const routing = a.routing !== undefined ? routingOf(a.routing, d.agents().models, roleEngine) : undefined;
        if (routing && !authed()) throw new Error('routing: only the authenticated Orchestrator records the user\'s choice for a work tree.');
        const ownPick = userModelOf(a.userModel, d.agents().models, roleEngine(String(roleId)));
        // the tree's pick for this role holds for the chat itself too (ADR 0359); the user's own userModel wins
        const treePick = !ownPick && roleId ? routing?.picks?.[String(roleId)] : undefined;
        const userModel = ownPick ?? treePick;
        if (userModel && !authed()) throw new Error('userModel: only the authenticated Orchestrator passes the user\'s own pick.');
        if (ownPick && a.preset !== undefined) throw new Error('userModel and preset: one or the other (the user\'s pick must be one of the card\'s presets).');
        await d.creditFresh?.();
        const resolved = d.resolveRole({ harness: from, cwd, roleId, title, prompt, ...presetFields, ...(links.roleVersion ? { roleVersion: links.roleVersion } : {}), ...(userModel ? { userModel } : {}) },
          { ...(routing?.exclude?.length ? { exclude: routing.exclude } : {}), ...(treePick ? { freePick: true } : {}) });
        const profile = d.agents().profiles.find(p => p.id === roleId)!;
        const agent = { id: roleId, name: profile.name, version: profile.activeVersion, harness: resolved.request.harness, model: resolved.request.model ?? null, effort: resolved.request.effort ?? null,
          chosenBy: 'orchestrator' as const, ...(resolved.tier ? { tier: resolved.tier } : {}), stats: d.agentStats?.(roleId, profile.activeVersion) ?? null };
        const routed = d.brain.route({
          agent, canRun: h => !openRefusal(s, h),
          title, prompt, ...(kind ? { kind: kind as TaskKind } : {}), appCode: app, ask: {},
          // the role decides (routeAgent): these defaults are never read for a role chat
          defaults: { harness: s.orchestratorChats.harness, models: {}, effort: null },
        });
        if ('error' in routed) throw new Error(`app_create_chat: ${routed.error}`);
        const { harness, model, effort } = routed;
        // the reason is the level's real pick (ADR 0354: the models passed over, each with why), not the brain's routing line
        const route = userModel ? { ...routed.route, reason: `the user asked for ${userModel.model} on ${engineLabel(userModel.engine)} for this task (one of the card's presets; the card is unchanged)` }
          : resolved.presetChoice?.route ? { ...routed.route, reason: resolved.presetChoice.route } : routed.route;
        const refused = openRefusal(s, harness);
        if (refused) throw new Error(`bloccato: ${refused}`);
        const chat = await d.chats.create({ harness, cwd, title, prompt: `${voice()}\n\n${prompt}`, ...links, orchestrator: false, roleId, ...presetFields, ...(skills.length ? { skills } : {}),
          ...(model ? { model } : {}), ...(effort ? { effort } : {}), route, ...(ownPick ? { userModel: ownPick } : {}), ...(routing ? { routing } : {}) }, 'agent', undefined, undefined,
          // the plain /mcp/app mount is open to any local process: its chats run no wider than the Orchestrator
          { boundByOrchestrator: !authed(), ...intake });
        if (mapLink) d.projectMaps!.link(mapLink.project, chat.id, mapLink.on);
        const unlinked = mapLink || !authed() ? undefined : mapHint(d.projectMaps, cwd);
        log.info('appctl', 'agent created a chat', { chat: chat.id, data: { harness, title, model: model || null, effort, route: route.source, kind: route.kind, area: route.area, reason: route.reason, ...(route.agent ? { agent: route.agent } : {}) } });
        // a skill whose tools the role lacks (issue #93): said now, so the Orchestrator can pick another role or ask the user
        const known = d.skillTools ? new Map(d.skillTools().map(x => [x.name, x.tools])) : null;
        const warnings = [...(resolved.presetChoice?.warnings ?? []), ...(known ? gapLines(profile.name, skillGaps([...new Set([...resolved.skills, ...skills])], n => known.get(n), resolved.policy)) : []), ...task.warnings];
        if (warnings.length) log.info('appctl', 'chat started with a skill its role lacks tools for', { chat: chat.id, data: { role: roleId, warnings: warnings.length } });
        // the machine is busy: the chat exists, its first turn waits in the cold-start queue (ADR 0222)
        // the estimate from similar past tasks (ADR 0087): the same figure the strip shows, so the plan is checked with data
        const estimate = d.runFeedback ? estimateTask(new SimilarIndex(d.runFeedback.runList(), d.priceOf ?? null), { text: task.estimate, agentId: roleId, model: model || resolved.request.model || null }) : null;
        return { chatId: chat.id, title: chat.title, harness, cwd, model: model || null, effort, ...(resolved.presetChoice ? { preset: resolved.presetChoice.preset } : {}), ...(chat.pick ? { pick: pickLines(chat.pick, Date.now()) } : {}), ...(warnings.length ? { warnings } : {}), ...(chat.queued ? { status: queuedLine(chat.queued) } : {}),
          ...(estimate ? { estimate: { timeMs: estimate.timeMs, costUsd: estimate.costUsd, n: estimate.n, confidence: estimate.confidence, parts: estimate.parts, path: estimate.path } } : {}), route: { source: route.source, kind: route.kind, area: route.area, reason: route.reason, ...(route.agent ? { agent: route.agent } : {}) },
          ...(mapLink ? { map: mapLink } : unlinked ? { map: unlinked } : {}) };
      },
    },
    {
      name: 'app_assign_task',
      description: 'Continue a compatible work conversation with a distinct measured run. Use continue for related follow-ups, new-task for a distinct assignment in the same scope, rework only for an explicit correction. Requires the same role and project folder, on any engine: a chat active, stopped or closed by itself resumes with its history on its own engine (ADR 0352); the current task version (app_chats) is used when expectedVersion is omitted. The user\'s messages and answers in that chat you have not seen come back readable (userInstructions): the chat already has them, so they are not repeated in its prompt; account for them, and correct it or ask the user where your prompt disagrees. expectedEventSeq is optional. Refused only while the chat works or has queued work. A review chat (a Sentinel or Judge opened with reviewOf) is continued the same way for a fix of the work it reviewed (#387): it reviews only the fix delta; reviewOf = the run to review now (default: the current run of the chat it reviews); other work needs its own review chat. A role card changed since the chat started is no reason for a new chat: it takes the card\'s current tools and permissions. When the chat\'s engine cannot run now (off, or not for the Orchestrators) the work goes on by itself in a new chat of the role on its card\'s engine, from the hand-off: the answer\'s chatId (continuedFrom = the old one). Refused for a chat the user closed with ✕.',
      inputSchema: obj({ intakeQuestion: intakeField, chatId: str('Existing conversation ID'), contract: contractField, prompt: { ...str(`Fallback when there is no contract: self-contained assignment, up to ${CHAT_PROMPT_MAX} characters`), maxLength: CHAT_PROMPT_MAX },
        doneWhen: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 }, description: 'Checkable criteria for this assignment' },
        mode: { type: 'string', enum: ['continue', 'new-task', 'rework'] }, roleId: str('Existing work role'), cwd: str('Same absolute project folder'),
        expectedVersion: { type: 'integer', minimum: 1, description: 'Current taskVersion from app_chats' },
        expectedEventSeq: { type: 'integer', minimum: 0, description: 'optional: latestSeq from app_task_events you have read' },
        deliveryPolicy: { type: 'string', enum: ['display', 'notify', 'synthesize'] },
        reviewOf: str('Only for a review chat: the run it reviews now (the implementation chat\'s current run); default: that chat\'s current run'),
        map: { ...MAP_LINK_SCHEMA, description: `${MAP_LINK_SCHEMA.description} Omitted: the chat stays on the pieces it was linked to.` },
      }, ['chatId', 'mode', 'roleId', 'cwd']),
      run: async a => {
        const orchestrator = caller();
        if (fastTurn(orchestrator?.id)) throw new ToolRefusal(FAST_REFUSAL);
        if (!authed() || !orchestrator || !d.chats.assignTask) throw new Error('app_assign_task requires an authenticated Orchestrator.');
        // a chat that went on in another one (an engine change): the task goes to the one that works now (ADR 0356)
        const target = successorIn(d.chats.list(), String(a.chatId));
        if (!target || target.parentId || target.isOrchestrator) throw new ToolRefusal('Work conversation not found; use app_chats.');
        if (!isWorkRole(a.roleId) || target.agent?.id !== a.roleId) {
          const asked = String(a.roleId).slice(0, 40), runs = target.agent?.id ?? 'no role';
          throw new ToolRefusal(`Role mismatch: this chat runs ${runs}, not ${asked}. Assign ${target.agent?.id ?? 'its role'} work here, or use app_create_chat for ${asked}.`);
        }
        if (typeof a.cwd !== 'string' || !path.isAbsolute(a.cwd) || path.resolve(a.cwd) !== path.resolve(target.cwd)) throw new ToolRefusal('Project changed: create a fresh chat.');
        if (!d.agents) throw new Error('app_assign_task: the role catalog is not available.');
        // a card changed since the chat started does not stop the work (ADR 0352): the chat takes the card's current
        // instructions, tools and permissions on its next turn (ChatManager.assignTask)
        if (!d.agents().profiles.some(p => p.id === a.roleId)) throw new ToolRefusal(`Role ${String(a.roleId).slice(0, 40)} is not in the catalog any more: use app_create_chat with a current role.`);
        if (target.closedAt && target.closedBy === 'user') throw new ToolRefusal('The user closed this chat with ✕ and cancelled its work: it takes no new task. Open a new chat (app_create_chat), or reopen it with app_reopen_chat only if the user asks.');
        if (!['continue', 'new-task', 'rework'].includes(String(a.mode)) || (a.expectedVersion !== undefined && (!Number.isSafeInteger(a.expectedVersion) || Number(a.expectedVersion) < 1))) throw new ToolRefusal('Invalid assignment mode/version.');
        const task = taskPrompt(a, String(a.roleId ?? '')), prompt = task.prompt;
        if (!prompt) throw new Error('contract (or prompt): required');
        if (prompt.length > CHAT_PROMPT_MAX) throw new Error(`${task.what}: at most ${CHAT_PROMPT_MAX} characters (this one has ${prompt.length})`);
        // a review chat goes on only with the work it reviewed, and reviews only the fix delta (#387, ADR 0309)
        const reviewing = !!target.run?.reviewOf && REVIEW_ROLES.includes(String(a.roleId));
        if (a.reviewOf !== undefined && (!reviewing || typeof a.reviewOf !== 'string' || !a.reviewOf.trim() || a.reviewOf.length > 80)) throw new ToolRefusal(reviewing ? 'Invalid reviewOf.' : 'reviewOf: only for a review chat (one opened with reviewOf); open the review with app_create_chat.');
        const world = reviewing ? reviewWorld() : null;
        const reviewOf = world ? (a.reviewOf as string | undefined)?.trim() ?? nextReviewOf(world, target) : null;
        if (world && (!reviewOf || !reviewsSameWork(world, target, reviewOf))) throw new ToolRefusal('This review chat reviews other work: a review chat stays with the work it reviewed, and reviewOf names a run of that work (never of a review chat). Open the review of this work with app_create_chat (reviewOf; freshReview true if a review chat of it was named but cannot take it).');
        const delta = !!world && a.mode !== 'new-task' && hasReported(world, target);   // a first round, unfinished, reviews it all
        const doneWhen = task.doneWhen ?? (a.doneWhen === undefined ? undefined : Array.isArray(a.doneWhen) && a.doneWhen.length <= 12 && a.doneWhen.every(c => typeof c === 'string' && c.trim() && c.length <= 300) ? a.doneWhen as string[] : null);
        if (doneWhen === null) throw new Error('Invalid doneWhen criteria.');
        if (a.expectedEventSeq !== undefined && (!Number.isSafeInteger(a.expectedEventSeq) || Number(a.expectedEventSeq) < 0)) throw new Error('Invalid user event cursor.');
        if (a.deliveryPolicy !== undefined && !['display', 'notify', 'synthesize'].includes(String(a.deliveryPolicy))) throw new Error('Invalid delivery policy.');
        const userInstructions = d.chats.userEvents ? unreadInstructions(d.chats.userEvents(target.id)) : [];
        const mapLink = mapLinkOf(d.projectMaps, a.map);
        // the chat's engine cannot run now (off, or not for the Orchestrators): the work goes on by itself in a new chat
        // of the same role on its card's engine, from the hand-off, linked to this one (ADR 0352). Never a manual step
        const blocked = openRefusal(d.brain.settings(), target.harness);
        if (blocked) {
          // a review chat stays with the work it reviewed: a new one keeps the review link, a moved one would lose it
          if (world) throw new ToolRefusal(`${engineLabel(target.harness)} cannot run now (${blocked}): open the review of this work again with app_create_chat (reviewOf, freshReview true) on an engine that runs.`);
          if (a.expectedVersion !== undefined && Number(a.expectedVersion) !== (target.run?.taskVersion ?? 1)) throw new Error('Task version changed; refresh before assigning.');
          if (target.continuedBy) throw new ToolRefusal(`«${target.title}» already goes on in «${target.continuedBy.title}» (chatId ${target.continuedBy.id}): assign the task there.`);
          const criteria = doneWhen?.length ? `\n\nFatto quando:\n${doneWhen.map(c => `- ${c}`).join('\n')}` : '';
          const moved = await moveToCard(target, String(a.roleId), `${prompt}${criteria}`, blocked);
          if (mapLink) d.projectMaps!.link(mapLink.project, moved.id, mapLink.on);
          return { ...(mapLink ? { map: mapLink } : {}), chatId: moved.id, continuedFrom: target.id, harness: moved.harness, note: `${engineLabel(target.harness)} cannot run now (${blocked}): the work goes on in «${moved.title}» on ${engineLabel(moved.harness)}, from the hand-off of «${target.title}». Use this chatId from now on.`, ...(userInstructions.length ? { userInstructions } : {}), ...(task.warnings.length ? { warnings: task.warnings } : {}) };
        }
        await d.chats.assignTask(target.id, `${voice()}\n\n${delta ? `${DELTA_REVIEW}\n\n` : ''}${prompt}`, { ...(reviewOf ? { reviewOf } : {}), ...intakeOf(a, a.roleId === 'strategist' && a.mode === 'new-task' && !!target.plan), mode: a.mode as 'continue' | 'new-task' | 'rework', expectedVersion: a.expectedVersion === undefined ? target.run?.taskVersion ?? 1 : Number(a.expectedVersion), ...(a.expectedEventSeq !== undefined ? { expectedEventSeq: Number(a.expectedEventSeq) } : {}), ...(a.deliveryPolicy ? { deliveryPolicy: a.deliveryPolicy as 'display' | 'notify' | 'synthesize' } : {}), ...(doneWhen ? { doneWhen } : {}), ...(task.contractFields ? { contractFields: task.contractFields } : {}), source: { kind: 'chat', chatId: orchestrator.id } });
        if (mapLink) d.projectMaps!.link(mapLink.project, target.id, mapLink.on);
        const assigned = d.chats.list().find(c => c.id === target.id);
        // its engine's credit now (ADR 0354): a stopped engine says why and until when, so the Orchestrator tells the user
        const credit = d.creditOf?.(target.harness, target.model);
        return { ...(mapLink ? { map: mapLink } : {}), ...(credit && credit.state !== 'free' && credit.state !== 'unknown' ? { credit: `${engineLabel(target.harness)}: ${credit.state === 'out' ? 'credito finito' : credit.state === 'pace' ? 'ritmo alto' : 'in prova'}, ${credit.why}` } : {}), chatId: target.id, taskId: assigned?.run?.taskId, taskVersion: assigned?.run?.taskVersion, runId: assigned?.run?.runId, ...(userInstructions.length ? { userInstructions } : {}), ...(task.warnings.length ? { warnings: task.warnings } : {}) };
      },
    },
    {
      name: 'app_task_events', description: 'Read the complete ordered user decisions for a root work task. Optional before app_assign_task, which returns the unread ones itself. No model turn is started.',
      inputSchema: obj({ chatId: str('Root work chat ID'), afterSeq: { type: 'integer', minimum: 0 } }, ['chatId']),
      run: a => {
        if (!authed() || !caller() || !d.chats.userEvents) throw new Error('An authenticated Orchestrator is required.');
        const id = contentOf(String(a.chatId));
        if (a.afterSeq !== undefined && (!Number.isSafeInteger(a.afterSeq) || Number(a.afterSeq) < 0)) throw new Error('Invalid cursor.');
        return d.chats.userEvents(id, Number(a.afterSeq ?? 0));
      },
    },
    {
      name: 'app_send_to_chat', description: 'Send a message to an app chat on any engine: a stopped one, or one closed by itself, resumes with its history on its own engine (refused, with why, when that engine is off or not for the Orchestrators, and for a chat the user closed with ✕). For a completed role assignment use app_assign_task, which checks compatibility and creates a new run. From the Orchestrator it is read as the user\'s own message (his ok included, never for production, database writes, Azure/cloud, permissions or settings, messages to people); from any other caller as an agent\'s. A chat at work reads it at its next step (an addition: nothing is thrown away); now = true stops what it is doing first (a change of course, «fermati», «stai sbagliando»): you choose from the user\'s sentence and say which you did.',
      inputSchema: obj({ chatId: str('chat id'), text: str('message'), now: { type: 'boolean', description: 'interrupt its current step first' } }, ['chatId', 'text']),
      run: async a => {
        const text = String(a.text ?? '').trim();
        if (!text || text.length > 4000) throw new Error('text empty or longer than 4000 chars');
        // any engine, whatever the caller's (ADR 0352): a stopped or auto-closed chat resumes with its history on its own
        // engine. Refused only for a chat the user closed, or a stopped one on an engine that cannot run now (openRefusal)
        const target = d.chats.list().find(c => c.id === String(a.chatId));
        const orchestrator = caller();
        if (target) {
          const refused = wakeRefusal(target);
          if (refused) throw new ToolRefusal(refused);
        }
        // a delegated chat paused on the user's step: his «fatto» goes to whoever owns that work (ADR 0269)
        if (authed() && target?.parentId && d.chats.userStepDone?.(target.id, text)) return 'passato a chi segue il lavoro';
        const busy = target?.state === 'running';
        // a change of course (ADR 0276): its current step stops, what it understood stays, this message is its next turn
        if (a.now === true && busy && authed()) await d.chats.stop(String(a.chatId), true).catch(e => log.info('appctl', 'interrupt before a change of course failed', { chat: String(a.chatId), data: String(e) }));
        await d.chats.send(String(a.chatId), `${voice()}\n\n${text}`, undefined, false, orchestrator?.title ?? 'Orchestrator', false, orchestrator ? { kind: 'chat', chatId: orchestrator.id } : { kind: 'app' });
        // on the project map the agent shows the change until it takes it (zero tokens)
        if (authed()) d.projectMaps?.sent(String(a.chatId), text, busy && a.now !== true);
        log.info('appctl', 'agent message sent to chat', { chat: String(a.chatId), data: { chars: text.length } });
        const after = d.chats.list().find(c => c.id === String(a.chatId)), q = after?.queued;
        // the Orchestrator wrote to a chat that waits on the user: the row stays open (ADR 0329), so it is told how to close it
        const waits = authed() && after && !after.parentId ? waitsOnUser(after, d.chats.pending()) : null;
        return `${q ? queuedLine(q) : 'sent'}${waits ? `. ${waits}` : ''}`;
      },
    },
    {
      name: 'app_handoff_chat',
      description: 'A chat writes its hand-off note now (state, files and worktree, decisions, tried and dropped, next step), saved by the app; returns the note and its path. Refused while the chat works or waits for the user. A stopped chat whose engine cannot run now is never started: the app builds the note itself.',
      inputSchema: obj({ chatId: str('chat id from app_chats') }, ['chatId']),
      run: async a => {
        // a delegated chat's note is its content: only its parent reads it (ADR 0083)
        const target = need(contentOf(String(a.chatId)));
        // an engine that cannot run now is never started for this: the app builds the note itself
        const allowStart = agentsMayOpen(d.brain.settings(), target.harness);
        const h = await d.chats.handoff(target.id, { reason: 'manual', allowStart });
        log.info('appctl', 'agent asked a hand-off', { chat: target.id, data: { source: h.source } });
        return { chatId: h.chatId, path: h.path, source: h.source, at: new Date(h.at).toISOString(), text: h.text };
      },
    },
    {
      name: 'app_continue_chat',
      description: '"Riprendi": explicitly opens a NEW chat on the same engine and folder from the old chat\'s hand-off (written first if missing or stale); the old chat stops and stays readable, linked both ways. Use only for an intentional new task/session or requested handoff, never merely because context is long. The engine manages native compaction. Not for the Orchestrator.',
      inputSchema: obj({ chatId: str('chat id from app_chats') }, ['chatId']),
      run: async a => {
        // a delegated chat goes on under its parent, which reads its hand-off (ADR 0083): not the Orchestrator's to continue
        const target = need(contentOf(String(a.chatId)));
        // the engine must be one agents may open (on, and the Orchestrators allowed there); the caller's own plays no part
        const refused = openRefusal(d.brain.settings(), target.harness);
        if (refused) throw new Error(`bloccato: ${refused}`);
        const chat = await d.chats.continueChat(target.id, { promptPrefix: voice() });
        log.info('appctl', 'agent continued a chat in a new one', { chat: target.id, data: { next: chat.id } });
        return { chatId: chat.id, title: chat.title, harness: chat.harness, continuedFrom: target.id };
      },
    },
  ];
  // only the authenticated Orchestrator mount: the questions window comes up with everything that waits for the user
  // (ADR 0135: he unblocks the work from the Orchestrator's recap, never from the agents' chats); only right after he
  // wrote to it, so an agent cannot bring a permission under his keystrokes at any moment (review 2026-10-11)
  if (authed()) {
    tools.push({
      name: 'app_unblock',
      description: `After a recap the user asked for: opens the app's questions window with everything that waits for him from every chat (questions, permissions, commands to run, Strategist plans, workflow proposals and learned rules), the ones he set aside with «Ci penso dopo» too, one after the other, ready to answer there (Sì / No / his own words) without opening the chats. Returns how many wait. Refused unless the Orchestrator's latest message is the user's own, written in the last ${UNBLOCK_ASK_MIN} minutes (never on a turn woken by app news or an agent). The window never takes his keyboard while he types.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: obj(),
      run: () => {
        const orchestrator = caller();
        if (!orchestrator) throw new Error('bloccato: solo l’Orchestrator apre le richieste in attesa');
        if (!userTurn(orchestrator.id, Date.now() - UNBLOCK_ASK_MIN * 60_000)) throw new Error('bloccato: apri le richieste in attesa solo quando l’utente ti chiede un recap');
        const asks = [...d.chats.pending(), ...(d.commandAsks?.() ?? [])].length;
        const plans = d.chats.list().filter(c => !c.closedAt && c.plan?.phase === 'proposed').length;
        const workflows = d.workflows?.list().filter(r => r.status === 'approval' && r.proposal).length ?? 0;
        const lessons = d.agentLearning?.waiting().length ?? 0;
        if (!asks && !plans && !workflows && !lessons) return { waiting: 0, note: 'Niente aspetta l’utente: non c’è nulla da aprire.' };
        d.emitUi({ action: 'unblock' });
        return { waiting: asks + plans + workflows + lessons, questionsAndPermissions: asks, plans, workflows, lessons, note: 'La finestra delle domande è aperta con tutte le richieste in attesa.' };
      },
    });
  }
  // only the authenticated Orchestrator mount (/mcp/app/o/<id>/<token>): the plain mount is open to local processes
  if (d.code?.pull && authed()) {
    const pull = d.code.pull;
    tools.push({
      name: 'app_update_code',
      description: `Only when the user asked in their own words to update the app ("aggiornati", "aggiorna l'app"): brings the app's code folder up to date with GitHub (scripts/pull.mjs: fetch main, fast-forward only, never merges or drops local work, never pushes), reinstalls the pinned dependencies if the lockfile changed and builds. It never promotes or restarts. Refused unless the user wrote to the Orchestrator in the last ${PULL_ASK_MIN} minutes. Then tell the user the result: a dev app run from the checkout picks it up when restarted; to switch at once, the user presses «Aggiorna» in Impostazioni → Aggiornamenti.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: obj(),
      run: async () => {
        const orchestrator = caller();
        if (!authed() || !orchestrator) throw new Error('bloccato: solo l’Orchestrator aggiorna il codice dell’app, quando l’utente lo chiede');
        if (!decidedSince(orchestrator.id, Date.now() - PULL_ASK_MIN * 60_000)) throw new Error('bloccato: l’utente non ha chiesto di aggiornare l’app. Aggiorna solo se te lo chiede lui');
        return pull();
      },
    });
  }
  return tools;

  /** did the user write to the Orchestrator, or answer one of its questions, at or after `at`? (his decision, not the agent's;
   *  text from the paired phone is never a decision: phone bridge, design §5.5) */
  function decidedSince(orchestratorId: string, at: number): boolean {
    const items = d.chats.items(orchestratorId);
    const phone = phoneAnswered(items);
    return items.some(i => i.at >= at && (
      i.kind === 'user' ? !labelled(i.text) && i.via !== 'phone' : i.kind === 'tool' && /question/i.test(i.name) && i.status === 'ok' && !phone.has(i.id)));
  }

  /** the question tool items answered with the phone's buttons, bound by id, never by time (an ACP tool item can be
   *  stamped after the answer). Each «Risposto dal telefono» line (manager-requests.ts answer) names its tool item when
   *  the engine shares the id (Claude: t-<toolUseId>); otherwise it claims the unclaimed answered question nearest to
   *  the time the request was asked (a line without that time: its own time) */
  function phoneAnswered(items: ChatItem[]): Set<string> {
    const asks = items.filter(i => i.kind === 'tool' && /question/i.test(i.name) && i.status === 'ok');
    const claimed = new Set<string>();
    for (const l of items) {
      if (l.kind !== 'system' || l.code !== 'phoneDecided' || l.params?.what !== 'question') continue;
      const tool = l.params.tool;
      if (typeof tool === 'string' && tool) { claimed.add(tool); continue; }
      const asked = typeof l.params.asked === 'number' ? l.params.asked : l.at;
      let best: ChatItem | undefined;
      for (const q of asks) if (!claimed.has(q.id) && (!best || Math.abs(q.at - asked) < Math.abs(best.at - asked))) best = q;
      if (best) claimed.add(best.id);
    }
    return claimed;
  }

  /** app_config's proof (ADR 0149): the user typed to this very Orchestrator in the last minutes, and its latest
   *  message is that one (not app news or an agent's mail, which also land as 'user' items) */
  function configAsked(orchestratorId: string): boolean {
    const typed = lastTyped(orchestratorId), answered = lastAnswered(orchestratorId);
    if (typed === undefined && answered === undefined) return false;
    const last = d.chats.items(orchestratorId).filter(i => i.kind === 'user').at(-1);
    const chat = d.chats.list().find(c => c.id === orchestratorId);
    return userAsked({ typed, answered, lastUserItem: last?.at, lastResult: chat?.lastResult?.at, now: Date.now(), freshMs: CONFIG_ASK_MIN * 60_000, turnMs: CONFIG_TURN_MIN * 60_000 });
  }

  /** app_learn's proof (ADR 0190): the time of the user's own latest message when this turn is his, else null */
  function imparaAsked(orchestratorId: string): { who: string; at: number } | null {
    const last = d.chats.items(orchestratorId).filter(i => i.kind === 'user').at(-1);
    return last && userTurn(orchestratorId, Date.now() - LEARN_ASK_MIN * 60_000) ? { who: orchestratorId, at: last.at } : null;
  }

  /** Fast mode (ADR 0296): the Orchestrator's latest message is a «[fast]» one, so this turn answers alone: no chat is
   *  opened or assigned (the mode line asks it; this makes it hold even when the model forgets) */
  function fastTurn(orchestratorId: string | undefined): boolean {
    // a chat service without items (a partial one) has no turn to read: no Fast
    const items = orchestratorId && typeof d.chats.items === 'function' ? d.chats.items(orchestratorId) : [];
    const last = items.filter(i => i.kind === 'user').at(-1);
    return !!last && last.kind === 'user' && splitMode(last.text).mode === 'fast';
  }

  /** is this turn the user's: the Orchestrator's latest message is one he wrote (not app news, not an agent's mail), at
   *  or after `at`? (app_unblock: a turn woken by an agent can never open the requests) */
  function userTurn(orchestratorId: string, at: number, phone = false): boolean {
    const last = d.chats.items(orchestratorId).filter(i => i.kind === 'user').at(-1);
    return !!last && last.kind === 'user' && last.at >= at && !labelled(last.text) && (phone || last.via !== 'phone');
  }

  function need(chatId: string): ChatSummary {
    const c = d.chats.list().find(x => x.id === chatId);
    if (!c) throw new Error(`chat sconosciuta: ${chatId}`);
    return c;
  }

  /** Why a message from an agent may not reach this chat (ADR 0352), or null. The caller's engine plays no part: a chat the
   *  user closed with ✕ takes no agent's message (only app_reopen_chat, when he asks); a chat with no engine running
   *  (stopped, or closed by itself) resumes on its own engine only if agents may open it (engines/policy.ts). */
  function wakeRefusal(c: ChatSummary): string | null {
    if (c.closedAt && c.closedBy === 'user') return 'The user closed this chat with ✕ and cancelled its work: an agent\'s message does not reopen it. Reopen it with app_reopen_chat only if the user asks.';
    if (!c.closedAt && ['running', 'waiting', 'idle'].includes(c.state)) return null;
    const refused = openRefusal(d.brain.settings(), c.harness);
    return refused ? `bloccato: la chat è ferma e ${refused}; si riprende quando il motore è acceso e consentito (Impostazioni → Motori).` : null;
  }

  /** The chat's engine cannot run now (`why`): its work goes on in a new chat of the same role on the engine its card
   *  names, from the app's own hand-off (the old engine is not asked), linked both ways (ChatManager.continueChat).
   *  Refused, with the reason, when the card's engine cannot run either. */
  async function moveToCard(target: ChatSummary, roleId: string, prompt: string, why: string): Promise<ChatSummary> {
    if (!d.resolveRole) throw new ToolRefusal(`bloccato: ${why}.`);
    // the tree's excluded engines (ADR 0359): the work never moves onto one
    const exclude = routingFor(target.id, d.chats.list()).exclude;
    const card = d.resolveRole({ harness: target.harness, cwd: target.cwd, roleId, title: target.title, prompt }, exclude.length ? { exclude } : undefined).request;
    const also = card.harness === target.harness ? why : openRefusal(d.brain.settings(), card.harness);
    if (also) throw new ToolRefusal(`bloccato: ${why}${card.harness !== target.harness ? `, e la scheda del ruolo parte su ${engineLabel(card.harness)}: ${also}` : ''}. Il lavoro riparte quando un motore della scheda è acceso e consentito (Impostazioni → Motori).`);
    return d.chats.continueChat(target.id, { allowStart: false, ask: false, on: { harness: card.harness, model: card.model ?? null, effort: card.effort ?? null },
      promptPrefix: `${voice()}\n\n${APP_MOVED(target, card.harness)}\n\n${prompt}` });
  }
}

/** A frame script for the screenshot's password mask, with a deadline (a page blocked by a dialog never answers). */
function frameRun(frame: Electron.WebFrameMain, script: string): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([frame.executeJavaScript(script) as Promise<unknown>,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the page did not answer')), 3000); })]).finally(() => clearTimeout(timer));
}
