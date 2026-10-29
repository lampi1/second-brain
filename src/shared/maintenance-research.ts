// The maintenance (ADR 0132, one click since ADR 0153): the data the «Manutenzione» button, the research chat's proposal
// tool and the Proposte deck share. The owner (2026-10-24): ideas, skill and rule proposals and the memory cleanup
// happen only when the user presses «Manutenzione»; one click runs the free cleanup and an invisible research by the best
// model on the user's own history, brain and logs; every finding is a card that says what it adds and removes and why;
// forgetting is a proposal too; an idea about the app also lands in Idee (the AI's side) and every idea or bug about the
// app's code is a card «Apro la issue su GitHub?» that opens it at once when approved. Data only: main
// (brainmodel/research*.ts, proposals/sources.ts) checks and stores, the renderer words. Used by the contract, main and
// the renderer.
import type { Effort, Harness } from './contract';

/** What a proposal is about. Brain kinds change the brain; app kinds become GitHub issues (a card «Apri issue»). */
// No memory kind: facts have their own store and review (rules/memory-records.ts, ADR 0129), and the free cleanup's
// merge-memory job already rewrites or retires them with «Annulla».
// lint and revert are the app's own zero-token cards (ADR 0194): a brain lint finding, a change that did not help.
export const RESEARCH_KINDS = ['skill', 'rule', 'role', 'forget', 'bold', 'app-idea', 'app-bug', 'lint', 'revert'] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
/** The kinds the research chat may propose (maintenance_propose): never the app's own lint and revert cards. */
export const RESEARCH_TOOL_KINDS = ['skill', 'rule', 'role', 'forget', 'bold', 'app-idea', 'app-bug'] as const satisfies readonly ResearchKind[];
/** The kinds that are about the app's code: they never change the brain, they become issues. */
export const APP_KINDS: readonly ResearchKind[] = ['app-idea', 'app-bug'];
export const isAppKind = (k: ResearchKind): boolean => APP_KINDS.includes(k);

/** An outside page the proposal cites (one the research chat opened). */
export interface ResearchSource { title: string; url: string }

/** A brain change to apply when the user approves (kinds skill, rule, role, bold). */
export interface ResearchChange {
  target: 'skill' | 'rule' | 'role';
  /** the role it is for (a role id), when it is one role's */
  role?: string;
  /** the skill's name (kebab-case) */
  name?: string;
  /** the text to add: a rule line, a skill's SKILL.md body, a line for the role's text */
  text: string;
}

/** What a forget card would archive (kind forget). */
export interface ResearchForget {
  what: 'skill' | 'rule';
  /** a skill's name or a rules/ file */
  name: string;
  /** when it was last used (ms), null = never seen in use */
  lastUsed?: number | null;
  /** how many verified successful runs used it in the window */
  uses?: number;
}

/** The GitHub issue an app idea or bug becomes, already written. */
export interface ResearchIssue {
  title: string;
  /** Markdown, scrubbed of private data (home paths, user names, e-mails, MCP server names, tokens) */
  body: string;
  labels?: string[];
  /** an open issue that may already cover it, when the research checked */
  duplicateOf?: { number: number; url: string };
}

// ── «riuscito se…» (ADR 0194, M4) ─────────────────────────────────────────────────────────────────────────────────────
/** The fixed criteria the app computes from what it records, a week before and a week after a change:
 *  fewer-corrections  the user's corrections per run (of `role`, or every role) go down;
 *  more-verified      the share of verified successes among `role`'s judged runs goes up;
 *  fewer-log-errors   the warn/error lines of the log group `logKey` go down;
 *  skill-used         the skill `skill` is loaded by at least `n` runs in the week after. */
export const SUCCESS_METRICS = ['fewer-corrections', 'more-verified', 'fewer-log-errors', 'skill-used'] as const;
export type SuccessMetric = (typeof SUCCESS_METRICS)[number];
export interface SuccessCriterion {
  metric: SuccessMetric;
  role?: string;
  logKey?: string;
  skill?: string;
  /** skill-used: the uses wanted (default 3) */
  n?: number;
  /** the criterion in the user's words, written by the app («riuscito se…») */
  text?: string;
}
/** The days on each side of a change the check compares, and when it runs. */
export const SUCCESS_DAYS = 7;
/** better / same / worse, or unknown when a side has too few data points to say. */
export type SuccessVerdict = 'better' | 'same' | 'worse' | 'unknown';
export interface SuccessCheck {
  at: number;
  /** the metric's value in the week before and the week after (a mean, a share, a count); null = no data */
  before: number | null; after: number | null;
  /** the data points each side rests on (runs, log lines) */
  nBefore: number; nAfter: number;
  verdict: SuccessVerdict;
}

