// Chats: a chat's summary, items, questions and permissions, runs of shell blocks, new chats.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { AgentContextSnapshot } from '../agent-context';
import type { AgentChildren, AgentOwnerSnapshot, AgentRun, CanonicalResult, TaskDeliveryPolicy } from '../agents';
import type { AutoClosePresence, AutoCloseStatus } from '../auto-close';
import type { SuggestAnswer, SuggestRequest, SuggestState } from '../composer-suggest';
import type { ChatDelegation, DelegationLimitHit } from '../delegation';
import type { ChatEffortStatus } from '../effort';
import type { ModelTier } from '../roles';
import type { StrategyPlan } from '../strategy';
import type { SysCode, SysParams } from '../sys';
import type { Harness } from './engines';
import type { RouteDecision } from './settings';
import type { AnswerLater, ChatCommand, HeldNewsState } from './ui';

/** running: the model is working · waiting: a question/permission needs the user · idle: turn ended, input open ·
 *  starting: process booting · error: the process failed (see lastError) · closed: process gone (can be resumed). */
export type ChatState = 'starting' | 'running' | 'waiting' | 'idle' | 'error' | 'closed';

/** app = runs inside the app (we own the process). The only origin in v1 (ADR 0010: no coexistence with other apps). */
export type ChatOrigin = 'app';

/** a chat waiting in the CPU-aware queue (ADR 0036) */
export interface QueuedInfo { kind: 'start' | 'turn'; position: number; since: number; cpu: number; freeRam: number }

export interface ChatSummary {
  launchContext?: AgentContextSnapshot;
  /** Host-only immutable routine identity, never accepted by app_create_chat. */
  /** Retired routine worker or descendant: transcript only, never an executable session. */
  routineArchived?: true;
  routine?: { browserWrite?: true; runId: string; stepId: string };
  routinePackage?: string;
  routinePromptHash?: string;
  userEvents?: { latestSeq: number; acknowledgedSeq: number };
  /** Root results the user can synthesize; private delegated results are excluded. */
  availableResultIds?: string[];
  /** Results with an outstanding app delivery or explicitly requested synthesis. */
  pendingResultIds?: string[];
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
  /** a Strategist root chat's plan with the user (ADR 0108): its questions' answers, the steps, their progress */
  plan?: StrategyPlan;
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
  /** how its harness, model and effort were chosen (its role's card or the user's defaults; app_create_chat, chat:createRouted) */
  route?: RouteDecision;
  /** ADR 0103: when the checkpoint before its last turn was taken (its files can go back to it); absent = none */
  checkpointAt?: number;
  /** «Flash», once «Lampo» (ADR 0105, 0107): the always-on quick lane beside the Orchestrator: reads and answers, changes nothing, starts no
   *  work; never a strip, never news for the Orchestrator, never closed by itself */
  quick?: true;
  /** the maintenance research chat (ADR 0132): reads and proposes cards, changes nothing */
  research?: true;
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
  /** the list-price $ of the first calls after an auto-compaction (the cold notes and continuation counters went in
   *  ADR 0186: no page read them; the log keeps each note's line) */
  afterCompaction: { calls: number; usd: number };
  /** the prompt cache per kind of chat (token plan 2026-10-20: measure before trusting the estimates): tokens read from
   *  the cache, written to it and sent uncached, over every call and over the first call of each session (whether a new
   *  session finds its prefix already cached by another one) */
  cache?: Record<CacheKind, CacheTotals>;
}
export type CacheKind = 'orchestrator' | 'root' | 'child';
export interface CacheTotals { calls: number; read: number; write: number; input: number; firstCalls: number; firstRead: number; firstWrite: number }

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
  /** exitCode: a shell command's exit code, only when its engine said it (Claude's Bash result, Codex's exitCode, an ACP
   *  rawOutput that carries one); absent = unknown (the run's receipts, agents/receipts.ts, ADR 0130) */
  | { kind: 'tool'; id: string; at: number; name: string; summary: string; input: unknown; status: 'running' | 'ok' | 'error'; output?: string; outputPreviewChars?: number; outputUrls?: string[]; diff?: FileDiff[]; exitCode?: number }
  /** continued = the divider of an invisible continuation (ADR 0031): the items above it are the previous session
   *  (shown folded), its note is the hand-off it starts from */
  // text: the English rendering, for agents, logs and items saved before this field existed. When code is set, the
  // UI shows t('sys.' + code, params) instead (src/shared/sys.ts, src/renderer/i18n/index.ts's sysText()).
  | { kind: 'system'; id: string; at: number; text: string; level: 'info' | 'warn' | 'error'; code?: SysCode; params?: SysParams; result?: CanonicalResult; continued?: { notePath: string; session?: string } }
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
/** a question's brief (ADR 0150): what was done, its evidence and what Sì / No do, shown inside the question card so the
 *  question never leans on the chat text before it (only with target next-ask) */
