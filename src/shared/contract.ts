// The one contract between the main process and the renderer: data shapes, invoke channels (renderer → main, with a
// result) and event channels (main → renderer). The preload exposes exactly these channels and nothing else
// (src/preload/index.ts reads INVOKE_CHANNELS / EVENT_CHANNELS); main registers a handler for every invoke channel
// (src/main/ipc.ts) and rejects senders that are not the app's own page. Change a shape here first, then both sides.

export type Harness = 'claude' | 'cursor';

/** running: the model is working · waiting: a question/permission needs the user · idle: turn ended, input open ·
 *  starting: process booting · error: the process failed (see lastError) · closed: process gone (can be resumed). */
export type ChatState = 'starting' | 'running' | 'waiting' | 'idle' | 'error' | 'closed';

/** app = runs inside the app (we own the process). The only origin in v1 (ADR 0010: no coexistence with other apps). */
export type ChatOrigin = 'app';

export interface ChatSummary {
  id: string;                 // app id (stable across resumes)
  harness: Harness;
  origin: ChatOrigin;
  title: string;
  cwd: string;
  sessionId: string | null;   // the CLI session id (claude: transcript uuid; cursor: chat id)
  model: string | null;       // e.g. "claude-opus-5-5"; null = the CLI default
  effort: Effort | null;
  permissionMode: PermissionMode | null;
  state: ChatState;
  costUsd: number;            // cumulative for this app run (API-equivalent on a subscription)
  contextTokens?: number;
  contextMaxTokens?: number;  // the model's context window (with contextTokens: the context bar)
  /** estimate made at the first send of the job (vs the actual costUsd): null = "stima senza dati", absent = none asked */
  estimate?: (Estimate & { basis: number }) | null;
  /** false = the engine reports no usage (Cursor over ACP today): costUsd is 0 for lack of data, show the estimate */
  costKnown?: false;
  pending: number;            // open questions/permissions
  isRegia: boolean;
  lastText: string;           // last assistant line, for collapsed tiles and the needs-you lane
  lastError?: string;
  updatedAt: number;
  browserTabIds: string[];    // internal browser tabs this chat drives
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions';

export type ChatItem =
  | { kind: 'user'; id: string; at: number; text: string; images?: number }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; at: number; text: string }
  | { kind: 'tool'; id: string; at: number; name: string; summary: string; input: unknown; status: 'running' | 'ok' | 'error'; output?: string; diff?: FileDiff[] }
  | { kind: 'system'; id: string; at: number; text: string; level: 'info' | 'warn' | 'error' }
  | { kind: 'result'; id: string; at: number; costUsd: number; durationMs: number; turns: number; isError: boolean };

export interface FileDiff { path: string; added: number; removed: number; patch?: string }

export interface QuestionOption { label: string; description?: string }
export interface Question { question: string; header?: string; options: QuestionOption[]; multiSelect: boolean }

export interface PendingRequest {
  id: string;                 // request id (unique per chat)
  chatId: string;
  type: 'permission' | 'question';
  tool: string;               // tool name ("Bash", "Write", "AskUserQuestion", "mcp__x__y")
  title: string;              // one line: what is being asked
  detail: string;             // the command / path / description to show
  input: unknown;
  questions?: Question[];     // type = question
  at: number;
  noAlways?: boolean;         // permission: do not offer "always allow" (the CLI forbids a rule for this ask, or has none)
  alwaysRules?: string[];     // permission: what "always allow" grants, for this session only ("Bash(git push:*)", "modalità: accetta modifiche")
}

export type Answer =
  | { kind: 'permission'; allow: boolean; always?: boolean; message?: string }
  | { kind: 'question'; answers: Record<string, string | string[]> };

