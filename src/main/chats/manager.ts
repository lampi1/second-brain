// ChatManager = the ChatService of the app (src/main/services.ts): every chat the user runs inside the cockpit, on one of
// the engines of the registry (engines/registry.ts, ADR 0046; today Claude, embedded binary, and Cursor over ACP): it
// asks an engine's caps, never its name, and gets the session from engines/sessions.ts.
// It owns the chat records (summary, items capped at ~2000, open questions/permissions), starts one engine session per
// chat on demand, turns session reports into contract events (chat:updated, chat:item with replace for streaming,
// pending:added/resolved, chat:removed), persists the chats (store.ts) and restores them as 'closed' on start; the
// first message to a closed chat resumes it (Claude --resume after loading its past from the transcript, transcript.ts;
// Cursor session/load). A finished chat can be archived (closedAt: its process ends, the record and transcript stay,
// the palette lists it under "Chiuse", Ctrl+K) and reopened; a message to an archived chat reopens it. A turn cut by a quit or
// crash (persisted "working") resumes by itself on the next start (resumeInterrupted). An app Claude chat can be forked (a copy, never two writers on one transcript). There is
// one Orchestrator, created only by the user; one created with `replaces` takes that one's role (the old one goes on as a
// normal chat). Long chats:
// each chat carries its context size (Claude: get_context_usage; Cursor: an estimate); every Claude engine gets the
// compaction window (option compactWindowTokens, ADR 0031); continueChat ("Riprendi") opens a NEW chat from a hand-off
// note, linked to the old one (handoff.ts); a cold chat (idle, long, Claude) writes its note quietly while the cache is
// warm and a message after the cache expired goes on in a fresh session of the same chat (coldTick / coldSwitch, ADR
// 0031), counted with the other context numbers (context-stats.ts, contextStats()). Brain hooks
// (options onRateLimit, onTurnEnd, onWaiting, onDone; method isOwnSession) let wiring.ts feed the brain
// without this module knowing it. Wired in src/main/wiring.ts.
import { timersFor } from '../timers';
const { setInterval, clearInterval, clearTimeout } = timersFor('chats/manager');
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Answer, ChatCommand, ChatItem, ChatSummary, CliStatus, ContextStats, CursorReasoning, Effort, HandoffInfo, Harness, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import { sysEn, type SysCode, type SysParams } from '../../shared/sys';
import { checkImages } from './images';
import type { Emitter } from '../ipc';
import { errText, log } from '../log';
import type { ChatService } from '../services';
import { cliVersion, killTrees, killTreesWithin, resolveClaude } from './cli';
import { reapAfterQuit, reapEnabled, reapEngine, snapshotTrees } from './proctree';
import { jobGuard } from './jobguard';
import { AFTER_CALLS, CACHE_TTL_MS, coldArmed, coldRoute, continuityStep, type ColdView, ORCHESTRATOR_COMPACT, romeDay } from './continuity';
import { autoHandoff, coldPrompt, continuePrompt, extractHandoff, HANDOFF_END, HANDOFF_START, handoffRequest, HandoffStore, nextTitle } from './handoff';
import { ContextCounters } from './context-stats';

/** The app's own message to a chat whose turn a restart cut (resumeInterrupted). */
export const RESUME_TEXT = "[second-brain] L'app è stata riavviata mentre lavoravi e il tuo turno si è interrotto. Riprendi da dove eri: prima rileggi lo stato (file, worktree, comandi che avevi lanciato), poi continua.";
import { cut, isUuid, nextId, type HarnessSession, type SessionOptions, type SessionPatch, type SessionSink } from './session';
import { ChatStore, type PastSession, type StoredChat } from './store';
import { updateActivity } from '../update/activity';
import { BufferedSink, WarmPool, type WarmEngine } from './warm';
import { AdmissionQueue, type AdmissionLimits, type LoadSampler } from './admission';
import { AgentMayNotWake } from '../engines/policy';
import { isAppChat } from '../brain/routing';
import { engineOf, engineOrThrow } from '../engines/registry';
import { sessionFor } from '../engines/sessions';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { waitsForPeople, waitsForWork } from '../../shared/waiting';
import { claudeHome, findTranscript, readHistory } from './transcript';
import { orchestratorOwner, plainOwner, type ResolvedRole } from '../agents/catalog';
import { aboveCeiling, belowParent, browserAccess, claudeDefaultMode, commandsReadOnly, narrowest, readOnlyCommand, within, type AgentPolicy, type BrowserAccess } from '../agents/tool-policy';
import { type AgentOwnerSnapshot, type AgentRun, type AgentRunEnd, type AgentRunOutcome, type AgentRunTags } from '../../shared/agents';
import { AgentRunStore, addSkill, addTurn, APP_MAX, endRun, REPO_MAX, reopenRun, SKILL_ID, SKILLS_MAX, staleDue, tagName, type RunLinks } from '../agents/runs';
import { reportOf } from '../agents/run-report';
import { gateRequest } from '../agents/role-gate';
import { APP_CHAT_TOOLS } from './app-tool-approval';
import { resultMessage, type DelegationLimitHit, type DelegationResult } from '../../shared/delegation';
import { aiErrorRuns, runMetrics } from '../agents/run-metrics';
import { isCorrection } from '../../shared/correction';
import { AgentChildrenReducer } from './agent-children';
import { autoCloseNow, type AutoCloseCandidate } from './auto-close';
import type { AutoCloseWaiting } from '../../shared/auto-close';
import { effortValue, initialEffort, selectEffort, submitEffort } from './effort';
import { AgentAnalyticsCollector } from '../agents/collector';

import { orchestratorRole, roleFrame } from '../agents/orchestrator-role';
import { slug as slugTitle } from './mail';
import { recallWarning, type Recall } from '../search/hybrid/recall';

export interface ChatManagerOptions {
  /** the roles in a few lines, for the Orchestrator's first message of a session (agents/discovery.ts roleCatalogBrief) */
  roleCatalogBrief?: () => string;
  /** the role a new chat runs (catalog.resolve), with the plugin of its launch (only the skills it was given) */
  resolveAgent?: (req: NewChat) => ResolvedRole & { assets?: { pluginDir: string; skillRoot: string } };
  onAutoCloseActivity?: (chatId: string) => void;
  emitter: Pick<Emitter, 'emit'>;
  userData: string;
  /** per engine, its command override (a .mjs fake for tests); absent = the installed one (cli.ts) */
  enginePaths?: Partial<Record<Harness, string>>;
  /** may a chat start on this engine now (the user's engineOn.* switches); absent = every engine may */
  engineOn?: (h: Harness) => boolean;
  /** may an agent's message wake a stopped chat on this engine («Gli Orchestrator possono usare X», engines/policy.ts) */
  agentsMayOpen?: (h: Harness) => boolean;
  /** the user's API key for this engine (engines/service.ts keyFor), read only when its process or request starts */
  keyFor?: (h: Harness) => string | null;
  /** app version, for the engines' clientInfo */
  appVersion?: string;
  /** per-chat MCP endpoint of the app (browser tools); null/undefined = none passed */
  mcpUrlFor?: ((chatId: string) => string | null) | null;
  /** the app-control MCP for the Orchestrator only: its own /mcp/app/o/<id>/<token> */
  appMcpUrl?: ((orchestratorId: string) => string | null) | null;
  /** where Claude Code keeps transcripts (default ~/.claude or CLAUDE_CONFIG_DIR) */
  claudeHome?: string;
  maxItems?: number;
  env?: NodeJS.ProcessEnv;
  /** Past-error context for engines without Claude's prompt hook; bounded to 300 ms before delivery. */
  recall?: (text: string) => Promise<Recall>;
  extraArgs?: string[];
  /** keep one Claude engine started ahead for the next new chat in the same folder (warm.ts); default off */
  prewarm?: boolean;
  /** ms after a new Claude chat (or the app's start) before the next waiting engine starts (default 5 s / 20 s) */
  prewarmDelayMs?: number;
  /** the CPU-aware queue (ADR 0036): agents' starts and turns wait while the machine is busy; absent = never wait */
  admission?: { sampler: LoadSampler; limits: () => AdmissionLimits; tickMs?: number; autoTick?: boolean };
  /** custom session factory (tests, future engines) */
  sessionFactory?: (harness: Harness, opts: SessionOptions, sink: SessionSink) => HarnessSession;

  // ---- hooks for the brain (wiring.ts connects them; a throwing hook is logged, never breaks a chat) ----
  /** every stream-json `rate_limit_event` and every get_usage answer (→ BrainService.ingestRateLimits) */
  onRateLimit?: (msg: unknown) => void;
  /** the models a CLI session offers (→ BrainService.recordModels, for the Settings page) */
  onModels?: (harness: Harness, list: { id: string; name: string }[]) => void;
  /** a turn ended (→ the job ledger: real cost and time) */
  onTurnEnd?: (info: TurnEndInfo) => void;
  /** Once per actual run end (not per turn): the improvement loop evaluates the role's trial again. */
  onRunEnded?: (run: AgentRun) => void;
  /** The user's verdict landed on a run (run:outcome), also on one that had already ended: its trial is evaluated again. */
  onRunOutcome?: (run: AgentRun) => void;
  /** a question or permission opened in an app chat (→ feed "chat waiting") */
  onWaiting?: (chatId: string, pending: PendingRequest) => void;
  /** a turn ended with nothing pending: the chat is idle again (→ feed "chat done") */
  onDone?: (chatId: string) => void;
  /** the CLI died in the middle of a turn, with an error and no result (→ feed "chat finita con errore") */
  onCrash?: (chatId: string, error: string) => void;
  /** the user's reasoning and fast for every ACP chat, read at each session start (settings orchestratorChats.*) */
  acpModelConfig?: () => { reasoning: CursorReasoning | ''; fast: boolean } | null;
  /** min ms between two get_usage asks after turns (default 60 s) */
  usageEveryMs?: number;

  // ---- long chats (settings compactWindowTokens / contextHandoff / coldHandoffMin; the brain's mem.mjs) ----
  /** the auto-compact window of every Claude engine, read at each start (0 = the user's Claude settings decide) */
  compactWindowTokens?: () => number;
  /** the invisible continuation of cold chats (ADR 0031; default off here, wiring reads the setting) */
  coldHandoff?: () => boolean;
  /** «Orchestrators corte» (ADR 0051): an Orchestrator with a context from an earlier day compacts it once on a new day (default off
   *  here, wiring reads the setting orchestratorDayCompact) */
  orchestratorDayCompact?: () => boolean;
  /** ms after the last call before an idle long chat writes its cold note (default 50 min) */
  coldIdleMs?: () => number;
  /** how long the prompt cache lives after its last use (default 55 min; tests shorten it) */
  cacheTtlMs?: number;
  /** ms between two checks of the cold chats (default 60 s; 0 = no timer, tests call coldTick) */
  coldEveryMs?: number;
  /** ms between two checks for stale agent runs (default 10 min; 0 = no timer, tests call staleRuns) */
  runEveryMs?: number;
  /** absolute path of the brain's mem.mjs, when it has one: the hand-off request asks to update the now.md line too */
  memTool?: () => string | null;
  /** how long a chat may take to write its hand-off before the app builds one itself (default 5 min) */
  handoffTimeoutMs?: number;
}

export interface HandoffOptions {
  reason?: 'manual' | 'threshold' | 'finished' | 'continue' | 'cold';
  /** false = never start a stopped engine for it (an agent asking about a Cursor chat): a token-free note instead */
  allowStart?: boolean;
  /** false = never ask the chat, even a running one: always the token-free note (the automatic closing of finished
   *  chats, owner 2026-10-11: no turn and no tokens at close) */
  ask?: boolean;
}

export interface TurnEndInfo {
  chatId: string;
  sessionId: string | null;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  /** only on the first turn of the job (the brain stores its length and kind, never the text) */
  firstPrompt?: string;
  costUsd: number;
  durationMs: number;
  turns: number;
  isError: boolean;
  /** the assistant's texts of this turn, joined (reply rules: chats/reply-rules.ts) */
  reply?: string;
}

/** The assistant's texts since the last user message (the turn that just ended), joined. */
export function turnReply(items: readonly ChatItem[]): string {
  const out: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant') out.unshift(it.text);
  }
  return out.join('\n\n');
}

/** Work still runs behind an idle prompt: background tasks the engine counts, or a final answer that says it waits
 *  for them (the engine's count missed a resumed agent on 2026-10-16). Such a chat is never closed nor released. */
export const workBehind = (s: Pick<ChatSummary, 'background' | 'waitsOnWork' | 'work'>): boolean => (s.background ?? 0) > 0 || !!s.waitsOnWork || !!s.work && s.work.status !== 'completed';

/** The scheduler's reason for each waiting kind (Italian, as its other reasons; the tile shows its own label). */
export const WAITING_REASON: Record<AutoCloseWaiting, string> = {
  answer: 'In attesa di una tua risposta', permission: 'In attesa di un tuo permesso', command: 'In attesa di un tuo comando',
  user: 'In attesa dell’utente', colleagues: 'In attesa dei colleghi', work: 'In attesa del lavoro in corso',
  report: 'In attesa del report finale', mail: 'In attesa di posta', browser: 'In attesa di te nel browser',
};

/** The final answer of the turn that just ended ('' when it wrote none). */
export function lastAnswer(items: readonly ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') break;
    if (it.kind === 'assistant' && it.text.trim()) return it.text;
  }
  return '';
}

interface Rec {
  s: ChatSummary;
  createdAt: number;
  /** its latest report to its Orchestrator (send_to_chat, or a run-report block): a clean idle after it completes the
   *  assignment (#86, ADR 0084); never persisted */
  report?: { text: string; at: number; blocked?: boolean };
  /** the app completed its assignment from that report: a new message from its Orchestrator assigns it again */
  autoCompleted?: boolean;
  agentInstructions?: string;
  agentAssets?: { pluginDir: string; skillRoot: string };
  /** the skills its launch gave it (role defaults, linked and the launch's own): the role gate allows only these */
  skills?: string[];
  /** the agent's tool policy and permission ceiling, frozen at start like its instructions (A2) */
  policy?: AgentPolicy | null;
  /** the agent's "Contesto massimo" (tokens): the compaction window of its engine instead of the user's setting (#80) */
  maxContext?: number;
  agentPrimed?: boolean;
  children?: AgentChildrenReducer;
  deliveryHolds?: number;
  activityRevision?: number;
  autoActivityAt?: number;
  autoClosing?: boolean;
  autoEnding?: boolean;
  /** last start or message: an idle engine is released this long after it (releaseIdle) */
  activeAt?: number;
  /** its engine is ending because it sat idle: the chat stays 'idle', the next message waits for it, then resumes */
  releasing?: Promise<void> | undefined;
  /** permissionMode null = no choice: the CLI follows the user's settings.json (ADR 0002) */
  choice: { model: string | null; effort: Effort | null; permissionMode: PermissionMode | null };
  forkFrom?: string;
  worktree: boolean;
  /** the chat was created with "Worktree separato": its work is in a worktree the CLI made, not in cwd */
  inWorktree?: boolean;
  costTotalUsd: number;
  items: ChatItem[];
  pending: Map<string, PendingRequest>;
  session: HarnessSession | null;
  /** the "/" commands its engine reported (in memory: a new engine reports them again) */
  commands?: ChatCommand[];
  /** engines ended while the chat went on (model or Orchestrator change, continued): their tools are reaped at the real close */
  kept?: HarnessSession[];
  historyLoaded: boolean;
  /** a job not started yet (a chat created in this run): its first send gets the first prompt */
  jobNew: boolean;
  firstPrompt: string | null;
  /** a turn ran since the last onDone */
  turnSinceDone: boolean;
  /** a resumed session still opening (sends wait for it) */
  opening?: Promise<void> | undefined;
  /** an archive closing the session (a send waits for it, then reopens the chat on a new session) */
  archiving?: Promise<void> | undefined;
  /** a turn is running (persisted): set when the CLI reports running/waiting, cleared by its result, a CLI exit
   *  while the app runs, or an archive; still set after a quit or crash = resume it on the next start */
  working?: boolean;
  /** close the session when this turn ends, so the next message reopens it (Cursor: the new --model; a former Orchestrator:
   *  without the app-control tools) */
  reopen?: boolean;
  /** the end of the last real turn (not a hand-off turn): a hand-off older than this is stale */
  lastTurnAt: number;
  /** a hand-off turn in flight: the assistant texts it produced, and who waits for them; quiet = a cold note (ADR
   *  0031): its items stay out of the tile */
  handoffTurn?: { texts: Map<string, string>; done: (text: string | null) => void; quiet?: boolean } | undefined;
  /** the saved hand-off is a cold note written at this time (persisted): a message after the cache expired goes on
   *  in a fresh session from it */
  coldNoteAt?: number | undefined;
  /** the lastTurnAt the cold note was asked for (once per idle stretch, even when it failed) */
  coldAskedFor?: number | undefined;
  /** when the context in force began: the first real turn since the session start or the last compaction (persisted) */
  ctxSince?: number | undefined;
  /** the Rome day an Orchestrator was last asked for its day compaction (once a day, even when it failed) */
  dayCompactOn?: string | undefined;
  /** the sessions before its cold continuations, oldest first (persisted; their transcripts show folded above) */
  pastSessions?: PastSession[];
  /** a cold continuation switching sessions: a second message waits for it */
  switching?: Promise<ColdStep | null> | undefined;
  /** archived by the auto-close while it waited for its cold note: its engine ends once the note is written */
  closeAfterCold?: boolean;
  /** the next API calls count as "after" a continuation or a compaction (ADR 0031 counters) */
  after?: { kind: 'continuation' | 'compaction'; left: number } | undefined;
  /** the last hand-off turn ended in an error or was stopped by the user: a "Riprendi" waiting on it is cancelled */
  handoffStopped?: boolean;
  /** request ids its agent run already counted (a request the engine reports again is one request) */
  runSeen?: Set<string>;
  /** the last time nothing waited on the user any more: a run's stale clock pauses while a request is open */
  idleSince?: number;
  /** open "Comando da eseguire" requests (run/asks.ts keeps them, not r.pending): they pause the stale clock too */
  commandsOpen?: Set<string>;
  /** since when the chat runs a turn of its open agent run (its execution time; not persisted: a quit cuts the turn) */
  runningSince?: number;
  /** when the current turn started running: a run ended during it (completed by its Orchestrator) still takes its report */
  turnAt?: number;
  /** its run (this id) was pruned into the rollups: counted there only (the mirror stays in chats.json) */
  runPruned?: string;
}

