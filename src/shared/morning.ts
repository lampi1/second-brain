// The morning block ("Mentre eri via", ADR 0102): a zero-token summary the app draws by itself at the first presence
// of the day or after an absence of 4 hours or more, from what it already holds (the run store, the open requests, the
// "Da approvare" queue, the Task page's last read, the brain's ideas, the cloud agents, the maintenance change log,
// yesterday's spend). Shapes shared by main (src/main/morning/) and the renderer (MorningBlock.tsx); contract.ts
// re-exports them with the 'morning:brief' channel. nextPriority is Ctrl+J's fallback when nothing is pending.

export type MorningOutcome = 'done' | 'partial' | 'blocked' | 'unknown';
/** a role run that ended since the last presence: open = its chat is still on the strips */
export interface MorningRun { runId: string; chatId: string; title: string; outcome: MorningOutcome; endedAt: number; open: boolean }
/** build = one of the user's PRs whose last build failed · vote = a PR that waits for the user's vote */
export interface MorningPr { id: number; title: string; url: string; why: 'build' | 'vote' }
/** an idea whose "Riprendere" date has come (ideas.md, not done or dropped) */
export interface MorningIdea { title: string; due: string }
export interface MorningCloud { id: string; title: string; status: 'done' | 'failed' | 'stopped' }
/** a change a maintenance pass made since then (the Skill page's change log) */
export interface MorningChange { id: string; summary: string; canRollback: boolean }
/** a root chat at work that produced no event for stallMin minutes */
export interface MorningStalled { chatId: string; title: string; quietMin: number }

export interface MorningBrief {
  /** the last presence before this absence (ms) and when the brief was built */
  since: number; at: number;
  runs: MorningRun[];
  /** open questions, permissions and commands left for the user; entries in "Da approvare" */
  pending: number; approvals: number;
  prs: MorningPr[];
  /** the Task page's last successful read; null = never read */
  tasksAt: number | null;
  ideas: MorningIdea[];
  cloud: MorningCloud[];
  changes: MorningChange[];
  /** yesterday's spend in $ (the brain's cost report, else the app's runs); null = unknown */
  spendYesterdayUsd: number | null;
  stalled: MorningStalled[];
}

/** history = the user worked with the app before (a run, a chat): without it the Grindhouse keeps its first-run text.
 *  show = draw the block now (a new presence today, not dismissed today). */
export interface MorningState { history: boolean; show: boolean; brief: MorningBrief | null }
/** presence = the user is here (the renderer, at most once a minute) · get = the brief now (Ctrl+J) · dismiss = Esc / Ok */
export type MorningOp = 'presence' | 'get' | 'dismiss';

export type MorningNext =
  | { kind: 'pr'; pr: MorningPr }
  | { kind: 'approvals'; n: number }
  | { kind: 'stalled'; chat: MorningStalled }
  | { kind: 'idea'; idea: MorningIdea };

/** Ctrl+J with nothing pending: the first thing in the block's priority (a red build on a PR → an approval → a stalled
 *  chat → an idea due), or null. */
export function nextPriority(b: MorningBrief | null): MorningNext | null {
  if (!b) return null;
  const pr = b.prs.find(p => p.why === 'build');
  if (pr) return { kind: 'pr', pr };
  if (b.approvals > 0) return { kind: 'approvals', n: b.approvals };
  const stalled = [...b.stalled].sort((x, y) => y.quietMin - x.quietMin)[0];
  if (stalled) return { kind: 'stalled', chat: stalled };
  const idea = b.ideas[0];
  return idea ? { kind: 'idea', idea } : null;
}

/** Nothing to say: the block then shows one calm line. */
export const briefEmpty = (b: MorningBrief): boolean =>
  !b.runs.length && !b.pending && !b.approvals && !b.prs.length && !b.ideas.length && !b.cloud.length && !b.changes.length && !b.stalled.length;
