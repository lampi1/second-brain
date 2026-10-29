// The Proposte deck's data (ADR 0123): every item the app puts in front of the user to decide, gathered by main
// (src/main/proposals/) from the sources that already own a decision (memory facts to confirm, skill candidates, the
// brain changes the maintenance applied by itself, agents' protected settings, role trials and tier suggestions, the
// Battito's learned rules, the improvement loop's policies) and shown one card at a time by the renderer
// (components/brain-model/ProposalsDeck.tsx). Data only: main rechecks every decision and runs it through the source's
// own path. Also why a card is still asked, the cards applied by themselves and each group's policy (ADR 0193). Used by
// the contract (proposals:*), main/proposals, main/brainmodel/research-pack.ts and renderer/lib/proposals.ts.
import type { ResearchKind, ResearchSource } from './maintenance-research';

/** Where an item comes from: each source keeps its own decide path (main/proposals/sources.ts). */
export const PROPOSAL_SOURCES = ['memory', 'candidate', 'change', 'setting', 'trial', 'tier', 'pulse', 'policy', 'research'] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];
/** The filter chips on top of the deck, in this order. */
/** issue: a GitHub issue the maintenance wrote about the app's code, opened at once when approved (ADR 0153) */
/** brain: a candidate version of the brain, several file changes decided as one (ADR 0195) */
/** note: a brain note the maintenance's lint found unlinked, broken or missing (ADR 0194) */
export const PROPOSAL_GROUPS = ['skill', 'rule', 'fact', 'script', 'role', 'setting', 'learning', 'forget', 'issue', 'brain', 'note'] as const;
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
    conflicts?: { id: string; value: string }[];
    /** near-duplicates decided with it (ADR 0129): how many times the fact was proposed */
    same?: number;
    /** the signs of a one-off fact (ADR 0129): the card says the fact looks tied to one case */
    specific?: MemorySign[];
    /** a batch card (ADR 0129): this many facts of one role and exact scope across dates, listed in full, decided as a whole */
    many?: number }
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
  | { kind: 'policy'; domain: string; name: string; from?: number; to?: number; cases?: number }
  /** a finding of the maintenance (ADR 0132): the card shows what it adds and removes, why, the evidence and the sources
   *  as they are (plain words the research or the cleanup wrote), never «if you press…» lines */
  | { kind: 'research'; finding: ResearchKind; adds: string; removes: string; why: string; expected: string; risk: string; evidence: string[]; sources: ResearchSource[];
    /** a revised role text: approving it starts a trial version of the role (ADR 0195) */
    trial?: boolean }
  /** a candidate version of the brain (ADR 0195): the findings it gathers, decided as one, with its checks and replay */
  | { kind: 'candidate'; items: { finding: ResearchKind; title: string; success?: string }[]; files: number; checks: string[];
    replay: { state: 'started' | 'skipped'; note: string; status?: 'running' | 'passed' | 'failed' | 'awaiting-review' } };
/** The code a card is about, shown as it is: a script or a saved query the change writes (or removes). */
/** What makes a memory fact look tied to one case (main/rules/memory-worth.ts, ADR 0129). */
export type MemorySign = 'url' | 'id' | 'commit' | 'path' | 'date' | 'branch';
/** Predicates that say nothing by themselves («setup · note»): the fact is its value alone. */
const EMPTY_PREDICATE = /^(notes?|nota|fact|fatto|info|is|è|ist|value|valore)$/i;
/** A predicate that says nothing: such facts are free notes, never two values of one thing (no contradiction). */
export const emptyPredicate = (predicate: string): boolean => !predicate.trim() || EMPTY_PREDICATE.test(predicate.trim());
/** A memory fact as one sentence: «Rimborsi parziali si calcolano su …», or its value alone when the predicate is empty. */
export function factSentence(subject: string, predicate: string, value: string): string {
  const v = value.trim();
  if (emptyPredicate(predicate) || !subject.trim()) return v;
  return `${subject.trim()} ${predicate.trim()} ${v}`;
}
export interface ProposalCode { file: string; lang: string; text: string }
/** A file a card would change, before and after (null = the file is created / removed): shown as a diff (ADR 0195). */
export interface ProposalDiff { file: string; before: string | null; after: string | null }

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
  /** the files it changes, before and after (a candidate brain, a revised role text) */
  diffs?: ProposalDiff[];
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
  /** why the app still asks (ADR 0193): «Te la chiedo perché: …», worded by the renderer; never a suggested answer */
  why?: ProposalWhy;
  /** set by the card's source when what it decides on is never applied by itself, for a reason the card's own fields do
   *  not show (policy.ts neverAuto): the text an applied change wrote, a research skill tied to a role, a lint finding
   *  that removes something */
  never?: ProposalNever;
}