export interface UiBrief {
  done: string[]; ifYes: string; ifNo: string;
  checks?: { label: string; status: UiStatus; detail?: string }[];
  images?: { path: string; caption?: string }[];
  files?: { path: string; why?: string; added?: number; removed?: number; href?: string }[];
}
export type UiSpec =
  | { component: 'table'; props: UiTable }
  | { component: 'cards'; props: UiCards }
  | { component: 'board'; props: UiBoard }
  | { component: 'diffList'; props: UiDiffList }
  | { component: 'barChart'; props: UiBarChart }
  | { component: 'brief'; props: UiBrief };
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
/** what the viewer's copy icon put on the clipboard (main/file-copy.ts) */
export type CopyFileResult = { how: 'text' | 'image' | 'file' } | { how: 'missing' | 'refused'; reason: string };
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
  deliveryPolicy?: TaskDeliveryPolicy;
  doneWhen?: string[];
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
  /** «Flash», the quick lane (ADR 0105, 0107): only the user; one at a time (the open one is returned) */
  quick?: boolean;
  /** the maintenance research (ADR 0132): only the app; reads the brain (and the web when `web`), proposes through
   *  maintenance_propose, changes nothing */
  research?: { web: boolean };
  /** with orchestrator: the Orchestrator this one replaces; the old one goes on as a normal chat, its history kept */
  replaces?: string;
  worktree?: boolean;         // claude --worktree
  route?: RouteDecision;      // set by app_create_chat and chat:createRouted: how the engine was chosen (role, defaults, override)
  /** run tags (AGENTS-DESIGN §4.8): the skill ids the chat starts with (`^[a-z0-9][a-z0-9_-]{0,79}$`, at most 16) */
  skills?: string[];
  /** run tags: the product the work is about, up to 40 characters */
  app?: string;
}

