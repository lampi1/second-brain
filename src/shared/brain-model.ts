// The brain model's shapes (ADR 0077), shared by main (src/main/brainmodel) and the Brain pages of the renderer
// (Agenti, Skill, Regole, Memoria, Classificatori, Mappa). Two concepts only: an agent = who works (engine, model,
// permissions, role); a skill = how a job is done, shared and loaded when the agent starts. Rules apply to every agent;
// memory is the brain's knowledge and what happened, plus one memory per agent. Every change a maintenance job makes is
// a BrainChange: logged, explained, and undone with one click (no approval: owner, 2026-10-19).
import type { SuccessCheck, SuccessCriterion } from './maintenance-research';

/** Where a skill lives: the brain's shared skills (`.claude/skills`, `.agents/skills`) or the user's own CLI folders. */
export type SkillHome = 'brain' | 'user';

export interface BrainSkill {
  name: string;
  description: string;
  /** absolute path of its SKILL.md */
  file: string;
  /** brain-relative path when inside the brain, for the file viewer (`file/<rel>`) */
  rel: string | null;
  home: SkillHome;
  /** the agents (catalog ids) that declare it: preloaded into their runs */
  usedBy: string[];
  /** the tools it calls: its `allowed-tools`, the scripts in its folder and the commands named in its text */
  tools: string[];
  lines: number;
  changedAt: number | null;
  /** who made it, when known from the change log ("migration", a job, the user) */
  madeBy: BrainChange['job'] | null;
}

/** A rule of the brain: a topic file (brain.json rules.topicFiles, injected when it matches) or a file of `rules/`. */
export interface BrainRule {
  /** brain-relative path */
  file: string;
  title: string;
  /** the first line of prose */
  summary: string;
  /** when it is injected; null = no frontmatter (read when an agent opens it) */
  when: { prompt: string[]; tools: string[]; paths: string[] } | null;
  /** how agents get it: always (an always-loaded file), topic (injected when it matches), none (on disk, not listed) */
  loaded: 'always' | 'topic' | 'none';
  lines: number;
  changedAt: number | null;
}

/** knowledge = customers, environments, people and other reference notes; the rest is what happened, and the agents'. */
export type MemoryKind = 'knowledge' | 'threads' | 'journal' | 'errors' | 'agent' | 'shared';
export interface MemoryFile {
  kind: MemoryKind;
  /** knowledge: the group it belongs to (Clienti, Ambienti, Persone, …); agent: the agent's name */
  group: string;
  title: string;
  /** brain-relative path */
  file: string;
  agentId?: string;
  /** entries (list lines, rows, dated days) */
  entries: number;
  /** the latest few entries, plain text */
  preview: string[];
  /** the same latest entries as written (inline Markdown, without the list marker), for the rendered card */
  previewMd?: string[];
  changedAt: number | null;
}

export type MaintenanceJobId = 'repeated-task' | 'merge-skills' | 'corrections' | 'merge-memory' | 'migration' | 'upgrade';
/** 'upgrade' (ADR 0116): the brain brought in line with this app version's layout (brainmodel/upgrade.ts) */
export const MAINTENANCE_JOBS: readonly MaintenanceJobId[] = ['migration', 'upgrade', 'corrections', 'repeated-task', 'merge-skills', 'merge-memory'];

/** One change a maintenance job or the user's link toggle made. target: a skill name, a role id, a rule or memory file.
 *  canRollback false = undone already, or what it changed moved on since (a newer change on the same target). */
export interface BrainChange {
  id: string; at: number;
  /** research = a maintenance finding the user approved in Proposte (ADR 0132) */
  job: MaintenanceJobId | 'user' | 'research';
  kind: 'skill' | 'agent' | 'rule' | 'memory' | 'script';
  action: 'create' | 'update' | 'merge' | 'link' | 'unlink' | 'remove';
  target: string;
  /** what changed, one line (Italian, shown as is) */
  summary: string;
  /** why: the evidence in words (runs, corrections, duplicates found) */
  reason: string;
  evidence: string[];
  rolledBackAt?: number;
  canRollback: boolean;
  /** its evidence claim (brainmodel/evidence.ts, ADR 0109): missing only where the runs could not be read */
  claim?: ChangeClaim;
  /** «riuscito se…» a maintenance finding declared (ADR 0194), and the check a week after it was applied */
  success?: SuccessCriterion;
  /** a candidate brain (ADR 0195) applies several findings as one change: each one's criterion; read with
   *  changeCriteria (an old entry has only `success`) */
  successes?: SuccessCriterion[];
  /** the change's check: with several criteria, the worst one (a worse one makes the revert card) */
  successCheck?: SuccessCheck;
  /** with several criteria, each one's check in their order */
  successChecks?: SuccessCheck[];
}
/** Every «riuscito se…» of a change: the several of a candidate brain, else its single one. */
export const changeCriteria = (c: Pick<BrainChange, 'success' | 'successes'>): SuccessCriterion[] => (c.successes?.length ? c.successes : c.success ? [c.success] : []);

