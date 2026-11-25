// Persistence of the app's own chats in <userData>/chats.json, so tiles come back after a restart as 'closed' and
// resume on the first message (docs/architecture.md "Data and state"). Only ids, folders, choices, the last context
// size, the hand-off/"Riprendi" links and the past sessions of a cold continuation (ADR 0031) are stored:
// never messages (they stay in each CLI's transcript) and never secrets. Writes are atomic (tmp + rename), synchronous
// or deferred and asynchronous (saveAsync, ADR 0171); a corrupt
// file is set aside as chats.json.bad-<time> instead of being lost. Used by manager.ts.
import { readAgentContext, type AgentContextSnapshot } from '../../shared/agent-context';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isLang, type ChatLink, type ChatSummary, type CreditWait, type Effort, type HandoffSource, type Harness, type Lang, type PermissionMode, type RemoteControlState, type RouteDecision } from '../../shared/contract';
import { readStoredRemote } from './remote-control';
import { validRoute } from '../brain/routing';
import { errText, log } from '../log';
import { isSessionId, isUuid } from './session';
import { ENGINE_ID } from '../engines/registry';
import type { AgentOwnerSnapshot, AgentChildren, AgentRun, UserTaskEvents } from '../../shared/agents';
import { RUN_ID, readRun } from '../agents/runs';
import { readOwner } from '../agents/catalog';
import { readPolicy, type AgentPolicy } from '../agents/tool-policy';
import { sanitizeAgentChildren } from './agent-children';
import { readDelegation, type ChatDelegation } from '../../shared/delegation';
import { readPlan, type StrategyPlan } from '../../shared/strategy';
import { PLAN_ID } from '../../shared/plan';
import { readLadder, type LadderQuestion } from '../../shared/question-ladder';
import { slowStep } from '../perf';
import { cleanOrphanTmps, writeLocalTextAsync, renameWithRetry } from '../agents/local-store';

function validAssets(value: unknown): value is NonNullable<StoredChat['agentAssets']> {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a.pluginDir === 'string' && a.pluginDir.length <= 4096 && typeof a.skillRoot === 'string'
    && /^[a-f0-9]{64}$/.test(path.basename(a.pluginDir)) && path.basename(path.dirname(a.pluginDir)) === 'agent-pack-runtime'
    && path.resolve(a.skillRoot) === path.resolve(a.pluginDir, 'skills');
}

/** Stable child result identity survives admission, retries and restarts; old records may lack IDs. */
export interface HeldChildResult { id?: string; runId?: string; title: string; message: string; /** the child that sent it: its newer result replaces it */ chatId?: string }
/** Durable root result delivery state, saved before the engine can finish its turn. */
export interface HeldRootResult {
  local?: boolean;
  note: { chatId: string; title: string; role: string; summary: string; at: number };
  message: string;
  quiet: boolean;
  userWaits: boolean;
}
export interface StoredChat {
  launchContext?: AgentContextSnapshot;
  userTaskEvents?: UserTaskEvents;
  id: string;
  agent?: AgentOwnerSnapshot;
  work?: NonNullable<ChatSummary['work']>;
  agentInstructions?: string;
  agentAssets?: { pluginDir: string; skillRoot: string };
  /** the skills its launch gave it (frozen at start): the role gate allows only these */
  agentSkills?: string[];
  agentChildren?: AgentChildren;
  /** the agent's tool policy and ceiling (A2); unreadable → the narrowest policy, never none */
  agentPolicy?: AgentPolicy;
  /** the agent's "Contesto massimo" (tokens), frozen at start like its policy (#80) */
  agentMaxContext?: number;
  /** mirror of the chat's agent run (A5); agent-runs.json is the source of truth. */
  run?: AgentRun;
  /** when nothing last waited on the user in this run (a reopen, an answer): the stale clock's start across restarts */
  runIdleSince?: number;
  heldResult?: HeldRootResult;
  rootReportAt?: number;
  userWaits?: boolean;
  autoCompleted?: boolean;

