// Service interfaces of the main process. index.ts wires them to the IPC handlers; each module implements one.
// Keeping them here lets the modules be built and tested apart (chats, browser + MCP, brain + feed).
import type {
  Answer, AppInfo, BrainApiResult, BrowserEnv, BrowserHandoff, BrowserTab, BudgetAlert, ChangeBy, ChatItem, ChatSummary, Effort, EstimateResult, FeedEvent, Harness, JobRecordInput,
  NewChat, PendingRequest, PermissionMode, SettingChange, SettingDef, SettingProposal, SettingRequestResult, Settings, SettingsPatch, Usage, ViewLayout,
} from '../shared/contract';
import type { Emitter } from './ipc';

export interface ChatService {
  list(): ChatSummary[];
  items(chatId: string): ChatItem[];
  pending(): PendingRequest[];
  create(req: NewChat): Promise<ChatSummary>;
  send(chatId: string, text: string): Promise<void>;
  answer(chatId: string, requestId: string, answer: Answer): Promise<void>;
  stop(chatId: string): Promise<void>;
  stopAll(): Promise<number>;
  close(chatId: string): Promise<void>;
  set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string }): Promise<ChatSummary>;
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
  estimate(req: { harness: Harness; model: string | null; effort: Effort | null; prompt: string }): EstimateResult;
  recordJob(job: JobRecordInput): { id: string };
  /** GET-only proxy to the brain's own data server (ops/tools/brain-site.mjs makeServer), run as an Electron-node child. */
  api(path: string): Promise<BrainApiResult>;
  /** Other modules push events into the same feed + notifications (e.g. the chat manager: an app chat waits for the user). */
  publish(events: FeedInput[]): void;
  /** Plan windows from a running Claude chat: a stream-json `rate_limit_event` or a `get_usage` control response. */
  ingestRateLimits(msg: unknown): void;
  /** The chat manager listens here to turn mode 'ask' alerts into a "stop or continue?" question (never a hard stop). */
  onBudgetAlert(fn: (a: BudgetAlert) => void): () => void;
  shutdown(): Promise<void>;
}

export interface Services {
  chats: ChatService;
  browser: BrowserService;
  brain: BrainService;
  emitter: Emitter;
}
