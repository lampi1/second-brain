// The maintenance with research (ADR 0132): the data the «Manutenzione» dialog, the research chat's proposal tool, the
// Proposte deck and the Memoria tab «Idee dell'app» share. The owner (2026-10-23): one always-visible «Manutenzione» in
// the top bar; a free cleanup plus, on request, a research by the best model on the user's own history, brain and logs,
// with a prompt the user sees and may change at every run; every finding is a card that says what it adds and removes
// and why; forgetting is a proposal too; ideas and bugs about the app's code go to their own tab, with the issue already
// written and «Apri issue» / «Apri tutte» handing it to the Orchestrator. Data only: main (brainmodel/research*.ts,
// proposals/sources.ts) checks and stores, the renderer words. Used by the contract, main and the renderer.
import type { Effort, Harness } from './contract';

/** What a proposal is about. Brain kinds go to Proposte, app kinds to «Idee dell'app». */
export const RESEARCH_KINDS = ['skill', 'rule', 'memory', 'role', 'forget', 'bold', 'app-idea', 'app-bug'] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
/** The kinds that are about the app's code: they never change the brain, they become issues. */
export const APP_KINDS: readonly ResearchKind[] = ['app-idea', 'app-bug'];
export const isAppKind = (k: ResearchKind): boolean => APP_KINDS.includes(k);

/** An outside page the proposal cites (one the research chat opened). */
export interface ResearchSource { title: string; url: string }

/** A brain change to apply when the user approves (kinds skill, rule, memory, role, bold). */
export interface ResearchChange {
  target: 'skill' | 'rule' | 'memory' | 'role';
  /** the role it is for (a role id), when it is one role's */
  role?: string;
  /** the skill's name (kebab-case) or the memory fact's subject */
  name?: string;
  /** the text to add: a rule line, a skill's SKILL.md body, a fact, a line for the role's text */
  text: string;
}

/** What a forget card would archive (kind forget). */
export interface ResearchForget {
  what: 'skill' | 'rule' | 'memory';
  /** a skill's name, a rule's line (as written), a memory fact's id */
  name: string;
  role?: string;
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
}

/** What the user picks in the dialog to start a research (after the free cleanup, which always runs first). */
export interface ResearchOptions {
  harness: Harness;
  /** null = the engine's default */
  model: string | null;
  effort: Effort | null;
  /** web search and fetch on (when the engine has them) */
  web: boolean;
  /** the chat is stopped when its live cost passes this */
  capUsd: number;
  /** the method, as the user left it in the dialog (the app's fixed frame is added after it) */
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

/** The dialog's data (maintenance:setup). */
export interface MaintenanceSetup {
  /** the app's method prompt, as shipped */
  defaultPrompt: string;
  /** the prompt of the last research (the user's edit), else the default */
  prompt: string;
  /** the fixed part the app adds after the prompt (tools, pack, safety): shown read-only */
  frame: string;
  /** the best choice the app knows now: the strongest model of an engine that is on */
  defaults: { harness: Harness; model: string | null; effort: Effort | null; web: boolean; capUsd: number };
  /** engines that are on, with web search or not */
  engines: { harness: Harness; label: string; web: boolean; effort: boolean }[];
  /** the median cost of the past researches; null = none yet («stima senza dati») */
  estimate: { medianUsd: number; n: number } | null;
  running: ResearchRunInfo | null;
  last: ResearchRunInfo | null;
}

/** The «Idee dell'app» tab (appIdeas:list). */
export interface AppIdeasState {
  /** app-idea and app-bug proposals, open first, newest first */
  items: ResearchProposal[];
  /** the app repository's issues page (package.json bugs.url), null when unknown */
  issuesUrl: string | null;
  /** an Orchestrator is open (Apri issue needs one) */
  orchestrator: boolean;
}

/** Caps: what one research may propose, per family (the tool refuses more). */
export const RESEARCH_CAPS = { brain: 5, forget: 5, app: 5, bold: 1 } as const;
export const familyOf = (k: ResearchKind): keyof typeof RESEARCH_CAPS =>
  k === 'forget' ? 'forget' : k === 'bold' ? 'bold' : isAppKind(k) ? 'app' : 'brain';
/** The default spending cap (owner, 2026-10-23). */
export const RESEARCH_CAP_USD = 5;