// ── The evidence layer (ADR 0109): every change is a hypothesis measured on the user's corrections per run ─────────────
export type ClaimVerdict = 'raccolta' | 'aiuta' | 'nessun-effetto' | 'peggiora' | 'annullato';
/** fewer = the change should lower the corrections (a new or updated skill, rule, role); not-more = it should not raise
 *  them (a merge, a removal, an unlink: tidying, not teaching) */
export type ClaimHypothesis = 'fewer' | 'not-more';
export interface ClaimSide {
  /** ended runs with corrections counted (before: the newest up to 40 that ended before the change, frozen) */
  n: number;
  /** the runs the verdict rests on: the side's checkpoint (20, 40, 80, 160), 0 below the first */
  judged: number;
  /** mean corrections per run over the judged runs (all runs while none is judged); null without runs */
  mean: number | null;
}
export interface ChangeClaim {
  hypothesis: ClaimHypothesis;
  /** the one metric: the user's corrections per run, lower is better */
  metric: 'corrections';
  /** the roles (catalog ids) whose runs measure it, frozen when the change was made; empty = every role */
  scope: string[];
  /** a skill's change is measured on the runs that loaded it */
  skill: string | null;
  before: ClaimSide;
  after: ClaimSide;
  /** the next checkpoint of the runs after it (null: past the last); the baseline is frozen, so one under the first
   *  checkpoint never gets a verdict (the page says so) */
  need: number | null;
  /** 90% bootstrap interval of mean(after) - mean(before), over the judged runs; null below the first checkpoint */
  diff: { low: number; high: number } | null;
  verdict: ClaimVerdict;
}

/** One week of a role's runs on the Apprendimento page: runs ended that week with corrections counted, and their sum. */
export interface LearningWeek { start: number; runs: number; corrections: number }
export interface LearningRole {
  id: string; name: string;
  weeks: LearningWeek[];
  /** the changes measured on this role's runs inside the weeks shown, oldest first */
  changes: { id: string; at: number; verdict: ClaimVerdict; summary: string }[];
}
export interface LearningState {
  /** the changes per verdict, over the changes listed (the newest 120) */
  counts: Record<ClaimVerdict, number>;
  roles: LearningRole[];
  /** start of the first week shown, and the week length */
  from: number; week: number;
  /** the agents' lessons proposed in the same weeks (agents/pack/learning.ts), by where they ended; missing = the
   *  lesson store was not read. Their evidence is never causal (lesson-evidence.ts `causal: false`): the page says so. */
  lessons?: LearningLessons;
}
/** The lessons proposed from `from` on: approved = applied or accepted, discarded, waiting = still for the user. */
export interface LearningLessons { proposed: number; approved: number; discarded: number; waiting: number }
/** What the view needs of one stored lesson. */
export interface LessonStub { createdAt: number; status: 'pending' | 'approved' | 'discarded' }

/** One former procedure (a runbook or routines section) and where it went. */
export interface MigrationItem {
  source: string; title: string;
  /** the skill it became, or null when it was not moved (see note) */
  skill: string | null;
  status: 'moved' | 'existing' | 'skipped';
  note?: string;
}
export interface MigrationReport {
  at: number;
  items: MigrationItem[];
}

export interface MaintenanceRun {
  at: number; jobs: { job: MaintenanceJobId; changes: number; note?: string }[];
  /** the log step of a full pass the user started (#150): the app's warnings and errors since the last one, grouped */
  logs?: LogScan;
  /** when the last log step read the logs; every later pass carries it on (#150) */
  logsAt?: number;
  /** the pass's result went to the Orchestrator (#150): true = delivered, else why not */
  handoff?: { sent: true } | { sent: false; why: string };
  /** the cards the pass the user started made (ADR 0132): app bugs from the log step, skills to forget */
  cards?: { bugs: number; forget: number; lint?: number; reverts?: number };
}

