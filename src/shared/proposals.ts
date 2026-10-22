// The Proposte deck's data (ADR 0123): every item the app puts in front of the user to decide, gathered by main
// (src/main/proposals/) from the sources that already own a decision (memory facts to confirm, skill candidates, the
// brain changes the maintenance applied by itself, agents' protected settings, role trials and tier suggestions, the
// Battito's learned rules, the improvement loop's policies) and shown one card at a time by the renderer
// (components/brain-model/ProposalsDeck.tsx). Data only: main rechecks every decision and runs it through the source's
// own path. Used by the contract (proposals:*), main/proposals and renderer/lib/proposals.ts.

/** Where an item comes from: each source keeps its own decide path (main/proposals/sources.ts). */
export const PROPOSAL_SOURCES = ['memory', 'candidate', 'change', 'setting', 'trial', 'tier', 'pulse', 'policy'] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];
/** The filter chips on top of the deck, in this order. */
export const PROPOSAL_GROUPS = ['skill', 'rule', 'fact', 'script', 'role', 'setting', 'learning'] as const;
export type ProposalGroup = (typeof PROPOSAL_GROUPS)[number];
/** approve = Approva (or Tieni on an applied change); reject = Rifiuta (or Annulla on an applied change). */
export type ProposalDecision = 'approve' | 'reject';

/** Who proposed it: a role (its avatar), a maintenance job, the app's own loop. */
export interface ProposalWho {
  kind: 'role' | 'maintenance' | 'app';
  /** role id (avatar and name), maintenance job id, or the app's loop id ('improve', 'lifecycle') */
  id: string;
}
/** A fact the renderer shows with its own label (proposals.fact.<key>): numbers and values, never prose. */
export type ProposalFactKey = 'before' | 'after' | 'scope' | 'target' | 'tier' | 'version' | 'gain' | 'cases' | 'needs' | 'action';
export interface ProposalFact { key: ProposalFactKey; value: string }

/** What the card asks, as data the renderer words into one plain question with what each answer does
 *  (lib/proposal-ask.ts): role ids stay ids (the renderer names them), values stay values, never prose. */
export type ProposalAsk =
  /** a fact an agent wants to remember: who keeps it (a role id when it is one) and where it holds */
  | { kind: 'remember'; role?: string; subject: string; predicate: string; project?: string; repository?: string; environment?: string;
    /** confirmed facts with the same subject that say something else: the user picks replace or keep both */
    conflicts?: { id: string; value: string }[] }
  /** a skill draft to add to the brain */
  | { kind: 'skill'; name: string }
  /** something the app already changed by itself: what, how, on which item (a role id for a role or its memory) */
  | { kind: 'applied'; what: 'skill' | 'agent' | 'rule' | 'memory' | 'script' | 'query'; action: 'create' | 'update' | 'merge' | 'link' | 'unlink' | 'remove'; name: string; role?: string }
  /** an agent asks to change a protected setting */
  | { kind: 'setting'; label: string; before: string; after: string }
  /** a role runs a trial version: keep it or go back */
  | { kind: 'trial'; role: string; version: number; baseline: number; advice?: 'keep' | 'revert' | 'tier' }
  /** the app suggests another level (and maybe skills) for one or more roles */
  | { kind: 'tier'; roles: string[]; before?: string; tier?: string; skills: string[] }
  /** a rule the Battito learned for an agent */
  | { kind: 'rule'; role: string }
  /** a new version of how the app decides something by itself (routing, notifications…) */
  | { kind: 'policy'; domain: string; name: string; from?: number; to?: number; cases?: number };
/** The code a card is about, shown as it is: a script or a saved query the change writes (or removes). */
export interface ProposalCode { file: string; lang: string; text: string }

export interface ProposalProvenance {
  who: ProposalWho;
  /** the chat where it came from (its title as it is now) */
  chat?: { id: string; title: string };
  runId?: string;
  /** brain files it touches or comes from (absolute, or relative to the brain) */
  files?: string[];
  /** when it was proposed or applied, ISO */
  at: string;
  /** the source lines, reasons or report that led to it, as quoted */
  evidence: string[];
}

export interface Proposal {
  /** stable: `<source>:<id in its source>` */
  id: string;
  source: ProposalSource;
  group: ProposalGroup;
  /** already applied by the app (a maintenance change, a role trial): the card says «già applicata», Tieni / Annulla */
  applied: boolean;
  title: string;
  /** the question the card asks, as data (the renderer words it) */
  ask: ProposalAsk;
  /** a script's or a query's code, when the card is about one */
  code?: ProposalCode[];
  /** the full content, Markdown (the fact, the skill draft, the change's summary and reason) */
  content: string;
  facts: ProposalFact[];
  provenance: ProposalProvenance;
  canApprove: boolean;
  canReject: boolean;
  /** why one side cannot be chosen now: codes the renderer words (proposals.blocked.<code>; a skill candidate's are its
   *  promotion problems, learning-review.ts) */
  blocked?: string[];
  /** the approval asks to open the draft and its evidence first (a skill candidate's promotion, ADR 0123) */
  readFirst?: boolean;
  /** runs whose retained result the card can open (learning:evidence): a candidate's source and verified example */
  evidenceRuns?: string[];
}

export interface ProposalsState {
  items: Proposal[];
  /** the sources that could not be read now (the others still show) */
  problems: ProposalSource[];
  at: number;
}
/** `seen`: the card's content the user decided on; main refuses when the card changed since (a skill draft edited
 *  between the read and the click is never approved unseen). */
/** keep: on a fact that contradicts confirmed ones, replace them (`new`) or keep them beside it (`both`). */
export type ProposalKeep = 'new' | 'both';
export interface ProposalDecide { id: string; decision: ProposalDecision; note?: string; seen?: string; keep?: ProposalKeep }
export type ProposalDecideResult = { ok: true; state: ProposalsState } | { ok: false; error: string; state: ProposalsState };

/** The newest first; ties by id, so the order never jumps between two reads. */
export const sortProposals = (items: Proposal[]): Proposal[] =>
  [...items].sort((a, b) => b.provenance.at.localeCompare(a.provenance.at) || a.id.localeCompare(b.id));
