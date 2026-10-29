// Which Proposte cards the app still asks (ADR 0193; owner, 2026-10-29: «dammi solo quelle sensate dove realmente
// l'approvazione non è scontata»). Pure over the decision ledger (ledger.ts):
// - trust is built per group AND source (groupPolicy(group, ledger, source)): «Tieni» on a change the maintenance already
//   applied never lets a brand-new research card of the same group go by itself;
// - a group on the allow-list (AUTO_GROUPS: skill, rule, fact, learning) applies its new cards by itself once, over its
//   last decisions from that source (at least MIN, at most WINDOW; an undo after a yes counts as a no), the 90% Wilson
//   lower bound of the yes share (shared/success.ts successInterval, z = 1.645) reaches the threshold (0.80: 11 yes in a
//   row, 19 with one no; the undo check below is what keeps it safe);
// - a risk check in the spirit of conformal risk control: of the last 20 cards a group applied by itself, more than 5%
//   undone sends the group back to asking, its decisions counted only from the last undo on, and each undone auto card
//   raises the group's threshold by 0.05 (at most 0.95);
// - never by itself, whatever the history: role, setting, forget, issue, script/query (they run commands), brain and
//   note groups, a tier or a trial, a «riuscito se» revert or a lint finding that removes something, anything touching
//   permissions, tools or hooks, production, or that goes outside the app (the patterns below scan the whole text,
//   quoted lines too); a card that cannot be undone from here.
// Each card still shown carries why (ProposalWhy), never a guessed answer (Bondi et al., AAAI 2022). Used by
// proposals/service.ts and brainmodel/research.ts (the pack's «decisions»); unit tests: test/unit/proposals/policy.test.ts.
import { AUTO_GROUPS, type Proposal, type ProposalGroup, type ProposalGroupPolicy, type ProposalNever, type ProposalSource, type ProposalWhy } from '../../shared/proposals';
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

/** One group's policy over its decisions from `source` (absent = from every source: an overview only). */
export function groupPolicy(group: ProposalGroup, ledger: readonly DecisionEntry[], source?: ProposalSource): ProposalGroupPolicy {
  const all = ledger.filter(e => e.group === group && (source === undefined || e.source === source)).sort((a, b) => a.at - b.at);
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
  return { group, ...(source ? { source } : {}), mode, n, yes, no: n - yes, undone, low, threshold, autoN: recent.length, autoUndone };
}
/** Every (group, source) pair the ledger holds decisions for, each with its own policy (the pack's «decisions»). */
export function allPolicies(ledger: readonly DecisionEntry[]): ProposalGroupPolicy[] {
  const pairs = new Map<string, [ProposalGroup, ProposalSource]>();
  for (const e of ledger) pairs.set(`${e.group}|${e.source}`, [e.group, e.source]);
  return [...pairs.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])).map(([g, src]) => groupPolicy(g, ledger, src));
}

/** Text that touches what the app always asks about: tools and permissions (a skill's allowed-tools, settings and
 *  hook files), production, and what goes outside the app. Never anchored to a line start: a quoted line («> …») or a
 *  value inside a sentence counts the same. Callers scan the whole text, never a clipped one. */
