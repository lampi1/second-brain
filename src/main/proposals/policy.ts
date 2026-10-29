// Which Proposte cards the app still asks (ADR 0193; owner, 2026-10-29: «dammi solo quelle sensate dove realmente
// l'approvazione non è scontata»). Pure over the decision ledger (ledger.ts):
// - a group on the allow-list (AUTO_GROUPS: skill, rule, fact, script/query, learning) applies its new cards by itself
//   once, over its last decisions (at least MIN, at most WINDOW; an undo after a yes counts as a no), the 90% Wilson
//   lower bound of the yes share (shared/success.ts successInterval, z = 1.645) reaches the threshold (0.80: 11 yes in a row,
//   19 with one no; the undo check below is what keeps it safe);
// - a risk check in the spirit of conformal risk control: of the last 20 cards a group applied by itself, more than 5%
//   undone sends the group back to asking, its decisions counted only from the last undo on, and each undone auto card
//   raises the group's threshold by 0.05 (at most 0.95);
// - never by itself, whatever the history: role, setting, forget and issue groups, a tier or a trial, anything touching
//   permissions, tools or hooks, production, or that goes outside the app; a card that cannot be undone from here.
// Each card still shown carries why (ProposalWhy), never a guessed answer (Bondi et al., AAAI 2022). Used by
// proposals/service.ts and brainmodel/research.ts (the pack's «decisions»); unit tests: test/unit/proposals/policy.test.ts.
import { AUTO_GROUPS, PROPOSAL_GROUPS, type Proposal, type ProposalGroup, type ProposalGroupPolicy, type ProposalWhy } from '../../shared/proposals';
import { successInterval } from '../../shared/success';
import type { DecisionEntry } from './ledger';

export const POLICY = {
  /** decisions a group needs before anything applies by itself (the first week only records) */
  min: 10,
  /** the decisions counted, newest */
  window: 200,
  /** the Wilson lower bound the yes share must reach */
  target: 0.8,
  /** each auto card the user undid raises the bound by this, up to maxTarget */
  raise: 0.05,
  maxTarget: 0.95,
  /** the last auto-applied cards checked for undos, and the undone share that sends the group back to asking */
  autoWindow: 20,
  maxUndone: 0.05,
  z: 1.645,
} as const;

/** A decision counts as yes only when it was approved and never taken back. */
export const said = (e: DecisionEntry): 'yes' | 'no' => (e.decision === 'approve' && e.undoneAt === undefined ? 'yes' : 'no');

export function groupPolicy(group: ProposalGroup, ledger: readonly DecisionEntry[]): ProposalGroupPolicy {
  const all = ledger.filter(e => e.group === group).sort((a, b) => a.at - b.at);
  const autos = all.filter(e => e.by === 'auto'), recent = autos.slice(-POLICY.autoWindow);
  const autoUndone = recent.filter(e => e.undoneAt !== undefined).length;
  const breach = recent.length > 0 && autoUndone / recent.length > POLICY.maxUndone;
  const threshold = Math.min(POLICY.maxTarget, POLICY.target + POLICY.raise * autos.filter(e => e.undoneAt !== undefined).length);
  // after a breach only fresh decisions count: those made after the last auto card the user took back
  const lastUndo = breach ? Math.max(...autos.flatMap(e => (e.undoneAt === undefined ? [] : [e.undoneAt]))) : -Infinity;
  const sample = all.filter(e => e.at > lastUndo).slice(-POLICY.window);
  const yes = sample.filter(e => said(e) === 'yes').length, n = sample.length;
  const undone = sample.filter(e => e.decision === 'approve' && e.undoneAt !== undefined).length;
  const low = n ? successInterval({ value: yes / n, n }, POLICY.z)?.low ?? null : null;
  const allowed = AUTO_GROUPS.includes(group);
  const mode = !allowed ? 'never' : n >= POLICY.min && low !== null && low >= threshold ? 'auto' : 'ask';
  return { group, mode, n, yes, no: n - yes, undone, low, threshold, autoN: recent.length, autoUndone };
}
export const allPolicies = (ledger: readonly DecisionEntry[]): ProposalGroupPolicy[] => PROPOSAL_GROUPS.map(g => groupPolicy(g, ledger));