/** A cold switch in flight (coldSwitch → ensureSession → coldDone / coldUndo): the note, the old session, what to restore. */
interface ColdStep {
  h: HandoffInfo; old: string | null; at: number; idleMin: number; notePath: string;
  prev: { forkFrom: Rec['forkFrom']; costTotalUsd: Rec['costTotalUsd']; contextTokens: number | undefined; contextMaxTokens: number | undefined; coldNoteAt: number | undefined; after: Rec['after'] };
}

/** The divider of a cold continuation (ADR 0031): the same id live and when the history is read again. */
const coldDivider = (fromSession: string, at: number, notePath: string): ChatItem => ({
  kind: 'system', id: `cont-${fromSession}`, at, level: 'info', continued: { notePath, ...(isUuid(fromSession) ? { session: fromSession } : {}) },
  text: sysEn('coldContinued'), code: 'coldContinued',
});

/** A system ChatItem from a code + params (sys.ts): text is the English rendering, for agents, logs and old items. */
function sysItem<C extends SysCode>(code: C, params: SysParams | undefined, level: 'info' | 'warn' | 'error'): ChatItem {
  return { kind: 'system', id: nextId('s'), at: Date.now(), text: sysEn(code, params), level, code, params };
}

const MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'];
/** archived chats kept (the oldest beyond this leave the app; their transcripts stay where the CLI keeps them) */
const MAX_ARCHIVED = 60;
/** A saved chat's owner: its snapshot, else a plain chat's (the Orchestrator always shows the Orchestrator's face). */
export function restoredOwner(c: Pick<StoredChat, 'agent' | 'harness' | 'model' | 'isOrchestrator'>): AgentOwnerSnapshot {
  const owner = c.agent ?? plainOwner(c.harness, c.model);
  return c.isOrchestrator && owner.id !== 'orchestrator' ? orchestratorOwner(c.harness, c.model) : owner;
}
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** A model id as the CLIs take it; never starting with '-', which an ACP CLI would read as one of its flags. */
const MODEL_ID = /^[\w.:@/[\]][\w.:@/=[\],-]{0,119}$/;