// ── the brain lint (ADR 0194, M2): zero-token checks of the free cleanup ──────────────────────────────────────────────
/** orphan: no other note links to it; broken-link: a link that leads nowhere; stale-fact: a memory fact cites a file
 *  that is gone; changed-fact: the file a fact cites changed since it was first seen; stale-cite: a skill or rule line
 *  cites a file that is gone; concept: a term cited three times or more with no note of its own. */
export type LintCheck = 'orphan' | 'broken-link' | 'stale-fact' | 'changed-fact' | 'stale-cite' | 'concept';
export interface LintFinding {
  check: LintCheck;
  /** stable key: the same problem is never carded twice (a rejected one is never asked again) */
  key: string;
  /** the brain file it is about (relative to the brain, '/'), when there is one */
  file?: string;
  /** the cited path, the link target or the concept */
  target?: string;
  /** the line of `file` it is about, as it is (stale-cite, broken-link) */
  line?: string;
  /** the memory fact (stale-fact, changed-fact) */
  memoryId?: string;
  /** the fact as a sentence, the skill's name, the notes citing a concept */
  about?: string;
  /** concept: the notes citing it (relative paths) */
  citedBy?: string[];
  /** the language the card was written in (a created note or hub line uses it) */
  lang?: 'it' | 'en';
}

/** A change the week-after check found worse than before (kind revert): Annulla goes through the change log. */
export interface ResearchRevert { changeId: string; kind: 'skill' | 'agent' | 'rule' | 'memory' | 'script'; summary: string; criterion: SuccessCriterion; check: SuccessCheck }

/** issue-asked and dismissed: the old «Idee dell'app» tab's states (ADR 0132), still read from older files */
export type ResearchState = 'open' | 'approved' | 'rejected' | 'issue-asked' | 'dismissed';

/** One finding, as a card. Every text is plain words in the user's language. */
export interface ResearchProposal {
  /** `r-<time36>-<rand>` */
  id: string;
  /** the research chat that proposed it; null = the zero-token cleanup (forget cards, log bugs) */
  chatId: string | null;
  at: number;
  kind: ResearchKind;
  /** short title, one line */
  title: string;
  /** what it adds ('' = nothing) */
  adds: string;
  /** what it removes ('' = nothing) */
  removes: string;
  /** why, with the numbers it rests on */
  why: string;
  /** data lines from the pack (counts, run ids, log groups) */
  evidence: string[];
  sources: ResearchSource[];
  /** the effect expected and how it is measured ('' when not stated) */
  expected: string;
  /** what could go wrong and how to go back ('' when not stated) */
  risk: string;
  change?: ResearchChange;
  forget?: ResearchForget;
  issue?: ResearchIssue;
  /** an app bug from the log step: its log group (brainmodel/log-scan.ts groupKey); a research may rewrite that card */
  logKey?: string;
  state: ResearchState;
  decidedAt?: number;
  /** the change log entry an approval wrote (its Annulla) */
  changeId?: string;
  /** an app card approved: the issue it opened on GitHub (or the new-issue page opened in the browser) */
  issueUrl?: string;
  /** an app idea also written to the brain's Idee (the AI's side) */
  ideaSaved?: boolean;
  /** «riuscito se…»: the measurable criterion it declares (ADR 0194), stored with the change it applies */
  success?: SuccessCriterion;
  /** kind lint: what the brain lint found (ADR 0194) */
  lint?: LintFinding;
  /** kind revert: the change that did not help and the numbers */
  revert?: ResearchRevert;
  /** a brain-file finding gathered into the candidate brain (ADR 0195): CANDIDATE_PENDING while the research runs, then
   *  the candidate's id; such a finding is no card of its own (the candidate's one card decides it) */
  candidateId?: string;
  /** a revised role text the research proposes from the role's failed runs (ADR 0195, GEPA-style): approving it starts
   *  a trial version (catalog approveTrial), never a direct replacement */
  roleTrial?: RoleTrialProposal;
}

