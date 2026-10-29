// Brain: the brain's data server, quality, comparisons, the learning loop, scripts, queries, the change log, memory and maintenance.
// One area of the IPC contract: src/shared/contract.ts re-exports it and assembles the channel maps (change a shape
// here first, then both sides).
import type { PackFinding } from '../agent-pack';
import type { BrainModelState, ClassifiersState, MaintenanceJobId } from '../brain-model';
import type { LearningEvidence, LearningReviewState, MemoryReviewRecord, ReplayComparison, ReplayRecord, SkillCandidateView } from '../learning-review';
import type { MaintenanceStatus } from '../maintenance-research';
import type { MorningOp, MorningState } from '../morning';
import type { ProposalDecide, ProposalDecideResult, ProposalsState } from '../proposals';
import type { Harness } from './engines';

/** What the shareable brain zip holds (counts), or why it was not written: guard findings, or no brain / no guard. */
export type BrainShareResult = { ok: true; path: string; skills: number; rules: number; roles: number; scripts: number; skipped: number } | { ok: false; findings: PackFinding[] } | { ok: false; error: string };

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
  /** the user's corrections the app saw (main/brain/user-corrections.ts, ADR 0197); absent from an older main */
  corrections?: UserCorrections;
}
/** One Rome day of the user's own messages to the app's chats, counted when sent (never their text): tagged = «Correggi
 *  il pensiero»; afterReport = a correction to a run whose agent had already reported; recognized = any other message
 *  the correction detector (semantic, else the hook's regex) reads as a correction; semantic = how many of afterReport +
 *  recognized the semantic detector decided; chats = titles of the chats corrected that day (at most 30), for matching
 *  ai-errors.md rows with no «visto da». */
export interface UserCorrectionDay { date: string; messages: number; tagged: number; afterReport: number; recognized: number; semantic: number; chats: string[] }
/** since = the first day the app counted; runs = the «Correggi il pensiero» and after-report corrections on the agent
 *  runs by the Rome day the run started (agent-runs.json), the only source before `since`. */
export interface UserCorrections { since: string | null; byDay: UserCorrectionDay[]; runs: { date: string; tagged: number; afterReport: number }[] }

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
/** A saved query of the brain (ADR 0124; main brain/queries.ts): one file in queries/, a Markdown note with its header
 *  (title, what it does, where it runs, tags, the note it came from) and the query in one fenced block, or a native
 *  .sql/.kql/… file with an @-comment header. `lang` = the fence or file language as written, `language` its label. */
export interface BrainQuerySummary {
  id: string; file: string; title: string; description: string; language: string; lang: string;
  /** where it runs: the data source, cluster, database or tool, as written ('' = not said) */
  source: string; tags: string[];
  /** the note it was moved from by the brain upgrade, or who saved it ('' = not said) */
  from: string;
  changedAt: string | null; bytes: number;
}
/** queries:get: the query's code (credential-looking lines masked) and its file's absolute path. */
export interface BrainQuery extends BrainQuerySummary { path: string; code: string; masked: number }
export interface BrainQueryList { root: string | null; dir: string; queries: BrainQuerySummary[] }
/** One line of the brain's changelog (`changelog.md`, main brain/changelog.ts, /api/changelog): who changed what in the
 *  brain, newest first. `at` = local "YYYY-MM-DD HH:MM". */
export type ChangelogKind = 'script' | 'rule' | 'procedure' | 'note' | 'agent' | 'skill' | 'other';
export type ChangelogAction = 'added' | 'edited' | 'fixed' | 'deleted' | 'restored';
export interface ChangelogEntry { at: string; kind: ChangelogKind; action: ChangelogAction; target: string; by: string; summary: string }
/** Per engine, the models its CLI offered at its last session (ACP's availableModels), kept in userData; absent = none
 *  seen yet (the UI falls back to its own list). The app never starts a CLI just to ask. */
export type ModelsSeen = Partial<Record<Harness, { ids: { id: string; name: string }[]; at: number }>>;

// ── "Rispondi dopo" (the user, 2026-10-13: "a volte sono concentrato e non ho tempo per rispondere"; ADR 0035) ──

