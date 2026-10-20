// The one contract between the main process and the renderer: data shapes, invoke channels (renderer → main, with a
// result) and event channels (main → renderer). The preload exposes exactly these channels and nothing else
// (src/preload/index.ts reads INVOKE_CHANNELS / EVENT_CHANNELS); main registers a handler for every invoke channel
// (src/main/ipc.ts) and rejects senders that are not the app's own page. Change a shape here first, then both sides.
import type { SysCode, SysParams } from './sys';
import type { AgentLifecycleDecide, AgentLifecycleSnapshot } from './agent-lifecycle';
import type { PackTarget, PackExportPlan, PackFinding, PackImportReview } from './agent-pack';
/** What the shareable brain zip holds (counts), or why it was not written: guard findings, or no brain / no guard. */
export type BrainShareResult = { ok: true; path: string; skills: number; rules: number; roles: number; scripts: number; skipped: number } | { ok: false; findings: PackFinding[] } | { ok: false; error: string };
import type { BrainModelState, ClassifiersState, MaintenanceJobId } from './brain-model';
import type { ApprovalDecision, ApprovalItem, PulseActResult, PulseDismissReason, PulseList, PulsePlace, PulseResult, PulseStatus, PulseSettings, PulseType } from './pulse';
import type { ConnectorId, ConnectorState } from './connectors';
import type { McpImportCandidate, McpServerDef, McpServersState, McpToolAccess } from './mcp-servers';
import type { FileViewResult } from './file-view';
import type { DiffAgainst, FileDiffResult } from './file-diff';
import type { AgentCatalog, AgentMetrics, AgentMetricsFilter, AgentDraft, AgentOwnerSnapshot, AgentProfile, AgentRun, AgentUndo, AgentVersion, AgentChildren, SetupDraft, SetupState } from './agents';
import type { DelegationSettings, ModelTier, WorkRoleId } from './roles';
import type { ChatDelegation, DelegationLimitHit } from './delegation';
import type { SkillSuggestions } from './skill-suggest';
import type { AutoClosePresence, AutoCloseStatus } from './auto-close';
import type { ChatEffortStatus } from './effort';
import type { ProgressState } from './progress';
import type { CreateBrainRequest, CreatedBrain } from './brain-create';
import type { OwnerProfile, ProfileResult, ProfileSave } from './profile';
import type { AppUpdateState, UpdateCheckpointAnswer, UpdateCheckpointRequest, UpdateRecovery } from './app-update';
import type { CloudAgent, CloudApplyResult, CloudCaps, CloudStartRequest, CloudState } from './cloud';
import type { RunEstimates } from './task-estimate';
export type { CloudAgent, CloudApplyResult, CloudCaps, CloudEngine, CloudMessage, CloudReady, CloudStartRequest, CloudState, CloudStatus } from './cloud';

/** An engine id from the engine registry (src/main/engines/registry.ts, ADR 0046): 'claude', 'cursor', … */
export type Harness = string;
/** The protocol an engine speaks; each kind has one adapter (claude: Claude Code stream-json · acp: Agent Client
 *  Protocol over stdio · codex: `codex app-server` JSON-RPC over stdio, ADR 0060 · api: an HTTP model endpoint, OpenAI-
 *  or Anthropic-compatible, text only). */
export type EngineKind = 'claude' | 'acp' | 'codex' | 'api';
/** What an engine can do. The app asks these, never the engine's name. */
export interface EngineCaps {
  /** an effort level per chat (Claude's --effort) */
  effort: boolean;
  /** the model changes inside a running session (false: the session reopens with the new model) */
  liveModel: boolean;
  /** a chat can be copied with its history (fork) */
  fork: boolean;
  /** an engine started ahead for the next new chat (warm.ts) */
  warm: boolean;
  /** a chat may run in its own git worktree */
  worktree: boolean;
  /** the user picks the permission mode (plan, auto, …) */
  permissionMode: boolean;
  /** true: the app picks the session id and reads the past from the engine's transcript files; false: the engine gives
   *  the id and replays the past itself when a session is loaded */
  transcript: boolean;
  /** the engine reports each turn's cost */
  cost: boolean;
  /** the engine answers the plan's usage windows (get_usage) */
  usage: boolean;
  /** the engine takes a list of pre-allowed tools at start (--allowedTools) */
  preAllow: boolean;
  /** the engine works with tools (files, shell, MCP: the browser, the app's tools); false = text only (api) */
  tools: boolean;
  /** the engine's cloud agents (ADR 0080; shared/cloud.ts CLOUD_CAPS): absent = none */
  cloud?: CloudCaps;
}
/** An engine as the renderer sees it: label = short ("Claude"), name = full ("Claude Code"). */
export interface EngineInfo {
  id: Harness; label: string; name: string; kind: EngineKind; caps: EngineCaps;
  /** app = built in or one of the app's presets; brain = an entry of the brain's harness/models.json */
  source: 'app' | 'brain';
  /** whether it takes the user's API key: required (api), optional (a CLI that also has its own login), none */
  key: 'required' | 'optional' | 'none';
  /** how it starts, as Settings shows it ("agent acp", an endpoint URL) */
  runs: string;
  /** false: its start definition is not the one the user turned on (changed in the brain, or never on): it does not start */
  trusted: boolean;
}
/** The app's own engine for the Anthropic Messages API (engines/registry.ts, ADR 0052): the judge and the other text-only
 *  calls (engines/text.ts) and the writing rows «Sui crediti API» run on it, with the key saved in Settings. */
export const ANTHROPIC_API = 'anthropic';
/** One engine's API spend in a month, as the app computed it at list prices (engines/spend.ts): calls = requests and chat
 *  turns; unpriced = those whose model has no price in the brain's table (counted, not in usd). */
export interface ApiSpendLine { usd: number; calls: number; unpriced: number }
/** engines:spend → this month's spend per API engine (month "2026-10", local time); measured = always 'app' (the API
 *  shows spend only to an Admin key, ADR 0052). */
export interface ApiSpendInfo { month: string; measured: 'app'; engines: Record<Harness, ApiSpendLine> }
/** The stored API keys as the renderer sees them (engines/secrets.ts): never a key, only its mask. */
export interface SecretsStatus {
  /** false: this machine offers no safe encryption (why says so); no key can be stored */
  available: boolean;
  why?: string;
  /** stale: the engine's start changed since the key was saved, so it is not used */
  keys: Record<Harness, { mask: string; stale: boolean }>;
}

/** running: the model is working · waiting: a question/permission needs the user · idle: turn ended, input open ·
 *  starting: process booting · error: the process failed (see lastError) · closed: process gone (can be resumed). */
export type ChatState = 'starting' | 'running' | 'waiting' | 'idle' | 'error' | 'closed';

/** app = runs inside the app (we own the process). The only origin in v1 (ADR 0010: no coexistence with other apps). */
export type ChatOrigin = 'app';

/** a chat waiting in the CPU-aware queue (ADR 0036) */
export interface QueuedInfo { kind: 'start' | 'turn'; position: number; since: number; cpu: number; freeRam: number }

export interface ChatSummary {
  id: string;                 // app id (stable across resumes)
  agent?: AgentOwnerSnapshot;
  /** the agent run this chat is (a chat started from a catalog agent): a mirror of its agent-runs.json record */
  run?: AgentRun;
  agentChildren?: AgentChildren;
  harness: Harness;
  origin: ChatOrigin;
  title: string;
  cwd: string;
  sessionId: string | null;   // the CLI session id (claude: transcript uuid; cursor: chat id)
  model: string | null;       // e.g. "claude-opus-5-5"; null = the CLI default
  effort: Effort | null;
  effortStatus?: ChatEffortStatus;
  permissionMode: PermissionMode | null;
  state: ChatState;
  costUsd: number;            // cumulative for this app run (API-equivalent on a subscription), live estimate included
  /** the part of costUsd that estimates the turn still running (from token usage); absent when every turn is settled */
  costLiveUsd?: number;
  contextTokens?: number;
  contextMaxTokens?: number;  // the model's context window (with contextTokens: the context bar)
  /** true = contextTokens is the app's estimate (the engine does not report it: Cursor over ACP), shown as "~" */
  contextEstimated?: boolean;
  /** the last hand-off saved for this chat (chat:handoffRead shows it): when, and who wrote it */
  handoffAt?: number;
  handoffSource?: HandoffSource;
  /** the chat is writing its hand-off now (a turn the app asked for) */
  handoffBusy?: boolean;
  /** "Riprendi" links: this chat continues that one / continues in that one (the old one stays readable) */
  continuedFrom?: ChatLink;
  continuedBy?: ChatLink;
  /** false = the engine reports no usage (Cursor over ACP today): costUsd is 0 for lack of data, show the estimate */
  costKnown?: false;
  /** renderer only: this Cursor chat's $, all its turns in the Cursor ledger (Usage.cursorChats by sessionId), an estimate */
  costLedgerUsd?: number;
  /** real work time since the app opened the chat: time spent starting or running, never waiting for the user's
   *  answers nor idle; workSince = the running span now in progress (add now − workSince) */
  workMs?: number;
  workSince?: number;
  pending: number;            // open questions/permissions
  /** the one coordinator of all work (it plans, starts root chats, reads their status); set only by main */
  isOrchestrator: boolean;
  /** the chat that delegated this one (agent_delegate): it shows under that chat in the tree, reports to it and never has
   *  more permissions than it; absent = a root chat */
  parentId?: string;
  /** the contract it was delegated (role, goal, criteria) and, once given, its agent_report */
  delegation?: ChatDelegation;
  /** its last agent_delegate was refused by a delegation limit (Impostazioni → Ruoli e deleghe) */
  limitHit?: DelegationLimitHit;
  lastText: string;           // last assistant line, for collapsed tiles and the needs-you lane
  lastError?: string;
  updatedAt: number;
  browserTabIds: string[];    // internal browser tabs this chat drives
  /** the last turn's end (a `result`): the auto-close clock starts here; isError = the turn failed; interrupted = the
   *  user stopped it (Stop, "Invia subito"): not an error, and the chat does not close by itself */
  lastResult?: { at: number; isError: boolean; interrupted?: boolean };
  /** background tasks (agents, shell commands) the CLI still runs after its turn (Claude task_started/notification) */
  background?: number;
  /** when its last background task ended: the CLI then reads the task's report in a turn of its own, started without a
   *  message from us, so the auto-close and the engine release count their delay from here too (never persisted) */
  backgroundEndedAt?: number;
  /** its last turn's final answer says it waits for work still running (an agent, a QA run, a build: shared/waiting.ts):
   *  never auto-closed, released or moved to a fresh session until a later turn says otherwise (any harness) */
  waitsOnWork?: boolean;
  /** its last report or final answer says it waits for the user (or a decision from above) or for a colleague (another
   *  chat): never auto-closed, shown "In attesa di…" (shared/waiting.ts waitsForPeople, #86, ADR 0084) */
  waitsOn?: 'user' | 'colleagues';
  /** Explicit assignment/mailbox hold. A provider result never completes it; no expiration or consent semantics. */
  work?: {status:'assigned'|'waiting-mail'|'completed';updatedAt:number};
  /** closed (archived) at: out of the grid, found with Ctrl+K (the palette's "Chiuse" group); its history stays and a reopen resumes it */
  closedAt?: number;
  /** why it was closed: auto = finished and left alone (auto-close), user = closed by hand */
  closedBy?: 'auto' | 'user';
  /** its turn was cut by an app restart and the app resumed it by itself at this time ("ripresa dopo il riavvio";
   *  cleared by the user's next message) */
  resumedAt?: number;
  /** an agent's start or turn waits for the machine's load to drop (ADR 0036): kind start = the engine is not started
   *  yet, turn = a message waits to wake it; position 1 = next; cpu/freeRam = the load last sampled, in % */
  queued?: QueuedInfo;
  /** how its harness, model and effort were chosen when an agent opened it (app_create_chat, the routing table) */
  route?: RouteDecision;
}