/** The warn and error lines of the app logs (userData/logs/app-*.jsonl) grouped by scope | msg | cause (#150). */
export interface LogGroup {
  /** scope | msg | cause, numbers folded: the same problem with another id or count is one group */
  key: string;
  lvl: 'warn' | 'error';
  scope: string; msg: string; cause: string;
  count: number;
  /** one line as written (cut) */
  sample: string;
  /** the user marked it "noto, ignora": listed apart, never handed to the Orchestrator */
  known?: true;
}
export interface LogScan {
  /** lines after this time were read (null = the last two days) */
  since: number | null;
  /** the log files read, absolute */
  files: string[];
  groups: LogGroup[];
}

export interface BrainModelAgent { id: string; name: string; role: string; skills: string[]; memory: string | null }

export interface BrainModelState {
  root: string | null;
  agents: BrainModelAgent[];
  skills: BrainSkill[];
  rules: BrainRule[];
  memory: MemoryFile[];
  changes: BrainChange[];
  migration: MigrationReport | null;
  lastRun: MaintenanceRun | null;
  /** the Memoria page's statistics (brainmodel/memory-stats.ts); missing without a brain */
  memoryStats?: MemoryStats;
  /** the Apprendimento page (brainmodel/evidence.ts, ADR 0109); missing where the runs could not be read */
  learning?: LearningState;
}

// ── Memoria statistics (read-only, zero tokens): computed from the memory files, ai-errors.md and the agent runs ──────
/** growth kinds: agents' memories (with the shared one), logged errors, journal lines, knowledge notes */
export type MemoryGrowthKind = 'agent' | 'errors' | 'journal' | 'knowledge';
export interface MemoryLine {
  /** inline Markdown as written, without the list marker and the date */
  text: string;
  /** who holds it: the agent's name, "Condivisa", or the file's title */
  owner: string;
  file: string;
  /** the line's own date (YYYY-MM-DD), or null when it has none */
  date: string | null;
  /** runs that started with this line in their memory (every run of the agent since the line's date) */
  recalls: number;
}
export interface AgentMemoryStat {
  agentId: string; name: string; file: string;
  /** false = the agent has not written its memory yet */
  exists: boolean;
  entries: number;
  /** runs of the agent that started with its memory loaded (since its oldest dated line; all runs when undated) */
  recalls: number;
  /** the newest dated line, or the file's change time */
  lastAt: number | null;
}
export interface ErrorEntry {
  date: string | null; time: string | null;
  /** the chat or agent named on the line */
  agent: string;
  area: string | null; type: string | null;
  /** what really happened (vero) or the whole correction, inline Markdown */
  text: string;
  rule: string | null;
  /** the recurring group it belongs to (ErrorGroup.key) */
  group: string;
}
export interface ErrorGroup {
  key: string;
  /** "tipo · area" when the line has them, else the words its lines share */
  label: string;
  count: number;
  agents: string[];
  first: string | null; last: string | null;
  /** errors per week, the same weeks as MemoryStats.weeks */
  trend: number[];
  sample: string;
  rule: string | null;
}
export type SkillVerdict = 'useful' | 'mixed' | 'weak' | 'few' | 'unused' | 'new';
export interface SkillUse {
  name: string; rel: string | null;
  /** runs that had it (tagged at start or loaded by the engine while open) */
  uses: number;
  /** of those, runs with a verified verdict (success, partial or fail) and the successful ones */
  known: number; ok: number;
  /** the share of shared/success.ts (a partial counts half), null with no verified verdict */
  success: number | null;
  lastUse: number | null;
  /** agents that declare it */
  usedBy: number;
  verdict: SkillVerdict;
}
export interface MemoryStats {
  at: number;
  /** Monday (YYYY-MM-DD) of each of the last 12 weeks, oldest first */
  weeks: string[];
  totals: { files: number; entries: number; agents: number; agentsWithMemory: number; shared: number; runs: number };
  perAgent: AgentMemoryStat[];
  /** new lines per week and kind (a line without a date counts in the week its file last changed) */
  growth: { kind: MemoryGrowthKind; values: number[] }[];
  topRecalled: MemoryLine[];
  /** files not changed for STALE_DAYS or more, oldest first (the journal aside: days do not go stale) */
  stale: { file: string; title: string; kind: MemoryKind; days: number }[];
  staleDays: number;
  /** the same line in two or more agents' memories (what "Unisci i doppioni" moves) */
  duplicates: number;
  oldest: MemoryLine | null;
  busiestDay: { date: string; n: number } | null;
  errors: {
    total: number; last30: number; prev30: number;
    /** errors per week, the same weeks as `weeks` */
    weekly: number[];
    groups: ErrorGroup[];
    byAgent: { agent: string; count: number }[];
    /** Monday first */
    weekday: number[];
    topWord: { word: string; n: number } | null;
    /** newest first, at most 200 */
    items: ErrorEntry[];
  };
  skills: SkillUse[];
}

