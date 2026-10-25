// Service interfaces of the main process. index.ts wires them to the IPC handlers; each module implements one.
// Keeping them here lets the modules be built and tested apart (chats, browser + MCP, brain + feed).
import type {
  Answer, AppInfo, ChatCommand, BrainApiResult, CredentialEntry, BrowserEnv, BrowserHandoff, BrowserTab, BudgetAlert, ChangeBy, ChatItem, ChatSummary, CompareState, ContextStats, LearnResult, Effort, FeedAction, FeedEvent, HandoffInfo, Harness, ImageAttachment, JobRecordInput, ModelsSeen, RoutingInfo, RoutingRow,
  NewChat, PendingRequest, PermissionMode, SettingChange, SettingDef, SettingProposal, SettingRequestResult, Settings, SettingsPatch, SyncChoice, SyncState, Usage, ViewLayout, TasksState, SkillCatalog, SkillDoc, SkillSave, SkillSaveResult,
} from '../shared/contract';
import type { AgentMetrics, AgentRunOutcome, UserTaskEvents } from '../shared/agents';
import type { AgentPolicy } from './agents/tool-policy';
import type { TaskAssignmentOptions, TaskSource } from '../shared/delegation';
import type { Emitter } from './ipc';
import type { KnownOutcome, RouteRequest, RouteResult, RoutingActual, RoutingPrediction } from './brain/routing';

export interface ChatService {
  /** Real engine receipts; demos and mocks acknowledge their simulated sends by promise. */
  readonly submissionReceipts?: boolean;
  list(): ChatSummary[];
  items(chatId: string): ChatItem[];
  pending(): PendingRequest[];
  /** the "/" commands the chat's engine reported; null = none yet (ADR 0018) */
  commands(chatId: string): ChatCommand[] | null;
  /** by agent = an agent's chat (app_create_chat): its first turn may wait in the CPU queue (ADR 0036).
   *  opts.boundByOrchestrator: a call from the unauthenticated /mcp/app mount: the chat runs no wider than the open
   *  Orchestrator (refused without one), since any local process can reach that mount */
  create(req: NewChat, by?: 'user' | 'agent', inherited?: undefined, links?: undefined, opts?: { boundByOrchestrator?: boolean }): Promise<ChatSummary>;
  /** images: the chat:send attachments, checked by the service (main/chats/images.ts) */
  /** from = not the user's message: who sent it (another chat, the Orchestrator), shown above the bubble */
  /** liveOnly = mail: fails instead of starting or reopening the chat (main/chats/mail.ts) */
  send(chatId: string, text: string, images?: ImageAttachment[], resumed?: boolean, from?: string, liveOnly?: boolean, source?: TaskSource, receipt?: { beforeSubmit(): void; submitted(): void; failed(error: unknown): void }): Promise<void>;
  /** Assign a versioned task to a compatible existing conversation. */
  agentPolicy?(chatId: string): AgentPolicy | null;
  assignTask?(chatId: string, text: string, options?: TaskAssignmentOptions): Promise<void>;
  userEvents?(chatId: string, afterSeq?: number): UserTaskEvents;
  synthesizeResult?(runId: string, source: TaskSource): Promise<void>;
  answer(chatId: string, requestId: string, answer: Answer): Promise<void>;
  /** a Strategist's proposed plan: the user's «Approva e parti» or «Cambia qualcosa» (ADR 0108) */
  planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string): Promise<void>;
  stop(chatId: string, keepQueued?: boolean): Promise<void>;
  stopAll(): Promise<number>;
  close(chatId: string): Promise<void>;
  /** archive a finished chat (closedAt; out of the grid, reopenable); auto = the auto-close, refused if it went back to work */
  archive(chatId: string, opts?: { auto?: boolean; undoable?: boolean }): Promise<ChatSummary>;
  /** an archived chat back on the grid; its session resumes on the next message */
  reopen(chatId: string): Promise<ChatSummary>;
  /** the user went on with this chat himself (chat:send, chat:reopen only): reopens its ended agent run (A5) */
  resumedByUser?(chatId: string, text?: string): void;
  /** the user's next message to this chat was said in the voice conversation: the reply is made to be heard */
  spokenNext?(chatId: string): void;
  /** the user typed this in the chat himself (chat:send only): the Orchestrator and the chat's parent learn it (ADR 0083) */
  userWrote?(chatId: string, text: string): void;
  /** the agent metrics (AGENTS-DESIGN §5, A6); aiErrors = the brain's ai-errors.md text */
  runMetrics?(opts?: { aiErrors?: string; since?: number; skill?: string; app?: string; repo?: string }): AgentMetrics[];
  /** Explicit user verdict from renderer IPC only; never exposed through agent tools. */
  markRun?(chatId: string, verdict: AgentRunOutcome['verdict'], note?: string): ChatSummary;
  /** a "Comando da eseguire" request was opened in this chat (run/asks.ts): its agent run counts it once (A5) */
  commandAsked?(chatId: string, requestId: string): void;
  /** that request left (run, dismissed, the chat went on) */
  commandDone?(chatId: string, requestId: string): void;
  /** after a start: chats whose turn the last quit (or crash) cut get an automatic "riprendi" message; how many */
  resumeInterrupted(): number;
  /** "Avvia ora": the chat's start or turn waiting in the CPU queue runs now (ADR 0036); false = nothing waited */
  admitNow(chatId: string): boolean;
  /** the user is typing: an engine released for idleness starts ahead of the message (ChatManager.prewarm) */
  prewarm?(chatId: string): boolean;
  /** the CPU queue: the load last sampled and the waiting chats, in order (null = no queue wired) */
  queueState(): { cpu: number; freeRam: number; enabled: boolean; waiting: { chatId: string; kind: 'start' | 'turn'; position: number; since: number }[] } | null;
  set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }): Promise<ChatSummary>;
  /** long chats: the hand-off note (asked to the chat, or built by the app) and "Riprendi" in a new chat */
  readHandoff(chatId: string, session?: string): HandoffInfo | null;
  handoff(chatId: string, opts?: { reason?: 'manual' | 'threshold' | 'finished' | 'continue'; allowStart?: boolean }): Promise<HandoffInfo>;
  /** ask false: never a turn of the chat, only the token-free note (the automatic closing uses it) */
  ensureHandoff(chatId: string, opts?: { allowStart?: boolean; ask?: boolean }): Promise<HandoffInfo>;
  continueChat(chatId: string, opts?: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary>;
  /** ADR 0103: the files back as they were before the chat's last turn */
  undoTurn(chatId: string): Promise<{ restored: number; removed: number }>;
  /** how the Claude chats used their context since the counters started (ADR 0031); absent in the demo */
  contextStats?(): ContextStats;
  shutdown(): Promise<void>;
}