export interface NewChat {
  harness: Harness;
  cwd: string;
  prompt?: string;
  title?: string;
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  resumeSessionId?: string;   // resume (or fork, see fork) an existing CLI session
  fork?: boolean;             // resume as a copy: never two writers on one session
  regia?: boolean;
  worktree?: boolean;         // claude --worktree
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  ownerChatId: string | null; // the chat that drives it (null = the user's own tab)
  lastAction?: string;        // "click ref_12", for the tile header
  /** A recent snapshot as a data: URL (JPEG), for thumbnails and the frozen frame shown while the view is hidden under an overlay. */
  thumb?: string;
  /** Tab group: 'user' (the user's own), 'chat:<chatId>' (an app chat), 'mcp:<session>' (an external MCP client). */
  group?: string;
  active?: boolean;           // the group's current tab (the one its agent acts on when no tabId is given)
  dialog?: string;            // a JavaScript dialog waiting for the agent ("confirm: Sei sicuro?")
  handoffId?: string;         // an open hand-off to the user on this tab (BrowserHandoff.id)
  /** The tab's environment: its own persistent session (cookies, storage), shared only by tabs of the same env. */
  env?: string;
  envColor?: string;          // stable color of the env (the same in every tile, every run)
  session?: BrowserSessionStatus; // sign-in state of the env
}

/** An agent asks the user to act in a tab (login, MFA, CAPTCHA): a banner until they click Fatto (done) or Non riesco (failed). */
/** Sign-in state of an environment: valid · expiring (auth cookie expires within 24 h) · expired (a login page, or the
 *  auth cookie that was there is gone) · unknown (nothing seen yet). */
export type BrowserSessionStatus = 'valid' | 'expiring' | 'expired' | 'unknown';

/** A browser environment = one persistent session partition (persist:env-<id>). Never carries cookies or secrets. */
export interface BrowserEnv {
  id: string;                 // "example-test-3", "local"
  color: string;
  hosts: string[];            // hosts seen in it (host:port), newest first
  tabIds: string[];           // open tabs in it
  createdAt: number;
  lastUsedAt: number;
  lastLoginAt: number | null; // last sign-in seen (login page left, auth cookie set, or a login hand-off done)
  lastUrl?: string;           // origin + path of its last page (no query: no tokens), to reopen it with one click
  session: BrowserSessionStatus;
  sessionDetail: string;      // Italian, one line ("l'accesso scade il 12/10, 18:30")
  authExpiresAt: number | null;
  /** cookies encrypted at rest (Electron fuse EnableCookieEncryption, DPAPI-protected key); null = unknown */
  encryptedAtRest: boolean | null;
}

export interface BrowserHandoff {
  id: string;
  tabId: string;
  chatId: string | null;      // the app chat that asked (null = an external MCP client)
  reason: string;             // one line: "Login richiesto"
  instructions: string;       // what the user should do
  url: string;
  state: 'open' | 'done' | 'failed' | 'cancelled';
  note?: string;              // the user's note when resolving
  at: number;
  resolvedAt?: number;
  env?: string;               // the environment of the tab
  kind?: 'login' | 'other';   // login = "rifai l'accesso a <env>": the user signs in, the env keeps the session
}

export interface Rect { x: number; y: number; width: number; height: number }
/** Where each visible browser tab is drawn (tiles report their rects; hidden = not on screen or under an overlay).
 *  `views:layout` carries the COMPLETE set of visible tabs: a tab missing from the list (or with rect null) is hidden. */
export interface ViewLayout { tabId: string; rect: Rect | null }

export type Priority = 'urgent' | 'normal' | 'quiet';
export interface FeedEvent {
  id: string;
  at: number;
  kind: string;               // 'chat-waiting' | 'chat-done' | 'error' | 'idea' | 'reflection' | 'win' | ...
  label: string;              // Italian label of the kind ("Idea aggiunta")
  priority: Priority;
  title: string;
  detail: string;
  who?: string;
  chatId?: string;
  file?: string;
  away?: boolean;             // happened while the app was closed
}

export interface AppInfo {
  version: string;
  brainRoot: string | null;
  mcpUrl: string;
  /** null until the background check finishes (a few seconds after start): ask cli:status for a fresh one. */
  cli: { claude: CliStatus; cursor: CliStatus } | null;
}
export interface CliStatus { found: boolean; path: string | null; version: string | null; loggedIn: boolean | null; account?: string | null }

