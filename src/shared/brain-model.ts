// The brain model's shapes (ADR 0077), shared by main (src/main/brainmodel) and the Brain pages of the renderer
// (Agenti, Skill, Regole, Memoria, Classificatori, Mappa). Two concepts only: an agent = who works (engine, model,
// permissions, role); a skill = how a job is done, shared and loaded when the agent starts. Rules apply to every agent;
// memory is the brain's knowledge and what happened, plus one memory per agent. Every change a maintenance job makes is
// a BrainChange: logged, explained, and undone with one click (no approval: owner, 2026-10-19).

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
  madeBy: MaintenanceJobId | 'user' | null;
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
  changedAt: number | null;
}

export type MaintenanceJobId = 'repeated-task' | 'merge-skills' | 'corrections' | 'merge-memory' | 'migration';
export const MAINTENANCE_JOBS: readonly MaintenanceJobId[] = ['migration', 'corrections', 'repeated-task', 'merge-skills', 'merge-memory'];

/** One change a maintenance job (or the user's link toggle) made. target: a skill name, an agent id, a rule or memory
 *  file. canRollback false = undone already, or what it changed moved on since (a newer change on the same target). */
export interface BrainChange {
  id: string; at: number;
  job: MaintenanceJobId | 'user';
  kind: 'skill' | 'agent' | 'rule' | 'memory';
  action: 'create' | 'update' | 'merge' | 'link' | 'unlink' | 'remove';
  target: string;
  /** what changed, one line (Italian, shown as is) */
  summary: string;
  /** why: the evidence in words (runs, corrections, duplicates found) */
  reason: string;
  evidence: string[];
  rolledBackAt?: number;
  canRollback: boolean;
}

/** One former procedure (a runbook or routines section) and where it went. */
export interface MigrationItem {
  source: string; title: string;
  /** the skill it became, or null when it was not moved (see note) */
  skill: string | null;
  agents: string[];
  status: 'moved' | 'existing' | 'skipped';
  note?: string;
}
export interface MigrationReport {
  at: number;
  items: MigrationItem[];
  /** learned rules that lived inside an agent's own skill, moved to the agent's role */
  lessons: { agentId: string; lines: number }[];
}

export interface MaintenanceRun { at: number; jobs: { job: MaintenanceJobId; changes: number; note?: string }[] }

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
}

// ── Classificatori (read-only): how the app's automatic choices work today ───────────────────────────────────────
export interface RouteResult { runs: number; success: { value: number | null; n: number }; avgCostUsd: number | null }
export interface ClassifierRoute {
  kind: string; area: string | null; harness: string; model: string; effort: string | null; why: string;
  /** measured from the outcomes log of the routed chats (and the verified verdicts of their runs) */
  result: RouteResult;
}
export interface ClassifierChoice {
  at: number; chatId: string; goal: string;
  /** the agent the classifier ranks first for the goal now (words channel), null when nothing passes */
  suggested: { id: string; name: string; score: number } | null;
  used: { id: string; name: string; score: number | null; rank: number | null; mode: string | null };
}
export interface ClassifiersState {
  routing: { version: number | null; appliedAt: string | null; by: string | null; routes: ClassifierRoute[]; error: string | null };
  history: { at: string; from: number | null; to: number; by: string; reason: string | null; evidence: string | null }[];
  choices: ClassifierChoice[];
  /** per kind of work: the app's chats in the ledger, how many have a known outcome and how many succeeded */
  kinds: { kind: string; chats: number; known: number; ok: number }[];
  /** how the model of the app's chats was chosen: by the table, by the agent's profile, by default or override */
  sources: { source: string; chats: number }[];
  /** success and cost per route and per classifier channel, by week; a row without runs has no data yet */
  quality: { key: string; label: string; weeks: { week: string; runs: number; success: number | null; avgCostUsd: number | null }[] }[];
}