const TOOLS: readonly RegExp[] = [
  /\b(allowed[-_]?tools|permissions?|permissionMode|hooks?)\s*[:=]/i,
  /\.claude[\\/]settings/i, /\bsettings(\.local)?\.json\b/i, /(?:^|[\s\\/"'`(])hooks?[\\/]/i,
  /\bpermissionMode\b/, /\bbypassPermissions\b/i, /--dangerously-skip-permissions/i, /\bdangerouslySkipPermissions\b/i,
];
const PRODUCTION: readonly RegExp[] = [
  // prod, PROD_DB, prod-db, db.prod.x, prd, production / produzione / Produktion as their own token
  /(?<![a-z0-9])(prod|prd|production|produzione|produktion)(?![a-z])/i,
  // prodDb, dbProd, connPROD (camelCase and upper case inside an identifier)
  /(?<![A-Za-z])[Pp]rod(?=[A-Z])|[a-z0-9]Prod(?![a-z])|[a-z0-9]PROD(?![A-Z])/,
  // a live or production host
  /(?<![\w-])(live|prod|prd)[.-][\w.-]*\.[a-z]{2,}\b/i, /[\w-][.-](live|prod|prd)\.[\w.-]+/i,
  // Azure CLI commands that change something
  /(?<![\w-])az\s+(?:[a-z][\w-]*\s+){0,4}(create|delete|update|set|start|stop|restart|deploy|apply|add|remove|purge|import|swap|scale|assign|reset|upload|run|invoke|sync)\b/i,
  // a kubectl context or a connection string that names production
  /kubectl[^\n]*(--context[= ]|use-context\s+)\S*(prod|prd|live)/i, /connection\s*string[^\n]*(prod|prd|live)/i,
];
const EXTERNAL: readonly RegExp[] = [
  /(?<![\w./-])gh\s+[a-z]/i,
  /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]*?\bhttps?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])(?:[:/\s'"]|$))/i,
  /\bfetch\(\s*['"`]https?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])[:/'"`])/i,
  /\b(smtp|sendmail|Send-MailMessage|nodemailer)\b/i,
  /hooks\.slack\.com|\bslack\b[^\n]*webhook|webhook[^\n]*\bslack\b|webhook\.office\.com|outlook\.office(365)?\.com\/webhook|\bteams\b[^\n]*webhook|webhook[^\n]*\bteams\b/i,
  /(?<![\w-])az\s+[a-z]/i, /\bkubectl\b/i,
];
/** The text as scanned: every quoted line's «> » prefix taken off. */
const unquote = (s: string): string => s.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');
/** The never reason a text carries (tools/permissions, production, external), or null. Used for the cards' own text
 *  and, by sources.ts, for the whole files an applied change wrote. */
export function textNever(raw: string): Extract<ProposalNever, 'permissions' | 'production' | 'external'> | null {
  const text = unquote(raw);
  if (TOOLS.some(r => r.test(text))) return 'permissions';
  if (PRODUCTION.some(r => r.test(text))) return 'production';
  if (EXTERNAL.some(r => r.test(text))) return 'external';
  return null;
}
/** The groups never on the allow-list, each with its reason. */
const GROUP_NEVER: Partial<Record<ProposalGroup, ProposalNever>> = { issue: 'external', setting: 'setting', role: 'role', forget: 'forget', script: 'script', brain: 'brain', note: 'note' };

/** Why a card is never applied by itself, whatever the history; null = it may be. */
export function neverAuto(c: Proposal): ProposalNever | null {
  if (c.group === 'issue' || (c.ask.kind === 'research' && (c.ask.finding === 'app-idea' || c.ask.finding === 'app-bug'))) return 'external';
  if (c.group === 'setting' || c.source === 'setting' || c.ask.kind === 'setting') return 'setting';
  if (c.ask.kind === 'tier' || c.ask.kind === 'trial') return 'permissions';
  if (c.group === 'role' || (c.ask.kind === 'applied' && c.ask.what === 'agent')) return 'role';
  // a «riuscito se» revert takes a change back: its Annulla could not put it back from here
  if (c.group === 'forget' || (c.ask.kind === 'research' && c.ask.finding === 'revert')) return 'forget';
  if (c.never) return c.never;
  const found = textNever([c.title, c.content, ...(c.code ?? []).map(x => `${x.file}\n${x.text}`), ...(c.diffs ?? []).map(d => `${d.file}\n${d.after ?? ''}`), ...(c.provenance.files ?? [])].join('\n'));
  if (found) return found;
  if (!AUTO_GROUPS.includes(c.group)) return GROUP_NEVER[c.group] ?? 'role';
  return null;
}

/** The change can be taken back from the app: an applied change still undoable, a candidate's promotion and a
 *  maintenance finding (both through the change log), a loop policy (learn:act rollback). The Battito's rules edit a
 *  role's text with no undo here. */
export function reversible(c: Proposal): boolean {
  switch (c.source) {
    case 'change': return c.canReject;
    case 'candidate': return true;
    case 'research': return c.group !== 'issue' && !(c.ask.kind === 'research' && c.ask.finding === 'revert');
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
  return `${p.group}${p.source ? ` (${p.source})` : ''}: ${p.mode} · ${p.n} decisions (yes ${p.yes}, no ${p.no}, of which undone after yes ${p.undone}) · Wilson low ${pct(p.low)} vs ${pct(p.threshold)} · auto ${p.autoN} (undone ${p.autoUndone})`;
}