/** Top-bar usage. todayUsd = Claude at API list price (on a subscription an "equivalent" cost, not a bill), from the
 *  brain's cost.mjs; the plan windows (5 h / 7 d, 0-100) are null when no source has them (see limitsNote). */
export interface Usage {
  todayUsd: number; fiveHourPct: number | null; fiveHourResetsAt: number | null; weekPct: number | null;
  weekResetsAt?: number | null;
  /** where the plan windows come from: a running app chat's stream, a get_usage answer, Claude Code's own 1-hour cache */
  limitsSource?: 'stream' | 'get_usage' | 'claude-cache' | null;
  limitsAt?: number | null;   // when the plan windows were read (ms)
  limitsNote?: string;        // Italian, why they are missing or how old they are
  costKnown?: boolean;        // false = cost.mjs missing or failed: todayUsd is 0 only as a placeholder
  costNote?: string;
  cursorTodayUsd?: number | null; // Cursor's real cost today from its usage export; null = unknown
  cursorNote?: string;
  at?: number;                // when this snapshot was computed
}

// ── Settings (userData/config.json; never secrets) ─────────────────────────────────────────────────────────────────
export type ViewMode = 'mosaico' | 'corsie';
/** Windows toasts: only urgent kinds (default), urgent + normal, or none (in-app feed only). */
export type ToastLevel = 'urgent' | 'normal' | 'off';
export type ThemeMode = 'dark' | 'light' | 'system';
/** warn = feed + toast · ask = also a 'budget:alert' the chat manager turns into a "stop or continue?" question · off */
export type BudgetMode = 'warn' | 'ask' | 'off';
export interface BudgetLimits { mode: BudgetMode; dailyUsd: number | null; perChatUsd: number | null }
export interface BudgetSettings { enabled: boolean; claude: BudgetLimits; cursor: BudgetLimits }
export interface Settings {
  brainRoot: string | null;
  mcpPort: number;
  view: ViewMode;
  mute: Record<string, boolean>;   // feed kind → no toast (still in the feed)
  osToasts: ToastLevel;
  theme: ThemeMode;
  dnd: boolean;                    // do not disturb: no toasts at all
  dndUntil: number | null;         // timed do not disturb (epoch ms): no toasts until then
  engines: { claude: boolean; cursor: boolean }; // harnesses the app may start
  /** Claude <-> Cursor chat mail (inbox.mjs); mirrored in the brain's brain-settings.json so it holds outside the app */
  messaging: { crossHarness: boolean };
  budget: BudgetSettings;
  /** fields forced by the environment (SB_BRAIN, SB_MCP_PORT): shown read-only, never saved */
  locked?: ('brainRoot' | 'mcpPort')[];
}
export type SettingsPatch = Partial<Omit<Settings, 'budget' | 'locked' | 'engines' | 'messaging'>> & {
  engines?: Partial<Settings['engines']>;
  messaging?: Partial<Settings['messaging']>;
  budget?: { enabled?: boolean; claude?: Partial<BudgetLimits>; cursor?: Partial<BudgetLimits> };
};

/** Every setting is one dot key ("view", "budget.claude.dailyUsd", "mute.idea"): the unit of validation, history,
 *  undo and agent permissions. The schema (settings:schema) gives type, default, Italian label and description. */
export type SettingKey =
  | 'brainRoot' | 'mcpPort' | 'view' | 'theme' | 'osToasts' | 'dnd' | 'dndUntil' | 'engines.claude' | 'engines.cursor' | 'messaging.crossHarness' | 'budget.enabled'
  | `budget.${Harness}.${'mode' | 'dailyUsd' | 'perChatUsd'}` | `mute.${string}`;