/** The run tags a new chat asks for (AGENTS-DESIGN §4.8): refused before anything starts when out of shape. */
export function startTags(req: Pick<NewChat, 'skills' | 'app'>): Omit<AgentRunTags, 'repo'> {
  if (req.skills !== undefined && (!Array.isArray(req.skills) || req.skills.some(s => typeof s !== 'string' || !SKILL_ID.test(s)))) throw new Error('Skill non valide: usa id minuscoli (lettere, cifre, - e _) fino a 80 caratteri.');
  const skills = [...new Set(req.skills ?? [])];
  if (skills.length > SKILLS_MAX) throw new Error(`Al massimo ${SKILLS_MAX} skill per chat.`);
  const app = typeof req.app === 'string' ? req.app.trim() : req.app;
  if (app !== undefined && app !== '' && !tagName(app, APP_MAX)) throw new Error(`App non valida: una riga fino a ${APP_MAX} caratteri.`);
  return { skills, app: app || null };
}
/** git top-level folder names per cwd: found by walking up to a `.git` entry (no git process), cached for the session. */
const repoCache = new Map<string, string | null>();
export function repoOf(cwd: string): string | null {
  const key = path.resolve(cwd);
  const known = repoCache.get(key);
  if (known !== undefined) return known;
  let found: string | null = null;
  for (let dir = key; ;) {
    try { if (fs.existsSync(path.join(dir, '.git'))) { const name = path.basename(dir); found = tagName(name, REPO_MAX) ? name : null; break; } } catch { break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (repoCache.size >= 256) repoCache.delete(repoCache.keys().next().value!);
  repoCache.set(key, found);
  return found;
}

export class ChatManager implements ChatService {
  readonly analytics: AgentAnalyticsCollector;
  /** agent-runs.json: the runs of chats started from catalog agents (AGENTS-DESIGN §1.2, §5) */
  readonly runs: AgentRunStore;
  private runTimer: NodeJS.Timeout | null = null;
  private chats = new Map<string, Rec>();
  private deliveries = new Map<string, Promise<void>>();
  /** "Riprendi" in flight per old chat: a double click or two agents get the same new chat, never two. */
  private continuing = new Map<string, Promise<ChatSummary>>();
  private store: ChatStore;
  private handoffs: HandoffStore;
  private home: string;
  private max: number;
  private version: string | null = null;
  private probing = false;
  private killedPids = new Set<number>();
  private quitting = false; // shutdown started: a CLI exit now is the quit's, its cut turn resumes on the next start
  private coalesce = new Map<string, { items: Map<string, ChatItem>; timer: NodeJS.Timeout }>();
  private lastUsageAt = 0;
  private usageTimer: NodeJS.Timeout | null = null;
  private lastUsageChat: string | null = null;
  private coldTimer: NodeJS.Timeout | null = null;
  private readonly counters: ContextCounters;
  private readonly onExit = (): void => { this.killAll(true); };
  /** the CPU queue (ADR 0036); null = not wired: everything runs at once */
  private readonly admission: AdmissionQueue | null;
  // no engine is started ahead while the machine is busy or chats wait in the CPU queue (ADR 0036)
  private readonly warm = new WarmPool({ spawn: cwd => this.spawnWarm(cwd), enabled: () => !!this.opts.prewarm && !this.quitting && !updateActivity.frozen && !this.admission?.busy() && this.opts.engineOn?.('claude') !== false });

  constructor(private readonly opts: ChatManagerOptions) {
    this.analytics = new AgentAnalyticsCollector(opts.userData);
    this.runs = new AgentRunStore(opts.userData);
    if (this.runs.problem) log.warn('chats', 'agent runs file unreadable', { cause: this.runs.problem, hint: 'move agent-runs.json aside to record runs again' });
    // a pruned run lives on in the rollups only: a chat mirror of it would be adopted back and counted twice
    this.runs.onPrune = ids => {
      let any = false;
      for (const r of this.chats.values()) if (r.s.run && ids.has(r.s.run.runId)) { r.runPruned = r.s.run.runId; delete r.s.run; delete r.runningSince; any = true; this.updated(r); }
      if (any) this.persist();
    };
    this.store = new ChatStore(opts.userData);
    this.admission = opts.admission ? new AdmissionQueue({ ...opts.admission, onChange: () => this.refreshQueued() }) : null;
    this.handoffs = new HandoffStore(opts.userData);
    this.counters = new ContextCounters(opts.userData);
    this.home = opts.claudeHome ?? claudeHome();
    this.max = opts.maxItems ?? 2000;
    const stored = this.store.load();
    for (const c of stored) this.chats.set(c.id, this.restore(c));
    if (stored.some(c => !c.agent)) this.persist();
    process.on('exit', this.onExit); // Windows keeps orphaned children alive: kill them when the app dies
    // the plan windows stay fresh in the top bar even while a long turn runs (get_usage spends no model call)
    if (opts.onRateLimit) { this.usageTimer = setInterval(() => this.askUsage(), opts.usageEveryMs ?? 60000); this.usageTimer.unref?.(); }
    if ((opts.coldEveryMs ?? 60_000) > 0) { this.coldTimer = setInterval(() => this.coldTick(), opts.coldEveryMs ?? 60_000); this.coldTimer.unref?.(); }
    if ((opts.runEveryMs ?? 600_000) > 0) { this.runTimer = setInterval(() => this.staleRuns(), opts.runEveryMs ?? 600_000); this.runTimer.unref?.(); }
    if (opts.prewarm) {
      const last = [...this.chats.values()].filter(r => !!engineOf(r.s.harness)?.caps.warm && r.s.origin === 'app' && !r.s.isOrchestrator).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last && fs.existsSync(last.s.cwd)) this.warm.schedule(last.s.cwd, opts.prewarmDelayMs ?? 20000);
    }
    const claude = resolveClaude(opts.enginePaths?.claude ?? null);
    log.info('chats', 'manager ready', { data: { restored: this.chats.size, claude: claude ? `${claude.source}: ${claude.path}` : 'not found', overrides: opts.enginePaths ?? null } });
  }

  // ---- ChatService ----

  list(): ChatSummary[] {
    return [...this.chats.values()].sort((a, b) => a.createdAt - b.createdAt).map(r => ({ ...r.s }));
  }

  items(chatId: string): ChatItem[] {
    const r = this.chats.get(chatId);
    if (!r) return [];
    this.ensureHistory(r);
    return r.items.slice();
  }

  /** The commands its engine reported, null when it has not reported any yet (the caller falls back to the disk). */
  commands(chatId: string): ChatCommand[] | null {
    return this.chats.get(chatId)?.commands ?? null;
  }

  /** The tool policy and ceiling this chat runs with (null = none: the engine's own gates); agent_start_subagent bounds a child by it. */
  agentPolicy(chatId: string): AgentPolicy | null { const p = this.chats.get(chatId)?.policy; return p ? structuredClone(p) : null; }
  pending(): PendingRequest[] {
    return [...this.chats.values()].flatMap(r => [...r.pending.values()]).sort((a, b) => a.at - b.at);
  }

  /** links = the run links an Orchestrator tool sets (A7): refused before anything starts when one names an unknown run. */
  async create(req: NewChat, by: 'user' | 'agent' = 'user', inherited?: { owner: AgentOwnerSnapshot; instructions: string; policy?: AgentPolicy | null; assets?: { pluginDir: string; skillRoot: string }; maxContext?: number }, links: RunLinks = {}): Promise<ChatSummary> {
    updateActivity.assertOpen();
    links = { ...links, ...(req.parentRunId !== undefined ? { parentRunId: req.parentRunId } : {}), ...(req.reviewOf !== undefined ? { reviewOf: req.reviewOf } : {}), ...(req.reworkOf !== undefined ? { reworkOf: req.reworkOf } : {}) };
    if (req.goal !== undefined && (typeof req.goal !== 'string' || !req.goal.trim() || req.goal.length > 2000)) throw new Error('Run goal must contain 1 to 2000 characters.');
    if (Object.values(links).some(v => v !== undefined)) this.runs.checkLinks(links);
    const asked = startTags(req);
    if (req.orchestrator) {
      if (by !== 'user') throw new Error('Only the user can create the Orchestrator.');
      const current = this.list().find(c => c.isOrchestrator && !c.closedAt);
      // one Orchestrator: only a replacement of the current one (Cambia motore, Ricomincia) creates another
      if (current && req.replaces !== current.id) return current;
      req = { ...req, orchestrator: true, title: ORCHESTRATOR_TITLE };
    }
    const agent: Pick<ResolvedRole, 'request' | 'owner' | 'instructions' | 'policy' | 'maxContext' | 'tier'> & { skills?: string[]; assets?: { pluginDir: string; skillRoot: string } } = inherited ? { ...inherited, policy: inherited.policy ?? null, request: req }
      : this.opts.resolveAgent?.(req) ?? { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null };
    req = agent.request;
    // a delegated chat (agent_delegate): only an agent's, under a live parent, in the parent's folder, linked to its run
    const delegator = req.parentId !== undefined ? this.delegator(req, by) : undefined;
    if (delegator?.s.run) links = { ...links, parentRunId: delegator.s.run.runId };
    // never wider than the chat it comes from: a fork of its session, the Orchestrator it renews, the chat that opens it
    const forkSrc = req.resumeSessionId?.trim() ? [...this.chats.values()].find(r => r.s.sessionId === req.resumeSessionId?.trim()) : undefined;
    const parent = delegator ?? forkSrc ?? (req.replaces ? this.chats.get(req.replaces) : undefined) ?? (by === 'agent' ? [...this.chats.values()].find(r => r.s.isOrchestrator && !r.s.closedAt) : undefined);
    // a delegated chat: its role's policy, below its parent's, narrowed again by the contract's tool classes
    const policy = delegator ? narrowest(belowParent(agent.policy, delegator.policy, this.modeFor(delegator)), req.delegation?.tools ? { tools: { allow: req.delegation.tools }, ceiling: null } : null)
      : narrowest(agent.policy, parent?.policy);
    // an explicit mode above the agent's ceiling runs at the ceiling (the chat shows the mode it really has)
    if (policy && req.permissionMode && aboveCeiling(req.permissionMode, policy.ceiling)) req = { ...req, permissionMode: policy.ceiling! };
    const engine = engineOrThrow(req.harness);
    this.needOn(engine.id);
    const caps = engine.caps;
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Cartella non valida: ${cwd || '(vuota)'}`);
    if (req.permissionMode && !MODES.includes(req.permissionMode)) throw new Error(`Modalità permessi non valida: ${req.permissionMode}`);
    if (req.effort && !EFFORTS.includes(req.effort)) throw new Error(`Effort non valido: ${req.effort}`);
    if (!caps.effort && req.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
    if (req.model !== undefined && !MODEL_ID.test(req.model)) throw new Error(`Modello non valido: ${req.model}`);
    // only a copy of one of the app's own Claude chats (ADR 0010: no sessions from other apps; never two writers)
    const forkOf = req.resumeSessionId?.trim() || null;
    if (forkOf) {
      const src = [...this.chats.values()].find(r => r.s.sessionId === forkOf);
      if (!req.fork || !caps.fork || !isUuid(forkOf) || !src || src.s.harness !== req.harness) throw new Error('Si può solo duplicare (fork) una chat dell’app, sullo stesso motore, se il motore lo permette.');
    }

    // a plain new Claude chat adopts the engine already waiting in its folder (warm.ts): no 10-25 s start-up
    const warm = caps.warm && !forkOf && !req.worktree && !req.orchestrator && req.permissionMode !== 'bypassPermissions'
      // warm engines are spawned with no tool limits: an agent with a policy always gets its own process
      && !policy
      // nor one with its own "Contesto massimo": the window is fixed when the engine starts (#80)
      && !agent.maxContext
      ? this.warm.take(cwd) : null;
    const id = warm?.chatId ?? `c_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    // `replaces`: the new Orchestrator takes the role, the old one goes on as a normal chat (history kept, never deleted)
    const old = req.orchestrator && req.replaces ? this.chats.get(req.replaces) : undefined;
    if (req.orchestrator && req.replaces && !old?.s.isOrchestrator) throw new Error('L’Orchestrator da sostituire non c’è più.');
    const title = req.title?.trim() || (req.prompt?.trim() ? cut(req.prompt, 50) : forkOf ? 'Fork' : 'Nuova chat');
    // an agent's chat with a prompt starts with its first message, through the CPU queue (ADR 0036); a warm engine is
    // already running: adopting it is no new start (its first turn still asks the queue)
    const prompt = req.prompt?.trim() ? req.prompt : null;
    const viaQueue = by === 'agent' && !!prompt && !!this.admission;
    const r: Rec = {
      s: {
        agent: agent.owner,
        ...(by === 'agent' ? {work:{status:'assigned' as const,updatedAt:now}} : {}),
        effortStatus: initialEffort(caps.effort, req.effort ?? null),
        id, harness: req.harness, origin: 'app', title, cwd, sessionId: forkOf || !caps.transcript ? null : warm?.sessionId ?? crypto.randomUUID(),
        model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null,
        // a chat that goes through the queue has started nothing yet: 'starting' only with an engine on its way (a queued
        // chat that went starting → idle read as a finished turn: the Orchestrator was told "ha finito il turno", 2026-10-14)
        state: viaQueue && !warm ? 'idle' : 'starting', costUsd: 0, pending: 0, isOrchestrator: !!req.orchestrator, lastText: '', updatedAt: now, browserTabIds: [],
        ...(caps.cost ? {} : { costKnown: false as const }),
        ...(req.route ? { route: req.route } : {}),
        ...(delegator ? { parentId: delegator.s.id, ...(req.delegation ? { delegation: req.delegation } : {}) } : {}),
      },
      createdAt: now,
      agentInstructions: agent.instructions,
      ...(agent.assets ? { agentAssets: agent.assets } : {}),
      ...(agent.assets && agent.skills ? { skills: agent.skills } : {}),
      ...(policy ? { policy } : {}),
      ...(agent.maxContext ? { maxContext: agent.maxContext } : {}),
      choice: { model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null },
      ...(forkOf ? { forkFrom: forkOf } : {}),
      worktree: !!req.worktree && caps.worktree,
      ...(req.worktree && caps.worktree ? { inWorktree: true } : {}),
      costTotalUsd: 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: true, firstPrompt: null, turnSinceDone: false, lastTurnAt: 0,
    };
    if (agent.owner.source === 'catalog' && !req.orchestrator) this.startRun(r, { agentId: agent.owner.id, version: agent.owner.version ?? 1, goal: req.goal ?? prompt ?? title, startedBy: delegator ? 'parent' : by === 'agent' ? 'orchestrator' : 'user', costKnown: caps.cost, ...links,
      tags: { ...asked, repo: repoOf(cwd) }, ...(agent.tier ? { tier: agent.tier } : {}), model: req.model ?? null });
    this.chats.set(id, r);
    if (old) {
      this.demoteOrchestrator(old);
      // two chats titled "Orchestrator" would make its mailbox ambiguous (mail.ts liveChats): the old one gives the name up
      if (slugTitle(old.s.title) === slugTitle(title)) old.s.title = `Orchestrator precedente · ${old.s.id.slice(2)}`;
    }
    this.ensureHistory(r); // a fork shows the past it starts from
    this.persist();
    log.info('chats', 'chat created', { chat: id, data: { harness: req.harness, cwd, fork: !!forkOf, model: r.choice.model, permissionMode: r.choice.permissionMode, orchestrator: r.s.isOrchestrator, warm: !!warm } });
    this.updated(r);
    if (warm) this.adoptWarm(r, warm); else if (!viaQueue) this.startSession(r);
    if (caps.warm) this.warm.schedule(cwd, this.opts.prewarmDelayMs ?? 5000);
    // the chat exists from here on: a failed first send shows as state 'error' + lastError, not as a lost chat
    if (prompt) {
      // a delegated chat's contract says who sent it (the parent's title), like mail between chats
      const from = delegator?.s.title;
      try { await (viaQueue ? this.gate(r, () => this.deliver(id, prompt, undefined, false, from)) : this.send(id, prompt, undefined, false, from)); } catch (e) {
        if (!r.s.lastError) r.s.lastError = errText(e);
        this.updated(r);
      }
    }
    return { ...r.s };
  }

  /** The live chat a delegated chat starts under (agent_delegate): it exists, is open and is not the Orchestrator (the
   *  Orchestrator opens root chats with app_create_chat), and the child's folder lies inside the parent's. */
  private delegator(req: NewChat, by: 'user' | 'agent'): Rec {
    const parent = req.parentId ? this.chats.get(req.parentId) : undefined;
    if (by !== 'agent' || !parent || parent.s.closedAt || parent.s.isOrchestrator) throw new Error('Delega rifiutata: la chat che delega non è una chat di lavoro aperta.');
    if (!within(parent.s.cwd, typeof req.cwd === 'string' ? req.cwd.trim() : '')) throw new Error(`Delega rifiutata: la cartella deve stare dentro quella del genitore (${parent.s.cwd}).`);
    return parent;
  }

  /** A message, optionally with images (pasted screenshots; checked here: images.ts). Text may be empty with images.
   *  resumed = the app's own "riprendi" after a restart (keeps the tile's mark; any other message clears it);
   *  from = not the user's: the sender shown above the bubble (another chat's title, the Orchestrator);
   *  liveOnly = mail (chats/mail.ts): never into a chat that has no engine or is closing, never reopens one */
  async send(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    this.autoActivity(r);
    this.needAgentMay(r, from);
    this.reassignOnOrchestrator(r, from);
    if (!this.admission) return this.deliver(chatId, text, images, resumed, from, liveOnly);
    // the user's own message never waits (ADR 0036): what waited for this chat goes first, now, then this one
    if (!resumed && from === undefined) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly);
    }
    // an agent's message (another chat, the Orchestrator, the app's own resume): checked now
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    // a message between chats (mail, app_send_to_chat) to a chat still open never waits for the load either (the owner,
    // 16/10 "Tutte subito", ADR 0064: mail kept unread while the CPU was over lost the race to every new sample, for
    // hours, and reached the chat only when the user wrote): what waited for this chat goes first, then this one
    if (!resumed && !r.s.closedAt) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly);
    }
    // the app's own resume, or an agent reopening a closed chat (a new engine): it may wait for the load
    if (r.s.closedAt && !r.archiving) this.unarchive(r); // back on the grid now: its tile shows that it waits
    return this.gate(r, () => this.deliver(chatId, text, images, resumed, from, liveOnly));
  }

  /** a turn runs in a live engine: a message joins it (a chat cut by a restart has working set but no engine) */
  private midTurn(r: Rec): boolean {
    return !!r.session && (r.working === true || r.session.busy);
  }

  /** Agent work through the CPU queue (ADR 0036): runs now (the promise is the delivery's) or waits, and then resolves
   *  at once; a later failure lands on the chat (lastError). A chat in the middle of a turn never waits: the message
   *  joins its running work. */
  private gate(r: Rec, deliver: () => Promise<void>): Promise<void> {
    const adm = this.admission;
    // a chat mid-turn takes the message at once, unless earlier work of its own still waits (never overtaken)
    if (!adm || (this.midTurn(r) && !adm.entry(r.s.id))) return deliver();
    let now: Promise<void> | undefined;
    let late = false;
    // a chat on the app itself waits behind the work chats' (the user, 2026-10-14)
    const q = adm.request(r.s.id, r.session ? 'turn' : 'start', () => {
      const p = deliver();
      if (late) p.catch(e => this.lateFailed(r, e)); else now = p;
    }, isAppChat(r.s.title) || r.s.route?.area === 'App');
    if (!q) return now ?? Promise.resolve();
    late = true;
    log.info('chats', 'agent work queued: the machine is busy', { chat: r.s.id, data: { kind: q.kind, position: q.position, app: !!q.app, ...adm.load() } });
    return Promise.resolve();
  }

  /** A queued delivery failed when it finally ran: the chat shows it (nobody awaits that promise any more). */
  private lateFailed(r: Rec, e: unknown): void {
    log.warn('chats', 'queued message not delivered', { chat: r.s.id, cause: errText(e), hint: 'the chat shows the error; write to it to retry' });
    if (this.chats.get(r.s.id) !== r) return;
    r.s.lastError = errText(e);
    delete r.s.resumedAt;
    this.updated(r);
  }

  /** The queue moved or the load changed: each chat's "In coda" line follows. */
  private refreshQueued(): void {
    const adm = this.admission;
    if (!adm) return;
    const load = adm.load();
    const waiting = new Map(adm.list().map(e => [e.key, e]));
    for (const r of this.chats.values()) {
      const e = waiting.get(r.s.id);
      const was = r.s.queued;
      if (!e) { if (was) { delete r.s.queued; this.updated(r); } continue; }
      if (was && was.position === e.position && was.kind === e.kind && was.cpu === load.cpu && was.freeRam === load.freeRam) continue;
      r.s.queued = { kind: e.kind, position: e.position, since: e.since, cpu: load.cpu, freeRam: load.freeRam };
      this.updated(r);
    }
  }

  admitNow(chatId: string): boolean {
    this.need(chatId);
    const ok = !!this.admission?.admitNow(chatId);
    if (ok) log.info('chats', 'queued chat started now by the user', { chat: chatId });
    return ok;
  }

  queueState(): ReturnType<ChatService['queueState']> {
    const adm = this.admission;
    if (!adm) return null;
    return { ...adm.load(), enabled: this.opts.admission!.limits().enabled, waiting: adm.list().map(e => ({ chatId: e.key, kind: e.kind, position: e.position, since: e.since })) };
  }

  /** The delivery of a message (send() decided it goes now). */
  private deliver(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false): Promise<void> {
    const run = () => this.deliverNow(chatId, text, images, resumed, from, liveOnly);
    if (!this.opts.recall || engineOf(this.need(chatId).s.harness)?.kind === 'claude') return run();
    // A later, faster recall must never deliver its message before an earlier one in this chat.
    const previous = this.deliveries.get(chatId);
    const delivery = previous ? previous.catch(() => {}).then(run) : run();
    this.deliveries.set(chatId, delivery);
    const done = () => { if (this.deliveries.get(chatId) === delivery) this.deliveries.delete(chatId); };
    void delivery.then(done, done);
    return delivery;
  }

  private async deliverNow(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    const releaseDelivery = this.holdActivity(chatId);
    try {
    // an engine released for idleness still gets its mail: the chat resumes for it (ensureSession below)
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    const t = typeof text === 'string' ? text.trim() : '';
    const imgs = checkImages(images);
    if (!t && !imgs.length) throw new Error('Messaggio vuoto.');
    if (!resumed && r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
    this.ensureHistory(r);
    const warning = engineOf(r.s.harness)?.kind === 'claude' ? '' : await recallWarning(t, this.opts.recall);
    if (this.quitting || this.chats.get(chatId) !== r) throw new Error('La chat non è attiva.');
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (r.archiving) await r.archiving; // never into a session that is closing: the archive ends first, then this reopens
    this.needAgentMay(r, from); // again: the engine may have been released while the message waited in the queue
    if (r.s.closedAt) this.unarchive(r); // a message (the user's, or an agent's through app_send_to_chat) reopens it
    // a cold chat (ADR 0031): after the cache expired the message goes on in a fresh session from its note
    const cold = await this.coldSwitch(r);
    try {
      await this.ensureSession(r);
      if (!r.session) throw new Error(r.s.lastError ?? 'Avvio della chat non riuscito.');
      if (liveOnly && engineOf(r.s.harness)?.kind !== 'claude' && (r.session.busy || r.s.state !== 'idle')) throw new Error('La chat sta lavorando: la posta resta da leggere fino al prossimo turno.');
    } catch (e) {
      if (cold) this.coldUndo(r, cold); // the note stays for the next message
      throw e;
    }
    if (cold) this.coldDone(r, cold); // the fresh session started: the divider goes above the message
    // a message into the old session makes the note stale (a turn cut before its result would leave it "fresh")
    else if (r.coldNoteAt) { r.coldNoteAt = undefined; this.persist(); }
    const thumbs = imgs.flatMap(im => (im.thumb ? [im.thumb] : []));
    this.addItem(r, { kind: 'user', id: nextId('u'), at: Date.now(), text: t, ...(imgs.length ? { images: imgs.length } : {}), ...(thumbs.length ? { thumbs } : {}), ...(from ? { from: from.slice(0, 80) } : {}) }, false);
    r.activeAt = Date.now();
    if (r.jobNew) this.startJob(r, t || `[${imgs.length} immagini]`);
    const body = cold ? coldPrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, cold.h, t) : t;
    // the role once per session: the Orchestrator's with the role catalog, a role chat's composed instructions
    const role = r.agentPrimed ? '' : r.s.isOrchestrator ? `${orchestratorRole(r.agentInstructions || undefined, this.opts.roleCatalogBrief?.())}\n\n`
      : r.agentInstructions ? `${roleFrame(r.s.agent?.name ?? 'Chat', r.agentInstructions)}\n\n` : '';
    try {
      r.session.send(`${role}${warning}${body}`, imgs); r.agentPrimed = true;
    } catch (e) {
      throw new Error(`Messaggio non inviato: ${errText(e)}`);
    }
    // queued behind a quiet note turn: the engine reports no new "running", the tile shows the work from here
    if (r.handoffTurn?.quiet && r.s.state === 'idle') { r.s.state = 'running'; this.updated(r); }
    // queued behind a hand-off turn the CLI reports no new "running": mark the work here, resumed after a restart
    if (r.handoffTurn && !r.working) { r.working = true; this.persist(); }
    if (r.s.lastError) { delete r.s.lastError; this.updated(r); }
    } finally { releaseDelivery(); }
  }

  private autoActivity(r: Rec): void {
    r.autoActivityAt = autoCloseNow(); r.activityRevision = (r.activityRevision ?? 0) + 1;
    this.opts.onAutoCloseActivity?.(r.s.id);
  }

  /** Main-only reservation held before delivery/mail takes its first asynchronous step. */
  holdActivity(chatId: string): () => void {
    const r = this.need(chatId); this.autoActivity(r);
    r.deliveryHolds = (r.deliveryHolds ?? 0) + 1;
    let released = false;
    return () => { if (!released) { released = true; r.deliveryHolds = Math.max(0, (r.deliveryHolds ?? 1) - 1); this.autoActivity(r); } };
  }

  /** Main guards, combined with mailbox/command/browser holds by wiring. Unknown children are never zero.
   *  externalHold: true / a waiting kind = held by wiring (a waiting kind also names the "In attesa di…" label). */
  autoCloseCandidates(externalHold: (chatId: string) => boolean | AutoCloseWaiting = () => true): AutoCloseCandidate[] {
    return [...this.chats.values()].filter(r => !r.s.closedAt).map(r => {
      const c = r.s, child = c.agentChildren;
      let held: boolean | AutoCloseWaiting = true;
      try { held = externalHold(c.id); } catch { /* fail closed */ }
      const eligible = !this.quitting && !updateActivity.frozen && !c.isOrchestrator && !held &&
        (c.state === 'idle' || r.autoClosing && c.state === 'closed') && !!c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted && !c.lastError &&
        !r.working && !r.session?.busy && r.pending.size === 0 && !workBehind(c) && !c.waitsOn && !c.queued && !r.deliveryHolds &&
        !r.opening && !r.releasing && !r.switching && !r.handoffTurn && (!r.archiving || r.autoClosing) &&
        child?.coverage === 'complete' && child.active === 0 && !child.children.some(x => x.state === 'running' || x.state === 'waiting' || x.state === 'unknown');
      const waitingFor = eligible || c.isOrchestrator ? undefined : this.waitingOf(r, held);
      return { id: c.id, eligible: !!eligible, stamp: `${r.activityRevision ?? 0}:${r.lastTurnAt}:${c.lastResult?.at ?? 0}:${c.pending}:${c.model ?? ''}:${c.work?.status ?? ''}:${c.waitsOn ?? ''}`,
        activityAt: r.autoActivityAt ??= autoCloseNow(), ...(waitingFor ? { waitingFor } : {}),
        reason: waitingFor ? WAITING_REASON[waitingFor] : child?.coverage !== 'complete' ? 'Sottoagenti non completamente osservabili: chiusura sospesa' : 'Attività o stato da verificare' };
    });
  }

  /** What a held work chat waits for, the most urgent first (#86): the user's answers before running work, running
   *  work before a missing report. undefined = held for another reason (busy, starting, an error, ...). */
  private waitingOf(r: Rec, external: boolean | AutoCloseWaiting): AutoCloseWaiting | undefined {
    const c = r.s, pend = [...r.pending.values()];
    if (pend.some(p => p.type === 'permission')) return 'permission';
    if (pend.some(p => p.type === 'question')) return 'answer';
    if (external === 'command' || external === 'browser') return external;
    if (c.waitsOn) return c.waitsOn;
    if (r.session?.busy || r.working || c.state === 'running' || c.state === 'starting') return undefined;
    if ((c.background ?? 0) > 0 || c.waitsOnWork || this.observedChildrenBusy(r) || (c.agentChildren?.active ?? 0) > 0 || external === 'work') return 'work';
    if (c.work?.status === 'waiting-mail' || external === 'mail') return 'mail';
    if (c.work?.status === 'assigned' && c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted) return 'report';
    return undefined;
  }

  /** No renderer flag can authorize this path. The scheduler supplies a current, main-owned reservation. */
  async archiveAutomatic(chatId: string, stillValid: () => boolean): Promise<boolean> {
    const r = this.need(chatId);
    const eligible = (): boolean => this.autoCloseCandidates(() => false).find(c => c.id === chatId)?.eligible === true;
    if (!stillValid() || !eligible() || r.archiving || r.autoClosing || r.pending.size || r.deliveryHolds) return false;
    r.autoClosing = true;
    let authorized = false;
    const valid = (): boolean => stillValid() && eligible() && this.chats.get(chatId) === r && !r.pending.size && !r.deliveryHolds && !r.session?.busy && !r.working && !workBehind(r.s);
    const sess = r.session;
    const run = (async () => {
      if (!valid()) return;
      try { await this.ensureHandoff(chatId, { ask: false, allowStart: false }); } catch { return; }
      if (!valid()) return;
      if (sess) { r.autoEnding = true; await sess.close(); if (!valid()) return; this.reapKept(r); }
      authorized = true;
    })();
    r.archiving = run;
    try {
      await run;
      if (!authorized || !valid()) return false;
      this.flushItems(chatId);
      r.s.closedAt = Date.now(); r.s.closedBy = 'auto'; r.s.state = 'closed';
      this.endRunOf(r, 'closed', r.s.closedAt);
      this.pruneArchived(); this.persist(); this.updated(r);
      return true;
    } finally { r.archiving = undefined; r.autoClosing = false; r.autoEnding = false; }
  }

  async answer(chatId: string, requestId: string, answer: Answer): Promise<void> {
    const r = this.need(chatId);
    if (!r.pending.has(requestId)) throw new Error('Questa richiesta non è più aperta.');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    const ok = r.session.answer(requestId, answer);
    if (!ok) this.dropPending(r, requestId);
  }

  /** Interrupts whenever a process exists, whatever the shown state says (an interrupt on an idle CLI is harmless). */
  async stop(chatId: string, keepQueued = false): Promise<void> {
    const r = this.need(chatId);
    if (!r.session) return;
    try { await r.session.interrupt({ keepQueued, byUser: true }); } catch (e) {
      log.warn('chats', 'interrupt failed', { chat: chatId, data: errText(e) });
      throw new Error(`Stop non riuscito: ${errText(e)}`);
    }
  }

  /** Interrupts every live session; returns how many were working. */
  async stopAll(): Promise<number> {
    const live = [...this.chats.values()].filter(r => r.session);
    const busy = live.filter(r => r.session?.busy).length;
    await Promise.allSettled(live.map(r => r.session?.interrupt({ byUser: true })));
    log.info('chats', 'stop all', { data: { live: live.length, busy } });
    return busy;
  }

  /** Removes the chat from the app (its process ends; the transcript stays where the CLI keeps it). */
  async close(chatId: string): Promise<void> {
    const r = this.need(chatId);
    this.admission?.drop(chatId); // its waiting work goes with it
    const sess = r.session;
    if (sess) await sess.close();
    this.reapKept(r);
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    this.endRunOf(r, 'closed');
    this.chats.delete(chatId);
    this.persist();
    log.info('chats', 'chat closed', { chat: chatId });
    this.opts.emitter.emit('chat:removed', { chatId });
  }

  /** The chat goes on in a new process: the old one ends, but a dev server it started stays for the next turn
   *  (owner, 2026-10-12); its tools are reaped when the chat really closes (reapKept). */
  private closeKeeping(r: Rec, sess: HarnessSession): Promise<void> {
    (r.kept ??= []).push(sess);
    return sess.close(undefined, true);
  }

  /** The chat really closes (✕, Ctrl+W, Chiudi, auto close): the engines it outlived leave nothing behind either. */
  private reapKept(r: Rec): void {
    for (const s of r.kept?.splice(0) ?? []) {
      if (s.root && reapEnabled()) void reapEngine(s.root, { chatId: r.s.id, what: 'a previous engine of this chat' });
    }
  }

  /** Archives a finished work chat: its process ends gracefully, the record stays (closedAt) and reopen() brings it
   *  back with its history. auto = the UI's auto-close: refused if the chat went back to work meanwhile. */
  async archive(chatId: string, opts: { auto?: boolean } = {}): Promise<ChatSummary> {
    const r = this.need(chatId);
    // the Orchestrator never closes (its title is the mail address the brain's rules and the chats write to)
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si chiude: per ripartire usa Pulisci.');
    if (r.archiving) await r.archiving;
    if (r.s.closedAt) return { ...r.s };
    if (opts.auto && (r.session?.busy || r.pending.size > 0 || workBehind(r.s) || r.s.queued)) throw new Error('La chat è tornata al lavoro: resta aperta.');
    if (opts.auto) throw new Error('La chiusura automatica richiede il timer verificato dal processo principale.');
    // closed by hand while an agent's message waited in the CPU queue: that message is dropped with the chat's work
    if (this.admission?.drop(chatId)) log.info('chats', 'queued work dropped: the chat was archived', { chat: chatId });
    const sess = r.session;
    const note = opts.auto && r.lastTurnAt > 0;
    // a long Claude chat that still waits for its cold note keeps its engine until it wrote it (never a turn at close:
    // the note comes at its usual time, coldTick; ADR 0031)
    const keep = !!opts.auto && !!sess?.alive && this.coldOn() && coldArmed(this.coldView(r), Date.now(), this.ttl());
    if (sess || note) {
      // one promise for the whole close, set before any await: a message sent meanwhile waits for it, then reopens
      r.archiving = (async () => {
        // the auto-close leaves the token-free hand-off for a later "Riprendi" (ADR 0014: never a turn at close)
        if (note) {
          try { await this.ensureHandoff(chatId, { ask: false }); } catch (e) {
            log.warn('chats', 'hand-off before the auto-close not written', { chat: chatId, cause: errText(e), hint: '"Riprendi" on this chat writes it then' });
          }
        }
        if (sess && !keep) { await sess.close(); this.reapKept(r); }
      })();
      try { await r.archiving; } finally { r.archiving = undefined; }
    }
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    r.s.closedAt = Date.now();
    r.s.closedBy = opts.auto ? 'auto' : 'user';
    this.endRunOf(r, 'closed', r.s.closedAt);
    r.working = false;
    if (keep) r.closeAfterCold = true;
    if (r.s.state !== 'error') r.s.state = 'closed';
    delete r.s.background; delete r.s.waitsOnWork; delete r.s.waitsOn;
    this.pruneArchived();
    this.persist();
    log.info('chats', 'chat archived', { chat: chatId, data: { auto: !!opts.auto, ...(keep ? { engineKeptForColdNote: true } : {}) } });
    this.updated(r);
    return { ...r.s };
  }

  /** Back on the grid; the session resumes on the next message (Claude --resume, Cursor session/load). */
  async reopen(chatId: string): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.closedAt) this.unarchive(r);
    return { ...r.s };
  }

  /** The user went on with this chat himself (typed in it, reopened it: the IPC handlers only): an ended agent run is
   *  open again and counts as reworked. A message from an agent, the Orchestrator or the app never reopens a run. */
  resumedByUser(chatId: string, text?: string): void {
    const r = this.chats.get(chatId);
    const run = r?.s.run;
    if (!r || !run) return;
    // Brother's corrections (AGENTS-DESIGN §5): (a) a "[Reasoning correction]", else (b) his reopen of a run whose
    // agent had reported; runs recorded before they were counted have no tally (unknown, not zero)
    const tagged = text !== undefined && isCorrection(text), reported = !!run.report;
    const reopened = reopenRun(run);
    if (run.corrections && (tagged || (reopened && reported))) run.corrections[tagged ? 'tagged' : 'afterReport']++;
    if (!reopened && !tagged) return;
    if (reopened) {
      delete run.report; // it reported on the work before the reopen
      // chat:send started the turn before this reopen: its running time counts from now
      if (r.s.state === 'running' && !r.handoffTurn) r.runningSince ??= Date.now();
      r.idleSince = Date.now(); // persisted below
      log.info('chats', 'agent run reopened by the user', { chat: chatId, data: { runId: run.runId, reopened: run.counters.reopened } });
    }
    this.runSave(); this.persist(); this.updated(r);
  }

  /** The §5 metrics per agent and version (A6): runs kept plus the rollups of the pruned ones. `aiErrors` = the brain's
   *  ai-errors.md text (its lines naming a run, seen by Brother, are a secondary column); undefined = not read. */
  runMetrics(opts: { aiErrors?: string; since?: number; skill?: string; app?: string; repo?: string } = {}): ReturnType<typeof runMetrics> {
    // a failed write (a locked file, a full disk, an unreadable store) still answers from memory
    try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
    return runMetrics(this.runs.list(), { rollups: this.runs.rolledUp(), ...(opts.aiErrors !== undefined ? { aiErrors: aiErrorRuns(opts.aiErrors) } : {}), ...(opts.since !== undefined ? { since: opts.since } : {}),
      filter: { ...(opts.skill !== undefined ? { skill: opts.skill } : {}), ...(opts.app !== undefined ? { app: opts.app } : {}), ...(opts.repo !== undefined ? { repo: opts.repo } : {}) } });
  }

  /** The user's verdict on an agent run (thumbs up / down / partly; the UI's only, never an agent tool): basis human;
   *  an open run ends as completed, an ended one keeps how it ended. */
  markRun(chatId: string, verdict: AgentRunOutcome['verdict'], note?: string): ChatSummary {
    const r = this.need(chatId);
    const run = r.s.run;
    if (!run) throw new Error('Questa chat non è un’esecuzione di un Agente.');
    if (!['success', 'partial', 'fail', 'unknown'].includes(verdict)) throw new Error('Esito non valido.');
    const text = typeof note === 'string' ? note.trim().slice(0, 600) : '';
    run.outcome = { verdict, basis: 'human', at: Date.now(), by: 'user', ...(text ? { note: text } : {}) };
    this.finishRun(run, 'completed');
    this.runSave(); this.persist(); this.updated(r);
    this.hook('agent lifecycle', () => this.opts.onRunOutcome?.(structuredClone(run)));
    return { ...r.s };
  }

  /** A "Comando da eseguire" request (run/asks.ts keeps it, not the engine): counted once on the chat's open run. */
  commandAsked(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    this.countRequest(r, { id: requestId, type: 'command' });
    (r.commandsOpen ??= new Set()).add(requestId);
  }
  /** That request left (run, "Non serve", the chat went on): when nothing else waits, the stale clock starts again. */
  commandDone(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r?.commandsOpen?.delete(requestId)) return;
    if (!r.commandsOpen.size && !r.pending.size) this.idleAgain(r);
  }

  /** Ends the open runs with no turn and nothing waiting on the user for STALE_MS (the timer; tests call it). */
  staleRuns(now = Date.now()): number {
    let n = 0;
    for (const r of this.chats.values()) {
      const run = r.s.run;
      if (!run || run.endedAt !== undefined) continue;
      const waiting = r.pending.size > 0 || !!r.commandsOpen?.size || !!r.working || !!r.session?.busy || !!r.s.queued;
      if (!staleDue(run, Math.max(run.startedAt, r.lastTurnAt, r.idleSince ?? 0, r.activeAt ?? 0), waiting, now)) continue;
      this.finishRun(run, 'stale', now); n++;
    }
    if (n) { this.runSave(); this.persist(); }
    return n;
  }

  /** After a start: every chat whose turn the last quit or crash cut (working still set) resumes by itself with
   *  RESUME_TEXT and the "ripresa dopo il riavvio" mark (resumedAt). Chats that had finished stay closed. */
  resumeInterrupted(): number {
    const cut = [...this.chats.values()].filter(r => r.working && !r.s.closedAt);
    for (const r of cut) {
      r.s.resumedAt = Date.now();
      this.updated(r);
      log.info('chats', 'resuming a chat cut by the restart', { chat: r.s.id });
      this.send(r.s.id, RESUME_TEXT, undefined, true).catch(e => {
        log.warn('chats', 'resume after restart failed', { chat: r.s.id, cause: errText(e), hint: 'the chat stays closed: a message from the user resumes it' });
        if (r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
      });
    }
    return cut.length;
  }

  async set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }): Promise<ChatSummary> {
    const r = this.need(chatId);
    const sess = r.session;
    if(patch.workStatus !== undefined){
      if(Object.keys(patch).some(key=>key!=='workStatus'))throw new Error('Aggiorna lo stato incarico separatamente dalle altre impostazioni.');
      if(!['assigned','waiting-mail','completed'].includes(patch.workStatus))throw new Error('Stato incarico non valido.');
      const previous=r.s.work;
      this.autoActivity(r);
      r.s.work={status:patch.workStatus,updatedAt:Date.now()};
      try{this.persist(true);}catch(error){r.s.work=previous;throw error;}
      if (patch.workStatus === 'completed' && r.s.run && r.s.run.endedAt === undefined) { this.endRunOf(r, 'completed'); this.persist(); }
    }
    const later: string[] = [];
    const apply = async (what: string, fn: (() => Promise<void>) | undefined): Promise<void> => {
      if (!sess || !fn) return;
      try { await fn(); } catch (e) { later.push(what); log.warn('chats', 'setting not applied live', { chat: chatId, data: { what, error: errText(e) } }); }
    };
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) throw new Error('Titolo vuoto.');
      r.s.title = t;
      await apply('title', sess ? () => sess.rename(t) : undefined);
    }
    if (patch.model !== undefined) {
      const m = patch.model.trim() || null;
      if (m && !MODEL_ID.test(m)) throw new Error(`Modello non valido: ${m}`);
      this.hook('analytics', () => this.analytics.patch(r.s, { modelObserved: null }));
      r.choice.model = m; r.s.model = m;
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.liveModel) {
        // never live (Cursor's session/set_model writes the user's config): reopen the session with --model, same history
        if (sess && !sess.busy) await this.closeKeeping(r, sess);
        else if (sess) r.reopen = true; // after this turn
        if (sess) this.addItem(r, sysItem('modelChangeQueued', { model: m ?? '', label: engine.label, reopen: r.reopen ? 1 : 0 }, 'info'), false);
      } else await apply('model', sess ? () => sess.setModel(m) : undefined);
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw new Error(`Effort non valido: ${patch.effort}`);
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
      const e = patch.effort;
      r.choice.effort = e; r.s.effort = e;
      r.s.effortStatus = selectEffort(r.s.effortStatus ?? initialEffort(engine.caps.effort, null), e);
      await apply('effort', sess ? () => sess.setEffort(e) : undefined);
    }
    if (patch.permissionMode !== undefined) {
      if (!MODES.includes(patch.permissionMode)) throw new Error(`Modalità permessi non valida: ${patch.permissionMode}`);
      const pm = patch.permissionMode;
      if (aboveCeiling(pm, r.policy?.ceiling ?? null)) throw new Error(`Questo Agente ha come limite la modalità «${r.policy!.ceiling}». Per alzarlo modifica l’Agente.`);
      r.choice.permissionMode = pm; r.s.permissionMode = pm;
      await apply('permissionMode', sess ? () => sess.setPermissionMode(pm) : undefined);
    }
    if (later.length) this.addItem(r, sysItem('appliedLater', { items: later.join(',') }, 'warn'), false);
    this.persist();
    log.info('chats', 'chat settings', { chat: chatId, data: { ...patch, title: patch.title ? '(changed)' : undefined } });
    this.updated(r);
    return { ...r.s };
  }

  // ---- long chats: hand-off and "Riprendi" ----

  /** The saved hand-off of a chat, or null. */
  readHandoff(chatId: string, session?: string): HandoffInfo | null {
    this.need(chatId);
    return this.handoffs.read(chatId, session);
  }

  /** The chat writes its hand-off now: one short turn, its answer saved as <userData>/handoffs/<chatId>.md. A chat that
   *  cannot be asked (no turn yet, a stopped engine with allowStart false, a failed or malformed answer) gets a
   *  token-free note built by the app (source 'auto'). Refused while the chat works or waits for the user. */
  async handoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    if (r.handoffTurn) throw new Error('La chat sta già facendo un turno breve dell’app (passaggio di consegne o riassunto): riprova tra poco.');
    this.ensureHistory(r);
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (hasTurns && (r.session?.busy || r.pending.size > 0)) throw new Error('La chat sta lavorando o ti aspetta: il passaggio si scrive quando ha finito il turno.');
    // an archived chat is never started for its hand-off (it has no tile for the turn): the app writes the note
    const canAsk = hasTurns && !r.s.closedAt && opts.ask !== false && (opts.allowStart !== false || !!r.session?.alive);
    let text: string | null = null;
    if (canAsk) {
      try { text = await this.askHandoff(r, opts.reason ?? 'manual'); } catch (e) {
        log.warn('chats', 'hand-off turn failed', { chat: chatId, data: errText(e) });
      }
    }
    if (this.chats.get(chatId) !== r) throw new Error('Chat chiusa mentre scriveva il passaggio.');
    // "Riprendi" whose hand-off turn was stopped or failed: nothing saved (a later "Riprendi" asks the chat again)
    if (r.handoffStopped && opts.reason === 'continue') throw new Error('Ripresa annullata: il passaggio di consegne si è interrotto (fermato o in errore). Riprova quando vuoi.');
    const info = this.handoffs.write(chatId, {
      title: r.s.title, text: text ?? autoHandoff(r.s, r.items), at: Date.now(), source: text ? 'chat' : 'auto',
      ...(r.s.contextTokens ? { contextTokens: r.s.contextTokens } : {}),
    });
    r.s.handoffAt = info.at; r.s.handoffSource = info.source;
    {
      const code = info.source === 'chat' ? 'handoffSavedChat' : 'handoffSavedAuto';
      this.addItem(r, { kind: 'system', id: nextId('s'), at: info.at, level: 'info', text: sysEn(code), code }, false);
    }
    this.persist();
    this.updated(r);
    log.info('chats', 'hand-off saved', { chat: chatId, data: { source: info.source, reason: opts.reason ?? 'manual', chars: info.text.length, contextTokens: r.s.contextTokens ?? null } });
    return info;
  }

  /** "Riprendi": a NEW chat on the same engine, folder and choices that starts from the hand-off (written first when
   *  missing or older than the last turn). The old chat's process ends; it stays readable, linked both ways.
   *  promptPrefix: a label put before the prompt (an agent's request is marked as not the user's). */
  continueChat(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string } = {}): Promise<ChatSummary> {
    const running = this.continuing.get(chatId);
    if (running) return running;
    const p = this.doContinue(chatId, opts).finally(() => this.continuing.delete(chatId));
    this.continuing.set(chatId, p);
    return p;
  }

  private async doContinue(chatId: string, opts: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si riprende così: usa «Ricomincia da capo» dal suo menu.');
    const next = r.s.continuedBy && this.chats.get(r.s.continuedBy.id);
    if (next) return { ...next.s };
    // never two agents on the same files: the old chat must have finished its turn (a fresh note does not cover this one)
    const hasTurns = r.lastTurnAt > 0 || r.items.some(i => i.kind === 'result' || i.kind === 'user');
    if (r.handoffTurn || (hasTurns && (r.session?.busy || r.pending.size > 0))) throw new Error('La chat sta lavorando o ti aspetta: si riprende quando ha finito il turno.');
    const saved = this.handoffs.read(chatId);
    const fresh = saved && saved.at >= r.lastTurnAt ? saved : null;
    r.handoffStopped = false;
    const h = fresh ?? await this.handoff(chatId, { reason: 'continue', ...(opts.allowStart === false ? { allowStart: false } : {}) });
    const taken = [...this.chats.values()].map(x => x.s.title);
    const c = await this.create({
      harness: r.s.harness, cwd: r.s.cwd, title: nextTitle(r.s.title, taken),
      ...(r.choice.model ? { model: r.choice.model } : {}), ...(r.choice.effort ? { effort: r.choice.effort } : {}), ...(r.choice.permissionMode ? { permissionMode: r.choice.permissionMode } : {}),
      // a routed job stays one outcome across hand-offs: the new chat writes on the first chat's ledger line
      ...(r.s.route ? { route: { ...r.s.route, ledgerId: r.s.route.ledgerId ?? `app:${r.s.id}`, handoffs: (r.s.route.handoffs ?? 0) + 1 } } : {}),
      prompt: `${opts.promptPrefix ? `${opts.promptPrefix}\n\n` : ''}${continuePrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, h)}`,
    }, 'user', { owner: r.s.agent ?? plainOwner(r.s.harness, r.choice.model), instructions: r.agentInstructions ?? '', policy: r.policy ?? null, assets: r.agentAssets, ...(r.maxContext ? { maxContext: r.maxContext } : {}) });
    const nr = this.chats.get(c.id);
    // the worktree hint follows the chain (A → B → C)
    if (nr) { nr.s.continuedFrom = { id: r.s.id, title: r.s.title }; if (r.inWorktree) nr.inWorktree = true; this.updated(nr); }
    // the agent's work goes on in a new run: the old one counts as reworked (§5)
    if (nr?.s.run && r.s.run && this.runs.get(r.s.run.runId)) { nr.s.run.continuedFrom = r.s.run.runId; this.runSave(); }
    r.s.continuedBy = { id: c.id, title: c.title };
    this.addItem(r, sysItem('continuedIn', { title: c.title }, 'info'), false);
    this.persist();
    this.updated(r);
    // its context is not re-read any more: the process ends now, or when the turn that just wrote the hand-off settles
    if (r.session && !r.session.busy) await this.closeKeeping(r, r.session);
    else if (r.session) r.reopen = true;
    log.info('chats', 'chat continued in a new one', { chat: chatId, data: { next: c.id, handoff: h.source, fresh: !!fresh } });
    return { ...(nr?.s ?? c) };
  }

  /** Writes the hand-off when it is missing or older than the last turn (the auto-close calls it before archiving). */
  async ensureHandoff(chatId: string, opts: HandoffOptions = {}): Promise<HandoffInfo> {
    const r = this.need(chatId);
    const saved = this.handoffs.read(chatId);
    if (saved && saved.at >= r.lastTurnAt) return saved;
    return this.handoff(chatId, { reason: 'finished', ...opts });
  }

  // ---- cold chats: the invisible continuation (ADR 0031) ----

  /** How the Claude chats used their context (zero tokens: from the usage the engines report). */
  contextStats(): ContextStats { return this.counters.snapshot(); }

  private coldOn(): boolean { return !!this.opts.coldHandoff?.(); }
  private ttl(): number { return this.opts.cacheTtlMs ?? CACHE_TTL_MS; }

  private coldView(r: Rec): ColdView {
    return {
      harness: r.s.harness, isOrchestrator: r.s.isOrchestrator, continuedBy: r.s.continuedBy,
      // an archived chat kept alive for its note counts as idle (archive: closeAfterCold)
      state: r.closeAfterCold && r.s.closedAt && r.s.state === 'closed' ? 'idle' : r.s.state,
      // a final answer that waits for its work counts as one more background task: no note, no fresh session
      pending: r.pending.size, background: (r.s.background ?? 0) + (r.s.waitsOnWork ? 1 : 0) + (r.s.work && r.s.work.status !== 'completed' ? 1 : 0) + (this.observedChildrenBusy(r) ? 1 : 0), busy: !!r.session?.busy, alive: !!r.session?.alive, handoffTurn: !!r.handoffTurn,
      contextTokens: r.s.contextTokens ?? 0, lastTurnAt: r.lastTurnAt, noteAt: r.coldNoteAt ?? 0,
      lastCallAt: Math.max(r.lastTurnAt, r.coldNoteAt ?? 0), askedFor: r.coldAskedFor,
    };
  }

  /** Every minute (coldEveryMs): each idle long Claude chat whose cache is about to expire writes its note quietly;
   *  an archived chat kept for its note whose chance passed ends its engine. Returns how many were asked. */
  coldTick(now = Date.now()): number {
    if (updateActivity.frozen) return 0;
    if (this.quitting) return 0;
    const on = this.coldOn(), idle = this.opts.coldIdleMs?.() ?? 50 * 60_000, day = !!this.opts.orchestratorDayCompact?.();
    let n = 0;
    for (const r of this.chats.values()) {
      if ((r.deliveryHolds ?? 0) > 0 || this.observedChildrenBusy(r)) continue;
      const v = this.coldView(r);
      const step = continuityStep({ ...v, ctxSince: r.ctxSince, askedOn: r.dayCompactOn }, now, { cold: on, day, idleMs: idle, ttlMs: this.ttl() });
      if (step === 'note') { n++; void this.coldNote(r); continue; }
      if (step === 'compact') { n++; void this.orchestratorCompact(r, now); continue; }
      if (r.closeAfterCold && !r.handoffTurn && (!on || !coldArmed(v, now, this.ttl()))) void this.endKept(r);
    }
    return n;
  }

  /** One quiet hand-off turn on the warm cache: nothing shows in the tile; the note is saved only when the chat wrote
   *  it (a token-free note is no base for a continuation: the next message then resumes the old session). */
  private async coldNote(r: Rec): Promise<void> {
    r.coldAskedFor = r.lastTurnAt;
    const ctx = r.s.contextTokens ?? 0;
    log.info('chats', 'cold chat: asking its note while the cache is warm', { chat: r.s.id, data: { contextTokens: ctx, idleMin: Math.round((Date.now() - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000) } });
    let text: string | null = null;
    try { text = await this.askHandoff(r, 'cold', true); } catch (e) {
      log.warn('chats', 'cold note turn failed', { chat: r.s.id, cause: errText(e), hint: 'the next message resumes the old session (one cold re-read)' });
    }
    if (this.chats.get(r.s.id) !== r) return;
    if (text) {
      const info = this.handoffs.write(r.s.id, { title: r.s.title, text, at: Date.now(), source: 'chat', ...(ctx ? { contextTokens: ctx } : {}) });
      r.s.handoffAt = info.at; r.s.handoffSource = 'chat';
      // a message queued behind the quiet turn goes on in the old session: the note is no base for it
      if (!r.working) r.coldNoteAt = info.at;
      this.counters.note(r.s.id, 'written', { contextTokens: ctx, chars: info.text.length });
      this.persist();
      this.updated(r);
    } else log.info('chats', 'cold note not written', { chat: r.s.id, data: { stopped: !!r.handoffStopped } });
    if (r.closeAfterCold) await this.endKept(r);
  }

  /** An Orchestrator's day compaction (continuity.ts orchestratorDayDue): one quiet `/compact` turn with what to keep; the engine's compact_boundary
   *  shows in the tile («Contesto compattato») and starts its context's day again. Same chat, same session. */
  private async orchestratorCompact(r: Rec, now: number): Promise<void> {
    r.dayCompactOn = romeDay(now);
    const sess = r.session;
    if (!sess) return;
    log.info('chats', 'Orchestrator: compacting a context from an earlier day', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null, since: r.ctxSince ?? null } });
    this.addItem(r, sysItem('dayCompactStart', undefined, 'info'), false);
    const out = await this.quietTurn(r, sess, ORCHESTRATOR_COMPACT, true).catch((e: unknown) => {
      log.warn('chats', 'Orchestrator day compaction not sent', { chat: r.s.id, cause: errText(e), hint: 'it still compacts by itself at its window (compactWindowTokens); tomorrow it tries again' });
      return null;
    });
    if (out !== null) return;
    log.info('chats', 'Orchestrator day compaction did not finish', { chat: r.s.id, data: { contextTokens: r.s.contextTokens ?? null } });
    this.addItem(r, sysItem('dayCompactFailed', undefined, 'warn'), false);
  }

  /** The engine an auto-close kept for the cold note ends now (the chat stays archived). */
  private async endKept(r: Rec): Promise<void> {
    r.closeAfterCold = false;
    const sess = r.session;
    // the note's result comes a moment before the engine reports idle
    for (let i = 0; i < 50 && sess?.busy && r.session === sess && r.s.closedAt; i++) await new Promise(res => setTimeout(res, 200));
    if (!r.s.closedAt || !sess || sess.busy || r.session !== sess || r.pending.size > 0 || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r)) return;
    await sess.close();
    this.reapKept(r);
  }

  /** A message to a cold chat whose cache expired: the old session ends, a fresh one (new session id, same chat,
   *  title and choices) will start from the note. Returns the step the first message carries (send commits it with
   *  coldDone once the engine started, or undoes it with coldUndo when it did not), null when the chat
   *  goes on as usual. A second message meanwhile waits for the switch. */
  private async coldSwitch(r: Rec): Promise<ColdStep | null> {
    if (r.switching) { await r.switching; return null; }
    if (!this.coldOn() || this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
    const h = this.handoffs.read(r.s.id);
    if (!h || h.source !== 'chat' || h.at < r.lastTurnAt) { r.coldNoteAt = undefined; return null; }
    const run = (async (): Promise<ColdStep | null> => {
      if (r.releasing) await r.releasing;
      if (this.unsettledChildren(r) || !coldRoute(this.coldView(r), Date.now(), this.ttl())) return null;
      const revision = r.activityRevision;
      if (r.session) {
        r.autoEnding = true;
        try { await this.closeKeeping(r, r.session); } finally { r.autoEnding = false; }
      }
      if (r.activityRevision !== revision || this.unsettledChildren(r) || r.pending.size > 0 || workBehind(r.s)) return null;
      const now = Date.now(), old = r.s.sessionId;
      const step: ColdStep = {
        h, old, at: now, idleMin: Math.round((now - Math.max(r.lastTurnAt, r.coldNoteAt ?? 0)) / 60000),
        prev: { forkFrom: r.forkFrom, costTotalUsd: r.costTotalUsd, contextTokens: r.s.contextTokens, contextMaxTokens: r.s.contextMaxTokens, coldNoteAt: r.coldNoteAt, after: r.after },
        notePath: isUuid(old) ? this.handoffs.archive(r.s.id, old) : h.path,
      };
      if (isUuid(old)) { (r.pastSessions ??= []).push({ sessionId: old, at: now, notePath: step.notePath }); r.pastSessions.splice(0, Math.max(0, r.pastSessions.length - 20)); }
      r.s.sessionId = crypto.randomUUID();
      delete r.forkFrom;
      r.costTotalUsd = 0; // the new session's own running total starts from zero
      delete r.s.contextTokens; delete r.s.contextMaxTokens;
      r.coldNoteAt = undefined;
      r.after = { kind: 'continuation', left: AFTER_CALLS };
      return step;
    })();
    r.switching = run;
    try { return await run; } finally { r.switching = undefined; }
  }

  /** The fresh session started: the divider folds the old session, the note counts as used. */
  private coldDone(r: Rec, c: ColdStep): void {
    this.addItem(r, coldDivider(c.old ?? 'x', c.at, c.notePath), false);
    this.counters.note(r.s.id, 'used', { idleMin: c.idleMin, contextTokens: c.h.contextTokens ?? null });
    this.persist();
    this.updated(r);
    log.info('chats', 'cold chat continued in a fresh session', { chat: r.s.id, data: { idleMin: c.idleMin, from: c.old, to: r.s.sessionId, contextTokens: c.h.contextTokens ?? null } });
  }

  /** The fresh session did not start: back to the old one, the note kept for the next message. */
  private coldUndo(r: Rec, c: ColdStep): void {
    if (r.session) return; // an engine on the new id runs: keep it
    if (c.old) r.s.sessionId = c.old;
    if (isUuid(c.old)) r.pastSessions?.pop();
    if (c.prev.forkFrom) r.forkFrom = c.prev.forkFrom;
    r.costTotalUsd = c.prev.costTotalUsd;
    if (c.prev.contextTokens !== undefined) r.s.contextTokens = c.prev.contextTokens;
    if (c.prev.contextMaxTokens !== undefined) r.s.contextMaxTokens = c.prev.contextMaxTokens;
    r.coldNoteAt = c.prev.coldNoteAt;
    r.after = c.prev.after;
    this.persist();
    this.updated(r);
    log.warn('chats', 'cold continuation not started', { chat: r.s.id, cause: r.s.lastError ?? 'engine did not start', hint: 'the note stays: the next message tries the fresh session again' });
  }

  /** App quit. Every CLI gets its tree killed at once, idle ones too: one that ended cleanly would leave its MCP
   *  servers and shells running, and the reap after an exit (a 3-40 s process list) does not finish before the app is
   *  gone (owner, 2026-10-12). Busy turns are lost at quit anyway; transcripts are already on disk. We wait for the
   *  kills to land, because taskkill /T needs claude.exe alive to find its children and takes 1-3.5 s to start on
   *  Windows (15-40 s on a loaded one); then one more kill for anything left, awaited without blocking the main
   *  process. Resolves within `capMs` (under the app's 6 s quit cap, index.ts): what is still alive then is the
   *  orphan sweep's on the next start. */
  async shutdown(graceMs = 800, capMs = 5500): Promise<void> {
    const end = Date.now() + capMs;
    this.quitting = true;
    this.persist();
    this.warm.stop();
    this.admission?.stop(); // what still waits is lost with the run; a cut turn (working) resumes on the next start anyway
    const live = [...this.chats.values()].map(r => r.session).concat(this.warm.current?.session ?? null).filter((x): x is HarnessSession => !!x && x.alive);
    // the engines outside a Job Object: what they started, pictured now (WMI is slow) for the kill at the cap
    // each of these spawns a process (WMI's PowerShell, a taskkill per engine): the slowest says what one costs now
    let spawnMs = 0;
    const timed = <T>(f: () => T): T => { const t = Date.now(); try { return f(); } finally { spawnMs = Math.max(spawnMs, Date.now() - t); } };
    const kids = timed(() => snapshotTrees(process.platform === 'win32' ? live.filter(x => !jobGuard.has(x.jobHandle)).flatMap(x => (x.pid ? [x.pid] : [])) : [], capMs));
    for (const x of live) timed(() => x.killNow());
    const closes = Promise.allSettled(live.map(x => x.close(graceMs)));
    // timed from the start, not from here, and the last kill keeps room for what it spawns (the reaper) at this load:
    // a fixed 1 s let the quit end 146 ms past the app's 6 s cap at full CPU (2026-10-14)
    const last = Math.max(1000, 3 * spawnMs);
    await Promise.race([closes, new Promise(r => setTimeout(r, Math.max(0, Math.min(end - capMs + graceMs + 4500, end - last) - Date.now())).unref())]);
    await this.killLeft(Math.max(0, end - Date.now()), kids, spawnMs);
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.coldTimer) clearInterval(this.coldTimer);
    if (this.runTimer) clearInterval(this.runTimer);
    this.counters.flush();
    if (!this.runs.problem) try { this.runs.flush(); } catch (e) { log.warn('chats', 'agent runs not saved at quit', { cause: errText(e) }); }
    process.off('exit', this.onExit);
    log.info('chats', 'manager stopped', { data: { sessions: live.length, left: live.filter(x => x.alive).length, ms: Date.now() - end + capMs, spawnMs } });
  }

  /** The engines running now and their chats, the waiting warm engine included (its chat id is the next chat's), plus
   *  the chats still open (the orphan sweep's owners, sweep.ts). */
  engines(): { live: { chatId: string; pid: number }[]; open: string[] } {
    const all = [...this.chats.values()];
    const w = this.warm.current;
    return {
      live: all.flatMap(r => (r.session?.alive && r.session.pid ? [{ chatId: r.s.id, pid: r.session.pid }] : []))
        .concat(w?.session.alive && w.session.pid ? [{ chatId: w.chatId, pid: w.session.pid }] : []),
      open: all.filter(r => !r.s.closedAt).map(r => r.s.id),
    };
  }

  /** Ends the engines of chats idle for `idleMs` (setting engineIdleMin): no turn, question, queue, background task or
   *  hand-off, never an Orchestrator; idle counts from the last send, turn or end of a background task (activeAt). The chat stays on the grid as idle; its next message resumes it (ensureSession). Each
   *  engine ends like a ✕ (its tools reaped, its job released). Returns how many were released. */
  releaseIdle(idleMs: number, now = Date.now()): number {
    if (idleMs <= 0 || this.quitting || updateActivity.frozen) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      const sess = r.session;
      if (!sess?.alive || sess.busy || r.releasing || r.archiving || r.opening || r.switching || r.autoClosing || (r.deliveryHolds ?? 0) > 0 || this.unsettledChildren(r) || r.handoffTurn || r.s.closedAt || r.s.isOrchestrator) continue;
      if (r.s.state !== 'idle' || r.pending.size > 0 || workBehind(r.s)) continue;
      if (now - Math.max(r.activeAt ?? 0, r.lastTurnAt) < idleMs) continue;
      // a long chat waiting for its cold note keeps its engine: a resumed one would miss the cache (ADR 0031)
      if (this.coldOn() && coldArmed(this.coldView(r), now, this.ttl())) continue;
      n++;
      log.info('chats', 'idle engine released', { chat: r.s.id, data: { idleMin: Math.round((now - Math.max(r.activeAt ?? 0, r.lastTurnAt)) / 60000), pid: sess.pid } });
      // like a model change: a dev server or local stack it started stays until the chat really closes (reapKept)
      r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
    }
    return n;
  }

  /** Unknown or partial observations are not evidence that a provider has no work left behind. */
  private unsettledChildren(r: Rec): boolean {
    const children = r.s.agentChildren;
    return !children || children.coverage !== 'complete' || children.active === null || children.active > 0 || this.observedChildrenBusy(r);
  }
  private observedChildrenBusy(r: Rec): boolean {
    return (r.s.agentChildren?.children.some(child => ['running', 'waiting', 'unknown'].includes(child.state)) ?? false) || this.delegatedBusy(r.s.id);
  }
  /** A delegated child still owes this chat its result (open, no agent_report yet): the parent waits for it. */
  private delegatedBusy(parentId: string): boolean {
    for (const c of this.chats.values()) if (c.s.parentId === parentId && !c.s.closedAt && c.s.delegation && !c.s.delegation.result) return true;
    return false;
  }

  /** The chats this one delegated (agent_delegate), oldest first. */
  delegatedBy(parentId: string): ChatSummary[] {
    return this.list().filter(c => c.parentId === parentId);
  }

  /** A delegated chat's agent_report (agents/delegation.ts checked it): the result is kept on the chat and its run, its
   *  assignment completes at the end of this turn, and the parent gets it as a message at once (it reopens a closed
   *  parent). At most one per delegation. */
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean } {
    const r = this.need(chatId), d = r.s.delegation, parentId = r.s.parentId;
    if (!d || !parentId) throw new Error('agent_report: only a delegated chat reports (agent_delegate started it); report to the Orchestrator with send_to_chat.');
    if (d.result) throw new Error('agent_report: this delegation already has its result.');
    const at = Date.now(), met = result.doneWhen.filter(x => x.met).length;
    r.s.delegation = { ...d, result: { outcome: result.outcome, summary: result.summary, at } };
    const run = r.s.run;
    if (run && run.endedAt === undefined) {
      run.report = { at, outcome: result.outcome, verified: met === result.doneWhen.length ? 'yes' : met ? 'partial' : 'no', summary: cut(result.summary, 140) };
      this.runSave();
    }
    r.report = { text: result.summary, at, ...(result.outcome === 'blocked' ? { blocked: true } : {}) };
    this.persist();
    this.updated(r);
    const parent = this.chats.get(parentId);
    if (parent) {
      this.updated(parent); // its waiting on this child may be over
      this.send(parentId, resultMessage(d.role, r.s.title, result), undefined, false, r.s.title)
        .catch(e => log.warn('chats', 'delegation result not delivered', { chat: parentId, cause: errText(e), hint: 'the result stays on the child chat; agent_children lists it' }));
    }
    log.info('chats', 'delegation reported', { chat: chatId, data: { parent: parentId, outcome: result.outcome, met, criteria: result.doneWhen.length } });
    return { parentId, delivered: !!parent };
  }

  /** agent_delegate refused by a delegation limit: the parent's transcript says so and the chat carries the mark. */
  limitNotice(chatId: string, kind: DelegationLimitHit['kind'], limit: number): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    r.s.limitHit = { kind, limit, at: Date.now() };
    this.addItem(r, sysItem(kind === 'depth' ? 'delegationDepth' : 'delegationParallel', { limit }, 'warn'), false);
    this.updated(r);
  }

  /** Synchronous last resort (before app.exit, will-quit, process exit): a detached taskkill /T for every CLI process
   *  still alive, never waited for (it finishes the tree after the app is gone; the CLI itself dies with libuv's
   *  kill-on-close job). Never blocks: the bounded wait is shutdown's (killLeft). No-op when nothing is alive.
   *  `sync`: the process exits right now (its 'exit' event). Otherwise (before app.exit: shutdown may have hit its cap
   *  before killLeft) the guard's helper stays for the quit's booster (jobguard.ts quit). */
  killAll(sync = false): void {
    const loose = this.takeLeft(sync);
    if (loose.length) killTrees(loose.map(x => x.pid), { fallback: () => { for (const x of loose) x.killNow(); } });
  }

  /** shutdown's last kill: like killAll, then waits (without blocking) at most `ms` for those processes to die; the
   *  ones still alive go with what `kids` pictured them starting. */
  private async killLeft(ms: number, kids: (pid: number) => number[], spawnMs: number): Promise<void> {
    const loose = this.takeLeft(false);
    const started = new Map(loose.map(x => [x.pid, x.startedAt ?? 0]));
    // their tree kill (taskkill /T) already runs since shutdown's killNow: no second one to spawn
    if (loose.length) await killTreesWithin(loose.map(x => x.pid), ms, { started: { spawnMs }, kids, after: (pids, at) => reapAfterQuit(pids.map(pid => ({ pid, created: started.get(pid) ?? 0, exited: at }))) });
  }

  /** The CLI processes still alive and not killed yet, marked killed; engines in a Job Object end with the guard's
   *  handles (kill-on-close, no taskkill), so only the others ("loose") are returned. `sync`: no await may follow
   *  (process exit), so the guard's helper is ended at once; otherwise it closes the jobs and stays for the quit's
   *  booster (jobguard.ts quit). */
  private takeLeft(sync: boolean): HarnessSession[] {
    // a killed pid stays "alive" until the loop runs 'close' again: never taskkill it twice (1-40 s each)
    const left = [...this.chats.values()].map(r => r.session).concat(this.warm.current?.session ?? null).filter((x): x is HarnessSession => !!x && x.alive && !x.gone && !!x.pid && !this.killedPids.has(x.pid));
    if (!left.length) return [];
    log.warn('chats', 'killing CLI processes still alive at quit', { data: { pids: left.map(x => x.pid) } });
    for (const x of left) if (x.pid) this.killedPids.add(x.pid);
    const loose = left.filter(x => !jobGuard.has(x.jobHandle));
    if (loose.length < left.length) { if (sync) jobGuard.stop(); else void jobGuard.closeAll(); }
    return loose;
  }

  /** Claude engine status: found, path, version (from a session or the background `claude --version`). */
  cliStatus(): CliStatus {
    const p = resolveClaude(this.opts.enginePaths?.claude ?? null)?.path ?? null;
    const found = !!p && fs.existsSync(p);
    if (found && !this.version && !this.probing) {
      this.probing = true;
      void cliVersion(p).then(v => { if (v && !this.version) { this.version = v; log.info('chats', 'claude CLI', { data: { path: p, version: v } }); } });
    }
    return { found, path: p, version: this.version, loggedIn: null };
  }

  /** The app runs this session (full id or an id prefix of 8+ chars, as chats.mjs prints): the brain's poll skips it. */
  isOwnSession(idOrPrefix: string): boolean {
    const p = String(idOrPrefix ?? '').trim().toLowerCase();
    if (p.length < 8) return false;
    return [...this.chats.values()].some(r => !!r.s.sessionId && r.s.sessionId.toLowerCase().startsWith(p));
  }

  // ---- internals ----

  /** Calls a brain hook; a hook that throws is logged and never breaks the chat. */
  private hook(name: string, fn: () => void): void {
    try { fn(); } catch (e) {
      log.error('chats', `hook ${name} failed`, { cause: errText(e), hint: 'fix the listener wired in src/main/wiring.ts; the chat itself is unaffected' });
    }
  }

  /** First send of a job: the first prompt for the ledger. */
  private startJob(r: Rec, prompt: string): void {
    r.jobNew = false;
    r.firstPrompt = prompt;
  }

  /** Starts the chat's engine if it is not running (a resumed Cursor chat: waits until its replayed past has landed). */
  private async ensureSession(r: Rec): Promise<void> {
    updateActivity.assertOpen();
    if (r.releasing) await r.releasing; // never into an engine released for idleness: it ends, then this resumes
    if (!r.session) {
      this.needOn(r.s.harness);
      this.startSession(r);
      // a resumed chat on an engine that replays its past while it opens (ACP): let it land before this message, in order
      const started = r.session as HarnessSession | null;
      if (started?.ready && engineOf(r.s.harness)?.caps.transcript === false && isUuid(r.s.sessionId)) r.opening = started.ready;
    }
    if (r.opening) { await r.opening; r.opening = undefined; }
  }

  /** One hand-off turn: the request goes to the chat (shown as a short line, not as the user's message) and the
   *  answer's text between the markers comes back; null when the chat ended, timed out or answered off format. */
  private async askHandoff(r: Rec, reason: NonNullable<HandoffOptions['reason']>, quiet = false): Promise<string | null> {
    await this.ensureSession(r);
    const sess = r.session;
    if (!sess) return null;
    // a cold note never runs a tool (no now.md line): one short answer on a warm cache
    const text = handoffRequest({ title: r.s.title, reason, contextTokens: r.s.contextTokens ?? null, memTool: quiet ? null : this.opts.memTool?.() ?? null });
    const out = await this.quietTurn(r, sess, text, quiet, () => {
      if (quiet) return;
      r.s.handoffBusy = true;
      this.addItem(r, sysItem('handoffAsking', undefined, 'info'), false);
      this.updated(r);
    });
    return out === null ? null : extractHandoff(out);
  }

  /** One turn of the app's own (a hand-off, an Orchestrator's day compaction), not of the job: its assistant texts come back
   *  joined, null when it was stopped, failed or timed out (then interrupted, its late items still swallowed); `quiet` =
   *  its items stay out of the tile but the system lines. `before` runs once the turn is armed, before the text goes. */
  private quietTurn(r: Rec, sess: HarnessSession, text: string, quiet: boolean, before?: () => void): Promise<string | null> {
    const answer = new Promise<string | null>(resolve => {
      // no answer in time (e.g. a permission nobody answers): the turn is stopped, so a late answer is never taken as a real turn
      const timer = setTimeout(() => {
        finish(null);
        // the stopped turn's last items still belong to the hand-off (markers hidden, not a job turn), then it is over
        // (never for long: a failed interrupt or a CLI that never answers must not block the chat's next turns)
        const drain = (): void => { clearTimeout(expire); if (r.handoffTurn?.done === drain) r.handoffTurn = undefined; };
        const expire = setTimeout(drain, 30_000);
        expire.unref();
        r.handoffTurn = { texts: new Map(), done: drain, ...(quiet ? { quiet } : {}) };
        sess.interrupt().catch(e => { drain(); log.debug('chats', 'hand-off turn not interrupted', { chat: r.s.id, data: errText(e) }); });
      }, this.opts.handoffTimeoutMs ?? 300_000);
      timer.unref();
      const finish = (t: string | null): void => {
        clearTimeout(timer);
        if (r.handoffTurn?.done !== finish) return;
        r.handoffTurn = undefined;
        delete r.s.handoffBusy;
        this.updated(r);
        resolve(t);
      };
      r.handoffTurn = { texts: new Map(), done: finish, ...(quiet ? { quiet } : {}) };
    });
    before?.();
    try { sess.send(text); } catch (e) { r.handoffTurn?.done(null); return Promise.reject(e); }
    return answer;
  }

  /** A chat sent mail (send_to_chat): to the Orchestrator it is its report (#86, ADR 0084), read at its turn's end. */
  noteMail(chatId: string, toChatId: string | null, text: string): void {
    const r = this.chats.get(chatId), to = toChatId ? this.chats.get(toChatId) : undefined;
    if (!r || !to || r.s.isOrchestrator || !to.s.isOrchestrator) return;
    r.report = { text, at: Date.now() };
    // mailed while idle (a tool call never runs outside a turn, but a late hook might): settle it now
    if (r.s.state === 'idle' && !r.session?.busy && r.s.lastResult) { this.settleReport(r); this.updated(r); }
  }

  /** At a clean turn end: who its last answer and report say it waits for (waitsOn) and, for an assigned worker that
   *  reported and waits for nobody, its assignment completed and its agent run ended "completed" (#86, ADR 0084). The
   *  auto-close then closes it after the delay (closedBy "auto"); a question, permission or background task holds it. */
  private settleReport(r: Rec, item?: Extract<ChatItem, { kind: 'result' }>): void {
    const answer = lastAnswer(r.items), report = r.report;
    const fresh = report && (report.at >= (r.s.work?.updatedAt ?? 0));
    const who = waitsForPeople(answer) ?? (fresh ? waitsForPeople(report.text) : null);
    if (who) r.s.waitsOn = who; else delete r.s.waitsOn;
    if (fresh && !r.s.waitsOnWork && waitsForWork(report.text)) r.s.waitsOnWork = true;
    const clean = item ? !item.isError && !item.interrupted : !!r.s.lastResult && !r.s.lastResult.isError && !r.s.lastResult.interrupted;
    if (!fresh || !clean || report.blocked || who || r.s.waitsOnWork || r.s.work?.status !== 'assigned' || r.pending.size > 0 || (r.s.background ?? 0) > 0) return;
    r.s.work = { status: 'completed', updatedAt: Date.now() };
    r.autoCompleted = true;
    this.autoActivity(r);
    this.endRunOf(r, 'completed');
    try { this.persist(true); } catch (e) { log.warn('chats', 'completed assignment not saved', { chat: r.s.id, cause: errText(e), hint: 'it is saved with the next change' }); }
    log.info('chats', 'assignment completed by its final report', { chat: r.s.id });
  }

  /** A new message from the Orchestrator to a worker the app completed: it is a new assignment (#86). */
  private reassignOnOrchestrator(r: Rec, from?: string): void {
    if (!r.autoCompleted || !from || r.s.work?.status !== 'completed') return;
    if (!from.includes(ORCHESTRATOR_TITLE)) return;
    r.autoCompleted = false; delete r.report;
    r.s.work = { status: 'assigned', updatedAt: Date.now() };
    try { this.persist(true); } catch { /* saved with the next change */ }
  }

  /** A result arrived: the job ledger gets the turn; the plan windows are refreshed now and then. */
  private turnEnded(r: Rec, item: Extract<ChatItem, { kind: 'result' }>): void {
    const handoffTurn = r.handoffTurn;
    if (handoffTurn) {
      // stopped or failed (max tokens, cancelled): a cut answer is not a hand-off; the app writes its own note
      // a hand-off cut by a network error is given up too: Cursor's automatic "continua" would write it as a job turn
      const cut = item.isError || !!item.interrupted;
      if (cut) { r.handoffStopped = true; r.session?.noRetry?.(); }
      handoffTurn.done(cut ? null : [...handoffTurn.texts.values()].join('\n\n'));
      return; // not a turn of the job: no ledger entry
    }
    r.turnSinceDone = true; r.lastTurnAt = item.at;
    r.ctxSince ??= item.at;
    r.s.lastResult = { at: item.at, isError: item.isError, ...(item.interrupted ? { interrupted: true } : {}) };
    // "Aspetto la QA…": its work still runs, whatever the engine counts (shared/waiting.ts, the chats of 2026-10-16)
    if (waitsForWork(lastAnswer(r.items))) r.s.waitsOnWork = true; else delete r.s.waitsOnWork;
    // the agent's run-report, if this turn ends with one (the latest wins; a turn without one keeps the last); a run
    // ended during this turn (its Orchestrator marked it completed) still takes it
    const run = r.s.run, turnAt = r.turnAt;
    // still running after the result: a queued turn follows at once (no state change starts it), and it starts now
    if (r.s.state === 'running') r.turnAt = item.at; else delete r.turnAt;
    const reply = turnReply(r.items), runReport = reportOf(reply, item.at);
    if (run && (run.endedAt === undefined || (turnAt !== undefined && run.endedAt >= turnAt))) {
      if (runReport) { run.report = runReport; this.runSave(); }
    }
    // a run-report block is a final report too (the Orchestrator reads it with the turn's end): "blocked" waits on it
    if (runReport) r.report = { text: runReport.summary, at: item.at, ...(runReport.outcome === 'blocked' ? { blocked: true } : {}) };
    this.settleReport(r, item);
    const first = r.firstPrompt;
    r.firstPrompt = null;
    const on = this.opts.onTurnEnd;
    if (on) {
      const info: TurnEndInfo = {
        chatId: r.s.id, sessionId: r.s.sessionId, harness: r.s.harness, model: r.s.model, effort: r.s.effort,
        ...(first ? { firstPrompt: first } : {}),
        costUsd: item.costUsd, durationMs: item.durationMs, turns: item.turns, isError: item.isError,
        reply: turnReply(r.items),
      };
      this.hook('onTurnEnd', () => on(info));
    }
    this.askUsage(r);
  }

  /** Asks a live Claude session for get_usage, at most once per usageEveryMs: the plan windows for the top bar and, in
   *  a running turn, its real cost so far (claude.ts). Busy chats take turns, so each one's live cost gets corrected. */
  private askUsage(prefer?: Rec): void {
    const rate = this.opts.onRateLimit;
    if (!rate || Date.now() - this.lastUsageAt < (this.opts.usageEveryMs ?? 60000)) return;
    const live = (x: Rec | undefined): x is Rec => !!x?.session?.alive && !!engineOf(x.s.harness)?.caps.usage;
    const all = [...this.chats.values()].filter(live);
    const busy = all.filter(x => x.session?.busy);
    const next = busy.length ? busy[(busy.findIndex(x => x.s.id === this.lastUsageChat) + 1) % busy.length] : undefined;
    const r = live(prefer) ? prefer : next ?? all[0];
    if (!r?.session) return;
    this.lastUsageAt = Date.now();
    this.lastUsageChat = r.s.id;
    r.session.usage().then(u => { if (u) this.hook('onRateLimit', () => rate(u)); })
      .catch(e => log.debug('chats', 'get_usage not answered', { chat: r.s.id, data: errText(e) }));
  }

  /** The Orchestrator role moves elsewhere: the chat stays as a normal one. Its live process keeps the app-control tools it
   *  was started with, so it is closed now (idle) or after this turn: the next message resumes it without them. */
  private demoteOrchestrator(r: Rec): void {
    r.s.isOrchestrator = false;
    this.persist();
    const sess = r.session;
    if (sess && !sess.busy && r.pending.size === 0) void this.closeKeeping(r, sess);
    else if (sess) r.reopen = true;
    log.info('chats', 'orchestrator role moved away', { chat: r.s.id });
    this.updated(r);
  }

  private unarchive(r: Rec): void {
    // an engine the auto-close kept for its cold note is live again: idle release and the cold timer see it
    if (r.closeAfterCold && r.session?.alive && r.s.state === 'closed') r.s.state = r.session.busy ? 'running' : 'idle';
    r.closeAfterCold = false;
    delete r.s.closedAt;
    delete r.s.closedBy;
    this.persist();
    log.info('chats', 'chat reopened', { chat: r.s.id });
    this.updated(r);
  }

  /** Only the newest MAX_ARCHIVED archived chats stay in the app. */
  private pruneArchived(): void {
    const old = [...this.chats.values()].filter(r => r.s.closedAt).sort((a, b) => (b.s.closedAt ?? 0) - (a.s.closedAt ?? 0)).slice(MAX_ARCHIVED);
    for (const r of old) {
      this.chats.delete(r.s.id);
      this.opts.emitter.emit('chat:removed', { chatId: r.s.id });
    }
  }

  /** A chat started from a role is a run; a store that cannot record leaves the chat as it is (logged). */
  private startRun(r: Rec, s: Omit<Parameters<AgentRunStore['start']>[0], 'chatId' | 'startedAt'>): void {
    if (this.runs.problem) return;
    try {
      r.s.run = this.runs.start({ ...s, chatId: r.s.id, startedAt: r.createdAt });
      r.idleSince = r.createdAt;
    } catch (e) { log.warn('chats', 'agent run not recorded', { chat: r.s.id, cause: errText(e), hint: 'the chat works; this run is missing from the agent metrics' }); }
  }

  /** Ends a run and, below it, every open run it spawned (a child never ends its parent). */
  private finishRun(run: AgentRun | undefined, reason: AgentRunEnd, at = Date.now()): void {
    if (!run || run.endedAt !== undefined) return;
    const r = this.chats.get(run.chatId), mine = !!r && r.s.run === run;
    if (mine) this.ranUntil(r!, at);
    endRun(run, reason, at);
    this.hook('agent lifecycle', () => this.opts.onRunEnded?.(structuredClone(run)));
    log.info('chats', 'agent run ended', { chat: run.chatId, data: { runId: run.runId, reason } });
    for (const child of this.runs.children(run.runId)) this.finishRun(child, 'closed', at);
    if (!mine) return;
    // its cost, tokens and time now live in the run: the analytics row may be pruned when the archive is full
    this.hook('analytics', () => this.analytics.rolledUp(r!.s));
    this.updated(r!);
  }
  /** A running turn of the open run stops counting at `at` (a state change, or the run's end). */
  private ranUntil(r: Rec, at: number): void {
    const run = r.s.run, since = r.runningSince;
    delete r.runningSince;
    if (since === undefined || !run || run.endedAt !== undefined || typeof run.executionMs !== 'number') return;
    run.executionMs += Math.max(0, at - since);
    this.runs.touch();
  }
  private endRunOf(r: Rec, reason: AgentRunEnd, at = Date.now()): void {
    if (!r.s.run || r.s.run.endedAt !== undefined) return;
    this.finishRun(r.s.run, reason, at);
    this.runSave();
  }
  /** Nothing waits on the user any more: an open run's stale clock starts again from now (kept in chats.json). */
  private idleAgain(r: Rec): void {
    r.idleSince = Date.now();
    if (r.s.run && r.s.run.endedAt === undefined) this.persist();
  }
  private runSave(): void {
    if (this.runs.problem) return;
    try { this.runs.save(); } catch (e) { log.warn('chats', 'agent runs not saved', { cause: errText(e), hint: 'the next run change writes them again' }); }
  }

  /** The role gate (agents/role-gate.ts) on a request before it reaches the user: an assigned skill is allowed at once,
   *  an unassigned one, an engine sub-agent other than a search and a request beyond the delegating chat's permissions
   *  are refused, visibly. True = answered here. */
  private gated(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    const owner = r.s.agent, parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (owner?.source !== 'catalog' || r.s.isOrchestrator) return false;
    const verdict = gateRequest(req, { role: { id: owner.id, name: owner.name }, skills: r.skills ?? [],
      ...(r.s.parentId ? { parent: { policy: parent ? parent.policy ?? null : r.policy ?? null, title: parent?.s.title ?? r.s.parentId } } : {}) });
    if (verdict.kind === 'pass') return false;
    if (verdict.kind === 'allow') {
      r.session?.answer(req.id, { kind: 'permission', allow: true });
      log.info('chats', 'role gate allowed', { chat: r.s.id, data: { tool: req.tool } });
      return true;
    }
    this.addItem(r, sysItem(verdict.code, verdict.params, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: verdict.message });
    log.info('chats', 'role gate refused', { chat: r.s.id, data: { tool: req.tool, code: verdict.code } });
    return true;
  }

  /** A role that may only read commands (shell-read): a command it asks to run that does not only read is refused at
   *  once, visibly, and never reaches the user; one that reads reaches the user without "always" (a rule would let
   *  later commands through unchecked). */
  private refusedCommand(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type !== 'permission' || req.tool !== 'Bash' && req.tool !== 'PowerShell' && req.tool !== 'Shell' || !commandsReadOnly(r.policy)) return false;
    const command = (req.input as { command?: unknown } | null)?.command;
    if (readOnlyCommand(command)) { req.noAlways = true; delete req.alwaysRules; return false; }
    const shown = typeof command === 'string' ? command.slice(0, 120) : req.tool;
    log.info('chats', 'command refused: read-only role', { chat: r.s.id, data: { tool: req.tool } });
    this.addItem(r, sysItem('commandReadOnly', { command: shown }, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: `This role may only run commands that read (shell-read): ${shown} was refused. Use a reading command, or report what you need to your parent.` });
    return true;
  }

  /** Each request once per run, by its id: question, permission or command. */
  private countRequest(r: Rec, req: Pick<PendingRequest, 'id' | 'type'>): void {
    const run = r.s.run;
    if (!run || run.endedAt !== undefined || r.pending.has(req.id)) return;
    const seen = r.runSeen ??= new Set();
    if (seen.has(req.id)) return;
    seen.add(req.id);
    if (seen.size > 1000) seen.delete(seen.values().next().value!);
    run.counters[req.type === 'question' ? 'questions' : req.type === 'permission' ? 'permissions' : 'commands']++;
    this.runSave();
  }

  private need(chatId: string): Rec {
    const r = this.chats.get(chatId);
    if (!r) throw new Error('Chat non trovata.');
    return r;
  }

  private restore(c: StoredChat): Rec {
    const restored = new AgentChildrenReducer(c.agentChildren);
    restored.end();
    const children = new AgentChildrenReducer(restored.snapshot());
    if (engineOf(c.harness)?.kind === 'api') children.coverage('complete');
    // agent-runs.json is the source of truth; a mirror it does not know (a lost or reset file) is taken back
    // (not one already pruned into the rollups: that mirror is dropped, and the chat remembers it was pruned)
    const run = c.run && (this.runs.get(c.run.runId) ?? (this.runs.problem ? c.run : this.runs.adopt(c.run)));
    const runPruned = run ? undefined : c.run ? c.run.runId : c.runPruned;
    return {
      ...(runPruned ? { runPruned } : {}),
      s: {
        agent: restoredOwner(c),
        ...(run ? { run } : {}),
        ...(c.work ? {work:c.work} : {}),
        effortStatus: initialEffort(!!engineOf(c.harness)?.caps.effort, c.effort),
        agentChildren: children.snapshot(),
        id: c.id, harness: c.harness, origin: 'app', title: c.title, cwd: c.cwd, sessionId: c.sessionId, model: c.model, effort: c.effort,
        permissionMode: c.permissionMode, state: 'closed', costUsd: 0, pending: 0, isOrchestrator: c.isOrchestrator, lastText: '', updatedAt: c.closedAt ?? c.createdAt, browserTabIds: [],
        ...(engineOf(c.harness)?.caps.cost ? {} : { costKnown: false as const }),
        ...(c.context ? { contextTokens: c.context.tokens, ...(c.context.max ? { contextMaxTokens: c.context.max } : {}), ...(c.context.estimated ? { contextEstimated: true } : {}) } : {}),
        ...(c.handoffAt ? { handoffAt: c.handoffAt, handoffSource: c.handoffSource ?? 'chat' } : {}),
        ...(c.continuedFrom ? { continuedFrom: c.continuedFrom } : {}), ...(c.continuedBy ? { continuedBy: c.continuedBy } : {}),
        ...(c.closedAt ? { closedAt: c.closedAt, closedBy: c.closedBy ?? 'auto' } : {}),
        ...(c.route ? { route: c.route } : {}),
        ...(c.parentId ? { parentId: c.parentId } : {}),
        ...(c.delegation ? { delegation: c.delegation } : {}),
      },
      createdAt: c.createdAt,
      agentInstructions: c.agentInstructions ?? '',
      ...(c.agentAssets ? { agentAssets: c.agentAssets } : {}),
      ...(c.agentSkills ? { skills: c.agentSkills } : {}),
      ...(c.agentPolicy ? { policy: c.agentPolicy } : {}),
      ...(c.agentMaxContext ? { maxContext: c.agentMaxContext } : {}),
      children,
      choice: { model: c.model, effort: c.effort, permissionMode: c.permissionMode },
      ...(c.forkFrom ? { forkFrom: c.forkFrom } : {}),
      worktree: false,
      ...(c.inWorktree ? { inWorktree: true } : {}),
      costTotalUsd: c.costTotalUsd ?? 0,
      working: c.working === true,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: false, firstPrompt: null, turnSinceDone: false, // a restored chat continues a job begun in an earlier run
      lastTurnAt: c.lastTurnAt ?? 0,
      ...(c.run && c.runIdleSince ? { idleSince: c.runIdleSince } : {}),
      ...(c.coldNoteAt ? { coldNoteAt: c.coldNoteAt } : {}),
      // saved before ctxSince existed: its last turn is the latest its context can have begun
      ...(c.ctxSince || c.lastTurnAt ? { ctxSince: c.ctxSince ?? c.lastTurnAt } : {}),
      ...(c.pastSessions?.length ? { pastSessions: c.pastSessions } : {}),
    };
  }

  private persist(strict = false): void {
    const rows: StoredChat[] = [...this.chats.values()].map(r => ({
      id: r.s.id, harness: r.s.harness, cwd: r.s.cwd, sessionId: r.s.sessionId, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}),
      ...(r.s.agent ? { agent: r.s.agent, agentInstructions: r.agentInstructions ?? '' } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      ...(r.skills ? { agentSkills: r.skills } : {}),
      ...(r.policy ? { agentPolicy: r.policy } : {}),
      ...(r.maxContext ? { agentMaxContext: r.maxContext } : {}),
      ...(r.s.run ? { run: r.s.run, ...(r.idleSince ? { runIdleSince: r.idleSince } : {}) } : r.runPruned ? { runPruned: r.runPruned } : {}),
      ...(r.s.agentChildren ? { agentChildren: r.s.agentChildren } : {}),
      ...(r.s.work ? {work:r.s.work} : {}),
      title: r.s.title, model: r.choice.model, effort: r.choice.effort, permissionMode: r.choice.permissionMode, isOrchestrator: r.s.isOrchestrator,
      createdAt: r.createdAt, costTotalUsd: r.costTotalUsd, ...(r.inWorktree ? { inWorktree: true } : {}),
      ...(r.lastTurnAt ? { lastTurnAt: r.lastTurnAt } : {}),
      ...(r.coldNoteAt ? { coldNoteAt: r.coldNoteAt } : {}),
      ...(r.ctxSince ? { ctxSince: r.ctxSince } : {}),
      ...(r.pastSessions?.length ? { pastSessions: r.pastSessions } : {}),
      ...(r.s.contextTokens ? { context: { tokens: r.s.contextTokens, ...(r.s.contextMaxTokens ? { max: r.s.contextMaxTokens } : {}), ...(r.s.contextEstimated ? { estimated: true } : {}) } } : {}),
      ...(r.s.handoffAt ? { handoffAt: r.s.handoffAt, handoffSource: r.s.handoffSource ?? 'chat' } : {}),
      ...(r.s.continuedFrom ? { continuedFrom: r.s.continuedFrom } : {}), ...(r.s.continuedBy ? { continuedBy: r.s.continuedBy } : {}),
      ...(r.s.closedAt ? { closedAt: r.s.closedAt, closedBy: r.s.closedBy ?? 'auto' } : {}),
      ...(r.working ? { working: true as const } : {}),
      ...(r.s.route ? { route: r.s.route } : {}),
      ...(r.s.parentId ? { parentId: r.s.parentId } : {}),
      ...(r.s.delegation ? { delegation: r.s.delegation } : {}),
    }));
    if (strict) this.store.checkpoint(rows); else this.store.save(rows);
  }

  /** Explicit update consent permits closing idle CLI sessions, including partially observable providers.
   * Unlike automatic archive, this does not assert a complete child census or delete/archive any chat. */
  updateReadiness(): string | null {
    for (const r of this.chats.values()) {
      const c = r.s;
      if (r.working || r.session?.busy || c.state === 'running' || c.state === 'starting' || c.pending || c.queued || workBehind(c) ||
        r.pending.size || r.deliveryHolds || r.opening || r.releasing || r.switching || r.archiving || r.handoffTurn ||
        c.agentChildren?.children.some(x => x.state === 'running' || x.state === 'waiting')) return 'Una chat ha attività o richieste in corso. Attendi prima di aggiornare.';
    }
    return null;
  }
  checkpointForUpdate(): void {
    if (!updateActivity.frozen) throw new Error('Salvataggio chat richiesto senza pausa aggiornamento.');
    const problem = this.updateReadiness(); if (problem) throw new Error(problem);
    for (const id of this.chats.keys()) this.flushItems(id);
    this.persist(true);
  }

  private updated(r: Rec): void {
    const now = Date.now();
    r.s.updatedAt = now;
    // work time: starting or running counts; waiting for the user, idle, closed do not
    const working = (r.s.state === 'starting' || r.s.state === 'running') && !r.handoffTurn; // a hand-off turn is no work of the job
    if (working && r.s.workSince === undefined) r.s.workSince = now;
    else if (!working && r.s.workSince !== undefined) {
      r.s.workMs = (r.s.workMs ?? 0) + now - r.s.workSince;
      delete r.s.workSince;
    }
    this.flushItems(r.s.id); // streamed words held for the next step reach the UI before the new state ("finito")
    this.opts.emitter.emit('chat:updated', { ...r.s });
  }

  /** Work time so far (the span in progress included). */
  workMs(chatId: string): number {
    const s = this.chats.get(chatId)?.s;
    return s ? (s.workMs ?? 0) + (s.workSince !== undefined ? Date.now() - s.workSince : 0) : 0;
  }

  private addItem(r: Rec, item: ChatItem, replace: boolean): void {
    let rep = false;
    if (replace) {
      for (let i = r.items.length - 1; i >= 0; i--) if (r.items[i]?.id === item.id) { r.items[i] = item; rep = true; break; }
    }
    if (!rep) {
      r.items.push(item);
      if (r.items.length > this.max) r.items.splice(0, r.items.length - this.max);
    }
    this.emitItem(r.s.id, item, rep);
  }

  /** Streaming without flooding IPC: newer versions of the same item within 100 ms collapse into one event (at most
   *  10 flushes a second per chat: the screen shows streamed text in steps, "Lag nell'app" 2026-10-12). A new item
   *  first flushes what is pending, so the order on screen is kept. */
  private emitItem(chatId: string, item: ChatItem, replace: boolean): void {
    if (replace) {
      let b = this.coalesce.get(chatId);
      if (!b) {
        const timer = setTimeout(() => this.flushItems(chatId), 100);
        timer.unref();
        b = { items: new Map(), timer };
        this.coalesce.set(chatId, b);
      }
      b.items.set(item.id, item);
      return;
    }
    this.flushItems(chatId);
    this.opts.emitter.emit('chat:item', { chatId, item, replace: false });
  }

  private flushItems(chatId: string): void {
    const b = this.coalesce.get(chatId);
    if (!b) return;
    clearTimeout(b.timer);
    this.coalesce.delete(chatId);
    for (const item of b.items.values()) this.opts.emitter.emit('chat:item', { chatId, item, replace: true });
  }

  private dropPending(r: Rec, requestId: string): void {
    if (!r.pending.delete(requestId)) return;
    if (!r.pending.size && !r.commandsOpen?.size) this.idleAgain(r);
    this.hook('analytics', () => this.analytics.resolved(r.s, requestId));
    r.s.pending = r.pending.size;
    this.opts.emitter.emit('pending:resolved', { chatId: r.s.id, requestId });
    this.updated(r);
  }

  /** Loads the transcript's past once (resumed or forked chats), before any new item. */
  private ensureHistory(r: Rec): void {
    if (r.historyLoaded) return;
    r.historyLoaded = true;
    if (!engineOf(r.s.harness)?.caps.transcript) return;
    // the sessions before its cold continuations come first, each closed by its divider (ADR 0031)
    const past: ChatItem[] = [];
    for (const p of r.pastSessions ?? []) {
      const f = findTranscript(p.sessionId, r.s.cwd, this.home);
      try { if (f) past.push(...readHistory(f, { cwd: r.s.cwd, maxItems: this.max }).items); } catch (e) {
        log.warn('chats', 'past session not readable', { chat: r.s.id, data: { file: f, error: errText(e) } });
      }
      past.push(coldDivider(p.sessionId, p.at, p.notePath));
    }
    if (past.length) r.items = [...past, ...r.items].slice(-this.max);
    const sid = r.s.sessionId ?? r.forkFrom;
    if (!sid) return;
    const file = findTranscript(sid, r.s.cwd, this.home);
    if (!file) return;
    try {
      const h = readHistory(file, { cwd: r.s.cwd, maxItems: this.max });
      r.items = [...past, ...h.items, ...r.items.slice(past.length)].slice(-this.max);
      if (!r.s.lastText && h.lastText) r.s.lastText = h.lastText;
      // the CLI restores a session's spend on resume (2.1.277+): its total is the baseline for per-turn costs
      if (h.costTotalUsd !== null && !r.costTotalUsd) r.costTotalUsd = h.costTotalUsd;
      if (h.title && (r.s.title === 'Nuova chat' || r.s.title === 'Fork')) r.s.title = r.forkFrom ? `${h.title} (fork)` : h.title;
      log.info('chats', 'history loaded', { chat: r.s.id, data: { items: h.items.length, file: path.basename(file) } });
    } catch (e) {
      log.warn('chats', 'history not readable', { chat: r.s.id, data: { file, error: errText(e) } });
    }
  }

  /** min(ceiling, Brother's mode) for this start. Claude without a chat choice follows his settings, so their default is
   *  read here (passing --permission-mode replaces it); other engines narrow through their own options (ceiling). */
  private modeFor(r: Rec): PermissionMode | null {
    const ceiling = r.policy?.ceiling ?? null, chosen = r.choice.permissionMode;
    if (!ceiling) return chosen;
    const brother = chosen ?? (engineOf(r.s.harness)?.kind === 'claude' ? claudeDefaultMode(r.s.cwd, { ...process.env, ...this.opts.env }) : null);
    return brother && aboveCeiling(brother, ceiling) ? ceiling : chosen;
  }

  /** Which of the app's browser tools the chat's role may use (tool-policy.ts browserAccess): the per-chat MCP serves
   *  all of them, only the reading ones, or none. */
  browserAccess(chatId: string): BrowserAccess {
    return browserAccess(this.chats.get(chatId)?.policy);
  }

  private mcpConfig(chatId: string): string | null {
    const url = this.opts.mcpUrlFor?.(chatId) ?? null;
    const app = this.appMcpFor(this.chats.get(chatId));
    const servers: Record<string, { type: 'http'; url: string }> = {};
    if (url) servers['second-brain'] = { type: 'http', url };
    if (app) servers['second-brain-app'] = { type: 'http', url: app };
    return Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null;
  }

  /** the app-control endpoint of an Orchestrator, null for any other chat */
  private appMcpFor(r: Rec | undefined): string | null {
    if (!r) return null;
    if (r.s.isOrchestrator) return this.opts.appMcpUrl?.(r.s.id) ?? null;
    return null;
  }

  private startSession(r: Rec): void {
    r.agentPrimed = false;
    r.s.effortStatus = initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort);
    const chatId = r.s.id;
    let sessionId = r.s.sessionId;
    let resume = false, fork = false;
    const engine = engineOrThrow(r.s.harness);
    if (!engine.caps.transcript) resume = isUuid(sessionId); // session/load; a new one gets its id from session/new
    else if (!sessionId && r.forkFrom) { sessionId = r.forkFrom; resume = true; fork = true; }
    else if (isUuid(sessionId) && findTranscript(sessionId, r.s.cwd, this.home)) resume = true;
    else if (!isUuid(sessionId)) { sessionId = crypto.randomUUID(); r.s.sessionId = sessionId; this.persist(); }
    const past = resume ? r.children?.snapshot() : undefined;
    r.children = new AgentChildrenReducer(past);
    r.children.coverage(engine.kind === 'api' ? 'complete' : 'unknown');
    r.s.agentChildren = r.children.snapshot();
    const extraArgs = this.extraArgsFor(r.s.harness, chatId, r);
    const opts: SessionOptions = {
      chatId, cwd: r.s.cwd, model: r.choice.model, effort: r.choice.effort, permissionMode: this.modeFor(r), title: r.s.title,
      ...(r.policy ? { toolPolicy: r.policy.tools, ceiling: r.policy.ceiling } : {}),
      ...(r.agentAssets ? { agentAssets: r.agentAssets } : {}),
      sessionId, resume, fork, worktree: r.worktree && !resume, mcpConfig: this.mcpConfig(chatId), costBaseUsd: r.costTotalUsd,
      compactWindowTokens: r.maxContext ?? this.compactWindow(),
      // Native subagents inherit this environment: a per-chat model cannot prove a memory event's producer.
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    r.worktree = false; // created once; a resume re-enters it
    let sess: HarnessSession | null = null;
    const sink = this.sinkFor(r, () => sess);
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    sess = this.newSession(engine.id, opts, sink, r);
    r.session = sess;
    this.updated(r);
    sess.start();
  }

  /** pre-allowed on Claude: the Orchestrator's app-control tools (/mcp/app), and every chat's mail to other chats and
   *  delegation tools (app-tool-approval.ts; mail is text only, labelled as not the user's; the auto-mode classifier sometimes refused the same message sent
   *  with Bash, 12/10). r = undefined: a warm engine (warm.ts), never an Orchestrator. */
  private extraArgsFor(harness: Harness, chatId: string, r: Rec | undefined): string[] | null {
    const allowed = !engineOf(harness)?.caps.preAllow ? [] : [
      ...(this.appMcpFor(r) ? ['mcp__second-brain-app'] : []),
      ...(this.opts.mcpUrlFor?.(chatId) ? APP_CHAT_TOOLS.map(t => `mcp__second-brain__${t}`) : []),
    ];
    return this.opts.extraArgs || allowed.length ? [...(this.opts.extraArgs ?? []), ...(allowed.length ? ['--allowedTools', allowed.join(',')] : [])] : null;
  }

  /** An agent's message (from = its sender) never wakes a stopped chat (closed, or its engine released for idleness) on
   *  an engine the Orchestrators may not use: it would resume that engine for an agent. A running chat gets it as before. */
  private needAgentMay(r: Rec, from: string | undefined): void {
    if (from === undefined || r.session || this.opts.agentsMayOpen?.(r.s.harness) !== false) return;
    throw new AgentMayNotWake(r.s.harness);
  }

  /** Refuses an engine the user switched off (Impostazioni → Motori): nothing starts on it, whoever asks. */
  private needOn(h: Harness): void {
    if (this.opts.engineOn?.(h) === false) throw new Error(`${engineOrThrow(h).label} è spento nelle impostazioni: riaccendilo in Impostazioni → Motori.`);
  }

  /** A session on an engine: the test factory if given, else the engine's own adapter (engines/sessions.ts). The Orchestrator
   *  on any engine gets the app-control tools (app_create_chat…); r = undefined: a warm engine, never an Orchestrator. */
  private newSession(harness: Harness, opts: SessionOptions, sink: SessionSink, r: Rec | undefined): HarnessSession {
    if (this.opts.sessionFactory) return this.opts.sessionFactory(harness, opts, sink);
    const override = this.opts.enginePaths?.[harness];
    return sessionFor(engineOrThrow(harness), opts, sink, {
      userData: this.opts.userData, mcpUrl: this.opts.mcpUrlFor?.(opts.chatId) ?? null, appMcpUrl: this.appMcpFor(r),
      showReplay: !r?.items.length, acpModelConfig: this.acpModelConfig(), key: () => this.opts.keyFor?.(harness) ?? null,
      ...(override ? { path: override } : {}), ...(this.opts.appVersion ? { appVersion: this.opts.appVersion } : {}),
    });
  }

  /** A Claude engine for the next new chat in cwd: its chat id, session id and MCP endpoint are chosen now; no model,
   *  effort, mode or title (the user's defaults until the chat sends its own as control requests). */
  private spawnWarm(cwd: string): WarmEngine | null {
    if (updateActivity.frozen) return null;
    const chatId = `c_${crypto.randomBytes(5).toString('hex')}`;
    const sessionId = crypto.randomUUID();
    const extraArgs = this.extraArgsFor('claude', chatId, undefined);
    const opts: SessionOptions = {
      chatId, cwd, model: null, effort: null, permissionMode: null, title: null, sessionId, resume: false, fork: false, worktree: false,
      mcpConfig: this.mcpConfig(chatId), costBaseUsd: 0, compactWindowTokens: this.compactWindow(),
      env: { ...this.opts.env, SB_EVENT_CONTEXT: '' }, ...(extraArgs ? { extraArgs } : {}),
    };
    const sink = new BufferedSink();
    const session = this.newSession('claude', opts, sink, undefined);
    session.start();
    return { chatId, sessionId, cwd, session, sink, at: Date.now() };
  }

  /** The new chat r takes the waiting engine: what it reported so far is replayed into the chat, then the chat's own
   *  choices go as control requests; a send waits for them (r.opening). A refused choice → a fresh engine with flags. */
  private adoptWarm(r: Rec, w: WarmEngine): void {
    const sess = w.session;
    r.session = sess;
    r.s.state = 'starting';
    r.activeAt = Date.now();
    delete r.s.lastError;
    w.sink.attach(this.sinkFor(r, () => sess));
    this.updated(r);
    const c = r.choice;
    const title = r.s.title !== 'Nuova chat' ? r.s.title : null;
    log.info('chats', 'warm engine adopted', { chat: r.s.id, data: { waitedMs: Date.now() - w.at, state: sess.state, model: c.model, effort: c.effort, permissionMode: c.permissionMode } });
    r.opening = (async () => {
      try {
        // a warm engine still starting: its start-up must not eat the controls' own timeout
        await sess.ready;
        if (c.model) await sess.setModel(c.model);
        if (c.effort) await sess.setEffort(c.effort);
        if (c.permissionMode) await sess.setPermissionMode(c.permissionMode);
      } catch (e) {
        log.warn('chats', 'warm engine refused the chat choices: starting a fresh one', { chat: r.s.id, data: errText(e) });
        if (r.session === sess) {
          r.session = null;
          void sess.close(1000);
          r.s.sessionId = crypto.randomUUID(); // never two engines on one session id
          this.startSession(r);
        }
        return;
      }
      // the name the CLI keeps for /resume (a cold start passes --name); never blocks the first message
      if (title) sess.rename(title).catch(e => log.warn('chats', 'warm engine rename failed', { chat: r.s.id, data: errText(e) }));
    })();
  }

  /** The chat's side of a session: every report lands in r while current() is r's session. */
  private sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink {
    const chatId = r.s.id;
    const live = (): boolean => { const sess = current(); return !!sess && r.session === sess && this.chats.get(chatId) === r; };
    return {
      item: (item, replace) => {
        if (!live()) return;
        this.hook('analytics', () => this.analytics.item(r.s, item, replace));
        this.autoActivity(r);
        if (r.handoffTurn && item.kind === 'assistant') {
          r.handoffTurn.texts.set(item.id, item.text);
          // the markers are for the app: the transcript shows the note without them
          item = { ...item, text: item.text.split('\n').filter(l => l.trim() !== HANDOFF_START && l.trim() !== HANDOFF_END).join('\n') };
        }
        // a cold note's turn stays out of the tile (ADR 0031): only its result settles the turn
        if (r.handoffTurn?.quiet && item.kind !== 'system') { if (item.kind === 'result' && !replace) this.turnEnded(r, item); return; }
        this.addItem(r, item, replace);
        // a skill Claude loaded while the run is open joins its tags (only Claude reports skills as a tool)
        if (item.kind === 'tool' && item.name === 'Skill' && r.s.harness === 'claude' && r.s.run) {
          const input = item.input as { skill?: unknown; command?: unknown } | null;
          if (addSkill(r.s.run, input?.skill ?? input?.command)) { this.runs.touch(); this.runSave(); }
        }
        if (item.kind === 'result' && !replace) this.turnEnded(r, item);
      },
      pending: req => {
        if (!live()) return;
        if (this.gated(r, req) || this.refusedCommand(r, req)) return;
        this.hook('analytics', () => this.analytics.pending(r.s, req));
        this.autoActivity(r);
        const full: PendingRequest = { ...req, chatId };
        this.countRequest(r, req);
        r.pending.set(req.id, full);
        r.s.pending = r.pending.size;
        this.opts.emitter.emit('pending:added', full);
        this.updated(r);
        const on = this.opts.onWaiting;
        if (on) this.hook('onWaiting', () => on(chatId, full));
      },
      rateLimit: msg => { const on = this.opts.onRateLimit; if (live() && on) this.hook('onRateLimit', () => on(msg)); },
      commands: list => { if (live()) r.commands = list; },
      models: list => { const on = this.opts.onModels; if (live() && on) this.hook('onModels', () => on(r.s.harness, list)); },
      children: observation => {
        if (!live()) return;
        this.autoActivity(r);
        const children = r.children ??= new AgentChildrenReducer();
        if (!children.observe(observation)) return;
        r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      childrenCoverage: (coverage, reason) => {
        if (!live()) return;
        const children = r.children ??= new AgentChildrenReducer();
        if (reason === 'exit' && r.autoEnding && children.snapshot().coverage === 'complete' && children.snapshot().active === 0) return;
        children.coverage(coverage); r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      resolved: id => { if (this.chats.get(chatId) === r) this.dropPending(r, id); },
      changed: p => { if (live()) this.applyPatch(r, p); },
      exit: ({ error }) => {
        const sess = current();
        if (!sess || this.chats.get(chatId) !== r || r.session !== sess) return;
        this.hook('analytics', () => this.analytics.end(r.s));
        r.session = null;
        const verifiedEmpty = r.autoEnding && !error && r.children?.snapshot().coverage === 'complete' && r.children.snapshot().active === 0;
        if (engineOf(r.s.harness)?.kind !== 'api' && !verifiedEmpty) r.children?.end();
        if (r.children) r.s.agentChildren = r.children.snapshot();
        // gone mid-turn (crash, close, kill): no result will settle the estimate, which stays as spent (no "≈")
        delete r.s.costLiveUsd;
        delete r.turnAt; // its turn is over, result or not
        r.handoffTurn?.done(null);
        delete r.s.background; // its background tasks died with it
        // died mid-turn with an error while the app runs: no result will come, so no onDone either; tell the brain now
        const crashed = !!error && r.working && !this.quitting;
        if (!this.quitting) r.working = false; // a crash while the app runs shows as an error, it is not resumed later
        if (error) r.s.lastError = error;
        if (error) delete r.s.resumedAt; // a resume that failed is no "ripresa": the error shows alone
        if (r.s.state !== 'error') r.s.state = error ? 'error' : r.releasing ? 'idle' : 'closed';
        this.persist();
        this.updated(r);
        const onCrash = this.opts.onCrash;
        if (crashed && error && onCrash) this.hook('onCrash', () => onCrash(chatId, error));
      },
    };
  }

  /** the compaction window for the next Claude engine (setting compactWindowTokens; 0 = the user's settings) */
  private compactWindow(): number {
    try { return this.opts.compactWindowTokens?.() ?? 0; } catch { return 0; }
  }

  private acpModelConfig(): { reasoning: CursorReasoning | ''; fast: boolean } | null {
    try { return this.opts.acpModelConfig?.() ?? null; } catch (e) { log.warn('chats', 'ACP model settings not read', { data: errText(e) }); return null; }
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    this.hook('analytics', () => this.analytics.patch(r.s, p));
    if (!(r.autoClosing || r.autoEnding) || p.state !== 'closed') this.autoActivity(r);
    let save = false;
    if ('effortSubmitted' in p) r.s.effortStatus = submitEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortSubmitted);
    if ('effortSessionDefault' in p) r.s.effortStatus = { ...(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort)), sessionDefault: effortValue(p.effortSessionDefault) };
    if (p.state) {
      const was = r.s.state;
      // a cold note's turn is invisible (ADR 0031): the tile stays as it was
      if (!(r.handoffTurn?.quiet && (p.state === 'running' || p.state === 'starting'))) r.s.state = p.state;
      // a hand-off turn is not the chat's work: never resumed after a restart
      if ((p.state === 'running' || p.state === 'waiting') && !r.working && !r.handoffTurn) { r.working = true; save = true; }
      // idle only once the CLI's queue is empty: a queued turn starts with no state change, so not cleared per result
      if (p.state === 'idle' && r.working) { r.working = false; save = true; }
      // the turn is over and nothing waits for the user: "done" (once per turn, never at boot)
      if (p.state === 'idle' && was !== 'idle' && r.turnSinceDone && r.pending.size === 0) {
        r.turnSinceDone = false;
        const on = this.opts.onDone;
        if (on) this.hook('onDone', () => on(r.s.id));
      }
      // a Cursor model change or an Orchestrator role change asked mid-turn: reopen now that the turn is over
      if (p.state === 'idle' && r.reopen && r.session && !r.session.busy) {
        r.reopen = false;
        void this.closeKeeping(r, r.session);
      }
    }
    if (p.sessionId && p.sessionId !== r.s.sessionId) { r.s.sessionId = p.sessionId; delete r.forkFrom; save = true; }
    if (p.model) r.s.model = p.model;
    // shown, never persisted: only the user's own choice (create / chat:set) is saved and used on the next start,
    // so a mode the CLI took from a suggestion or ExitPlanMode does not outlive this process
    if (p.permissionMode) r.s.permissionMode = p.permissionMode;
    // second guard: a mode the engine took on its own (ExitPlanMode, a suggestion, its settings) above the ceiling is
    // set back at once
    if (p.permissionMode && r.policy && aboveCeiling(p.permissionMode, r.policy.ceiling) && r.session) {
      const ceiling = r.policy.ceiling!;
      log.warn('chats', 'agent mode above its ceiling, set back', { chat: r.s.id, data: { mode: p.permissionMode, ceiling } });
      r.s.permissionMode = ceiling;
      void r.session.setPermissionMode(ceiling).catch(e => log.error('chats', 'agent ceiling not restored', { chat: r.s.id, cause: errText(e), hint: 'stop the chat: its mode is above the agent ceiling' }));
    }
    if (p.effort !== undefined) r.s.effort = p.effort;
    if (p.contextTokens !== undefined) r.s.contextTokens = p.contextTokens;
    const run = r.s.run;
    // A fresh submission also starts a turn while Claude is still running after its previous result (delayed idle).
    if ('effortSubmitted' in p && !r.handoffTurn) r.turnAt = Date.now();
    if (p.state === 'running' && !r.handoffTurn) r.turnAt ??= Date.now();
    // out of the turn with no result (a crash, a clean exit mid-turn): the next turn starts its own clock
    else if (p.state === 'idle' || p.state === 'error' || p.state === 'closed') delete r.turnAt;
    // execution time: only while running (waiting on Brother, a permission or the queue is not), never a hand-off note
    if (p.state && run && run.endedAt === undefined) {
      if (p.state === 'running' && !r.handoffTurn) r.runningSince ??= Date.now();
      else if (p.state !== 'running') this.ranUntil(r, Date.now());
    }
    if (run && run.endedAt === undefined) {
      if (p.contextTokens !== undefined && p.contextTokens > (run.counters.contextPeak ?? 0)) { run.counters.contextPeak = p.contextTokens; this.runs.touch(); }
      // a settled turn (its result): what it cost while the run was open
      if (p.turnCostUsd !== undefined) { addTurn(run, p.costKnown === false ? null : p.turnCostUsd, p.turnTokens); this.runs.touch(); this.runSave(); }
    }
    if (p.contextMaxTokens !== undefined) r.s.contextMaxTokens = p.contextMaxTokens;
    if (p.turnCostUsd !== undefined || p.liveCostUsd !== undefined) {
      // costUsd = settled turns + the running turn's estimate; a result settles it (its real cost replaces the estimate)
      const live = r.s.costLiveUsd ?? 0;
      const settled = r.s.costUsd - live + (p.turnCostUsd ?? 0);
      const next = p.liveCostUsd ?? (p.turnCostUsd !== undefined ? 0 : live);
      r.s.costUsd = Math.round((settled + next) * 1e6) / 1e6;
      if (next > 0) r.s.costLiveUsd = Math.round(next * 1e6) / 1e6; else delete r.s.costLiveUsd;
    }
    if (p.contextEstimated === true) r.s.contextEstimated = true;
    else if (p.contextEstimated === false) delete r.s.contextEstimated;
    if (p.costKnown === true) delete r.s.costKnown;
    else if (p.costKnown === false && !r.s.costUsd) r.s.costKnown = false;
    if (p.totalCostUsd !== undefined) { r.costTotalUsd = p.totalCostUsd; save = true; }
    if (p.lastText !== undefined) r.s.lastText = p.lastText;
    if (p.background !== undefined) {
      if (p.background > 0) r.s.background = p.background;
      else if (r.s.background) { delete r.s.background; r.s.backgroundEndedAt = r.activeAt = Date.now(); }
    }
    if (p.version) this.version = p.version;
    if (p.call) {
      const a = r.after;
      if (a) { a.left--; if (a.left <= 0) r.after = undefined; }
      this.counters.call(r.s.id, p.call, a ? a.kind : null);
    }
    if (p.compacted) {
      this.counters.compaction(r.s.id, p.compacted.pre, p.compacted.post);
      r.after = { kind: 'compaction', left: AFTER_CALLS };
      // the context starts again from its summary: an Orchestrator's next day compaction counts from now
      r.ctxSince = Date.now(); save = true;
    }
    if (p.contextTokens !== undefined && p.contextTokens > 0) save = true; // the meter of a closed chat survives a restart
    if (save) this.persist();
    this.updated(r);
  }
}
