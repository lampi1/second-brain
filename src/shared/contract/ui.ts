// Shell UI: held news, the global layer (overlay), skills and agents on disk, search, brain sync, headline and the page's own diagnostics.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { LogList } from '../activity-log';
import type { Harness } from './engines';
import type { Lang, ThemeMode } from './settings';

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

// ── Global layer: important events as short toasts in a small top-most WebContentsView (main/overlay.ts), above
// browser tiles and pages. Requests never float here: every question, permission and command is answered in the
// questions window (always on since 2026-10-22). The app page decides what it shows, the layer only renders it.
export interface OverlayModel {
  theme: ThemeMode;
  /** the app page's resolved UI language (ADR 0057) */
  lang?: Lang;
  density: 'comfortable' | 'compact';
  now?: number;              // the app page's clock (frozen in the demo), for "4 min" labels
  /** important events (chat waiting/done, errors, sync, budget, login…) as short toasts above everything, max 2 */
  toasts?: OverlayToast[];
  /** the Orchestrator widget's bottom-right room (ADR 0028): the layer sits left of it (expanded) or above it (collapsed) */
  /** top is the absolute occupied bottom in content coordinates; right/bottom are edge reservations. */
  avoid?: { right: number; bottom: number; top?:number };
}
/** The look (color, icon) of a notice, the one notification design of the app and of the global layer
 *  (renderer components/Notice.tsx, ADR 0151): attention = someone waits for the user's answer; celebrate = a big
 *  finished job (the maintenance). */
export type NoticeTone = 'info' | 'ok' | 'warn' | 'err' | 'attention' | 'celebrate';
export interface OverlayToast {
  id: string;                 // group key (kind|chat)
  kind: string;
  label: string;              // Italian kind label ("Errore registrato")
  title: string;
  detail: string;
  count: number;              // grouped events of this kind (and chat)
  action: string;             // the one direct action: "Apri", "Rispondi"
  tone: NoticeTone;
}
/** The overlay page only renders the toasts: the app page acts on its behalf. */
export type OverlayAction =
  | { kind: 'next' }                        // Ctrl+J inside the layer: the app takes the keyboard and opens what waits
  | { kind: 'leave' }                       // keyboard back to the app
  | { kind: 'toast'; id: string; act: 'open' | 'dismiss' }; // an event toast: its action, or ✕

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

/** Key → letter on screen in the app page over one window (ms): keydown to the first frame after its input event. */
export interface InputLagReport { keys: number; p50: number; p95: number; max: number; longTaskMs: number; windowSec: number }
/** An interface error the page reports (renderer/lib/ui-errors.ts → main/renderer-errors.ts, ADR 0192): a window
 *  'error', an unhandled promise rejection or a React render error caught by a page's ErrorBoundary. Only the error's
 *  own text and stack (cut), never the user's content; main rate-limits and redacts it into the `renderer` log. */
export interface RendererErrorReport {
  kind: 'error' | 'rejection' | 'render';
  message: string;
  stack?: string;
  /** the React component stack (render errors) */
  componentStack?: string;
  /** script:line:col of a window error */
  source?: string;
  /** where it happened: the page id or the column ('orchestrator', 'focus', 'map') */
  where?: string;
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

/** renderer → main, ui: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface UiInvokeMap {
  /** the app page → main: what the global layer shows now (main attaches/detaches it and forwards the model) */
  'overlay:model': [OverlayModel, void];
  /** the layer page → main: the size its toasts need (main places the layer bottom-right) */
  'overlay:size': [{ width: number; height: number }, void];
  /** the app page's interface errors (ADR 0192): to the `renderer` log, rate-limited */
  'log:renderer': [RendererErrorReport, void];
  /** the layer page → main → the app page: the user used a toast, pressed Ctrl+J or left the layer */
  'overlay:action': [OverlayAction, void];
  /** move the keyboard to the layer (Ctrl+J, a click) or back to the app; never automatic */
  'overlay:focus': [{ target: 'overlay' | 'app' }, void];
  /** "Skill e agenti" (ADR 0018): every skill and agent of both engines, and where new ones can go */
  'skills:list': [void, SkillCatalog];
  'skills:read': [{ id: string }, SkillDoc];
  /** checked (skillmd) and passed through the user's PreToolUse hooks for Write before anything is written */
  'skills:save': [SkillSave, SkillSaveResult];
  /** to the Windows Recycle Bin: a skill's folder, an agent's file */
  'skills:delete': [{ id: string }, { ok: boolean; error?: string }];
  /** a chat input's Ctrl+V carried no image and no text: main reads the clipboard's image (seen = the paste's types, logged) */
  'clipboard:image': [{ seen: string[] }, ClipboardImage | null];
  /** Ctrl+K: full-text search over chats (last 30 days), branches and the brain's markdown (read-only) */
  'search:query': [{ q: string }, SearchResult];
  /** the hybrid search's model and index; retryModel starts the model download again after a failure */
  'search:status': [void, SearchIndexStatus];
  'search:retryModel': [void, SearchIndexStatus];
  /** brain domains and their sync (ADR 0059): the status, a sync now (one domain or all), the user's choice on a conflict */
  'sync:get': [void, SyncState];
  'sync:now': [{ domain?: string }, SyncState];
  'sync:resolve': [{ domain: string; choice: SyncChoice }, SyncState];
  /** the Grindhouse's headline (SPEC 18, main/headline.ts): the line on screen now, never waiting for a model */
  'headline:get': [void, HeadlineState];
  /** the Log page (shared/activity-log.ts): the recent events, the folder's size and its limits; zero tokens */
  'log:list': [void, LogList];
}