export interface BrowserService {
  list(): BrowserTab[];
  /** env: the environment (session) to open it in; default derived from the url's host (example-test-3, local). */
  open(url: string | undefined, ownerChatId: string | null, env?: string): BrowserTab;
  navigate(tabId: string, url: string): Promise<void>;
  go(tabId: string, dir: 'back' | 'forward' | 'reload'): Promise<void>;
  close(tabId: string): void;
  /** The complete set of visible tabs and their rects in the app window; every other tab is hidden (kept rendering offscreen). */
  layout(views: ViewLayout[]): void;
  /** MCP endpoint for one app chat (its tabs are its own); generic endpoint for external clients. */
  mcpUrlFor(chatId: string | null): string;
  /** Open hand-offs (an agent waits for the user in a tab) and their resolution by the user (Fatto / Non riesco). */
  handoffs(): BrowserHandoff[];
  resolveHandoff(id: string, outcome: 'done' | 'failed', note?: string): void;
  /** The user clicked Copia on a login hand-off: user name or password (read from the credentials file now) to the clipboard. */
  copyFromHandoff(id: string, field: 'user' | 'password'): boolean;
  /** The "Credenziali" panel: entries of the credentials file without passwords, and Copia (password read at the click). */
  credentials(): CredentialEntry[];
  copyCredential(id: string, field: 'user' | 'password'): boolean;
  /** How a chat is woken when the user answers a hand-off its agent no longer waits for (set by wiring). */
  setWake(fn: (chatId: string, text: string) => void): void;
  /** «Affida a un agente» (ADR 0133): a personal tab's view joins the chat's tabs; closing that tab calls back. */
  lend?(chatId: string, view: Electron.WebContentsView, back: () => void): BrowserTab;
  /** Known environments with session status and last sign-in (no cookies, no secrets). */
  envs(): Promise<BrowserEnv[]>;
  /** A chat is gone for good: close its tabs and revoke its MCP endpoint token. */
  forgetChat(chatId: string): void;
  /** Where browser events go into the live feed (set by wiring once the brain exists), e.g. "rifai l'accesso a example-test-3". */
  setFeed(fn: (e: FeedInput) => void): void;
  shutdown(): Promise<void>;
}

/** A feed event before the brain module stamps it (id, time, Italian label and priority come from its kind). */
export interface FeedInput { kind: string; title: string; detail?: string; who?: string; chatId?: string; file?: string; action?: FeedAction }