export interface ChatLink { id: string; title: string }
/** chat = written by the chat itself on request · auto = built by the app without tokens (no decisions inside) */
export type HandoffSource = 'chat' | 'auto';
/** A chat's hand-off note ("passaggio di consegne"): <userData>/handoffs/<chatId>.md */
export interface HandoffInfo {
  chatId: string;
  title: string;              // the chat's title when it was written
  path: string;
  text: string;               // markdown: Stato, File e worktree, Decisioni prese, Provato e scartato, Prossimo passo
  at: number;
  source: HandoffSource;
  contextTokens?: number;     // the chat's context when it was written
}

/** How the app's Claude chats use their context (ADR 0031), counted from the API usage the engines report (zero
 *  tokens): app_state shows it. "after" = the first calls of a fresh session from a cold hand-off vs after an
 *  auto-compaction, the price of each way out of a long context. */
export interface ContextStats {
  since: number;
  calls: number;
  /** calls whose context (input + cache read + cache write) was over 200k */
  over200k: number;
  /** calls that re-wrote more than 100k of cache (a cold resume or a compaction's first call) */
  coldRewrites: number;
  compactions: number;
  notesWritten: number;
  notesUsed: number;
  afterContinuation: { calls: number; usd: number };
  afterCompaction: { calls: number; usd: number };
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions';

/** An image attached to a message (a pasted or dropped screenshot). data = base64 without the `data:` prefix, at most
 *  IMAGE_MAX_BYTES once decoded; at most IMAGE_MAX_COUNT per message. thumb = a small preview (data:image/jpeg|png|webp
 *  URL, at most THUMB_MAX_CHARS) made by the renderer, kept on the user item for the history. */
export interface ImageAttachment { mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string; thumb?: string }
export const IMAGE_MAX_BYTES = 3_750_000;   // Claude's API limit is 5 MB of base64 per image
export const IMAGE_MAX_COUNT = 10;
export const IMAGES_MAX_TOTAL = 20_000_000; // all images of one message, decoded (the Messages API takes 32 MB per request)
export const THUMB_MAX_CHARS = 120_000;

export type ChatItem =
  /** images = how many were attached; thumbs = their previews (live messages; a transcript gives only the count);
   *  from = not the user's: who sent it (another chat's title, "Orchestrator"), shown above the bubble */
  | { kind: 'user'; id: string; at: number; text: string; images?: number; thumbs?: string[]; from?: string }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | { kind: 'thinking'; id: string; at: number; text: string }
  | { kind: 'tool'; id: string; at: number; name: string; summary: string; input: unknown; status: 'running' | 'ok' | 'error'; output?: string; diff?: FileDiff[] }
  /** continued = the divider of an invisible continuation (ADR 0031): the items above it are the previous session
   *  (shown folded), its note is the hand-off it starts from */
  // text: the English rendering, for agents, logs and items saved before this field existed. When code is set, the
  // UI shows t('sys.' + code, params) instead (src/shared/sys.ts, src/renderer/i18n/index.ts's sysText()).
  | { kind: 'system'; id: string; at: number; text: string; level: 'info' | 'warn' | 'error'; code?: SysCode; params?: SysParams; continued?: { notePath: string; session?: string } }
  /** interrupted = the user stopped the turn (Stop, "Invia subito"): isError stays false, the UI says "interrotto da te" */
  | { kind: 'result'; id: string; at: number; costUsd: number; durationMs: number; turns: number; isError: boolean; interrupted?: boolean }
  /** a visual a chat showed with show_ui (ADR 0033): a trusted catalog component, never HTML. id = `art-<key>`, key =
   *  the chat's own id for it (the same key again replaces it); from = the chat that sent it, when shown elsewhere (in its
   *  Orchestrator) and cwd = its folder (relative file paths open there); target next-ask: askId = the question it is attached
   *  to, waiting = no question yet (not in the list) */
  | { kind: 'artifact'; id: string; at: number; key: string; title: string; summary: string; ui: UiSpec; target: ArtifactTarget; from?: string; cwd?: string; askId?: string; waiting?: boolean };

// ── Generative UI (ADR 0033): the catalog of trusted components a chat can show (show_ui on its MCP endpoint, or an
// ```sb-ui fence inside an AskUserQuestion option's preview). Shapes only; validation and caps: shared/genui.ts ──
/** ok = passed/done · fail = failed · blocked · running = in progress · todo = not run yet · info · warn */
export type UiStatus = 'ok' | 'fail' | 'blocked' | 'running' | 'todo' | 'info' | 'warn';
/** href: an http(s) URL (system browser) or a local absolute path / file: URL (opened in the app's read-only file viewer) */
export interface UiLink { label: string; href: string }
export interface UiTable { columns: string[]; rows: { cells: string[]; status?: UiStatus; link?: UiLink }[] }
export interface UiCards {
  options: { title: string; summary?: string; pros?: string[]; cons?: string[]; effort?: string; risk?: 'low' | 'medium' | 'high'; recommended?: boolean }[];
}
export interface UiBoard { lanes: { title: string; status?: UiStatus; items: { title: string; detail?: string; status?: UiStatus; links?: UiLink[] }[] }[] }
export interface UiDiffList { groups: { area: string; files: { path: string; why?: string; added?: number; removed?: number; href?: string }[] }[] }
export interface UiBarChart { unit?: string; bars: { label: string; value: number; note?: string }[] }
export type UiSpec =
  | { component: 'table'; props: UiTable }
  | { component: 'cards'; props: UiCards }
  | { component: 'board'; props: UiBoard }
  | { component: 'diffList'; props: UiDiffList }
  | { component: 'barChart'; props: UiBarChart };
export type UiComponent = UiSpec['component'];
/** chat = a card in the calling chat · orchestrator = in its Orchestrator's panel · next-ask = on its next question (else a card) */
export type ArtifactTarget = 'chat' | 'orchestrator' | 'next-ask';

export interface FileDiff { path: string; added: number; removed: number; patch?: string }

/** preview: AskUserQuestion's optional content shown for an option (a draft, a snippet: markdown) */
export interface QuestionOption { label: string; description?: string; preview?: string }
export interface Question { question: string; header?: string; options: QuestionOption[]; multiSelect: boolean }

export interface PendingRequest {
  id: string;                 // request id (unique per chat)
  chatId: string;
  /** command = a shell block the chat left for the user to run (main/run/asks.ts): answered by Esegui (run:start) or
   *  "Non serve" (run:dismiss), never by chat:answer; it does not count in ChatSummary.pending (the chat is not blocked) */
  type: 'permission' | 'question' | 'command';
  tool: string;               // tool name ("Bash", "Write", "AskUserQuestion", "mcp__x__y"; "Esegui" for a command)
  /** the tool_use this request is about (Claude): its transcript row is `t-<toolUseId>`, where its context ends */
  toolUseId?: string;
  title: string;              // one line: what is being asked
  detail: string;             // the command / path / description to show
  input: unknown;
  questions?: Question[];     // type = question
  at: number;
  noAlways?: boolean;         // permission: do not offer "always allow" (the CLI forbids a rule for this ask, or has none)
  alwaysRules?: string[];     // permission: what "always allow" grants, for this session only ("Bash(git push:*)", "modalità: accetta modifiche")
  command?: CommandAsk;       // type = command
}

/** The block a command request is about: the assistant message it is in, its code (as Esegui runs it) and language;
 *  prod = why it looks like production (Esegui asks a second click, shared/runnable.ts prodRisk); lead = the chat's
 *  explanation right before the block, plain text (shared/command-ask.ts), shown on the card without a click. */
export interface CommandAsk { itemId: string; code: string; lang: string; prod?: string; lead?: string }
export type OpenPathResult = { how: 'folder' } | { how: 'missing' | 'refused'; reason: string };
/** app:peekFile: a clicked file's preview (main/peek-file.ts): its first lines, an image thumbnail, or why not */
export type PeekResult =
  | { kind: 'text'; path: string; size: number; text: string; more: boolean }
  | { kind: 'image'; path: string; size: number; dataUrl: string }
  | { kind: 'other'; path: string; size: number; what: string }
  | { kind: 'missing'; reason: string; path: string }
  | { kind: 'refused'; reason: string };
/** app:askImage: an image a question names, as a data: URL (main/ask-image.ts: allowed folders, magic bytes, size), or why not */
export type AskImageResult =
  | { kind: 'image'; path: string; dataUrl: string }
  | { kind: 'missing'; reason: string; path: string }
  | { kind: 'refused'; reason: string; path?: string };

export type Answer =
  | { kind: 'permission'; allow: boolean; always?: boolean; message?: string }
  | { kind: 'question'; answers: Record<string, string | string[]> };

/** A code block of a chat run in PowerShell 5.1 by the user's click ("Esegui" under the block, main/run/runner.ts).
 *  output = the tail of stdout + stderr; prod = why the block looked like production (it needed a second click). */
export interface RunInfo {
  id: string;
  chatId: string;
  itemId: string;             // the assistant message the block belongs to
  code: string;
  cwd: string;
  state: 'running' | 'ok' | 'error' | 'stopped';
  exitCode: number | null;
  output: string;
  startedAt: number;
  endedAt?: number;
  prod?: string;
}

export interface NewChat {
  /** Expected role version and run links; validated before a new engine starts. */
  roleVersion?: number;
  parentRunId?: string;
  reviewOf?: string;
  reworkOf?: string;
  goal?: string;
  /** The role the chat runs (shared/roles.ts). Main resolves its frozen configuration; never changes an existing session. */
  roleId?: string;
  /** set only by agent_delegate (main): the delegating chat and the contract; the child is bounded by that chat */
  parentId?: string;
  delegation?: ChatDelegation;
  /** the model tier a delegation asks for (at most the role's tierMax); absent = the role's own */
  tier?: ModelTier;
  harness: Harness;
  cwd: string;
  prompt?: string;
  title?: string;
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  resumeSessionId?: string;   // resume (or fork, see fork) an existing CLI session
  fork?: boolean;             // resume as a copy: never two writers on one session
  /** the Orchestrator (created only by the user: OrchestratorService.ensure, Ricomincia da capo, Cambia motore, Pulisci) */
  orchestrator?: boolean;
  /** with orchestrator: the Orchestrator this one replaces; the old one goes on as a normal chat, its history kept */
  replaces?: string;
  worktree?: boolean;         // claude --worktree
  route?: RouteDecision;      // set by app_create_chat: how the routing table (or an override) chose the engine
  /** run tags (AGENTS-DESIGN §4.8): the skill ids the chat starts with (`^[a-z0-9][a-z0-9_-]{0,79}$`, at most 16) */
  skills?: string[];
  /** run tags: the product the work is about, up to 40 characters */
  app?: string;
  /** set by app_create_chat (main): what the routing table matches a model-less role's row on (its explicit kind, app
   *  code, the caller's area) besides title and prompt, so the row picked is the one the route records (ADR 0091) */
  routeHint?: { kind?: TaskKind; appCode?: boolean; area?: string };
}

/** A chat the user starts without choosing everything ("Nuova chat", a new Orchestrator from Ricomincia / Cambia motore /
 *  Pulisci): main picks harness, model and effort through the routing table (ADR 0032)
 *  as app_create_chat does, and the choice goes to the improvement loop's ledger (chat.route). The brain pages never
 *  start one: their "Discuti" goes to the Orchestrator (2026-10-19). */
export interface RoutedNewChat {
  /** empty = from the prompt (the Orchestrator: "Orchestrator"), as chat:create */
  title: string;
  /** required, except for an Orchestrator (it may start empty and read its memory by itself) */
  prompt?: string;
  cwd: string;
  /** what the user named themselves (the engine of Cambia motore, a model or effort of "Nuova chat"): it beats the
   *  table's row, recorded as an override with `reason` */
  ask?: { harness?: Harness; model?: string; effort?: Effort; reason?: string };
  /** "Nuova chat"'s «Worktree separato» (only on an engine that has it) */
  worktree?: boolean;
  /** the Orchestrator (`replaces` the one it takes over); its kind of work is `orchestrator` */
  orchestrator?: boolean;
  replaces?: string;
  /** what starts when no row matches: the user's last "Nuova chat" choice */
  defaults: { harness: Harness; model?: string; effort?: Effort };
  permissionMode?: PermissionMode;
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
  account?: HandoffAccount;   // kind login: the account the agent named, looked up in the user's credentials file
}

/** The account a login hand-off shows. Never the password: main copies it from the file on the user's click
 *  ('browser:handoffCopy'), so it never reaches the agent, a tool argument, the renderer or a log. */
export interface HandoffAccount {
  user: string;               // as found in the file (or as the agent wrote it, when not found)
  found: boolean;             // an entry with this user name and a password exists in the credentials file
  url?: string;               // the entry's sign-in URL, if it has one
  note?: string;              // the entry's note ("holding with module X enabled"), one line
}

/** One entry of the "Credenziali" panel (the user's credentials file). Never the password: main copies it from the
 *  file on the user's click ('credentials:copy'), as for login hand-offs (ADR 0012). */
export interface CredentialEntry {
  id: string;                 // stable while the file does not change (a Copia after a change finds nothing)
  group: string;              // the keys that lead to it in the file: "air · test"
  user: string;
  url?: string;               // sign-in URL, if the entry has one
  note?: string;              // one line: "holding with module X enabled"
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
  /** the card's one action (agent-retired: Ripristina) */
  action?: FeedAction;
}
export type FeedAction = { kind: 'agent-undo'; undo: AgentUndo } | { kind: 'agent-proposals' };

// ---- DevOps (src/main/tasks): the user's Azure DevOps, read by the brain's read-only scripts, never written

export interface DevopsItem {
  id: number; type: string; title: string; state: string; project: string; priority: number | null;
  assignedTo: string | null; iteration: string | null; changedAt: string | null; url: string;
}
/** A comment as plain text (the script strips the HTML; the page shows it as text, never as HTML). */
export interface DevopsComment { who: string; mine: boolean; at: string; text: string }
/** A test case linked to a work item (Tested By) with the outcome of its most recent run (null = never run). */
export interface DevopsTest { id: number; title: string; outcome: string | null; url: string }
/** What the page shows inside a work item without opening DevOps (devops-me.mjs --full). */
export interface DevopsDetail {
  description: string | null; stateSince: string | null; createdAt: string | null;
  comments: DevopsComment[];   // newest first, at most 5
  tests: DevopsTest[];
}
export interface DevopsPrRef { id: number; title: string; repo: string; project: string; author: string | null; createdAt: string; url: string }
export interface DevopsPr extends DevopsPrRef {
  target: string; draft: boolean; autoComplete: boolean;
  reviewers: { name: string; vote: number; label: string; required: boolean }[];
  build: { result: string | null; status: string; number: string; url: string; at: string | null } | null;
  workItems: DevopsItem[];
  /** --full: open discussions and the last human comment (anyone's) */
  activeThreads?: number;
  lastComment?: (DevopsComment & { url: string }) | null;
}
/** mention · touched (my item changed by someone) · taken (moved away from me) · review (asked for my vote) ·
 *  comment / vote / build (on my PRs) · followed (a ticket I follow or opened: state, assignee, comment) */
export type DevopsNewsKind = 'mention' | 'touched' | 'taken' | 'review' | 'comment' | 'vote' | 'build' | 'followed';
export interface DevopsNews {
  key: string; at: string; kind: DevopsNewsKind; who: string | null; title: string; detail?: string; url: string;
  /** the whole comment or mention as plain text (detail is its first 110 characters) */
  body?: string;
  item?: DevopsItem; pr?: DevopsPrRef; unread: boolean;
}
export interface TasksState {
  enabled: boolean;
  everyMin: number;
  /** the alerts' chime (setting tasks.sound) */
  sound: boolean;
  running: boolean;
  /** last successful read (ms) and the next automatic one (null when off) */
  at: number | null;
  nextAt: number | null;
  /** login = `az login` missing or expired (command says what to run); script = the brain has no devops-me.mjs */
  error: { kind: 'login' | 'script' | 'failed'; message: string; command?: string } | null;
  news: DevopsNews[];          // newest first, the last 14 days
  assigned: DevopsItem[];      // my open work items
  urgent: DevopsItem[];        // my open P1/P2 bugs with no news
  oldReviews: DevopsPrRef[];   // reviews waiting for me from before the window
  reviews: DevopsPrRef[];      // every review waiting for my vote at the last read (recent + old)
  prs: DevopsPr[];             // my active PRs, live
  details: Record<string, DevopsDetail>;  // by work item id: description, last comments, test cases
  unread: number;
  /** "Test e QA": my active PRs' test plans (ops/tools/qa-status.mjs --mine), read with the page; [] without that script */
  qa: QaReport[];
  /** the QA read failed (the rest of the page read fine): the last good qa stays */
  qaError: string | null;
  /** repo name → its local clone (<home>/source/repos/<repo>), for the repos of the PRs on the page: "Discuti" names it
   *  to the Orchestrator as the folder of a PR's work; a repo with no clone is missing */
  repoDirs: Record<string, string>;
}

/** A test point: last outcome (null = not run yet), who ran it and when, who it is assigned to, its QA bugs' ids. */
export interface QaPoint {
  id: number; suite: string;
  testCase: { id: number; title: string; url: string };
  outcome: string | null; ranBy: string | null; ranAt: string | null; tester: string | null; bugs: number[];
}
export interface QaBug { id: number; title: string; state: string; open: boolean; assignedTo: string | null; createdAt: string | null; url: string; testCases: number[] }
export interface QaTotals {
  total: number; done: number; missing: number; passed: number; failed: number; blocked: number; notApplicable: number; other: number;
  byPerson: { name: string; done: number; passed: number; failed: number; blocked: number }[];
}
export interface QaPlan { id: number; name: string; url: string; points: QaPoint[]; totals: QaTotals }
export interface QaReport { pr: DevopsPrRef | null; plans: QaPlan[]; bugs: QaBug[]; totals: QaTotals & { bugs: number; openBugs: number } }

// ---- "Aggiorna" from GitHub (src/main/update/source.ts, ADR 0075): the code folder against GitHub's main, the
// one-click update in progress and how the last start went (moved from the retired "Migliora l'app", ADR 0079)

/** How the last start went, shown once after a restart until dismissed. new = the new version started ·
 *  fallback = it did not start and the launcher went back to the previous one (reason: why, from the launcher) */
export interface LaunchNotice { outcome: 'new' | 'fallback'; running: string; wanted: string; reason: string; at: number }
/** A stable copy's switch to the new version (scripts/release.mjs promote-now), then the restart through the launcher */
export interface PromoteRun {
  state: 'running' | 'ok' | 'error' | 'restarting';
  startedAt: number;
  endedAt?: number;
  step: string;               // Italian, the step in progress ("Copia della versione")
  log: string;                // the output's tail
  version?: string;           // the new release id once switched
}
/** "Aggiorna" from GitHub (ADR 0075): the code folder against GitHub's main, and the one-click update in progress */
export interface SourceUpdate {
  state: 'idle' | 'checking' | 'updating' | 'restarting' | 'done' | 'error';
  /** commits on GitHub's main not in the code folder (null = not checked yet) */
  behind: number | null;
  commits: string[];          // "<sha> <subject>", newest first, at most 20
  message: string;            // Italian, for the user
  /** the button may run: a code folder on main without local changes, nothing running */
  canUpdate: boolean;
  at: number;
}
export interface AppSourceState {
  repo: string | null;
  repoProblem: string | null; // Italian: why the code folder is missing or unusable
  running: string;            // the release id in use, 'dev' for a build run from the repo
  /** when the version in use was made (its commit, ms): shown instead of the release id; absent = dev or unknown */
  runningAt?: number | null;
  stable: boolean;
  /** main's tip when it is not the version in use: what "Aggiorna" switches a stable copy to */
  candidate: { sha: string; subject: string; at: number } | null;
  promote: PromoteRun | null;
  launch: LaunchNotice | null;
  source: SourceUpdate;
  at: number;
}

export interface AppInfo {
  version: string;
  brainRoot: string | null;
  /** why the brain folder is missing: config.json unreadable, or the folder lacks the brain tools */
  brainProblem?: string | null;
  mcpUrl: string;
  /** the app's own health since it started (main/health.ts); a fallen-back MCP port shows a banner */
  health?: AppHealth;
  /** null until the background check finishes (a few seconds after start): ask cli:status for a fresh one. */
  cli: Record<Harness, CliStatus> | null;
  /** the engines the app knows, in display order */
  engines: EngineInfo[];
  /** Windows' language as the UI uses it (ADR 0057): 'it' when it is Italian, else 'en'; SB_LANG forces it (tests) */
  systemLang: Lang;
}
/** Since the app started: the MCP port (fallback = the configured one was taken, external clients lose the browser),
 *  main-window renderer crashes/hangs (each reloads it; chats keep running), engines killed by force, Job Object guard. */
export interface AppHealth {
  mcp: { wanted: number | null; port: number | null; fallback: boolean; cause: string | null };
  renderer: { crashes: number; hangs: number; reloads: number; last: { what: 'gone' | 'hang'; reason: string | null; at: number } | null };
  forcedKills: number;
  jobGuard: 'off' | 'starting' | 'ready' | 'failed';
}
/** 'app:projectsFolder': saved = the setting projectsRoot; detected = what the app found by itself (null = it asks) */
export interface ProjectsFolderInfo { saved: string | null; detected: { path: string; repos: number; source: 'cli' | 'common' } | null; newMemoryIn: string }
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
  /** Cursor today: the per-turn ledger (stop hook, agent -p) at list price × the CSV factor, exact for what a usage
   *  export covers; null = unknown (no turn logged, no export) */
  cursorTodayUsd?: number | null;
  cursorNote?: string;
  /** true = the whole figure comes from Cursor's usage export (exact); false = an estimate within ±cursorMarginPct */
  cursorExact?: boolean;
  cursorMarginPct?: number;
  /** estimated $ per Cursor conversation id (= an app Cursor chat's sessionId), all its turns in the ledger read (60 days) */
  cursorChats?: Record<string, number>;
  /** the same, today's turns only (the day's chats by cost) */
  cursorChatsToday?: Record<string, number>;
  /** today's Cursor turns with no list price (model "auto" or missing from main/chats/cursor-prices.ts): the
   *  conversations they belong to and their models, shown as «prezzo sconosciuto» instead of a silent 0 */
  cursorUnpriced?: { chats: string[]; models: string[] };
  /** Italian: why Cursor's plan usage (included quota, on-demand spend) cannot be shown, and what does give its cost */
  cursorPlanNote?: string;
  at?: number;                // when this snapshot was computed
  /** when cost.mjs started reading the transcripts behind todayUsd (ms): the live total adds what the app's Claude
   *  chats spent after it (renderer lib/live-costs.ts); absent = no cost run yet */
  costAt?: number;
  /** today's Claude $ per session from cost.mjs (the app's chats and the ones outside it), most first */
  claudeChats?: { sessionId: string; title: string; usd: number }[];
}

