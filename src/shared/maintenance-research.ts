// The maintenance (ADR 0132, one click since ADR 0152): the data the «Manutenzione» button, the research chat's proposal
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
export const RESEARCH_KINDS = ['skill', 'rule', 'role', 'forget', 'bold', 'app-idea', 'app-bug'] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
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
}

/** What a research runs with: the app's best choice (ResearchService.defaults), never a dialog since ADR 0152. */
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
  k === 'forget' ? 'forget' : k === 'bold' ? 'bold' : isAppKind(k) ? 'app' : 'brain';
/** The default spending cap (owner, 2026-10-23). */
export const RESEARCH_CAP_USD = 5;