export interface BrainService {
  feed(): FeedEvent[];
  mute(kind: string, muted: boolean): void;
  usage(): Usage;
  info(): Pick<AppInfo, 'brainRoot' | 'brainProblem'>;
  settings(): Settings;
  /** The user's own change from the UI (by 'user'). */
  setSettings(patch: SettingsPatch): Promise<Settings>;
  settingsSchema(): SettingDef[];
  settingsHistory(limit?: number): SettingChange[];
  undoSetting(changeId: string, by?: ChangeBy, origin?: { chatId?: string; direct?: boolean }): SettingChange;
  /** For the app-control MCP (by 'agent', with its chat id): non-protected keys apply live, protected ones become a
   *  proposal the user confirms with a click. The user's UI calls it with by 'user'. */
  requestSetting(key: string, value: unknown, origin: { by: ChangeBy; chatId?: string; reason?: string; direct?: boolean }): SettingRequestResult;
  pendingSettings(): SettingProposal[];
  confirmSetting(proposalId: string, accept: boolean): { change: SettingChange | null };
  /** Main-process listeners (e.g. the browser module restarts its MCP server on 'mcpPort'). */
  onSettingChange(fn: (c: SettingChange, now: Settings) => void): () => void;
  /** The job's real cost and time, for the brain's ledger (jobs.jsonl: routing reads it, ADR 0053). */
  recordJob(job: JobRecordInput): { id: string };
  /** Model routing (brain/routing.ts, ADR 0032): the table and registry for the settings page. */
  routingInfo(): RoutingInfo;
  /** A new version of the table, refused (throws, Italian) on a broken hard rule: from the user's settings page, or from
   *  an agent (`by` "agente: …" and the data behind the change, `evidence`; app_routing_save). `base` = the version the
   *  edit started from; exploration and costWeight omitted = kept. */
  saveRouting(routes: RoutingRow[], reason: string | null, o?: { exploration?: number; costWeight?: number; by?: string; evidence?: string | null; base?: number }): RoutingInfo;
  /** An older version back in force, as a new version (`by` defaults to the user's page). */
  restoreRouting(version: number, by?: string): RoutingInfo;
  /** Harness, model and effort for a chat an agent opens: the table's row, else `defaults`; an override needs a reason. */
  route(req: RouteRequest): RouteResult;
  /** One line of the improvement loop's shared ledger (ops/state/improve/outcomes.jsonl): a routed chat's prediction or
   *  its measured actuals. */
  observeRouting(rec: RoutingPrediction | RoutingActual): void;
  /** The last actuals written for a ledger id: totals carry over an app restart or a hand-off. */
  lastRoutingActual(id: string): RoutingActual['actual'] | null;
  /** An agent run's verdict as the known outcome of its chat's ledger line (issue #72, ADR 0078). */
  observeRoutingOutcome(id: string, outcome: KnownOutcome): void;
  /** GET-only proxy to the brain's own data server (ops/tools/brain-site.mjs makeServer), run as an Electron-node child. */
  api(path: string): Promise<BrainApiResult>;
  /** Answers one of the allowed /api/ paths from main itself (e.g. /api/quality: brain/quality.ts), not the brain's server. */
  serveApi(path: string, fn: (query: URLSearchParams) => unknown | Promise<unknown>): void;
  /** The brain's model comparisons (brain/compare.ts): list, and switch an experiment or one of its agents. */
  compareList(): Promise<CompareState>;
  compareSet(experiment: string, on: boolean, agent?: string): Promise<CompareState>;
  /** A click of the Miglioramento page: improve.mjs apply|reject|rollback in the brain (brain/learn.ts). */
  learnAct(a: unknown): Promise<LearnResult>;
  /** The models a CLI session offered (brain/models-seen.ts): recorded by the chat manager, read by the Settings page. */
  recordModels(harness: Harness, list: { id: string; name: string }[]): void;
  modelsSeen(): ModelsSeen;
  /** Other modules push events into the same feed + notifications (e.g. the chat manager: an app chat waits for the user). */
  publish(events: FeedInput[]): void;
  /** Plan windows from a running Claude chat: a stream-json `rate_limit_event` or a `get_usage` control response. */
  ingestRateLimits(msg: unknown): void;
  /** The brain's domains and their multi-PC sync (brain/sync.ts, ADR 0059): status, a sync now (one domain or all), the
   *  user's choice on a conflict ('both' also opens the two versions). */
  syncState(): SyncState;
  syncNow(domain?: string): Promise<SyncState>;
  syncResolve(domain: string, choice: SyncChoice): Promise<SyncState>;
  /** Before a chat that reads the brain starts: the remote's changes first (bounded, throttled, never throws). */
  syncBeforeRead(): Promise<void>;
  /** The chat manager listens here to turn mode 'ask' alerts into a "stop or continue?" question (never a hard stop). */
  onBudgetAlert(fn: (a: BudgetAlert) => void): () => void;
  shutdown(): Promise<void>;
}

/** The Task page (tasks/service.ts): read-only reads by the brain's devops-me.mjs, never an AI chat. */
export interface TasksApi {
  get(): TasksState;
  refresh(): Promise<TasksState>;
  refreshFresh(): Promise<TasksState>;
  markRead(keys?: string[]): TasksState;
  /** Each good read (no error), e.g. for the Azure DevOps connector's status (issue #95); returns the unsubscribe. */
  onRead(listener: (s: TasksState) => void): () => void;
  shutdown(): void;
}

/** "Skill e agenti" (skills/service.ts, ADR 0018). */
export interface SkillsApi {
  list(): SkillCatalog;
  read(id: string): SkillDoc;
  save(req: SkillSave): Promise<SkillSaveResult>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  commandsFor(harness: Harness, cwd: string): ChatCommand[];
}

export interface Services {
  chats: ChatService;
  browser: BrowserService;
  brain: BrainService;
  emitter: Emitter;
}