  /** its run (this id) was pruned into the rollups: it counts there only, so the chat never gets a backfilled run */
  runPruned?: string;
  harness: Harness;
  cwd: string;
  sessionId: string | null;
  /** a fork not started yet: resume this id with --fork-session (its own id comes from the CLI) */
  forkFrom?: string;
  title: string;
  model: string | null;
  effort: Effort | null;
  /** null = never chosen by the user: the CLI follows settings.json (ADR 0002) */
  permissionMode: PermissionMode | null;
  isOrchestrator: boolean;
  /** the maintenance research (ADR 0132) */
  research?: true;
  /** child results a quit held back from this parent, sent after the next start */
  heldResults?: HeldChildResult[];
  createdAt: number;
  /** the CLI's running cost total last seen, for per-turn deltas after a resume */
  costTotalUsd?: number;
  /** end of the last real turn: a saved hand-off older than this is stale */
  lastTurnAt?: number;
  /** the context size last seen, so a closed long chat still shows it (estimated: Cursor) */
  context?: { tokens: number; max?: number; estimated?: boolean };
  /** a hand-off note exists in <userData>/handoffs/<id>.md, written at this time */
  handoffAt?: number;
  handoffSource?: HandoffSource;
  /** its saved hand-off is a cold note (ADR 0031) written at this time: a message after the cache expired continues
   *  the chat in a fresh session from it */
  coldNoteAt?: number;
  /** The previous session's note still needs delivery to this session; survives a crash before first submission. */
  continuationPending?: string;
  /** Exact completed question/permission context belongs only to this chat, not the shared user-event ledger. */
  continuationDecisions?: string;
  intakeKey?: string;
  /** A history eviction or image input makes an automatic text-only continuation unsafe. */
  continuityUnsafe?: true;
  /** when the context in force began (first turn since the session start or the last compaction): an Orchestrator's day
   *  compaction (continuity.ts orchestratorDayDue) */
  ctxSince?: number;
  /** the session whose context already holds the role text, and a hash of that text: a resume of that same session
   *  does not send it again (it is in the history; the token plan, proposal 1) */
  rolePrimed?: { session: string; sig: string };
  /** the reply language its context was last told (ADR 0120): a change is said once, on its next turn */
  replyLang?: Lang;
  /** the sessions this chat had before its cold continuations, oldest first (their transcripts show folded above) */
  pastSessions?: PastSession[];
  /** "Riprendi" links: this chat continues another one / is continued by another one */
  continuedFrom?: ChatLink;
  /** the work map it was started for (ADR 0342) */
  planId?: string;
  continuedBy?: ChatLink;
  /** created with "Worktree separato" (the CLI made the worktree; "Riprendi" tells the new chat to work there) */
  inWorktree?: boolean;
  /** Remote Control was on (ADR 0229): the next engine reattaches this bridge; only status 'paused' is ever stored */
  remoteControl?: RemoteControlState;
  /** archived (out of the grid, in the palette's "Chiuse" group) at this time, by the auto-close or by hand */
  closedAt?: number;
  closedBy?: 'auto' | 'user';
  /** a turn was running when this was written: if the app stops now, the next start resumes the chat by itself */
  working?: true;
  /** how its last turn ended and what its last answer waits for: a restored chat closes by itself only after a clean
   *  result that waits for nobody (ADR 0134) */
  lastResult?: { at: number; isError: boolean; interrupted?: true };
  waitsOn?: 'user' | 'colleagues';
  waitsOnWork?: true;
  /** stopped on its provider's credit limit: it waits for another model on its role's card (ADR 0346) */
  creditWait?: CreditWait;
  creditMoved?: ChatSummary['creditMoved'];
  userModel?: ChatSummary['userModel'];
  pick?: ChatSummary['pick'];
  /** its engine ended with an error or in the middle of a turn: not finished, it never closes by itself */
  unfinished?: true;
  /** how its engine was chosen (role, defaults or override; ADR 0032, 0210) */
  route?: RouteDecision;
  /** the chat that delegated this one (agent_delegate) and the contract it got (shared/delegation.ts) */
  parentId?: string;
  delegation?: ChatDelegation;
  /** a Strategist root chat's plan with the user (shared/strategy.ts, ADR 0108) */
  plan?: StrategyPlan;
  /** its questions on the ladder, an open one included (shared/question-ladder.ts, ADR 0344) */
  questions?: LadderQuestion[];
  /** a delegated chat's ancestors' catalog roles, frozen at its creation (its managed MCP access, ADR 0086) */
  mcpAncestors?: (string | null)[];
}