/** A whole revised text for one role, proposed as a trial version (ADR 0195). */
export interface RoleTrialProposal {
  role: string;
  /** the active version the text was written against: approval is refused when the role moved on */
  baseVersion: number;
  /** the role's text at that version (the card's «before») */
  before: string;
  text: string;
}

/** What a research runs with: the app's best choice (ResearchService.defaults), never a dialog since ADR 0153. */
export interface ResearchOptions {
  harness: Harness;
  /** null = the engine's default */
  model: string | null;
  effort: Effort | null;
  /** web search and fetch on (when the engine has them) */
  web: boolean;
  /** the chat is stopped when its live cost passes this */
  capUsd: number;
  /** the method (the app's fixed frame is added after it) */
  prompt: string;
}

export type ResearchRunState = 'running' | 'done' | 'stopped' | 'capped' | 'failed';
export interface ResearchRunInfo {
  chatId: string;
  startedAt: number;
  endedAt?: number;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  capUsd: number;
  costUsd: number;
  state: ResearchRunState;
  /** proposals it made */
  proposals: number;
  /** why it stopped, when not done */
  why?: string;
}

/** The button's state (maintenance:status): a pass or a research running, and the last one's end. */
export interface MaintenanceStatus {
  /** the free cleanup is running (seconds) or the research is (minutes) */
  running: boolean;
  /** the research running now: its cost so far against its cap */
  research: ResearchRunInfo | null;
  /** the last one that ended */
  last: MaintenanceDone | null;
  /** a research can run (an engine that is on reads files and reports its cost); false = only the free cleanup */
  canResearch: boolean;
}

/** What one click did, when it is all over (the end notice, maintenance:done). */
export interface MaintenanceDone {
  at: number;
  /** free = only the zero-token cleanup ran (no engine for the research) */
  state: ResearchRunState | 'free';
  /** cards in Proposte about the brain (skill, rule, role, forget) */
  proposals: number;
  /** ideas written to Idee (the AI's side) */
  ideas: number;
  /** cards «Apri issue» */
  issues: number;
  costUsd: number;
  why?: string;
}

/** Caps: what one research may propose, per family (the tool refuses more). */
export const RESEARCH_CAPS = { brain: 5, forget: 5, app: 5, bold: 1 } as const;
export const familyOf = (k: ResearchKind): keyof typeof RESEARCH_CAPS =>
  k === 'forget' || k === 'lint' ? 'forget' : k === 'bold' ? 'bold' : isAppKind(k) ? 'app' : 'brain';
/** The default spending cap (owner, 2026-10-23). */
export const RESEARCH_CAP_USD = 5;

// ── The candidate brain (ADR 0195, after Anthropic's «dreaming»): the research's brain-file findings of one click are
// gathered into one copy of the affected files under userData, never written to the brain until the user approves the
// one card, applied then as one change with one «Annulla».
/** Marks a finding held for the candidate while its research still runs. */
export const CANDIDATE_PENDING = 'pending';
/** One file of the candidate: its brain-relative path, the text now (null = new file) and in the candidate (null = removed). */
export interface CandidateFile { rel: string; before: string | null; after: string | null }
export interface CandidateEvaluation {
  /** zero-token checks, one plain line each (UI language) */
  checks: string[];
  /** the recorded-task replay (brainmodel/evaluation.ts): started when an anonymized holdout set exists and the
   *  research's budget covers its estimate, else skipped with the reason */
  replay: { state: 'started' | 'skipped'; replayId?: string; note: string; status?: 'running' | 'passed' | 'failed' | 'awaiting-review' };
}
/** stale = a brain file changed after the candidate was built: it can no longer be applied as shown */
export type CandidateState = 'open' | 'approved' | 'rejected' | 'stale';
export interface BrainCandidate {
  /** `bc-<time36>-<rand>` */
  id: string;
  chatId: string;
  at: number;
  state: CandidateState;
  /** the findings it gathers (ResearchProposal ids), in the order proposed */
  proposalIds: string[];
  files: CandidateFile[];
  evaluation: CandidateEvaluation;
  decidedAt?: number;
  /** the one change-log entry an approval wrote (its one «Annulla») */
  changeId?: string;
}
/** A candidate as its card shows it: with the findings it gathers in words. */
export interface BrainCandidateView extends BrainCandidate { items: { kind: ResearchKind; title: string }[] }