/** A chat the user starts without choosing everything ("Nuova chat", a new Orchestrator from Ricomincia / Cambia motore /
 *  Pulisci): main picks harness, model and effort from the user's defaults (ADR 0032, 0210)
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

/** renderer → main, chats: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface ChatsInvokeMap {
  'chat:autoCloseGet': [void, AutoCloseStatus[]];
  'chat:autoClosePresence': [{ holds: AutoClosePresence[] }, void];
  'chat:autoCloseKeep': [{ chatId: string; keep: boolean }, void];
  /** Brother's verdict on a settled agent run (Home strip); renderer only, never an agent tool. */
  'run:outcome': [{ chatId: string; verdict: 'success' | 'partial' | 'fail' }, ChatSummary];
  /** Explicit user review of provenance-bearing memory and skill candidates; never exposed as model approval. */
  'chat:synthesize': [{ runId: string }, void];
  'chat:list': [void, ChatSummary[]];
  'chat:items': [{ chatId: string; itemId?: string; limit?: number; maxBytes?: number }, ChatItem[]];
  'chat:pending': [void, PendingRequest[]];
  'chat:create': [NewChat, ChatSummary];
  'chat:createRouted': [RoutedNewChat, ChatSummary];
  /** text may be empty when images are attached */
  /** voice: said in the voice conversation: the engine is asked for a reply made to be heard (ADR 0152) */
  'chat:send': [{ chatId: string; text: string; images?: ImageAttachment[]; voice?: boolean }, void];
  'chat:answer': [{ chatId: string; requestId: string; answer: Answer }, void];
  /** a Strategist's proposed plan: «Approva e parti», or «Cambia qualcosa» with what to change (ADR 0108) */
  /** at = the proposal the user read (StrategyPlan.at): a newer one is refused, never approved unseen */
  'chat:plan': [{ chatId: string; decision: 'approve' | 'change'; at: number; text?: string }, void];
  /** keepQueued: "Invia subito" stops only the turn; messages the engine already holds still run after it */
  'chat:stop': [{ chatId: string; keepQueued?: boolean }, void];
  'chat:stopAll': [void, number];
  'chat:close': [{ chatId: string }, void];
  /** archive a finished chat (its process ends, its browser tabs close, the env sign-in stays); reopen brings it back */
  /** undoable: the user's ✕ with «Annulla» (#168): the run ends when the close is final */
  'chat:archive': [{ chatId: string; auto?: boolean; undoable?: boolean }, ChatSummary];
  'chat:reopen': [{ chatId: string }, ChatSummary];
  /** "Avvia ora": a chat waiting in the CPU queue starts now (ADR 0036); false = it was not waiting */
  'chat:admitNow': [{ chatId: string }, boolean];
  /** the user is typing in this chat: an engine released for idleness starts now (no message, no tokens); false = nothing to start */
  'chat:prewarm': [{ chatId: string }, boolean];
  'chat:set': [{ chatId: string; model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }, ChatSummary];
  /** the chat writes its hand-off now (one turn; a token-free one when it cannot answer) */
  'chat:handoff': [{ chatId: string }, HandoffInfo];
  /** the saved hand-off, null if none */
  'chat:handoffRead': [{ chatId: string; session?: string }, HandoffInfo | null];
  /** "Riprendi": a NEW chat, same engine, folder and choices, that starts from the hand-off (written first if missing or
   *  older than the last turn); the old chat's process ends, it stays readable and linked (continuedBy) */
  'chat:continue': [{ chatId: string }, ChatSummary];
  /** ADR 0103: the files back as they were before the chat's last turn (its checkpoint); counts of restored and removed files */
  'chat:undoTurn': [{ chatId: string }, { restored: number; removed: number }];
  /** the "Stato" view: the git branch checked out in each chat folder, read from disk (null = not a git folder) */
  'chat:branches': [{ cwds: string[] }, Record<string, string | null>];
  /** the user clicked "Esegui" under a shell block (never an agent): confirmProd = the second click on a production one */
  'run:start': [{ chatId: string; itemId: string; code: string; lang?: string; confirmProd?: boolean }, RunInfo];
  'run:stop': [{ runId: string }, void];
  'run:list': [{ chatId?: string }, RunInfo[]];
  /** "Non serve" on a command request: it leaves "Ti aspettano" without running (the block stays in the chat) */
  'run:dismiss': [{ chatId: string; requestId: string }, void];
  /** what "/" offers in a chat's input: the commands its engine reported, or its engine's skills on disk */
  'chat:commands': [{ chatId: string }, ChatCommand[]];
  /** Read without starting an engine; ensure creates only when no coordinator exists. */
  'orchestrator:ensure': [{ harness: Harness; model?: string }, ChatSummary];
  /** "Rispondi dopo" (on: true) or the queue opened by the user (on: false) */
  'later:set': [{ on: boolean }, AnswerLater];
  /** the chat composer's model suggestion (ADR 0118): get after a typing pause, cancel on the next key, today's spend */
  'suggest:get': [SuggestRequest, SuggestAnswer];
  'suggest:cancel': [{ chatId: string }, void];
  'suggest:state': [void, SuggestState];
  'orchestrator:held': [void, HeldNewsState];
  /** the user opened a held news item's chat from the list: that chat's items are read, never wake the Orchestrator (#123) */
  'orchestrator:heldSeen': [{ chatId: string }, HeldNewsState];
}