/** Text that touches what the app always asks about: tools and permissions (a skill's allowed-tools, settings and
 *  hook files) and production. */
const TOOLS = /^\s*(allowed-tools|permissions?|hooks?)\s*:|(?:^|[\\/])\.claude[\\/]settings|(?:^|[\\/])hooks?[\\/]|\bpermissionMode\b/im;
const PRODUCTION = /\bprod(uction|uzione)?\b/i;

/** Why a card is never applied by itself, whatever the history; null = it may be. */
export function neverAuto(c: Proposal): Extract<ProposalWhy, { code: 'never' }>['what'] | null {
  if (c.group === 'issue' || (c.ask.kind === 'research' && (c.ask.finding === 'app-idea' || c.ask.finding === 'app-bug'))) return 'external';
  if (c.group === 'setting' || c.source === 'setting' || c.ask.kind === 'setting') return 'setting';
  if (c.ask.kind === 'tier' || c.ask.kind === 'trial') return 'permissions';
  if (c.group === 'role' || (c.ask.kind === 'applied' && c.ask.what === 'agent')) return 'role';
  if (c.group === 'forget') return 'forget';
  const text = [c.content, ...(c.code ?? []).map(x => `${x.file}\n${x.text}`), ...(c.provenance.files ?? [])].join('\n');
  if (TOOLS.test(text)) return 'permissions';
  if (PRODUCTION.test(text) || PRODUCTION.test(c.title)) return 'production';
  if (!AUTO_GROUPS.includes(c.group)) return 'role';
  return null;
}

/** The change can be taken back from the app: an applied change still undoable, a candidate's promotion and a
 *  maintenance finding (both through the change log), a loop policy (learn:act rollback). The Battito's rules edit a
 *  role's text with no undo here. */
export function reversible(c: Proposal): boolean {
  switch (c.source) {
    case 'change': return c.canReject;
    case 'candidate': return true;
    case 'research': return c.group !== 'issue';
    case 'policy': return c.ask.kind === 'policy';
    default: return false;
  }
}
export const hasEvidence = (c: Proposal): boolean => (c.evidenceRuns?.length ?? 0) > 0;
export const cardSize = (c: Proposal): number => c.content.length + (c.code ?? []).reduce((s, x) => s + x.text.length, 0);

/** The card goes by itself now: its group is sure enough, nothing about it is on the never list, it can be undone and
 *  its approve side is open. */
export function autoNow(c: Proposal, p: ProposalGroupPolicy): boolean {
  return p.mode === 'auto' && neverAuto(c) === null && reversible(c) && c.canApprove && !c.blocked?.length;
}

/** «Te la chiedo perché: …» as data: the first reason that holds. */
export function whyAsked(c: Proposal, p: ProposalGroupPolicy): ProposalWhy {
  const never = neverAuto(c);
  if (never) return { code: 'never', what: never };
  if (!reversible(c)) return { code: 'irreversible' };
  if (p.autoN > 0 && p.autoUndone / p.autoN > POLICY.maxUndone) return { code: 'undone', n: p.autoUndone };
  if (p.mode === 'auto') return { code: 'blocked' };
  if (p.n === 0) return { code: 'first' };
  if (p.no > 0) return { code: 'rejected', no: p.no, n: p.n };
  if (p.n < POLICY.min) return { code: 'few', n: p.n };
  return { code: 'building', yes: p.yes, n: p.n };
}

/** Monday 00:00 local time of the week `now` is in. */
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
/** «Carte risparmiate questa settimana»: cards applied by themselves since Monday and not taken back. */
export const savedThisWeek = (ledger: readonly DecisionEntry[], now: number): number => {
  const since = weekStart(now);
  return ledger.filter(e => e.by === 'auto' && e.at >= since && e.undoneAt === undefined).length;
};

/** One line on a group's policy, for the log and the data pack. */
export function policyLine(p: ProposalGroupPolicy): string {
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  return `${p.group}: ${p.mode} · ${p.n} decisions (yes ${p.yes}, no ${p.no}, of which undone after yes ${p.undone}) · Wilson low ${pct(p.low)} vs ${pct(p.threshold)} · auto ${p.autoN} (undone ${p.autoUndone})`;
}