/** Why a card is never applied by itself (ADR 0193): external = it leaves the app; setting; permissions = tools,
 *  permissions or hooks; role; forget = it removes something (or takes a change back); production; script = a script
 *  or a query (it runs commands); unread = the text it wrote could not be read to check; brain = a candidate brain
 *  (several changes as one); note = a brain note or hub line. */
export type ProposalNever = 'external' | 'setting' | 'permissions' | 'role' | 'forget' | 'production' | 'script' | 'unread' | 'brain' | 'note';

/** The groups that may be applied by themselves once the user's own decisions show the answer is obvious (ADR 0193).
 *  Explicit allow-list: role, setting, forget, issue, script (scripts and queries run commands), brain and note are never applied without the user, whatever the history
 *  (roles carry permissions, tiers and tools; settings are protected; forgetting removes; an issue is published on GitHub). */
export const AUTO_GROUPS: readonly ProposalGroup[] = ['skill', 'rule', 'fact', 'learning'];
/** Why a card is still in front of the user (ADR 0193), as data:
 *  never = a kind the app always asks (what: why); irreversible = no Annulla from here; first = no decision of this kind
 *  yet; few = n decisions so far, all yes, not enough; rejected = no times out of n; undone = changes the app applied by
 *  itself in this group the user took back; building = yes out of n, not sure enough yet; blocked = it could not be
 *  applied by itself (or one side is blocked). */
export type ProposalWhy =
  | { code: 'never'; what: ProposalNever }
  | { code: 'irreversible' }
  | { code: 'first' }
  | { code: 'few'; n: number }
  | { code: 'rejected'; no: number; n: number }
  | { code: 'undone'; n: number }
  | { code: 'building'; yes: number; n: number }
  | { code: 'blocked' };
/** A card the app applied by itself (ADR 0193), for Memoria → Proposte «Applicate da sole». */
export interface ProposalAutoApplied {
  /** the decision's id in the ledger (proposals:undoAuto) */
  id: string;
  card: string;
  source: ProposalSource;
  group: ProposalGroup;
  title: string;
  at: number;
  undoneAt?: number;
  /** Annulla still works (the change is still as the app left it) */
  canUndo: boolean;
}
/** One group's policy now (ADR 0193): what the ledger says and whether its new cards apply by themselves. */
export interface ProposalGroupPolicy {
  group: ProposalGroup;
  /** the source the policy is for (ADR 0193: trust is built per group and source, so «Tieni» on changes already applied
   *  never lets new research cards go by themselves); absent = the group's decisions from every source */
  source?: ProposalSource;
  /** never = not on the allow-list; ask = not sure enough; auto = new cards apply by themselves (with Annulla) */
  mode: 'never' | 'ask' | 'auto';
  /** the decisions the policy counts (the window), yes and no (an undo after a yes counts as no) */
  n: number; yes: number; no: number; undone: number;
  /** the 90% Wilson lower bound of the yes share (null below the sample) and the bound it must reach */
  low: number | null; threshold: number;
  /** of the last auto-applied ones (at most 20): how many, how many undone */
  autoN: number; autoUndone: number;
}

export interface ProposalsState {
  items: Proposal[];
  /** the sources that could not be read now (the others still show) */
  problems: ProposalSource[];
  at: number;
  /** the cards the app applied by itself lately, newest first (ADR 0193) */
  auto?: ProposalAutoApplied[];
  /** cards applied by themselves this week (since Monday) and not undone: «Carte risparmiate questa settimana» */
  saved?: number;
}
/** `seen`: the card's content the user decided on; main refuses when the card changed since (a skill draft edited
 *  between the read and the click is never approved unseen). */
/** keep: on a fact that contradicts confirmed ones, replace them (`new`) or keep them beside it (`both`). */
export type ProposalKeep = 'new' | 'both';
/** `conflicts`: with `keep`, the ids of the contradicted facts the card showed (main refuses when they changed since). */
export interface ProposalDecide { id: string; decision: ProposalDecision; note?: string; seen?: string; keep?: ProposalKeep; conflicts?: string[] }
export type ProposalDecideResult = { ok: true; state: ProposalsState } | { ok: false; error: string; state: ProposalsState };

/** The newest first; ties by id, so the order never jumps between two reads. */
export const sortProposals = (items: Proposal[]): Proposal[] =>
  [...items].sort((a, b) => b.provenance.at.localeCompare(a.provenance.at) || a.id.localeCompare(b.id));