export interface SettingDef {
  key: SettingKey;            // 'mute.*' stands for every feed kind
  type: 'path' | 'int' | 'boolean' | 'enum' | 'usd';
  default: unknown;
  nullable?: boolean;
  values?: readonly string[]; // enum
  min?: number; max?: number; // int
  label: string;              // Italian
  description: string;        // Italian, one or two sentences
  /** protected: an agent can only propose it; the user confirms with a click (engines, spending limits, notifications
   *  off, security: brain folder, MCP port) */
  protected: boolean;
}
export type ChangeBy = 'user' | 'agent';
/** One applied change (userData/changes.jsonl). An undo is a new change with undoOf; the original gets undone: true. */
export interface SettingChange {
  id: string; at: number; by: ChangeBy; chatId?: string;
  key: SettingKey; before: unknown; after: unknown;
  undone?: boolean; undoOf?: string;
  proposalId?: string;        // applied because the user accepted this agent proposal
}
/** A protected change asked by an agent, waiting for the user's click (settings:confirm). */
export interface SettingProposal {
  id: string; at: number; by: 'agent'; chatId?: string; reason?: string;
  key: SettingKey; label: string; before: unknown; after: unknown;
  status: 'pending' | 'accepted' | 'rejected';
}
/** What an agent's request became: applied at once (non-protected), a proposal (protected), or refused (invalid). */
export type SettingRequestResult = { applied: SettingChange } | { proposal: SettingProposal } | { error: string };

/** A spending threshold crossed (80 % or 100 %). The brain module only reports: it never stops or interrupts anything;
 *  with mode 'ask' the chat manager asks the user "stop or continue". scope: day / one chat / the plan's 5 h or 7 d window. */
export interface BudgetAlert {
  id: string;
  at: number;
  harness: Harness;
  scope: 'day' | 'chat' | 'fiveHour' | 'week';
  chatId?: string;            // the CLI session id (Claude transcript uuid) for scope 'chat'
  chatTitle?: string;
  pct: number;                // 0-100+
  threshold: 80 | 100;
  usd: number | null;         // null for plan windows (they are percentages)
  limitUsd: number | null;
  mode: Exclude<BudgetMode, 'off'>;
  text: string;               // Italian, one line
}

// ── Estimates: cost and time of a job, from similar past jobs (p25-p75) ───────────────────────────────────────────
export type JobKind = 'fix' | 'qa' | 'review' | 'feature' | 'research' | 'question' | 'other';
export interface Estimate { usdLow: number; usdHigh: number; minLow: number | null; minHigh: number | null }
export interface EstimateResult {
  kind: JobKind;
  estimate: Estimate | null;  // null = "stima senza dati" (fewer than 5 similar jobs)
  basis: { count: number; scope: string; label: string }; // label: Italian ("da 12 lavori simili: stesso tipo e modello")
}
export interface JobActual { usd: number; minutes: number | null; tokensIn: number | null; tokensOut: number | null; turns: number | null }
/** Record (or update: same id, last wins) one job in the ledger. The prompt text is never stored: only its length and kind. */
export interface JobRecordInput {
  id?: string;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  prompt?: string;
  kind?: JobKind;
  estimate?: Estimate | null;
  actual?: JobActual | null;
}

/** The brain's own data server (ops/tools/brain-site.mjs), read-only: GET paths under /api/ (tables, now, cost, day,
 *  map, files, file, search, version, status). Never throws for a missing brain server: ok false + error. */
export type BrainApiResult = { ok: true; data: unknown } | { ok: false; error: string };

