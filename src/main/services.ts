// Service interfaces of the main process. index.ts wires them to the IPC handlers; each module implements one.
// Keeping them here lets the modules be built and tested apart (chats, browser + MCP, brain + feed).
import type {
  Answer, AppInfo, ChatCommand, BrainApiResult, CredentialEntry, BrowserEnv, BrowserHandoff, BrowserTab, BudgetAlert, ChangeBy, ChatItem, ChatSummary, CompareState, ContextStats, LearnResult, Effort, EstimateResult, FeedEvent, HandoffInfo, Harness, ImageAttachment, JobRecordInput, ModelsSeen, RoutingInfo, RoutingRow,
  NewChat, PendingRequest, PermissionMode, SettingChange, SettingDef, SettingProposal, SettingRequestResult, Settings, SettingsPatch, Usage, ViewLayout, DevopsState, SkillCatalog, SkillDoc, SkillSave, SkillSaveResult,
} from '../shared/contract';
import type { Emitter } from './ipc';
import type { RouteRequest, RouteResult, RoutingActual, RoutingPrediction } from './brain/routing';
import type { PredictionInput } from './brain/brain-estimates';

export interface ChatService {
  list(): ChatSummary[];
  items(chatId: string): ChatItem[];
  pending(): PendingRequest[];
  /** the "/" commands the chat's engine reported; null = none yet (ADR 0018) */
  commands(chatId: string): ChatCommand[] | null;
  /** by agent = an agent's chat (app_create_chat): its first turn may wait in the CPU queue (ADR 0036) */
  create(req: NewChat, by?: 'user' | 'agent'): Promise<ChatSummary>;
  /** images: the chat:send attachments, checked by the service (main/chats/images.ts) */
  /** from = not the user's message: who sent it (another chat, the Regia), shown above the bubble */
  /** liveOnly = mail: fails instead of starting or reopening the chat (main/chats/mail.ts) */
  send(chatId: string, text: string, images?: ImageAttachment[], resumed?: boolean, from?: string, liveOnly?: boolean): Promise<void>;
  answer(chatId: string, requestId: string, answer: Answer): Promise<void>;
  stop(chatId: string, keepQueued?: boolean): Promise<void>;
  stopAll(): Promise<number>;
  close(chatId: string): Promise<void>;
  /** archive a finished chat (closedAt; out of the grid, reopenable); auto = the auto-close, refused if it went back to work */
  archive(chatId: string, opts?: { auto?: boolean }): Promise<ChatSummary>;
  /** an archived chat back on the grid; its session resumes on the next message */
  reopen(chatId: string): Promise<ChatSummary>;
  /** after a start: chats whose turn the last quit (or crash) cut get an automatic "riprendi" message; how many */
  resumeInterrupted(): number;
  /** "Avvia ora": the chat's start or turn waiting in the CPU queue runs now (ADR 0036); false = nothing waited */
  admitNow(chatId: string): boolean;
  /** the CPU queue: the load last sampled and the waiting chats, in order (null = no queue wired) */
  queueState(): { cpu: number; freeRam: number; enabled: boolean; waiting: { chatId: string; kind: 'start' | 'turn'; position: number; since: number }[] } | null;
  set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string }): Promise<ChatSummary>;
  /** long chats: the hand-off note (asked to the chat, or built by the app) and "Riprendi" in a new chat */
  readHandoff(chatId: string, session?: string): HandoffInfo | null;
  handoff(chatId: string, opts?: { reason?: 'manual' | 'threshold' | 'finished' | 'continue'; allowStart?: boolean }): Promise<HandoffInfo>;
  /** ask false: never a turn of the chat, only the token-free note (the automatic closing uses it) */
  ensureHandoff(chatId: string, opts?: { allowStart?: boolean; ask?: boolean }): Promise<HandoffInfo>;
  continueChat(chatId: string, opts?: { allowStart?: boolean; promptPrefix?: string }): Promise<ChatSummary>;
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
  /** Known environments with session status and last sign-in (no cookies, no secrets). */
  envs(): Promise<BrowserEnv[]>;
  /** A chat is gone for good: close its tabs and revoke its MCP endpoint token. */
  forgetChat(chatId: string): void;
  /** Where browser events go into the live feed (set by wiring once the brain exists), e.g. "rifai l'accesso a example-test-3". */
  setFeed(fn: (e: FeedInput) => void): void;
  shutdown(): Promise<void>;
}

/** A feed event before the brain module stamps it (id, time, Italian label and priority come from its kind). */
export interface FeedInput { kind: string; title: string; detail?: string; who?: string; chatId?: string; file?: string }

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
  undoSetting(changeId: string, by?: ChangeBy): SettingChange;
  /** For the app-control MCP (by 'agent', with its chat id): non-protected keys apply live, protected ones become a
   *  proposal the user confirms with a click. The user's UI calls it with by 'user'. */
  requestSetting(key: string, value: unknown, origin: { by: ChangeBy; chatId?: string; reason?: string }): SettingRequestResult;
  pendingSettings(): SettingProposal[];
  confirmSetting(proposalId: string, accept: boolean): { change: SettingChange | null };
  /** Main-process listeners (e.g. the browser module restarts its MCP server on 'mcpPort'). */
  onSettingChange(fn: (c: SettingChange, now: Settings) => void): () => void;
  /** title: the chat's title ("Area · cosa"), what the brain's estimates table is keyed on */
  estimate(req: { harness: Harness; model: string | null; effort: Effort | null; prompt: string; title?: string }): EstimateResult;
  recordJob(job: JobRecordInput): { id: string };
  /** A job's estimate as the brain's self-improvement loop records it, made before the job ran (brain-estimates.ts
   *  predictionLine); false when there is nothing to record (no brain table, not the brain's estimate). */
  recordPrediction(p: PredictionInput): boolean;
  /** Model routing (brain/routing.ts, ADR 0032): the table and registry for the settings page. */
  routingInfo(): RoutingInfo;
  /** The user saves the table from the settings page: a new version, refused (throws, Italian) on a broken hard rule. */
  saveRouting(routes: RoutingRow[], reason: string | null): RoutingInfo;
  /** Harness, model and effort for a chat an agent opens: the table's row, else `defaults`; an override needs a reason. */
  route(req: RouteRequest): RouteResult;
  /** One line of the improvement loop's shared ledger (ops/state/improve/outcomes.jsonl): a routed chat's prediction or
   *  its measured actuals. */
  observeRouting(rec: RoutingPrediction | RoutingActual): void;
  /** The last actuals written for a ledger id: totals carry over an app restart or a hand-off. */
  lastRoutingActual(id: string): RoutingActual['actual'] | null;
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
  /** The chat manager listens here to turn mode 'ask' alerts into a "stop or continue?" question (never a hard stop). */
  onBudgetAlert(fn: (a: BudgetAlert) => void): () => void;
  shutdown(): Promise<void>;
}

/** The DevOps page (devops/service.ts): read-only reads by the brain's devops-me.mjs, never an AI chat. */
export interface DevopsApi {
  get(): DevopsState;
  refresh(): Promise<DevopsState>;
  markRead(keys?: string[]): DevopsState;
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