export interface PastSession { sessionId: string; at: number; notePath: string }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isRolePrimed = (v: unknown): v is { session: string; sig: string } => {
  const x = v as Record<string, unknown> | null;
  return !!x && typeof x === 'object' && typeof x.session === 'string' && x.session.length > 0 && x.session.length <= 200
    && typeof x.sig === 'string' && /^[0-9a-f]{16}$/.test(x.sig);
};
const link = (v: unknown): ChatLink | null => {
  const l = v as Record<string, unknown> | null;
  return l && typeof l === 'object' && typeof l.id === 'string' && l.id && typeof l.title === 'string' ? { id: l.id, title: l.title } : null;
};
function readChatWork(value:unknown):NonNullable<StoredChat['work']>{
  const work=value as Partial<NonNullable<StoredChat['work']>>|null;
  if(work&&['assigned','waiting-mail','completed'].includes(String(work.status))&&typeof work.updatedAt==='number'&&Number.isFinite(work.updatedAt)&&work.updatedAt>=0)return {status:work.status!,updatedAt:work.updatedAt};
  // Invalid persisted holds fail closed until an explicit lifecycle update; they never turn into completed work.
  return {status:'assigned',updatedAt:0};
}
function readCreditWait(value: unknown): StoredChat['creditWait'] | undefined {
  const w = value as Record<string, unknown> | null;
  if (!w || typeof w !== 'object' || typeof w.at !== 'number' || !Number.isFinite(w.at)) return undefined;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const key = (x: unknown): x is string => typeof x === 'string' && x.length <= 200;
  const next = w.next as Record<string, unknown> | undefined;
  const failed = Array.isArray(w.failed) ? (w.failed as Record<string, unknown>[]).filter(f => f && key(f.card) && fin(f.n) && fin(f.at)).slice(0, 16)
    .map(f => ({ card: f.card as string, n: f.n as number, at: f.at as number, nextAt: fin(f.nextAt) ? f.nextAt : null, permanent: f.permanent === true, error: typeof f.error === 'string' ? f.error.slice(0, 300) : '' })) : [];
  const waiting = w.waiting as Record<string, unknown> | undefined;
  // the wait survives a restart with its announced move, its «Annulla» and its failures (ADR 0354)
  return { at: w.at, model: typeof w.model === 'string' && w.model && w.model.length <= 120 ? w.model : null, ...(key(w.card) ? { card: w.card } : {}), ...(w.why === 'start' ? { why: 'start' as const } : {}), ...(typeof w.prompt === 'string' && w.prompt.length <= 200_000 ? { prompt: w.prompt } : {}),
    ...(next && key(next.card) && fin(next.at) ? { next: { card: next.card, at: next.at } } : {}),
    ...(w.stay === true ? { stay: true as const } : key(w.stay) ? { stay: w.stay } : {}),
    ...(failed.length ? { failed } : {}),
    ...(waiting && Array.isArray(waiting.out) ? { waiting: { out: (waiting.out as unknown[]).filter(key).slice(0, 8) as string[], first: fin(waiting.first) ? waiting.first : null } } : {}) };
}
function readCreditMoved(value: unknown): StoredChat['creditMoved'] | undefined {
  const m = value as Record<string, unknown> | null;
  const t = (x: unknown) => typeof x === 'string' && x.length <= 300;
  return m && typeof m === 'object' && typeof m.at === 'number' && t(m.from) && t(m.to) && t(m.level) && t(m.why) ? { at: m.at, from: m.from as string, to: m.to as string, level: m.level as string, why: m.why as string } : undefined;
}
function readUserModel(value: unknown): StoredChat['userModel'] | undefined {
  const u = value as Record<string, unknown> | null;
  if (!u || typeof u !== 'object' || typeof u.model !== 'string' || !u.model || u.model.length > 128 || typeof u.engine !== 'string' || u.engine.length > 60) return undefined;
  return { model: u.model, engine: u.engine as Harness, ...(typeof u.effort === 'string' && u.effort.length <= 10 ? { effort: u.effort as Effort } : {}) };
}
function readPick(value: unknown): StoredChat['pick'] | undefined {
  const p = value as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || typeof p.at !== 'number' || typeof p.chosen !== 'string' || !Array.isArray(p.skipped)) return undefined;
  const skipped = (p.skipped as Record<string, unknown>[]).filter(x => x && typeof x.engine === 'string' && typeof x.why === 'string' && ['off', 'price', 'credit'].includes(String(x.kind))).slice(0, 8)
    .map(x => ({ engine: x.engine as Harness, model: typeof x.model === 'string' ? x.model : null, kind: x.kind as 'off' | 'price' | 'credit', why: (x.why as string).slice(0, 300),
      ...(typeof x.until === 'number' ? { until: x.until } : {}), ...(typeof x.readingAt === 'number' ? { readingAt: x.readingAt } : {}), ...(['reading', 'error', 'turn', 'none'].includes(String(x.source)) ? { source: x.source as 'reading' } : {}),
      ...(['ok', 'pace', 'over', 'out', 'probation', 'unknown'].includes(String(x.state)) ? { state: x.state as 'out' } : {}) }));
  return { at: p.at, chosen: p.chosen.slice(0, 200), skipped, ...(p.allOut === true ? { allOut: true as const } : {}) };
}
function readLastResult(value: unknown): StoredChat['lastResult'] | undefined {
  const v = value as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== 'object' || !num(v.at) || typeof v.isError !== 'boolean') return undefined;
  return { at: v.at as number, isError: v.isError, ...(v.interrupted === true ? { interrupted: true as const } : {}) };
}
function extras(c: Record<string, unknown>): Partial<StoredChat> {
  const ctx = c.context as Record<string, unknown> | undefined;
  const from = link(c.continuedFrom), by = link(c.continuedBy), route = validRoute(c.route), run = readRun(c.run);
  return {
    ...(readAgentContext(c.launchContext) ? { launchContext: readAgentContext(c.launchContext)! } : {}),
    ...(readOwner(c.agent) ? { agent: readOwner(c.agent)! } : {}),
    // Cursor carries two bounded skill documents in addition to the 8000-character profile; every role also carries its
    // memory block (up to 4000 + 2000 characters with its hint, agents/pack/flows.ts) beside the role text and skills line
    ...(typeof c.agentInstructions === 'string' && c.agentInstructions.length <= (c.harness === 'cursor' && validAssets(c.agentAssets) ? 4 * 1024 * 1024 + 16384 : 16384) ? { agentInstructions: c.agentInstructions } : {}),
    ...(validAssets(c.agentAssets) ? { agentAssets: c.agentAssets } : {}),
    ...(Array.isArray(c.agentSkills) && c.agentSkills.length <= 64 && c.agentSkills.every(x => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(x)) ? { agentSkills: c.agentSkills as string[] } : {}),
    ...(c.agentChildren ? { agentChildren: sanitizeAgentChildren(c.agentChildren) } : {}),
    ...(readPolicy(c.agentPolicy) ? { agentPolicy: readPolicy(c.agentPolicy)! } : {}),
    ...(Number.isSafeInteger(c.agentMaxContext) && (c.agentMaxContext as number) >= 100_000 && (c.agentMaxContext as number) <= 1_000_000 ? { agentMaxContext: c.agentMaxContext as number } : {}),
    ...(run && run.chatId === c.id ? { run, ...(num(c.runIdleSince) ? { runIdleSince: c.runIdleSince } : {}) } : {}),
    ...(typeof c.runPruned === 'string' && RUN_ID.test(c.runPruned) ? { runPruned: c.runPruned } : {}),
    ...(route ? { route } : {}),
    ...(c.work !== undefined ? {work:readChatWork(c.work)} : {}),
    ...(num(c.lastTurnAt) ? { lastTurnAt: c.lastTurnAt } : {}),
    ...(ctx && typeof ctx === 'object' && num(ctx.tokens) ? { context: { tokens: ctx.tokens, ...(num(ctx.max) ? { max: ctx.max } : {}), ...(ctx.estimated === true ? { estimated: true } : {}) } } : {}),
    ...(num(c.coldNoteAt) ? { coldNoteAt: c.coldNoteAt } : {}),
    ...(isUuid(c.continuationPending) ? { continuationPending: c.continuationPending } : {}),
    ...(typeof c.intakeKey === 'string' && c.intakeKey ? { intakeKey: c.intakeKey } : {}),
    ...(typeof c.continuationDecisions === 'string' ? { continuationDecisions: c.continuationDecisions } : {}),
    ...(c.continuityUnsafe === true || (c.continuationDecisions !== undefined && typeof c.continuationDecisions !== 'string') ? { continuityUnsafe: true as const } : {}),
    ...(num(c.ctxSince) ? { ctxSince: c.ctxSince } : {}),
    ...(isRolePrimed(c.rolePrimed) ? { rolePrimed: { session: c.rolePrimed.session, sig: c.rolePrimed.sig } } : {}),
    ...(isLang(c.replyLang) ? { replyLang: c.replyLang } : {}),
    ...(Array.isArray(c.pastSessions) ? { pastSessions: c.pastSessions.flatMap(p => { const x = p as Record<string, unknown>; return isUuid(x?.sessionId) && num(x.at) && typeof x.notePath === 'string' ? [{ sessionId: x.sessionId, at: x.at, notePath: x.notePath }] : []; }).slice(-20) } : {}),
    ...(num(c.handoffAt) ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource === 'auto' ? 'auto' as const : 'chat' as const } : {}),
    ...(typeof c.planId === 'string' && PLAN_ID.test(c.planId) ? { planId: c.planId } : {}),
    ...(from ? { continuedFrom: from } : {}), ...(by ? { continuedBy: by } : {}),
    ...(c.inWorktree === true ? { inWorktree: true } : {}),
    ...(readStoredRemote(c.remoteControl) ? { remoteControl: readStoredRemote(c.remoteControl)! } : {}),
    ...(typeof c.parentId === 'string' && /^[\w-]{1,80}$/.test(c.parentId) && c.parentId !== c.id ? { parentId: c.parentId } : {}),
    ...(readDelegation(c.delegation) ? { delegation: readDelegation(c.delegation)! } : {}),
    ...(readPlan(c.plan) ? { plan: readPlan(c.plan)! } : {}),
    ...(readLadder(c.questions).length ? { questions: readLadder(c.questions) } : {}),
    ...(Array.isArray(c.mcpAncestors) && c.mcpAncestors.length <= 16 && c.mcpAncestors.every(x => x === null || typeof x === 'string' && /^[\w-]{1,80}$/.test(x))
      ? { mcpAncestors: c.mcpAncestors as (string | null)[] } : {}),
  };
}