// ── Settings (userData/config.json; never secrets) ─────────────────────────────────────────────────────────────────
/** Windows toasts: only urgent kinds (default), urgent + normal, or none (in-app feed only). */
export type ToastLevel = 'urgent' | 'normal' | 'off';
export type ThemeMode = 'dark' | 'light' | 'system';
/** The UI language (ADR 0057): system = Windows' language (Italian when it is Italian, English otherwise) */
export type LanguageMode = 'system' | 'it' | 'en';
export type Lang = 'it' | 'en';
/** warn = feed + toast · ask = also a 'budget:alert' the chat manager turns into a "stop or continue?" question · off */
export type BudgetMode = 'warn' | 'ask' | 'off';
export interface BudgetLimits { mode: BudgetMode; dailyUsd: number | null; perChatUsd: number | null }
export interface BudgetSettings { enabled: boolean; claude: BudgetLimits; cursor: BudgetLimits }
export interface Settings {
  pulse?: PulseSettings;
  jobs?: { fallback: 'auto' | 'off' };
  brainRoot: string | null;
  mcpPort: number;
  mute: Record<string, boolean>;   // feed kind → no toast (still in the feed)
  osToasts: ToastLevel;
  theme: ThemeMode;
  language: LanguageMode;
  dnd: boolean;                    // do not disturb: no toasts at all
  dndUntil: number | null;         // timed do not disturb (epoch ms): no toasts until then
  /** engines anything may start on (ADR 0046; absent = off): the user's own chats too */
  engineOn: Partial<Record<Harness, boolean>>;
  /** engines the Orchestrators may open or resume chats on (absent = off); the user's own chats are free */
  engines: Partial<Record<Harness, boolean>>;
  /** Retired transport switch: always true after loading. Kept as compatibility data for older clients. */
  messaging: { crossHarness: boolean };
  budget: BudgetSettings;
  /** context size (tokens) above which a chat's meter turns amber when its engine reports no compaction window (Cursor);
   *  a Claude chat turns amber near its own window (compactWindowTokens) instead (ADR 0031) */
  contextWarnTokens: number;
  /** the invisible continuation of cold chats (ADR 0031): an idle Claude chat with a long context writes its hand-off
   *  while the prompt cache is still warm, and a message after the cache expired goes on in a fresh session from it */
  contextHandoff: boolean;
  /** the auto-compact window of every Claude chat the app starts (passed per process, it beats a folder's own
   *  settings); 0 = whatever the user's Claude settings say (ADR 0031) */
  compactWindowTokens?: number;
  /** «Orchestrators corte» (ADR 0051): an Orchestrator whose context began on an earlier day compacts it once, the first time it is idle
   *  on a new day (same chat: its queue and the chats it follows stay); its window is compactWindowTokens as for every chat */
  orchestratorDayCompact?: boolean;
  /** ADR 0060: the brain's rules given to each Claude chat at launch (a plugin folder: skills, agents, output styles,
   *  hooks, plus the rules file); off by default */
  launchRulesClaude?: boolean;
  /** ADR 0060: the brain's rules given to each Codex chat at launch (developer instructions + skill folders); on by default */
  launchRulesCodex?: boolean;
  /** Explicit repository/worktree roots where Codex uses never + workspace-write. Empty = on-request everywhere.
   *  Each chat gets only its matching root; sibling repositories and worktrees require their own entry. */
  codexAutonomyRoots?: string[];
  /** limits of delegation between role chats (Impostazioni → Ruoli e deleghe; shared/roles.ts DELEGATION_DEFAULTS) */
  delegation: DelegationSettings;
  /** the model each tier means on an engine (engine id → tier → model id; '' or absent = the brain's registry) */
  modelTiers: Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
  /** minutes an idle long Claude chat waits before writing its hand-off for the invisible continuation (the cache lasts
   *  ~60 min since the last call) */
  coldHandoffMin?: number;
  /** the chats the Orchestrator opens (app_create_chat without harness/model) and where the "Nuova chat" dialog starts:
   *  engine, model per engine ('' = the CLI default), Claude effort ('' = the CLI default); Cursor reasoning and fast
   *  apply to every Cursor chat */
  orchestratorChats: OrchestratorChatDefaults;
  /** minutes a finished work chat stays on the grid before it closes by itself (archived, reopenable); 0 = never */
  autoCloseMin: number;
  /** minutes an idle chat keeps its engine process (with its MCP servers and shells); then the process ends and the
   *  chat stays on the grid, resumed by itself on the next message (ADR 0026); 0 = never. Orchestrators are never released. */
  engineIdleMin?: number;
  /** Task page: read by the brain's devops-me.mjs (no AI, no tokens), on a timer only when the user turns it on */
  tasks: { enabled: boolean; everyMin: number; /** a short sound with a DevOps alert (a mention, a change on my items) */ sound: boolean };
  /** the Orchestrator overlay's opacity in %, 40-100 (fully opaque while hovered or focused; ADR 0021) */
  orchestratorOpacity: number;
  /** "Eventi all'Orchestrator": a work chat that finishes, fails, waits for the user or leaves a command wakes the Orchestrator with a
   *  short app message (main/chats/orchestrator-wake.ts) */
  orchestratorEvents: boolean;
  /** "Esito alla chat": when a run of Esegui ends, the chat that proposed the block gets the exit code and the output's
   *  tail as an app message (main/run/results.ts) */
  runResults: boolean;
  /** "Domande in finestra": every open question and permission shows in one modal window in front, one at a time in
   *  a queue (instead of the chats' tiles and the Orchestrator); it never takes the keyboard while the user types */
  questionsModal: boolean;
  /** the folder of the app's own code (a git repo) that "Aggiorna" updates; null = the one the running release was built from */
  appRepo: string | null;
  /** the folder that holds the owner's projects (their git repos): asked by the first-run setup only when the app
   *  cannot find it by itself (main/brain/projects-folder.ts); null = not known yet */
  projectsRoot?: string | null;
  /** "Coda per carico" (ADR 0036): an agent's new chat or turn waits while CPU is over loadQueueCpu % or free RAM under
   *  loadQueueRam %; the user's own messages never wait */
  loadQueue: boolean;
  loadQueueCpu: number;
  loadQueueRam: number;
  /** the Grindhouse's headline (SPEC 18, main/headline.ts): on/off, and the model and effort that write it (Anthropic
   *  API engine; '' = the default, claude-opus-5-5 at low). Absent = the defaults. */
  headlineOn?: boolean;
  headlineModel?: string;
  headlineEffort?: Effort | '';
  /** fields forced by the environment (SB_BRAIN, SB_MCP_PORT): shown read-only, never saved */
  locked?: ('brainRoot' | 'mcpPort')[];
}
export interface OrchestratorChatDefaults {
  harness: Harness; claudeModel: string; cursorModel: string; claudeEffort: Effort | '';
  /** reasoning of every Cursor chat (ACP session config option of category thought_level), '' = the model's default */
  cursorReasoning: CursorReasoning | '';
  /** Cursor's "fast" option for every Cursor chat (faster, spends more usage) */
  cursorFast: boolean;
}
export type CursorReasoning = 'low' | 'medium' | 'high' | 'xhigh';
export type SettingsPatch = Partial<Omit<Settings, 'budget' | 'locked' | 'engineOn' | 'engines' | 'messaging' | 'orchestratorChats' | 'tasks' | 'pulse' | 'delegation' | 'modelTiers'>> & {
  delegation?: Partial<DelegationSettings>;
  modelTiers?: Partial<Record<Harness, Partial<Record<ModelTier, string>>>>;
  pulse?: Partial<Omit<PulseSettings, 'headline' | 'types' | 'places'>> & { headline?: { on?: boolean }; types?: Partial<PulseSettings['types']>; places?: Partial<PulseSettings['places']> };
  engines?: Partial<Settings['engines']>;
  tasks?: Partial<Settings['tasks']>;
  engineOn?: Partial<Settings['engineOn']>;
  messaging?: Partial<Settings['messaging']>;
  orchestratorChats?: Partial<OrchestratorChatDefaults>;
  budget?: { enabled?: boolean; claude?: Partial<BudgetLimits>; cursor?: Partial<BudgetLimits> };
};