/** renderer → main, brain: each entry [argument, result]. Part of InvokeMap (src/shared/contract.ts). */
export interface BrainInvokeMap {
  /** the shareable brain zip for colleagues (ADR 0088): rules, skills, roles, scripts, never memory; null = save dialog cancelled */
  'brain:share': [void, BrainShareResult | null];
  /** the Brain pages (ADR 0077, src/main/brainmodel): agents, skills and their links, rules, memory, the change log */
  'brainmodel:state': [void, BrainModelState];
  'memory:reviewList': [{ asOf?: string } | undefined, MemoryReviewRecord[]];
  /** keep: the user's answer when confirmed facts say something else (new = replace them, both = keep them too), on the
   *  fact ids they saw (memory-records.ts confirmMemory) */
  'memory:retract': [{ expectedRoot: string; id: string; reason: string }, MemoryReviewRecord];
  'memory:delete': [{ expectedRoot: string; id: string }, void];
  'learning:evidence': [{ runId: string; expectedRoot: string }, LearningEvidence];
  'learning:state': [void, LearningReviewState];
  'learning:import': [{ expectedRoot: string; dataset: unknown }, LearningReviewState];
  'learning:replay': [{ expectedRoot: string; datasetId: string; split: 'tuning' | 'holdout'; candidateName?: string }, ReplayRecord];
  'learning:saveCandidate': [{ expectedRoot: string; name: string; text: string; expectedDigest: string }, SkillCandidateView];
  'learning:promote': [{ expectedRoot: string; name: string; expectedDigest: string; replayId: string; exampleRunId: string }, SkillCandidateView];
  'learning:compare': [{ beforeId: string; afterId: string }, ReplayComparison];
  /** Memoria → Proposte (ADR 0123, main/proposals): every item waiting for the user's decision, newest first, with who,
   *  where, when and the evidence; decide runs the item's own source path after main checks it is still open; count
   *  = the sidebar badge (an event proposals:changed when it changes) */
  'proposals:list': [void, ProposalsState];
  'proposals:count': [void, number];
  'proposals:decide': [ProposalDecide, ProposalDecideResult];
  /** the deck shows a card on top now (ADR 0193: the ledger keeps how long a decision took); undoAuto = Annulla on a card
   *  the app applied by itself (its ledger id), through the change log or the loop's rollback */
  'proposals:shown': [{ id: string }, void];
  'proposals:undoAuto': [{ id: string }, ProposalDecideResult];
  /** the maintenance button: run every job now (or one); every change is logged and can be undone */
  'brainmodel:maintain': [{ job?: MaintenanceJobId } | undefined, BrainModelState];
  'brainmodel:rollback': [{ id: string }, BrainModelState];
  /** the «Manutenzione» button (ADR 0153): one click runs the free cleanup, then the invisible research with the app's
   *  best choice; the result arrives as cards and the end notice (maintenance:done). One at a time. */
  'maintenance:run': [void, MaintenanceStatus];
  'maintenance:status': [void, MaintenanceStatus];
  /** stops the running research */
  'maintenance:stop': [void, MaintenanceStatus];
  /** the brain's saved queries (ADR 0124): list, one with its code, delete through the ChangeLog (undo = brainmodel:rollback with changeId) */
  'queries:list': [void, BrainQueryList];
  'queries:get': [{ id: string }, BrainQuery];
  'queries:delete': [{ id: string }, { changeId: string; file: string }];
  /** the user marks a log group of the maintenance as known noise (or not any more, #150) */
  'brainmodel:noise': [{ key: string; known: boolean }, BrainModelState];
  /** the user declares (on) or drops (off) a skill for an agent */
  'brainmodel:link': [{ skill: string; agentId: string; on: boolean }, BrainModelState];
  /** the Memoria hub's «Approvate» trash (ADR 0122): removes a brain skill (by name), a rules/ file or a script (by id)
   *  through the change log, so «Annulla» (brainmodel:rollback of the returned change) puts it back */
  'brainmodel:remove': [{ kind: 'skill' | 'rule' | 'script'; target: string }, { state: BrainModelState; changeId: string }];
  /** Classificatori (read-only): the routing table with history and measured results, recent agent choices */
  'classifiers:state': [void, ClassifiersState];
  /** the morning block (ADR 0102, main/morning/): presence = the user is here (the block opens on the first presence of
   *  the day or after 4 h away), get = the brief now (Ctrl+J's fallback), dismiss = Esc / Ok (not again that day) */
  'morning:brief': [{ op: MorningOp } | undefined, MorningState];
  'brain:api': [{ path: string }, BrainApiResult];
  /** the brain's model comparisons (harness/compare): read through its config.mjs, switched through its switch.mjs */
  'compare:list': [void, CompareState];
  /** the brain's self-improvement loop: a click of the Miglioramento page (brain/learn.ts) */
  'learn:act': [LearnAction, LearnResult];
}