const MODES: readonly string[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** held child results: at most 32, each a title and a message of bounded size, else none */
function heldResults(x: unknown): HeldChildResult[] | null {
  if (!Array.isArray(x) || !x.length || x.length > 32) return null;
  const ok = x.every(i => !!i && typeof i === 'object' && typeof (i as { title?: unknown }).title === 'string' && typeof (i as { message?: unknown }).message === 'string'
    && (i as { message: string }).message.length <= 64 * 1024 && (i as { title: string }).title.length <= 500);
  return ok ? (x as HeldChildResult[]).map(i => ({ title: i.title, message: i.message, ...(typeof i.id === 'string' && i.id.length <= 100 ? { id: i.id } : {}), ...(typeof i.runId === 'string' && RUN_ID.test(i.runId) ? { runId: i.runId } : {}), ...(typeof i.chatId === 'string' && i.chatId.length <= 100 ? { chatId: i.chatId } : {}) })) : null;
}

/** Malformed authoritative events fail closed rather than silently making a stale assignment appear safe. */
function readTaskEvents(value: unknown): UserTaskEvents | undefined {
  if (value === undefined) return undefined;
  const ledger = value as UserTaskEvents;
  if (ledger && Array.isArray(ledger.events) && Number.isSafeInteger(ledger.latestSeq) && ledger.latestSeq >= 0 &&
      Number.isSafeInteger(ledger.acknowledgedSeq) && ledger.acknowledgedSeq >= 0 && ledger.acknowledgedSeq <= ledger.latestSeq &&
      ledger.events.length === ledger.latestSeq && ledger.events.every((e, index) => e && e.seq === index + 1 &&
        typeof e.id === 'string' && typeof e.at === 'number' && Number.isFinite(e.at) && typeof e.text === 'string' &&
        (e.taskId === undefined || typeof e.taskId === 'string') && (e.taskVersion === undefined || Number.isSafeInteger(e.taskVersion)))) return structuredClone(ledger);
  return { events: [], latestSeq: Number.MAX_SAFE_INTEGER, acknowledgedSeq: 0 };
}

function validHeldRoot(value: unknown): value is HeldRootResult {
  const h = value as HeldRootResult | undefined, n = h?.note;
  return !!h && typeof h === 'object' && typeof h.message === 'string' && h.message.length <= 65536 &&
    typeof h.quiet === 'boolean' && typeof h.userWaits === 'boolean' && !!n && typeof n.chatId === 'string' &&
    typeof n.title === 'string' && typeof n.role === 'string' && typeof n.summary === 'string' && n.summary.length <= 2000 && num(n.at);
}

function valid(x: unknown): StoredChat | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || typeof c.cwd !== 'string' || !ENGINE_ID.test(String(c.harness))) return null;
  // a file written by a release before ADR 0083 marks the user's Orchestrator with the old coordinator key plus
  // `orchestrator: true`: it stays the Orchestrator (the one tolerant read; the other old coordinators are plain chats)
  const orchestrator = c.isOrchestrator === true || (c.isRegia === true && c.orchestrator === true);
  // the side lane removed by ADR 0296 (`quick`): its chats are dropped, the app keeps no trace of it
  if (c.quick === true && !orchestrator) return null;
  return {
    id: c.id, harness: c.harness as Harness, cwd: c.cwd,
    // only a plain session token survives (a UUID for Claude, else startSession replaces it): anything else is dropped
    sessionId: isSessionId(c.sessionId) ? c.sessionId : null,
    ...(isUuid(c.forkFrom) ? { forkFrom: c.forkFrom } : {}),
    title: typeof c.title === 'string' ? c.title : 'Chat',
    model: typeof c.model === 'string' && c.model ? c.model : null,
    effort: EFFORTS.includes(String(c.effort)) ? (c.effort as Effort) : null,
    permissionMode: MODES.includes(String(c.permissionMode)) ? (c.permissionMode as PermissionMode) : null,
    isOrchestrator: orchestrator,
    ...(c.research === true && !orchestrator ? { research: true as const } : {}),
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    ...(typeof c.costTotalUsd === 'number' && Number.isFinite(c.costTotalUsd) ? { costTotalUsd: c.costTotalUsd } : {}),
    ...extras(c),
    ...(c.userTaskEvents !== undefined ? { userTaskEvents: readTaskEvents(c.userTaskEvents) } : {}),
    ...(c.userWaits === true ? { userWaits: true } : {}),
    ...(c.autoCompleted === true ? { autoCompleted: true } : {}),
    ...(num(c.rootReportAt) ? { rootReportAt: c.rootReportAt } : {}),
    ...(validHeldRoot(c.heldResult) ? { heldResult: c.heldResult } : {}),
    // the Orchestrator is never archived, whatever the file says
    ...(typeof c.closedAt === 'number' && Number.isFinite(c.closedAt) && !orchestrator ? { closedAt: c.closedAt, closedBy: c.closedBy === 'user' ? 'user' as const : 'auto' as const } : {}),
    ...(c.working === true && typeof c.closedAt !== 'number' ? { working: true as const } : {}),
    ...(readLastResult(c.lastResult) ? { lastResult: readLastResult(c.lastResult)! } : {}),
    ...(c.waitsOn === 'user' || c.waitsOn === 'colleagues' ? { waitsOn: c.waitsOn } : {}),
    ...(c.waitsOnWork === true ? { waitsOnWork: true as const } : {}),
    ...(readCreditWait(c.creditWait) ? { creditWait: readCreditWait(c.creditWait)! } : {}),
    ...(readCreditMoved(c.creditMoved) ? { creditMoved: readCreditMoved(c.creditMoved)! } : {}),
    ...(readUserModel(c.userModel) ? { userModel: readUserModel(c.userModel)! } : {}),
    ...(readPick(c.pick) ? { pick: readPick(c.pick)! } : {}),
    ...(c.unfinished === true ? { unfinished: true as const } : {}),
    ...(heldResults(c.heldResults) ? { heldResults: heldResults(c.heldResults)! } : {}),
  };
}