// ── Global request layer (the user: "se l'IA vuole farmi domande mi compaiano ovunque io stia navigando nell'app") ──
// Questions and permissions not visible elsewhere on screen float in a small top-most WebContentsView (main/overlay.ts),
// above browser tiles and pages. The app page decides what it shows (one source of truth), the layer only renders it.
/** attempt: bumped when an answer failed and the request came back (the layer re-mounts the card, answerable again). */
export interface OverlayCard { key: string; req: PendingRequest; chatTitle: string; harness: Harness; isRegia: boolean; attempt?: number }
export interface OverlayModel {
  cards: OverlayCard[];       // the queue: oldest first; the first is shown in full
  waiting: number;            // all open requests (badge)
  theme: ThemeMode;
  density: 'comfortable' | 'compact';
  focusKey?: string;          // set with a new nonce when the keyboard moves to the layer (Ctrl+J)
  nonce?: number;
  now?: number;               // the app page's clock (frozen in the demo), for "4 min" labels
  /** important events (chat waiting/done, errors, sync, budget, login…) as short toasts above everything, max 2 */
  toasts?: OverlayToast[];
}
export interface OverlayToast {
  id: string;                 // group key (kind|chat)
  kind: string;
  label: string;              // Italian kind label ("Errore registrato")
  title: string;
  detail: string;
  count: number;              // grouped events of this kind (and chat)
  action: string;             // the one direct action: "Apri", "Rispondi"
  tone: 'info' | 'ok' | 'warn' | 'err';
}
/** The overlay page only renders the cards: the app page acts on its behalf. */
export type OverlayAction =
  | { kind: 'answer'; key: string; answer: Answer }
  | { kind: 'postpone'; key: string }       // Esc: off the layer, it stays in "Ti aspettano"
  | { kind: 'open'; key: string }           // show that chat in the app
  | { kind: 'next'; from?: string }         // Ctrl+J inside the layer (from = the card shown, the cycle goes on from it)
  | { kind: 'leave' }                       // keyboard back to the app
  | { kind: 'toast'; id: string; act: 'open' | 'dismiss' }; // an event toast: its action, or ✕

/** renderer → main. Each entry: [argument, result]. */
export interface InvokeMap {
  'app:info': [void, AppInfo];
  'app:usage': [void, Usage];
  'cli:status': [{ harness: Harness; checkLogin?: boolean }, CliStatus];
  'cli:login': [{ harness: Harness }, void];
  'chat:list': [void, ChatSummary[]];
  'chat:items': [{ chatId: string }, ChatItem[]];
  'chat:pending': [void, PendingRequest[]];
  'chat:create': [NewChat, ChatSummary];
  'chat:send': [{ chatId: string; text: string }, void];
  'chat:answer': [{ chatId: string; requestId: string; answer: Answer }, void];
  'chat:stop': [{ chatId: string }, void];
  'chat:stopAll': [void, number];
  'chat:close': [{ chatId: string }, void];
  'chat:set': [{ chatId: string; model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string }, ChatSummary];
  'browser:list': [void, BrowserTab[]];
  'browser:open': [{ url?: string; ownerChatId?: string | null; env?: string }, BrowserTab];
  'browser:navigate': [{ tabId: string; url: string }, void];
  'browser:go': [{ tabId: string; dir: 'back' | 'forward' | 'reload' }, void];
  'browser:close': [{ tabId: string }, void];
  'views:layout': [ViewLayout[], void];
  'browser:handoffs': [void, BrowserHandoff[]];
  'browser:handoffResolve': [{ id: string; outcome: 'done' | 'failed'; note?: string }, void];
  'browser:envList': [void, BrowserEnv[]];
  'feed:list': [void, FeedEvent[]];
  'feed:mute': [{ kind: string; muted: boolean }, void];
  'settings:get': [void, Settings];
  /** The user's own change from the UI (each key logged as a change by 'user'); all keys validated first, all or none */
  'settings:set': [SettingsPatch, Settings];
  'settings:schema': [void, SettingDef[]];
  'settings:history': [{ limit?: number }, SettingChange[]];      // newest first
  'settings:undo': [{ changeId: string }, SettingChange];         // the new change that restores the old value
  /** an agent's request relayed by the UI: non-protected keys apply at once, protected ones become a proposal */
  'settings:propose': [{ key: string; value: unknown; chatId?: string; reason?: string }, SettingRequestResult];
  'settings:pending': [void, SettingProposal[]];
  'settings:confirm': [{ proposalId: string; accept: boolean }, { change: SettingChange | null }];
  'estimate:get': [{ harness: Harness; model: string | null; effort: Effort | null; prompt: string }, EstimateResult];
  'estimate:record': [JobRecordInput, { id: string }];
  'brain:api': [{ path: string }, BrainApiResult];
  /** the app page → main: what the global request layer shows now (main attaches/detaches it and forwards the model) */
  'overlay:model': [OverlayModel, void];
  /** the layer page → main: the size its cards need (main places the layer bottom-right) */
  'overlay:size': [{ width: number; height: number }, void];
  /** the layer page → main → the app page: the user answered / postponed / opened a card, or left the layer */
  'overlay:action': [OverlayAction, void];
  /** move the keyboard to the layer (Ctrl+J, a click) or back to the app; never automatic */
  'overlay:focus': [{ target: 'overlay' | 'app' }, void];
}