// ── Classificatori (read-only): how the app's automatic choices work today ───────────────────────────────────────
export interface RouteResult { runs: number; success: { value: number | null; n: number }; avgCostUsd: number | null }
export interface ClassifierRoute {
  kind: string; area: string | null; harness: string; model: string; effort: string | null; why: string;
  /** measured from the outcomes log of the routed chats (and the verified verdicts of their runs) */
  result: RouteResult;
}
export interface ClassifiersState {
  routing: { version: number | null; appliedAt: string | null; by: string | null; routes: ClassifierRoute[]; error: string | null };
  history: { at: string; from: number | null; to: number; by: string; reason: string | null; evidence: string | null }[];
  /** per kind of work: the app's chats in the ledger, how many have a known outcome and how many succeeded */
  kinds: { kind: string; chats: number; known: number; ok: number }[];
  /** how the model of the app's chats was chosen: by the table, by the agent's profile, by default or override */
  sources: { source: string; chats: number }[];
  /** success and cost per route, by week; a row without runs has no data yet */
  quality: { key: string; label: string; weeks: { week: string; runs: number; success: number | null; avgCostUsd: number | null }[] }[];
  /** one card per classifier that keeps a record (main/brainmodel/classifier-cards.ts); the page draws them as a grid */
  cards?: ClassifierCard[];
  /** the kind of work by examples (main/brainmodel/kind-model.ts, ADR 0197); absent from an older main or the demo */
  kindModel?: KindModelCard;
}
/** The kind-of-work classifier by examples (ADR 0197): nearest centroid over the local e5 embeddings of the user's own
 *  ended runs with a verified outcome, labelled by the word rule (taskOf), with «altro» below a calibrated similarity.
 *  state: ready = trained and tested; few = under MIN_PER_KIND examples for two kinds (the word rule decides); no-model =
 *  the local embedder is not ready (the word rule decides); busy = embedding the examples now, at low pace. */
export interface KindModelCard {
  state: 'ready' | 'few' | 'no-model' | 'busy';
  /** labelled runs (verified outcome, a goal) and their count per kind of the word rule, «altro» included */
  examples: number;
  perKind: { kind: string; n: number }[];
  /** the kinds with enough examples, which have a centroid */
  kinds: string[];
  minPerKind: number;
  /** cosine below which it answers «altro», calibrated on 20% of the examples kept apart from the test */
  threshold: number | null;
  /** on the 20% held out (by run id, never trained on): rows = the word rule's kind, columns = the classifier's; labels
   *  = the trained kinds then «altro». agree = the diagonal; it measures agreement with the word rule, not the truth */
  test: { n: number; agree: number; labels: string[]; matrix: number[][] } | null;
  /** of the held-out runs the word rule called «altro», how many the classifier gives a kind (unverifiable: shown apart) */
  altroProposed: { n: number; of: number } | null;
  at: number;
}
// ── Classifier cards: each classifier's numbers, its weeks and its slices, for the Classificatori grid ───────────────
/** A share with the count it rests on; value null = no case yet (never zero). */
export interface ClassifierStat { value: number | null; n: number }
/** One ISO week of a classifier: its decisions, how many it "got" (its own hit measure), the verified outcomes. */
export interface ClassifierWeek { week: string; decisions: number; hits: number; known: number; ok: number; avgCostUsd: number | null }
/** One value it decided (a kind, a model): how often, with what outcome and cost, and who ran it most. */
export interface ClassifierSlice { key: string; count: number; known: number; ok: number; avgCostUsd: number | null; top?: { key: string; count: number } }
export type ClassifierCardId = 'kind' | 'model' | 'jobkind';
export interface ClassifierCard {
  id: ClassifierCardId;
  decisions: number;
  /** its own measure: kind/jobkind = recognised (not "altro"); model = decided by the table */
  hit: ClassifierStat;
  /** verified success of the chats it decided (the user's or a review's verdict; never a self-report) */
  success: ClassifierStat;
  /** the cases whose only known outcome is unverified (the brain's proxy "closed without an error line", the
   *  Orchestrator's opinion): their success share, shown apart and never counted in `success` (ADR 0095) */
  unverified?: ClassifierStat;
  avgCostUsd: number | null;
  /** last 8 ISO weeks, oldest first */
  weeks: ClassifierWeek[];
  slices: ClassifierSlice[];
  /** success when it hit versus when it missed (null: no verified case on either side) */
  compare: { hit: ClassifierStat; miss: ClassifierStat } | null;
  lastAt: number | null;
}
