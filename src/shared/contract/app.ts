// App: «Aggiorna» from GitHub, app info and health, CLI status, usage, the first-run setup and the owner's profile.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { SetupDraft, SetupState } from '../agents';
import type { AppUpdateState, UpdateCheckpointAnswer, UpdateRecovery } from '../app-update';
import type { CreateBrainRequest, CreatedBrain } from '../brain-create';
import type { DiffAgainst, FileDiffResult } from '../file-diff';
import type { FileViewResult } from '../file-view';
import type { OwnerProfile, ProfileResult, ProfileSave } from '../profile';
import type { AskImageResult, OpenPathResult } from './chats';
import type { EngineInfo, Harness } from './engines';
import type { Lang } from './settings';
import type { InputLagReport } from './ui';

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
// ---- the usage counter (main/use-counter.ts, ADR 0202): page opens and main actions per day, local only, zero tokens

/** One place or action of the usage counter: `key` = "page:<id>[/<tab>]" or "action:<name>". */
export interface UseCountRow { key: string; n: number; days: number; last: string }
/** The counts of the last `days` days (local dates, YYYY-MM-DD), the busiest first; `since` = the first day counted. */
export interface UseCountReport { from: string; to: string; days: number; total: number; since: string | null; byDay: { day: string; n: number }[]; rows: UseCountRow[] }

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

/** renderer → main, app: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface AppInvokeMap {
  'update:get': [void, AppUpdateState];
  'update:apply': [{ id: string }, AppUpdateState];
  'update:checkpointAnswer': [UpdateCheckpointAnswer, void];
  'update:recovery': [void, UpdateRecovery | null];
  'update:recoveryAck': [{ id: string }, void];
  'setup:get': [void, SetupState];
  'setup:save': [{ preferences: SetupDraft; status: 'draft' | 'completed' | 'skipped' }, SetupState];
  /** the owner's profile in the brain's me.md (src/main/brain/profile.ts) */
  'profile:get': [void, ProfileResult];
  /** patches only the managed fields; refused when me.md changed since `revision` */
  'profile:save': [ProfileSave, OwnerProfile];
  'app:info': [void, AppInfo];
  'app:usage': [void, Usage];
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
  /** A user-opened file link: any local file, never a network share, read-only and bounded; text one page at a time
   *  around a cited `line`, ending at `before`, or from `offset` (`align`: at the next line start). Main renderer only. */
  'app:readFile': [{ path:string; chatId?:string; offset?:number; align?:boolean; before?:number; line?:number }, FileViewResult];
  /** the viewer's "Compare": the file now and the same file at git HEAD / a commit or branch, or another local file
   *  (main/file-diff.ts: read-only git, no shell). Main renderer only. */
  'app:readFileDiff': [{ path:string; chatId?:string; against:DiffAgainst }, FileDiffResult];
  /** an image named in a question (main/ask-image.ts) */
  'app:askImage': [{ path: string }, AskImageResult];
  /** the app page's typing probe (renderer/lib/inputlag.ts): one summary a minute while the user types, to the log */
  'app:inputLag': [InputLagReport, void];
  /** Settings → Aggiornamenti: the version in use, the code folder, the restart notice (refresh = read git now) */
  'source:get': [{ refresh?: boolean }, AppSourceState];
  /** the restart notice was read */
  'source:dismissLaunch': [void, AppSourceState];
  /** reads GitHub's main against the code folder (git fetch, nothing changes) */
  'source:check': [void, AppSourceState];
  /** the user's click on "Aggiorna" (never an agent): pull, build, switch to the new version and restart, no tests */
  'source:updateNow': [void, AppSourceState];
  /** the usage counter (ADR 0202): the renderer's batched counts since its last flush ("page:costi" → 2), local only */
  'usecount:add': [{ counts: Record<string, number> }, void];
  /** Andamento → Uso: the last `days` days (default 14, at most 90) */
  'usecount:report': [{ days?: number }, UseCountReport];
}