/** Every setting is one dot key ("theme", "budget.claude.dailyUsd", "mute.idea"): the unit of validation, history,
 *  undo and agent permissions. The schema (settings:schema) gives type, default, Italian label and description. */
export type SettingKey =
  | 'pulse.on' | 'pulse.dailyUsd' | 'pulse.slots' | 'pulse.headline.on' | `pulse.types.${PulseType}` | `pulse.places.${'board' | 'agent' | 'search' | 'file'}` | 'jobs.fallback'
  | 'brainRoot' | 'mcpPort' | 'theme' | 'language' | 'autoCloseMin' | 'engineIdleMin' | 'contextWarnTokens' | 'contextHandoff' | 'compactWindowTokens' | 'orchestratorDayCompact' | 'launchRulesClaude' | 'launchRulesCodex' | 'coldHandoffMin' | 'osToasts' | 'dnd' | 'dndUntil' | `engineOn.${Harness}` | `engines.${Harness}` | 'messaging.crossHarness' | 'tasks.enabled' | 'tasks.everyMin' | 'tasks.sound' | 'budget.enabled'
  | `budget.${Harness}.${'mode' | 'dailyUsd' | 'perChatUsd'}` | `mute.${string}`
  | `orchestratorChats.${keyof OrchestratorChatDefaults}` | 'orchestratorOpacity' | 'orchestratorEvents' | 'runResults' | 'questionsModal' | 'appRepo' | 'projectsRoot' | 'loadQueue' | 'loadQueueCpu' | 'loadQueueRam' | 'codexAutonomyRoots'
  | 'headlineOn' | 'headlineModel' | 'headlineEffort' | `delegation.${keyof DelegationSettings}` | `modelTiers.${Harness}.${ModelTier}`;