/** A chat of the in-app routine executor, retired with ADR 0179 and out of the app with ADR 0325: its record carries
 *  one of that executor's marks, in the shape that executor wrote (a malformed one was never a mark). The app keeps
 *  such records in chats.json and never loads them (ChatStore.load). */
const isRetired = (c: unknown): boolean => {
  const r = c as Record<string, unknown> | null;
  const step = r?.routine as { runId?: unknown; stepId?: unknown } | null | undefined;
  return !!r && typeof r === 'object' && (r.routineArchived === true || !!step && typeof step === 'object' && typeof step.runId === 'string' && typeof step.stepId === 'string'
    || typeof r.routinePackage === 'string' && /^[a-f0-9]{64}$/.test(r.routinePackage));
};

export class ChatStore {
  readonly file: string;
  constructor(userData: string) { this.file = path.join(userData, 'chats.json'); }

  /** The retired chats of the last load, as they were in the file: every write puts them back unchanged. */
  private retired: unknown[] = [];
  /** Their ids: the runs of a retired chat are never shown, delivered or ended (ChatManager). */
  retiredIds: ReadonlySet<string> = new Set();
  /** The last load found the file and could neither read nor copy it: no write may replace it (until a restart). */
  private unread = false;
  private body(chats: StoredChat[]): string { return `${JSON.stringify({ version: 2, chats: this.retired.length ? [...chats, ...this.retired] : chats })}\n`; }