/** main → renderer. */
export interface EventMap {
  'chat:updated': ChatSummary;
  'chat:removed': { chatId: string };
  'chat:item': { chatId: string; item: ChatItem; replace?: boolean };
  'pending:added': PendingRequest;
  'pending:resolved': { chatId: string; requestId: string };
  'browser:tabs': BrowserTab[];
  'browser:handoff': BrowserHandoff;   // opened or changed state
  'browser:envs': BrowserEnv[];        // the known environments changed (tabs, session status, last login)
  'feed:events': FeedEvent[];
  'usage': Usage;
  'focus:next': void;
  /** app-control MCP or a notification asks the UI to do something (switch view, focus a chat, open a page). */
  'ui:command': { action: string; value?: string };
  /** one key changed (by the user or an agent), applied live; `settings` = the full effective settings after it */
  'settings:changed': SettingChange & { settings: Settings };
  /** a protected change waits for the user (status pending), or was answered (accepted / rejected) */
  'settings:proposed': SettingProposal;
  'budget:alert': BudgetAlert;
  /** main → the layer page: the cards to show */
  'overlay:model': OverlayModel;
  /** main → the app page: what the user did in the layer */
  'overlay:action': OverlayAction;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;
export type InvokeArg<K extends InvokeChannel> = InvokeMap[K][0];
export type InvokeResult<K extends InvokeChannel> = InvokeMap[K][1];

// Runtime lists (the preload allow-list). Kept in sync with the maps by the compile-time checks below.
export const INVOKE_CHANNELS = [
  'app:info', 'app:usage', 'cli:status', 'cli:login', 'chat:list', 'chat:items', 'chat:pending', 'chat:create', 'chat:send', 'chat:answer', 'chat:stop',
  'chat:stopAll', 'chat:close', 'chat:set', 'browser:list', 'browser:open', 'browser:navigate', 'browser:go',
  'browser:close', 'views:layout', 'feed:list', 'feed:mute', 'settings:get', 'settings:set', 'settings:schema', 'settings:history',
  'settings:undo', 'settings:propose', 'settings:pending', 'settings:confirm', 'estimate:get', 'estimate:record', 'brain:api',
  'browser:handoffs', 'browser:handoffResolve', 'browser:envList', 'overlay:model', 'overlay:size', 'overlay:action', 'overlay:focus',
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = [
  'chat:updated', 'chat:removed', 'chat:item', 'pending:added', 'pending:resolved', 'browser:tabs', 'feed:events', 'usage', 'focus:next', 'ui:command',
  'settings:changed', 'settings:proposed', 'budget:alert', 'browser:handoff', 'browser:envs', 'overlay:model', 'overlay:action',
] as const satisfies readonly EventChannel[];

type Missing<All, Listed> = Exclude<All, Listed>;
// Compile error if a channel is added to a map but not to its runtime list.
const _invokeComplete: Missing<InvokeChannel, (typeof INVOKE_CHANNELS)[number]> extends never ? true : never = true;
const _eventComplete: Missing<EventChannel, (typeof EVENT_CHANNELS)[number]> extends never ? true : never = true;
void _invokeComplete; void _eventComplete;

/** What the preload exposes as window.sb. */
export interface Bridge {
  invoke<K extends InvokeChannel>(channel: K, arg: InvokeArg<K>): Promise<InvokeResult<K>>;
  on<K extends EventChannel>(channel: K, fn: (payload: EventMap[K]) => void): () => void;
}