export interface SettingDef {
  key: SettingKey;            // 'mute.*' stands for every feed kind
  type: 'path' | 'int' | 'boolean' | 'enum' | 'usd' | 'model' | 'repo-paths' | 'slots'; // slots: 1-3 local HH:MM times
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

// ── Job ledger: real cost and time of a job, kept for the brain's routing table (ADR 0053 dropped the estimate shown
// to the user: measured on 178 chats it held only 47% of the time with a bigger median error than the median cost) ──
export type JobKind = 'fix' | 'qa' | 'review' | 'feature' | 'research' | 'question' | 'other';
/** minutesKind 'work' = effective work time (running, never waiting for the user's answers: the app since 2026-10-11, the
 *  same figure the chat tile shows); without it the minutes are a chat's span or the CLI's turn time and only $ count. */
export interface JobActual { usd: number; minutes: number | null; minutesKind?: 'work'; tokensIn: number | null; tokensOut: number | null; turns: number | null }
/** Record (or update: same id, last wins) one job in the ledger. The prompt text is never stored: only its length and kind. */
export interface JobRecordInput {
  id?: string;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  prompt?: string;
  kind?: JobKind;
  actual?: JobActual | null;
}

// ── Model routing: which harness, model and effort a chat opened by an agent gets (ADR 0032) ─────────────────────────
/** The task kinds the routing table decides on: the brain's estimates.mjs taskOf (its rules travel in estimates.json). */
export const TASK_KINDS = ['qa-run', 'review', 'bug-fix', 'ops-read', 'writing', 'triage', 'research-web', 'investigation', 'app-feature', 'orchestrator', 'altro'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
/** One row of the brain's model registry and price table (harness/models.json): USD per million tokens. */
export interface RegistryModel {
  id: string; harness: Harness; provider: string; aliases?: string[];
  /** auto = the routing table may pick it; manual = only when named */
  routing: 'auto' | 'manual'; tier?: string;
  price: { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number };
  longPrompt?: { over: number; price: RegistryModel['price'] };
  fastFactor?: number; noGeo?: boolean;
  efforts: Effort[]; defaultEffort: Effort | null;
}
export interface ModelRegistry {
  harnesses: Partial<Record<Harness, { routing: 'auto' | 'manual'; note?: string }>>;
  defaultModel: string;
  models: RegistryModel[];
  modifiers?: { usGeo?: number; webSearchPerRequest?: number };
  /** the only model and effort a row for the app's chats may name (the user, 2026-10-14: "i lavori sull'app sempre in
   *  opus medio"); other models reach them only through exploration. Absent = no such rule. */
  appChats?: { model: string; effort: Effort | null };
}
/** A row of the routing table: kind '*' = any; area = the title's label ("IT", "Pers · App"), one or several; no area = any. */
export interface RoutingRow {
  kind: TaskKind | '*'; area?: string | string[];
  harness: Harness; model: string; effort: Effort | null;
  why: string; since: string; evidence: string;
  /** the user's switch for the writing rows «Sui crediti API» (ADR 0052): on = its chats run on the Anthropic API engine
   *  with the same model, while that engine is on, has a key and may be used; else on the row's harness. Absent = off;
   *  only the user turns it on or off */
  onApi?: boolean;
  /** the user's switch «L'AI può cambiarla» off: an agent may neither change nor remove this row (absent = it may) */
  locked?: boolean;
}
/** The table in force: <brain>/ops/state/improve/routing/v<version>.json, current.json says which (versioned: every save
 *  is a new version + a line in audit.jsonl; old versions stay for rollback). */
export interface RoutingTable {
  version: number; appliedAt: string | null; by: string | null; exploration: number; routes: RoutingRow[];
  /** how much cost weighs against quality when the loop compares models: 0 = only quality, 10 = only cost (the user's
   *  λ, 7 on 2026-10-14; like OpenRouter's cost_quality_tradeoff); only the user changes it */
  costWeight: number;
}
/** One change of the table (a line of <brain>/ops/state/improve/audit.jsonl, domain routing): who, when, why, with what
 *  data; stored = its v<to>.json is still on disk (it can be restored). */
export interface RoutingChange { at: string; from: number | null; to: number; by: string; reason: string | null; evidence: string | null; exploration?: { from: number; to: number }; costWeight?: { from: number; to: number }; stored: boolean }
/** routing:get → the table (null: never applied), the registry (null: the brain has no harness/models.json) and why not;
 *  history = its last changes, newest first (the user's page and the agents both write it, ADR 0032). */
export interface RoutingInfo { table: RoutingTable | null; registry: ModelRegistry | null; kinds: readonly TaskKind[]; error: string | null; history: RoutingChange[];
  /** per kind: the app's chats in the ledger, how many have a known outcome, how many succeeded (ADR 0078) */
  kindStats?: Partial<Record<TaskKind, { chats: number; known: number; ok: number }>> }
/** How a chat's engine was chosen: agent = the catalog agent's profile (engine, model, effort; a profile with no model
 *  takes the table row's as a default, never an override: ADR 0078); table = its row; default = no row, the user's
 *  "Chat aperte dall'Orchestrator"; override = the agent named something else, with a reason. */
export interface RouteDecision {
  policy: 'routing'; version: number | null; source: 'table' | 'default' | 'override' | 'explore' | 'agent';
  reason: string | null; kind: TaskKind; area: string; at: number;
  /** source agent: which agent, who picked it (the Orchestrator by agentId, the classifier, a worker for its sub-agent,
   *  Generale as the fallback) and, when the classifier ranked it, its score against the threshold in force (ADR 0078) */
  agent?: RouteAgent;
  /** a chat that continues a routed one ("Riprendi"): the ledger id of the first chat, so one job keeps one outcome */
  ledgerId?: string;
  /** how many hand-offs led to this chat */
  handoffs?: number;
}
/** The role a routed chat runs: who launched it, its model tier, and where its model came from (the role's own model,
 *  its tier on the engine, or the engine's default). */
export interface RouteAgent { id: string; version: number; chosenBy: 'orchestrator' | 'parent' | 'app'; tier?: ModelTier; modelFrom?: 'role' | 'tier' | 'table' | 'engine' }
/** routing:preview → the engine, model and effort the table (or the user's pick, or the defaults) gives a new chat, and
 *  why; error = what chat:createRouted would refuse (Italian). */
export type RoutePreview = { harness: Harness; model: string | null; effort: Effort | null; route: RouteDecision } | { error: string };

/** The brain's own data server (ops/tools/brain-site.mjs), read-only: GET paths under /api/ (tables, now, cost, day,
 *  map, files, file, search, version, status). Never throws for a missing brain server: ok false + error. */
export type BrainApiResult = { ok: true; data: unknown } | { ok: false; error: string };

/** /api/quality, answered by main itself (brain/quality.ts), not by the brain's server: what only the app knows for the
 *  Qualità page. Turns = finished turns of the chats run in this app (its own logs, Rome days); PRs = the user's
 *  active PRs at the last DevOps read that a failed build or QA holds; reopen = the brain's bug-reopen.mjs (read-only,
 *  cached in userData, refreshed at most every 12 h). */
export interface QualityPrBlock { id: number; title: string; repo: string; url: string; reasons: string[] }
export interface QualityReopen { resolvedAt: string; reopenedAt: string; by: string; to: string }
export interface AppQuality {
  turns: { from: string | null; to: string | null; byDay: { date: string; claude: number; cursor: number }[] };
  prs: { at: number | null; total: number; blocked: QualityPrBlock[]; error: string | null };
  reopen: {
    at: string | null; days: number; resolved: number; reopened: number;
    bugs: { id: number; title: string; state: string; url: string; reopened: QualityReopen[] }[];
    error: string | null; refreshing: boolean;
  };
}

/** One side of a comparison's cost so far: usd null = no round has a cost yet; missing = rounds without one (e.g. a
 *  Cursor export not imported). */
export interface CompareCost { usd: number | null; missing: number }

/** One A/B experiment of the brain (<brain>/harness/compare/experiments/*.json) with its switches (switch.json, written
 *  only by the harness's switch.mjs; ADR 0046 §4). A run is compared only when the experiment AND its agent are on.
 *  Side a is the work sampled (e.g. a Cursor subagent's run), side b re-runs the same task inside the app as a hidden
 *  read-only run (main/compare), the judge rates both blind. engine = an engine id (registry), label = its short name
 *  ("Cursor"); a model or effort the experiment does not name is null. Cost so far: the sum over its rounds. */
export interface CompareExperiment {
  name: string; title: string; description: string;
  on: boolean; changedAt: string | null;   // Europe/Rome "YYYY-MM-DD HH:MM:SS"
  a: { engine: string; label: string; agents?: string[] };
  b: { engine: string; label: string; model: string | null; effort: string | null };
  judge: { engine: string; label: string; model: string | null };
  agents: { name: string; on: boolean }[];
  rounds: number;
  cost: { a: CompareCost; b: CompareCost };
}
export type CompareState = { ok: true; experiments: CompareExperiment[] } | { ok: false; error: string };

/** A click on the Miglioramento page (ADR 0030), run by the brain's ops/improve/improve.mjs (the app never writes the
 *  loop's state): [Applica] / [No] on a proposal ("<policy>-<n>"), [Ripristina] a policy's previous version. */
export type LearnAction = { action: 'apply' | 'reject'; id: string } | { action: 'rollback'; domain: string };
export type LearnResult = { ok: true; message: string } | { ok: false; error: string };

/** One script of the brain's Script page (main brain/scripts.ts, /api/scripts): a reusable, tested script kept in the
 *  brain's `scripts/` folder (ADR 0076). Its description comes from the `@title` / `@description` / `@usage` / `@tags` /
 *  `@tested` lines of its header comment; `tested` = the last run the Orchestrator recorded (`untested` when none). */
export interface BrainScriptSummary {
  id: string; file: string; title: string; description: string; usage: string; language: string; tags: string[];
  tested: { state: 'ok' | 'failed' | 'untested'; at: string | null; note: string };
  changedAt: string | null; bytes: number;
}
/** /api/script?id=…: the script's code with every line that may hold a credential replaced (`masked` lines). */
export interface BrainScript extends BrainScriptSummary { path: string; code: string; masked: number }
/** One line of the brain's changelog (`changelog.md`, main brain/changelog.ts, /api/changelog): who changed what in the
 *  brain, newest first. `at` = local "YYYY-MM-DD HH:MM". */
export type ChangelogKind = 'script' | 'rule' | 'procedure' | 'note' | 'agent' | 'skill' | 'other';
export type ChangelogAction = 'added' | 'edited' | 'fixed' | 'deleted' | 'restored';
export interface ChangelogEntry { at: string; kind: ChangelogKind; action: ChangelogAction; target: string; by: string; summary: string }
/** Per engine, the models its CLI offered at its last session (ACP's availableModels), kept in userData; absent = none
 *  seen yet (the UI falls back to its own list). The app never starts a CLI just to ask. */
export type ModelsSeen = Partial<Record<Harness, { ids: { id: string; name: string }[]; at: number }>>;

// ── "Rispondi dopo" (the user, 2026-10-13: "a volte sono concentrato e non ho tempo per rispondere"; ADR 0035) ──
/** On after "Rispondi dopo" on any question or permission: every open request waits in the "Da rispondere" queue and
 *  new ones join it silently (no window, card, toast or Windows notification; only the top bar's counter) until the user
 *  opens the queue (Ctrl+J, the counter). The asking chats stay blocked. Kept by main (userData/answer-later.json). */
export interface AnswerLater { on: boolean }

/** News for an Orchestrator the app holds back by the delivery rule (main/chats/orchestrator-delivery.ts; #88): a work chat's
 *  news (orchestrator-wake.ts) or mail to it (mail.ts) not delivered yet. Shown as "N novità in attesa" on its tile; reading
 *  it costs no turn. kind: done = finished its turn; why: user = the Orchestrator waits for the user's answer, busy =
 *  it works on an engine that takes nothing mid-turn (or is in a hand-off, or failed), group = it goes within the
 *  grouping window with the other news, quiet = it rides along with the next delivery. */
export type HeldNewsKind = 'done' | 'error' | 'question' | 'permission' | 'command' | 'started' | 'user-message' | 'mail';
export type HeldNewsWhy = 'user' | 'busy' | 'group' | 'quiet';
export interface HeldNewsItem { orchestratorId: string; chatId: string | null; title: string; kind: HeldNewsKind; at: number; why: HeldNewsWhy }
export interface HeldNewsState { items: HeldNewsItem[] }

// ── Global request layer (the user: "se l'IA vuole farmi domande mi compaiano ovunque io stia navigando nell'app") ──
// Questions and permissions not visible elsewhere on screen float in a small top-most WebContentsView (main/overlay.ts),
// above browser tiles and pages. The app page decides what it shows (one source of truth), the layer only renders it.
/** attempt: bumped when an answer failed and the request came back (the layer re-mounts the card, answerable again). */
/** engine = the asking chat's engine as app:info describes it (the layer's page has no app:info of its own) */
export interface OverlayCard { key: string; req: PendingRequest; chatTitle: string; harness: Harness; engine: EngineInfo | null; isOrchestrator: boolean; attempt?: number }
export interface OverlayModel {
  cards: OverlayCard[];       // the queue: oldest first; the first is shown in full
  waiting: number;            // all open requests (badge)
  theme: ThemeMode;
  /** the app page's resolved UI language (ADR 0057) */
  lang?: Lang;
  density: 'comfortable' | 'compact';
  focusKey?: string;          // set with a new nonce when the keyboard moves to the layer (Ctrl+J)
  nonce?: number;
  now?: number;               // the app page's clock (frozen in the demo), for "4 min" labels
  /** important events (chat waiting/done, errors, sync, budget, login…) as short toasts above everything, max 2 */
  toasts?: OverlayToast[];
  /** the Orchestrator widget's bottom-right room (ADR 0028): the layer sits left of it (expanded) or above it (collapsed) */
  /** top is the absolute occupied bottom in content coordinates; right/bottom are edge reservations. */
  avoid?: { right: number; bottom: number; top?:number };
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
  | { kind: 'postpone'; key: string }       // "Rispondi dopo" (Esc): every open request goes to "Da rispondere" (AnswerLater)
  | { kind: 'open'; key: string }           // show that chat in the app
  | { kind: 'next'; from?: string }         // Ctrl+J inside the layer (from = the card shown, the cycle goes on from it)
  | { kind: 'leave' }                       // keyboard back to the app
  | { kind: 'toast'; id: string; act: 'open' | 'dismiss' } // an event toast: its action, or ✕
  | { kind: 'run'; key: string; confirmProd?: boolean }    // a command card's Esegui (the app page starts the run)
  | { kind: 'dismiss'; key: string };                       // a command card's "Non serve"

// ── Skills and agents (src/main/skills, ADR 0018): the CLIs' own markdown files, listed, edited and deleted by the user ──
export type SkillKind = 'skill' | 'agent';
export type SkillScope = 'user' | 'project';
/** A problem of a skill/agent file (src/shared/skillmd.ts): error = not saved, warn = saved, shown. Italian text. */
export interface MdIssue { level: 'error' | 'warn'; field?: string; text: string }
export interface SkillEntry {
  id: string;                 // the file's absolute path (the key for read, save, delete)
  kind: SkillKind;
  harness: Harness;
  scope: SkillScope;
  root: string | null;        // scope project: the project folder
  name: string;               // from the frontmatter (the folder or file name when missing)
  description: string;
  path: string;
  mtime: number;
  errors: number;             // MdIssue errors in the file as it is on disk
  /** why it cannot be saved from the app (a generated copy: "generato da copy-tool.mjs da <source>") */
  readOnly?: string;
}
/** Where a new skill or agent can go. dir = the folder that holds them (".../.claude/skills"). */
export interface SkillPlace { kind: SkillKind; harness: Harness; scope: SkillScope; root: string | null; dir: string; label: string }
export interface SkillCatalog { entries: SkillEntry[]; places: SkillPlace[] }
export interface SkillDoc { entry: SkillEntry; text: string }
/** Save: id = an existing file (a new name in the text moves it); without id = a new one at place (kind/harness/scope/root).
 *  mtime = the file's mtime when it was opened: a newer one on disk is never overwritten. */
export interface SkillSave { id?: string; mtime?: number; kind: SkillKind; harness: Harness; scope: SkillScope; root?: string | null; text: string }
/** hook = the command of the user's PreToolUse hook that refused the write; error is then its own message */
export type SkillSaveResult = { ok: true; entry: SkillEntry; issues: MdIssue[] } | { ok: false; error: string; hook?: string; issues?: MdIssue[] };
/** A command a chat can run by typing "/<name>" (skills, the engine's own commands). */
export interface ChatCommand { name: string; description: string; hint?: string; skill?: boolean }

/** Ctrl+K full-text search (main/search, ADR 0023). chat = a chat's title matches · message = its messages do ·
 *  branch = the git branch of chats' folders · brain = a markdown file of the brain folder. */
export type SearchKind = 'chat' | 'message' | 'branch' | 'brain';
export interface SearchHit {
  kind: SearchKind;
  key: string;                // unique among the hits
  title: string;              // chat title, branch name, brain file path
  sub?: string;               // where: the folder, the chats on a branch
  snippet: string;            // a short excerpt around the match ('' = none)
  mark: [number, number] | null; // the match inside the snippet
  at: number;                 // date of the matching message / file / chat
  chatId?: string;            // chat, message, branch: the chat Enter opens
  closed?: boolean;           // that chat is closed: Enter reopens it
  path?: string;              // brain: the file, relative to the brain folder ('/')
  line?: number;              // brain: 1-based line of the match
  count?: number;             // how many messages / places matched
}
// ---------------------------------------------------------------- brain domains and multi-PC sync (ADR 0059)

export type DomainScope = 'everywhere' | 'this-pc';
/** Why a domain's sync stopped. conflict: stays stopped until the user chooses (sync:resolve); guard: the publish guard
 *  found something (file:line + rule, never the value); no-guard: the guard is missing on this PC (fail closed); error:
 *  git failed (offline, a git operation in progress), retried at the next sync. */
export type SyncBlock =
  | { kind: 'conflict'; files: string[]; copies?: string[] }
  | { kind: 'guard'; findings: { file: string; line: number | null; rule: string; commit?: string }[] }
  | { kind: 'no-guard'; hint: string }
  | { kind: 'error'; message: string; hint: string };
export interface DomainSyncStatus {
  name: string;
  root: string;
  scope: DomainScope;
  /** off = no remote (a this-pc domain, or no domain.json): the app never syncs it */
  state: 'off' | 'idle' | 'syncing' | 'blocked';
  remote: string | null;
  lastSync: number | null;
  /** commits to send / to receive at the last check; null = not known yet */
  ahead: number | null;
  behind: number | null;
  blocked: SyncBlock | null;
  /** domain.json wrong or refused (Italian) */
  problem: string | null;
}
export interface SyncState { domains: DomainSyncStatus[]; at: number }
/** keep mine / keep theirs on the conflicting lines; both = a copy of each version opened for the user, sync stays stopped */
export type SyncChoice = 'mine' | 'theirs' | 'both';

export interface SearchResult { q: string; hits: SearchHit[]; ms: number; indexed: { chats: number; files: number } }
/** The hybrid brain search (SPEC 23): its local embedding model and index. Without the model, words only (BM25). */
export type SearchModelState =
  | { state: 'missing' }                                   // not downloaded (tests, or not started yet)
  | { state: 'downloading'; done: number; total: number }  // bytes
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'failed'; error: string };                    // download or load failed: retry from the palette
export interface SearchIndexStatus { model: SearchModelState; docs: number; chunks: number; vectors: number; vec: boolean }

/** renderer → main. Each entry: [argument, result]. */
/** Key → letter on screen in the app page over one window (ms): keydown to the first frame after its input event. */
export interface InputLagReport { keys: number; p50: number; p95: number; max: number; longTaskMs: number; windowSec: number }

export interface InvokeMap {
  'connectors:list': [void, ConnectorState[]];
  'connectors:login': [{ provider: ConnectorId }, void];
  'connectors:cancelLogin': [void, void];
  'connectors:probe': [{ provider: ConnectorId }, ConnectorState];
  'connectors:select': [{ provider: ConnectorId; projects: string[] }, ConnectorState];
  'connectors:disconnect': [{ provider: ConnectorId }, void];
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
  'update:get': [void, AppUpdateState];
  'update:apply': [{ id: string }, AppUpdateState];
  'update:checkpointAnswer': [UpdateCheckpointAnswer, void];
  'update:recovery': [void, UpdateRecovery | null];
  'update:recoveryAck': [{ id: string }, void];
  'progress:get': [void, ProgressState];
  'progress:setHidden': [{ hidden: boolean }, ProgressState];
  'progress:confirmResult': [{ chatId: string; resultAt: number }, ProgressState];
  'chat:autoCloseGet': [void, AutoCloseStatus[]];
  'chat:autoClosePresence': [{ holds: AutoClosePresence[] }, void];
  'chat:autoCloseKeep': [{ chatId: string; keep: boolean }, void];
  'agents:list': [void, AgentCatalog];
  /** the brain skills that fit a request, best first (skills/suggest.ts; advisory: the user picks what a role chat may use) */
  'skills:suggest': [{ request: string }, SkillSuggestions];
  /** the user's Annulla on a change the app applied (feed card, change log) */
  'agents:undo': [AgentUndo, AgentProfile];
  'agents:exportPlan': [{ id: string; target: PackTarget }, PackExportPlan];
  'agents:exportFix': [{ token: string; item: string; action: 'exclude' | 'rescan' | 'allow' | 'open' }, PackExportPlan];
  'agents:export': [{ token: string; includeStats: boolean }, { ok: true; path: string } | { ok: false; findings: PackFinding[] }];
  /** the shareable brain zip for colleagues (ADR 0088): rules, skills, roles, scripts, never memory; null = save dialog cancelled */
  'brain:share': [void, BrainShareResult | null];
  'agents:importInspect': [{ pick: true } | { dropped: string }, PackImportReview | null];
  /** attaches the reviewed pack's skills to `roleId` (a trial version of that role) and writes its rules when absent */
  'agents:importApply': [{ token: string; approveScripts: boolean; approvePersonalData?: boolean; roleId: WorkRoleId }, AgentProfile[]];
  'agents:importCancel': [{ token: string }, void];
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
  /** Brother's verdict on a settled agent run (Home strip); renderer only, never an agent tool. */
  'run:outcome': [{ chatId: string; verdict: 'success' | 'partial' | 'fail' }, ChatSummary];
  'agents:restoreVersion': [{ id: string; version: number }, AgentProfile];
  /** the Brain pages (ADR 0077, src/main/brainmodel): agents, skills and their links, rules, memory, the change log */
  'brainmodel:state': [void, BrainModelState];
  /** the maintenance button: run every job now (or one); every change is logged and can be undone */
  'brainmodel:maintain': [{ job?: MaintenanceJobId } | undefined, BrainModelState];
  'brainmodel:rollback': [{ id: string }, BrainModelState];
  /** the user declares (on) or drops (off) a skill for an agent */
  'brainmodel:link': [{ skill: string; agentId: string; on: boolean }, BrainModelState];
  /** Classificatori (read-only): the routing table with history and measured results, recent agent choices */
  'classifiers:state': [void, ClassifiersState];
  'setup:get': [void, SetupState];
  'setup:save': [{ preferences: SetupDraft; status: 'draft' | 'completed' | 'skipped' }, SetupState];
  /** the owner's profile in the brain's me.md (src/main/brain/profile.ts) */
  'profile:get': [void, ProfileResult];
  /** patches only the managed fields; refused when me.md changed since `revision` */
  'profile:save': [ProfileSave, OwnerProfile];
  'app:info': [void, AppInfo];
  'app:usage': [void, Usage];
  'cli:status': [{ harness: Harness; checkLogin?: boolean }, CliStatus];
  'cli:login': [{ harness: Harness }, void];
  /** native folder chooser for the brain folder; sets brainRoot (by the user) and returns it, null if cancelled */
  'app:pickBrain': [void, string | null];
  'app:pickRepo': [void, string | null];
  /** the first-run setup's folders: the projects folder saved or found by itself (read only), and where a new memory goes */
  'app:projectsFolder': [void, ProjectsFolderInfo];
  /** native folder chooser for the projects folder; saves projectsRoot (by the user) and returns it, null if cancelled */
  'app:pickProjects': [void, string | null];
  'app:createBrain': [CreateBrainRequest, CreatedBrain | null];
  /** the viewer's "Show in folder": a local file selected in Explorer, never opened or run (main/open-path.ts) */
  'app:showInFolder': [{ path: string }, OpenPathResult];
  /** the first lines or a thumbnail of a file a message names (absolute, or relative to the chat's folder) */
  'app:peekFile': [{ path: string; cwd?: string }, PeekResult];
  /** A user-opened file link: any local file, never a network share, read-only and bounded; text one page at a time
   *  around a cited `line`, ending at `before`, or from `offset` (`align`: at the next line start). Main renderer only. */
  'app:readFile': [{ path:string; chatId?:string; offset?:number; align?:boolean; before?:number; line?:number }, FileViewResult];
  /** the viewer's "Compare": the file now and the same file at git HEAD / a commit or branch, or another local file
   *  (main/file-diff.ts: read-only git, no shell). Main renderer only. */
  'app:readFileDiff': [{ path:string; chatId?:string; against:DiffAgainst }, FileDiffResult];
  /** an image named in a question (main/ask-image.ts) */
  'app:askImage': [{ path: string }, AskImageResult];
  'chat:list': [void, ChatSummary[]];
  'chat:items': [{ chatId: string }, ChatItem[]];
  'chat:pending': [void, PendingRequest[]];
  'chat:create': [NewChat, ChatSummary];
  'chat:createRouted': [RoutedNewChat, ChatSummary];
  /** text may be empty when images are attached */
  'chat:send': [{ chatId: string; text: string; images?: ImageAttachment[] }, void];
  'chat:answer': [{ chatId: string; requestId: string; answer: Answer }, void];
  /** keepQueued: "Invia subito" stops only the turn; messages the engine already holds still run after it */
  'chat:stop': [{ chatId: string; keepQueued?: boolean }, void];
  'chat:stopAll': [void, number];
  'chat:close': [{ chatId: string }, void];
  /** archive a finished chat (its process ends, its browser tabs close, the env sign-in stays); reopen brings it back */
  'chat:archive': [{ chatId: string; auto?: boolean }, ChatSummary];
  'chat:reopen': [{ chatId: string }, ChatSummary];
  /** "Avvia ora": a chat waiting in the CPU queue starts now (ADR 0036); false = it was not waiting */
  'chat:admitNow': [{ chatId: string }, boolean];
  'chat:set': [{ chatId: string; model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }, ChatSummary];
  /** the chat writes its hand-off now (one turn; a token-free one when it cannot answer) */
  'chat:handoff': [{ chatId: string }, HandoffInfo];
  /** the saved hand-off, null if none */
  'chat:handoffRead': [{ chatId: string; session?: string }, HandoffInfo | null];
  /** "Riprendi": a NEW chat, same engine, folder and choices, that starts from the hand-off (written first if missing or
   *  older than the last turn); the old chat's process ends, it stays readable and linked (continuedBy) */
  'chat:continue': [{ chatId: string }, ChatSummary];
  'browser:list': [void, BrowserTab[]];
  'browser:open': [{ url?: string; ownerChatId?: string | null; env?: string }, BrowserTab];
  'browser:navigate': [{ tabId: string; url: string }, void];
  'browser:go': [{ tabId: string; dir: 'back' | 'forward' | 'reload' }, void];
  'browser:close': [{ tabId: string }, void];
  'views:layout': [ViewLayout[], void];
  'browser:handoffs': [void, BrowserHandoff[]];
  'browser:handoffResolve': [{ id: string; outcome: 'done' | 'failed'; note?: string }, void];
  /** main copies the hand-off's user name or password (read from the credentials file now) to the clipboard; a copied
   *  password is cleared from the clipboard after 30 s if still there. Returns false when it could not (no entry). */
  'browser:handoffCopy': [{ id: string; field: 'user' | 'password' }, boolean];
  'browser:envList': [void, BrowserEnv[]];
  /** the "Credenziali" panel: the entries of the user's credentials file, without passwords */
  'credentials:list': [void, CredentialEntry[]];
  /** main copies an entry's user name or password (read from the file now); a password is cleared from the clipboard
   *  after 30 s if still there. Returns false when it could not (no such entry, e.g. the file changed). */
  'credentials:copy': [{ id: string; field: 'user' | 'password' }, boolean];
  'feed:list': [void, FeedEvent[]];
  'feed:mute': [{ kind: string; muted: boolean }, void];
  'settings:get': [void, Settings];
  /** the stored API keys' masks; set and delete answer the same (a key never comes back, engines/secrets.ts) */
  'secrets:status': [void, SecretsStatus];
  'secrets:set': [{ engine: Harness; key: string }, SecretsStatus];
  'secrets:delete': [{ engine: Harness }, SecretsStatus];
  /** the user's "Riaccendi" on an engine whose definition changed: trust its definition of now and turn it on */
  'engines:trust': [{ engine: Harness }, void];
  /** this month's API spend per engine, computed by the app (engines/spend.ts) */
  'engines:spend': [void, ApiSpendInfo];
  /** The user's own change from the UI (each key logged as a change by 'user'); all keys validated first, all or none */
  'settings:set': [SettingsPatch, Settings];
  'settings:schema': [void, SettingDef[]];
  'settings:history': [{ limit?: number }, SettingChange[]];      // newest first
  'settings:undo': [{ changeId: string }, SettingChange];         // the new change that restores the old value
  /** an agent's request relayed by the UI: non-protected keys apply at once, protected ones become a proposal */
  'settings:propose': [{ key: string; value: unknown; chatId?: string; reason?: string }, SettingRequestResult];
  'settings:pending': [void, SettingProposal[]];
  'settings:confirm': [{ proposalId: string; accept: boolean }, { change: SettingChange | null }];
  /** the job's actual cost and time, for the brain's ledger (jobs.jsonl: routing reads it, ADR 0053) */
  'estimate:record': [JobRecordInput, { id: string }];
  'brain:api': [{ path: string }, BrainApiResult];
  /** the brain's model comparisons (harness/compare): read through its config.mjs, switched through its switch.mjs */
  'compare:list': [void, CompareState];
  'compare:set': [{ experiment: string; on: boolean; agent?: string }, CompareState];
  /** the brain's self-improvement loop: a click of the Miglioramento page (brain/learn.ts) */
  'learn:act': [LearnAction, LearnResult];
  'models:seen': [void, ModelsSeen];
  /** the routing table and the model registry (Impostazioni → «Instradamento modelli») */
  'routing:get': [void, RoutingInfo];
  /** the user saves the table from the settings page: checked against the hard rules, written as a new version;
   *  exploration = the share of chats (0 to 0.5) that try a little-sampled model, omitted = unchanged */
  'routing:save': [{ routes: RoutingRow[]; reason?: string; exploration?: number; costWeight?: number; baseVersion?: number }, RoutingInfo];
  /** the user brings back an older version: a new version with its rows and exploration (history stays linear) */
  'routing:restore': [{ version: number }, RoutingInfo];
  /** "Nuova chat": what chat:createRouted would start for this request now, without starting it (no exploration) */
  'routing:preview': [RoutedNewChat, RoutePreview];
  'tasks:get': [void, TasksState];
  /** "Aggiorna ora": runs the scripts now (resolves when done; a read already running is joined) */
  'tasks:refresh': [void, TasksState];
  /** marks news read: the given keys, or all of them */
  'tasks:markRead': [{ keys?: string[] }, TasksState];
  /** the "Stato" view: the git branch checked out in each chat folder, read from disk (null = not a git folder) */
  'chat:branches': [{ cwds: string[] }, Record<string, string | null>];
  /** the app page → main: what the global request layer shows now (main attaches/detaches it and forwards the model) */
  'overlay:model': [OverlayModel, void];
  /** the layer page → main: the size its cards need (main places the layer bottom-right) */
  'overlay:size': [{ width: number; height: number }, void];
  /** the app page's typing probe (renderer/lib/inputlag.ts): one summary a minute while the user types, to the log */
  'app:inputLag': [InputLagReport, void];
  /** the layer page → main → the app page: the user answered / postponed / opened a card, or left the layer */
  'overlay:action': [OverlayAction, void];
  /** move the keyboard to the layer (Ctrl+J, a click) or back to the app; never automatic */
  'overlay:focus': [{ target: 'overlay' | 'app' }, void];
  /** the user clicked "Esegui" under a shell block (never an agent): confirmProd = the second click on a production one */
  'run:start': [{ chatId: string; itemId: string; code: string; lang?: string; confirmProd?: boolean }, RunInfo];
  'run:stop': [{ runId: string }, void];
  'run:list': [{ chatId?: string }, RunInfo[]];
  /** "Non serve" on a command request: it leaves "Ti aspettano" without running (the block stays in the chat) */
  'run:dismiss': [{ chatId: string; requestId: string }, void];
  /** "Skill e agenti" (ADR 0018): every skill and agent of both engines, and where new ones can go */
  'skills:list': [void, SkillCatalog];
  'skills:read': [{ id: string }, SkillDoc];
  /** checked (skillmd) and passed through the user's PreToolUse hooks for Write before anything is written */
  'skills:save': [SkillSave, SkillSaveResult];
  /** to the Windows Recycle Bin: a skill's folder, an agent's file */
  'skills:delete': [{ id: string }, { ok: boolean; error?: string }];
  /** what "/" offers in a chat's input: the commands its engine reported, or its engine's skills on disk */
  'chat:commands': [{ chatId: string }, ChatCommand[]];
  /** Settings → Aggiornamenti: the version in use, the code folder, the restart notice (refresh = read git now) */
  'source:get': [{ refresh?: boolean }, AppSourceState];
  /** Read without starting an engine; ensure creates only when no coordinator exists. */
  'orchestrator:get': [void, ChatSummary | null];
  'orchestrator:ensure': [{ harness: Harness; model?: string }, ChatSummary];
  /** the restart notice was read */
  'source:dismissLaunch': [void, AppSourceState];
  /** reads GitHub's main against the code folder (git fetch, nothing changes) */
  'source:check': [void, AppSourceState];
  /** the user's click on "Aggiorna" (never an agent): pull, build, switch to the new version and restart, no tests */
  'source:updateNow': [void, AppSourceState];
  /** a chat input's Ctrl+V carried no image and no text: main reads the clipboard's image (seen = the paste's types, logged) */
  'clipboard:image': [{ seen: string[] }, ClipboardImage | null];
  /** Ctrl+K: full-text search over chats (last 30 days), branches and the brain's markdown (read-only) */
  'search:query': [{ q: string }, SearchResult];
  /** the hybrid search's model and index; retryModel starts the model download again after a failure */
  'search:status': [void, SearchIndexStatus];
  'search:retryModel': [void, SearchIndexStatus];
  /** "Rispondi dopo" (on: true) or the queue opened by the user (on: false) */
  'later:get': [void, AnswerLater];
  'later:set': [{ on: boolean }, AnswerLater];
  /** brain domains and their sync (ADR 0059): the status, a sync now (one domain or all), the user's choice on a conflict */
  'sync:get': [void, SyncState];
  'sync:now': [{ domain?: string }, SyncState];
  'sync:resolve': [{ domain: string; choice: SyncChoice }, SyncState];
  /** the Grindhouse's headline (SPEC 18, main/headline.ts): the line on screen now, never waiting for a model */
  'headline:get': [void, HeadlineState];
  'orchestrator:held': [void, HeldNewsState];
  'pulse:list': [{ place: PulsePlace }, PulseList];
  'pulse:status': [void, PulseStatus];
  'pulse:seen': [{ ids: string[] }, void];
  'pulse:save': [{ id: string }, PulseResult];
  'pulse:act': [{ id: string }, PulseActResult];
  'pulse:dismiss': [{ id: string; reason?: PulseDismissReason }, PulseResult];
  'pulse:runNow': [void, PulseResult];
  'approvals:list': [{ agentId?: string }, ApprovalItem[]];
  'approvals:decide': [ApprovalDecision, PulseResult];
  /** cloud agents (ADR 0080, main/cloud/): the known ones (refresh = ask the vendors now, at most every 30 s) */
  'cloud:list': [{ refresh?: boolean } | void, CloudState];
  /** the user's click (or app_create_chat where:'cloud'): fails closed with the reason (not signed in, no GitHub remote…) */
  'cloud:start': [CloudStartRequest, CloudAgent];
  'cloud:followUp': [{ id: string; text: string }, CloudAgent];
  'cloud:stop': [{ id: string }, CloudAgent];
  /** "Porta in locale": the result into a NEW worktree beside the repo (never into the checkout itself) */
  'cloud:apply': [{ id: string }, CloudApplyResult];
  /** the strip expanded now (its messages stream while it stays open, Cursor), or null */
  'cloud:watch': [{ id: string | null }, void];
  /** whether each engine can start a cloud agent from this folder now (key, sign-in, GitHub remote, pushed branch) */
  'cloud:readiness': [{ cwd: string }, Record<string, { ok: boolean; why?: string }>];
  /** forget a finished agent (the vendor keeps it) */
  'cloud:dismiss': [{ id: string }, CloudState];
}

/** The Grindhouse's headline (SPEC 18): a joke on the day's real events, written about once an hour by a model on the
 *  Anthropic API engine (main/headline.ts). source: model = the last answer; previous = an older answer kept after a
 *  failed refresh; builtin = none yet, a line of the app's own list. month* = what the headline spent this month. */
export interface HeadlineState {
  /** Battito provenance; absent in legacy caches. */
  engine?: string | null;
  agentId?: string;
  text: string;
  source: 'model' | 'previous' | 'builtin';
  at: number | null;
  model: string;
  monthUsd: number;
  monthCalls: number;
}

/** An image read from the system clipboard by main (bytes as they were; the renderer checks and scales them). */
export interface ClipboardImage { mimeType: string; bytes: Uint8Array }

/** main → renderer. */
export interface EventMap {
  'update:state': AppUpdateState;
  'update:checkpointRequest': UpdateCheckpointRequest;
  'update:checkpointRelease': { requestId: string };
  'progress:changed': ProgressState;
  'chat:autoCloseStatus': AutoCloseStatus[];
  'agents:changed': AgentCatalog;
  /** the "Da approvare" queue changed (a proposal, an evaluation, a decision): read /api/agents/lifecycle again */
  'agents:lifecycleChanged': null;
  'chat:updated': ChatSummary;
  'chat:removed': { chatId: string };
  'chat:item': { chatId: string; item: ChatItem; replace?: boolean };
  'pending:added': PendingRequest;
  'pending:resolved': { chatId: string; requestId: string };
  'browser:tabs': BrowserTab[];
  'browser:handoff': BrowserHandoff;   // opened or changed state
  'browser:envs': BrowserEnv[];        // the known environments changed (tabs, session status, last login)
  'browser:pointer': { tabId: string; inside: boolean };   // the mouse entered/left a tab's page (a native view the UI cannot see)
  'feed:events': FeedEvent[];
  'usage': Usage;
  /** the background CLI check at start finished (app:info had cli null until now) */
  'cli:ready': Record<Harness, CliStatus>;
  'focus:next': void;
  /** app-control MCP or a notification asks the UI to do something (switch view, focus a chat, open a page). */
  'ui:command': { action: string; value?: string };
  /** one key changed (by the user or an agent), applied live; `settings` = the full effective settings after it */
  'settings:changed': SettingChange & { settings: Settings };
  /** the engines changed (the brain's models.json, a definition turned on): the new list */
  'engines:changed': EngineInfo[];
  /** a protected change waits for the user (status pending), or was answered (accepted / rejected) */
  'settings:proposed': SettingProposal;
  'budget:alert': BudgetAlert;
  'tasks:state': TasksState;
  /** main → the layer page: the cards to show */
  'overlay:model': OverlayModel;
  /** main → the app page: what the user did in the layer */
  'overlay:action': OverlayAction;
  /** a run started, printed more output, or ended */
  'run:updated': RunInfo;
  'source:state': AppSourceState;
  'later:changed': AnswerLater;
  'search:status': SearchIndexStatus;
  /** a skill, rule, memory file or agent link changed (a maintenance job, a rollback, the brain on disk) */
  'brainmodel:changed': void;
  /** a script of the brain or its changelog changed on disk (brain watcher): the Script and Changelog pages reload */
  'scripts:changed': void;
  /** a domain's sync status changed (ADR 0059) */
  'sync:state': SyncState;
  /** a new headline (or the same after a failed refresh, source previous) */
  'headline:changed': HeadlineState;
  /** what the app holds back for the Orchestrators changed (main/chats/held-news.ts, #88) */
  'orchestrator:heldChanged': HeldNewsState;
  'pulse:changed': void;
  'approvals:changed': void;
  'cloud:changed': CloudState;
  'mcpservers:changed': McpServersState;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;
export type InvokeArg<K extends InvokeChannel> = InvokeMap[K][0];
export type InvokeResult<K extends InvokeChannel> = InvokeMap[K][1];

// Runtime lists (the preload allow-list). Kept in sync with the maps by the compile-time checks below.
export const INVOKE_CHANNELS = [
  'pulse:list', 'pulse:status', 'pulse:seen', 'pulse:save', 'pulse:act', 'pulse:dismiss', 'pulse:runNow', 'approvals:list', 'approvals:decide',
  'connectors:list', 'connectors:login', 'connectors:cancelLogin', 'connectors:probe', 'connectors:select', 'connectors:disconnect',
  'mcpservers:state', 'mcpservers:save', 'mcpservers:remove', 'mcpservers:setSecret', 'mcpservers:deleteSecret', 'mcpservers:setAccess', 'mcpservers:test', 'mcpservers:importScan', 'mcpservers:importApply',
  'update:get', 'update:apply', 'update:checkpointAnswer', 'update:recovery', 'update:recoveryAck',
  'app:createBrain', 'app:projectsFolder', 'app:pickProjects',
  'progress:get', 'progress:setHidden', 'progress:confirmResult',
  'chat:autoCloseGet', 'chat:autoClosePresence', 'chat:autoCloseKeep',
  'agents:list', 'skills:suggest', 'agents:undo', 'agents:save', 'agents:reset', 'agents:history', 'agents:metrics', 'agents:estimates', 'run:outcome', 'agents:restoreVersion', 'setup:get', 'setup:save', 'profile:get', 'profile:save',
  'app:info', 'app:usage', 'cli:status', 'cli:login', 'app:pickBrain', 'app:pickRepo', 'app:showInFolder', 'app:peekFile', 'app:readFile', 'app:readFileDiff', 'app:askImage', 'chat:list', 'chat:items', 'chat:pending', 'chat:create', 'chat:createRouted', 'chat:send', 'chat:answer', 'chat:stop',
  'agents:exportPlan', 'agents:exportFix', 'agents:export', 'brain:share', 'agents:importInspect', 'agents:importApply', 'agents:importCancel', 'brainmodel:state', 'brainmodel:maintain', 'brainmodel:rollback', 'brainmodel:link', 'classifiers:state', 'agents:trialDecide', 'agents:lifecycleDecide',
  'chat:stopAll', 'chat:close', 'chat:archive', 'chat:reopen', 'chat:admitNow', 'chat:set', 'chat:handoff', 'chat:handoffRead', 'chat:continue', 'browser:list', 'browser:open', 'browser:navigate', 'browser:go',
  'browser:close', 'views:layout', 'feed:list', 'feed:mute', 'settings:get', 'settings:set', 'settings:schema', 'settings:history',
  'settings:undo', 'settings:propose', 'settings:pending', 'settings:confirm', 'estimate:record', 'brain:api',
  'tasks:get', 'tasks:refresh', 'tasks:markRead', 'chat:branches',
  'compare:list', 'compare:set', 'learn:act', 'models:seen', 'routing:get', 'routing:save', 'routing:restore', 'routing:preview',
  'browser:handoffs', 'browser:handoffResolve', 'browser:handoffCopy', 'browser:envList', 'credentials:list', 'credentials:copy', 'overlay:model', 'overlay:size', 'overlay:action', 'overlay:focus',
  'run:start', 'run:stop', 'run:list', 'run:dismiss', 'app:inputLag', 'skills:list', 'skills:read', 'skills:save', 'skills:delete', 'chat:commands', 'source:get', 'source:dismissLaunch', 'source:check', 'source:updateNow',
  'clipboard:image',
  'orchestrator:get', 'orchestrator:ensure',
  'search:query', 'search:status', 'search:retryModel', 'later:get', 'later:set', 'secrets:status', 'secrets:set', 'secrets:delete', 'engines:trust', 'engines:spend',
  'sync:get', 'sync:now', 'sync:resolve', 'headline:get',
  'orchestrator:held',
  'cloud:list', 'cloud:start', 'cloud:followUp', 'cloud:stop', 'cloud:apply', 'cloud:watch', 'cloud:readiness', 'cloud:dismiss',
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = [
  'pulse:changed', 'approvals:changed',
  'update:state', 'update:checkpointRequest', 'update:checkpointRelease',
  'progress:changed',
  'chat:autoCloseStatus',
  'agents:changed', 'agents:lifecycleChanged',
  'chat:updated', 'chat:removed', 'chat:item', 'pending:added', 'pending:resolved', 'browser:tabs', 'feed:events', 'usage', 'cli:ready', 'focus:next', 'ui:command',
  'settings:changed', 'engines:changed', 'settings:proposed', 'budget:alert', 'tasks:state', 'browser:handoff', 'browser:envs', 'browser:pointer', 'overlay:model', 'overlay:action', 'run:updated', 'source:state', 'later:changed', 'search:status', 'brainmodel:changed', 'sync:state', 'headline:changed',
  'cloud:changed',
  'mcpservers:changed',
  'orchestrator:heldChanged',
  'scripts:changed',
] as const satisfies readonly EventChannel[];

type Missing<All, Listed> = Exclude<All, Listed>;
// Compile error if a channel is added to a map but not to its runtime list.
const _invokeComplete: Missing<InvokeChannel, (typeof INVOKE_CHANNELS)[number]> extends never ? true : never = true;
const _eventComplete: Missing<EventChannel, (typeof EVENT_CHANNELS)[number]> extends never ? true : never = true;
void _invokeComplete; void _eventComplete;

/** What the preload exposes as window.sb. */
export interface Bridge {
  pathForFile?: (file: File) => string;
  invoke<K extends InvokeChannel>(channel: K, arg: InvokeArg<K>): Promise<InvokeResult<K>>;
  on<K extends EventChannel>(channel: K, fn: (payload: EventMap[K]) => void): () => void;
}