  load(): StoredChat[] {
    cleanOrphanTmps(this.file);
    let text: string;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      // the file is there and was not read (a lock, a permission): what was not read is never written over
      const copy = `${this.file}.unread-${Date.now()}`;
      try { fs.copyFileSync(this.file, copy); } catch { this.unread = true; }
      log.error('chats', 'chats.json could not be read, starting empty', { cause: errText(e), hint: this.unread ? 'the file is left as it is and not written in this session: close what holds it, then restart' : `a copy is kept as ${copy}` });
      return [];
    }
    try {
      const data = JSON.parse(text) as { chats?: unknown };
      const rows: unknown[] = Array.isArray(data.chats) ? data.chats : [];
      // retired chats and every chat below one: set aside as they are, never loaded
      const idOf = (c: unknown, key: 'id' | 'parentId') => { const v = (c as Record<string, unknown> | null)?.[key]; return typeof v === 'string' ? v : null; };
      const retired = new Set(rows.filter(isRetired));
      const ids = new Set([...retired].map(c => idOf(c, 'id')).filter((id): id is string => !!id));
      for (let added = true; added;) {
        added = false;
        for (const c of rows) if (!retired.has(c) && ids.has(idOf(c, 'parentId') ?? '')) { retired.add(c); const id = idOf(c, 'id'); if (id) ids.add(id); added = true; }
      }
      this.retired = rows.filter(c => retired.has(c));
      this.retiredIds = ids;
      return rows.filter(c => !retired.has(c)).map(valid).filter((c): c is StoredChat => !!c);
    } catch (e) {
      const bad = `${this.file}.bad-${Date.now()}`;
      try { fs.renameSync(this.file, bad); } catch { /* keep it */ }
      log.error('chats', 'chats.json unreadable, starting empty', { cause: errText(e), hint: `the old file is kept as ${bad}; fix or delete it` });
      return [];
    }
  }

  /** the body last written: ChatManager saves from many places, often with nothing changed (no write then) */
  private last: string | null = null;
  /** bumped by every write started: a deferred write that sees a newer one drops itself (never lands an older body) */
  private gen = 0;
  /** deferred writes started and not settled: a sync save writes even an unchanged body while one is in flight */
  private inflight = 0;

  /** Synchronous (callers read the file right after; the quit flush), compact and skipped when nothing changed: it runs on the main
   *  process for every chat change. */
  save(chats: StoredChat[]): void {
    const t = performance.now();
    try { this.write(chats); } finally { slowStep('chats.json write', performance.now() - t); }
  }
  private write(chats: StoredChat[]): void {
    if (this.unread) return;
    const body = this.body(chats);
    // a deferred write in flight is superseded (gen): this body is written even when equal to the last one
    if (body === this.last && !this.inflight) return;
    this.gen++;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, body, 'utf8');
      renameWithRetry(tmp, this.file);
      this.last = body;
    } catch (e) {
      this.last = null;
      try { fs.writeFileSync(this.file, body, 'utf8'); this.last = body; } catch (e2) {
        log.error('chats', 'chats.json not saved', { cause: `${errText(e)} / ${errText(e2)}`, hint: 'check disk space and that userData is writable; chats will not survive a restart' });
      }
    }
  }

  /** The deferred save (ChatManager with writeDelayMs): serialized now, written asynchronously (tmp + rename, retries
   *  without blocking), skipped when nothing changed. A newer save, sync or deferred, supersedes it. Never throws: false
   *  = the write failed (the caller schedules a retry), true = written, unchanged or superseded. */
  async saveAsync(chats: StoredChat[]): Promise<boolean> {
    const t = performance.now();
    const body = this.body(chats);
    slowStep('chats.json serialize', performance.now() - t);
    if (this.unread) return true;
    if (body === this.last && !this.inflight) return true;
    const gen = ++this.gen;
    this.inflight++;
    try {
      // a sync save or checkpoint may have run during the await: only this write's own generation may set `last`
      if (await writeLocalTextAsync(this.file, body, () => this.gen === gen, { maxBytes: Infinity }) && this.gen === gen) this.last = body;
      return true;
    } catch (e) {
      if (this.gen === gen) this.last = null;
      log.warn('chats', 'chats.json not saved (deferred)', { cause: errText(e), hint: 'retried shortly; the quit writes it too' });
      return this.gen !== gen; // superseded: the newer write carries this state
    } finally { this.inflight--; }
  }

  /** Update boundary: throw on any failure, never fall back to a direct overwrite or claim a logged error is saved. */
  checkpoint(chats: StoredChat[]): void {
    const t = performance.now();
    // named in the stall log: a synchronous write + fsync + read-back at a user's click (answer, message, delivery)
    try { this.checkpointNow(chats); } finally { slowStep('chats.json checkpoint', performance.now() - t); }
  }
  private checkpointNow(chats: StoredChat[]): void {
    if (this.unread) throw new Error('Archivio chat non letto: aggiornamento fermato.');
    const body = this.body(chats);
    this.last = null;
    this.gen++;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try { const stat = fs.lstatSync(this.file); if (!stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink()) throw new Error('Archivio chat collegato: aggiornamento fermato.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, body, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      renameWithRetry(tmp, this.file);
      if (fs.readFileSync(this.file, 'utf8') !== body) throw new Error('Salvataggio chat non verificato.');
      this.last = body;
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ } }
  }
}
