// «Riuscito se…» (ADR 0194, M4): every maintenance proposal declares one measurable criterion from a small fixed set
// (shared/maintenance-research.ts SUCCESS_METRICS) that the app computes from what it already records, at zero tokens:
// the runs (corrections, verified outcomes, skills loaded) and the app's own logs. The criterion is stored with the
// change it applied (BrainChange.success); SUCCESS_DAYS after the change, `checkChange` compares the week before with the
// week after. A worse result becomes a Proposte card «Questo cambio non ha aiutato: lo annullo?» with the numbers
// (research.ts outcomes, Annulla through the change log's rollback). Too few data points on a side → unknown, no card.
// This file: the criterion's validation and default, its words, and the math. Pure; used by research.ts and
// brainmodel/service.ts; tests: test/unit/brainmodel/success-check.test.ts.
import type { AgentRun } from '../../shared/agents';
import type { Lang } from '../../shared/contract';
import { SUCCESS_DAYS, SUCCESS_METRICS, type ResearchChange, type SuccessCheck, type SuccessCriterion, type SuccessMetric, type SuccessVerdict } from '../../shared/maintenance-research';
import { isRoleId } from '../../shared/roles';
import { verifiedVerdict } from '../../shared/run-verdict';

const DAY = 86_400_000;
export const WINDOW_MS = SUCCESS_DAYS * DAY;
/** the fewest runs on each side for a mean or a share to say anything */
export const MIN_RUNS = 3;
/** a share must move by this much (absolute) to count */
export const SHARE_MARGIN = 0.15;
/** skill-used: the default uses wanted in the week after */
export const DEFAULT_USES = 3;

/** The tool's `success` argument, checked: one metric of the fixed set with what it needs, else an error the model reads. */
export function parseSuccess(v: unknown): SuccessCriterion | undefined {
  if (v === undefined || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const metric = o.metric as SuccessMetric;
  if (!SUCCESS_METRICS.includes(metric)) throw new Error(`success.metric: one of ${SUCCESS_METRICS.join(', ')}.`);
  const role = typeof o.role === 'string' && o.role.trim() ? o.role.trim() : undefined;
  if (role !== undefined && !isRoleId(role)) throw new Error('success.role: a role id.');
  if (metric === 'more-verified' && !role) throw new Error('success.role: required for more-verified.');
  const logKey = typeof o.logKey === 'string' && o.logKey.trim() ? o.logKey.trim().slice(0, 1000) : undefined;
  if (metric === 'fewer-log-errors' && !logKey) throw new Error('success.logKey: required for fewer-log-errors (a key of the logs section).');
  const skill = typeof o.skill === 'string' && o.skill.trim() ? o.skill.trim() : undefined;
  if (skill !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error('success.skill: a kebab-case skill name.');
  if (metric === 'skill-used' && !skill) throw new Error('success.skill: required for skill-used.');
  const n = o.n === undefined ? undefined : Number(o.n);
  if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 100)) throw new Error('success.n: a whole number from 1 to 100.');
  return { metric, ...(role ? { role } : {}), ...(logKey && metric === 'fewer-log-errors' ? { logKey } : {}), ...(skill && metric === 'skill-used' ? { skill } : {}), ...(n !== undefined && metric === 'skill-used' ? { n } : {}) };
}

/** The criterion a brain change gets when the research declared none: a skill is used, a role's or every role's
 *  corrections go down. A forget card or an app card has none (nothing is applied to measure). */
export function defaultSuccess(change: ResearchChange | undefined): SuccessCriterion | undefined {
  if (!change) return undefined;
  if (change.target === 'skill' && change.name) return { metric: 'skill-used', skill: change.name, n: DEFAULT_USES };
  return { metric: 'fewer-corrections', ...(change.role ? { role: change.role } : {}) };
}

const WORDS = {
  it: {
    'fewer-corrections': (c: SuccessCriterion) => `Riuscito se le correzioni per lavoro${c.role ? ` di ${c.role}` : ''} calano nella settimana dopo.`,
    'more-verified': (c: SuccessCriterion) => `Riuscito se sale la quota di lavori di ${c.role} riusciti e verificati nella settimana dopo.`,
    'fewer-log-errors': () => 'Riuscito se nella settimana dopo l\'app scrive meno righe di quel gruppo di log.',
    'skill-used': (c: SuccessCriterion) => `Riuscito se la skill «${c.skill}» viene usata almeno ${c.n ?? DEFAULT_USES} volte nella settimana dopo.`,
  },
  en: {
    'fewer-corrections': (c: SuccessCriterion) => `Worked if the corrections per job${c.role ? ` of ${c.role}` : ''} go down in the week after.`,
    'more-verified': (c: SuccessCriterion) => `Worked if the share of ${c.role}'s verified successful jobs goes up in the week after.`,
    'fewer-log-errors': () => 'Worked if the app writes fewer lines of that log group in the week after.',
    'skill-used': (c: SuccessCriterion) => `Worked if the skill «${c.skill}» is used at least ${c.n ?? DEFAULT_USES} times in the week after.`,
  },
} as const;
/** «Riuscito se…» in the UI language (Italian, else English). */
export const successText = (c: SuccessCriterion, lang: Lang): string => WORDS[lang === 'it' ? 'it' : 'en'][c.metric](c);

/** The numbers in words, for the revert card. */
export function checkWords(c: SuccessCriterion, k: SuccessCheck, lang: Lang): string {
  const it = lang === 'it';
  const num = (x: number | null, share = false): string => (x === null ? '—' : share ? `${Math.round(x * 100)}%` : (Math.round(x * 100) / 100).toLocaleString(it ? 'it-IT' : 'en-US'));
  switch (c.metric) {
    case 'fewer-corrections': return it ? `Correzioni per lavoro: prima ${num(k.before)} (${k.nBefore} lavori), dopo ${num(k.after)} (${k.nAfter} lavori).` : `Corrections per job: before ${num(k.before)} (${k.nBefore} jobs), after ${num(k.after)} (${k.nAfter} jobs).`;
    case 'more-verified': return it ? `Lavori riusciti e verificati: prima ${num(k.before, true)} di ${k.nBefore}, dopo ${num(k.after, true)} di ${k.nAfter}.` : `Verified successful jobs: before ${num(k.before, true)} of ${k.nBefore}, after ${num(k.after, true)} of ${k.nAfter}.`;
    case 'fewer-log-errors': return it ? `Righe di quel gruppo di log: prima ${k.nBefore}, dopo ${k.nAfter}.` : `Lines of that log group: before ${k.nBefore}, after ${k.nAfter}.`;
    case 'skill-used': return it ? `La skill «${c.skill}» è stata usata ${k.nAfter} ${k.nAfter === 1 ? 'volta' : 'volte'} nella settimana dopo (ne servivano ${c.n ?? DEFAULT_USES}).` : `The skill «${c.skill}» was used ${k.nAfter} ${k.nAfter === 1 ? 'time' : 'times'} in the week after (${c.n ?? DEFAULT_USES} wanted).`;
  }
}

/** What the check reads: the runs, and the lines of one log group between two times (absent = no log metric). */
export interface CheckData {
  runs: readonly AgentRun[]; logCount?: (key: string, from: number, to: number) => number;
  /** when the runs' corrections.afterReport started to be counted (user-corrections.ts): earlier runs say nothing on
   *  corrections (their afterReport was always 0) */
  correctionsSince?: number | null;
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ended = (r: AgentRun, from: number, to: number): boolean => r.endedAt !== undefined && r.endedAt >= from && r.endedAt < to;
const inRole = (c: SuccessCriterion) => (r: AgentRun): boolean => !c.role || r.agentId === c.role;

/** better / same / worse for a value where lower is better, with the evidence layer's margin (a quarter, at least 0.1). */
export function lowerIsBetter(before: number, after: number): SuccessVerdict {
  const margin = Math.max(0.1, 0.25 * before);
  return after > before + margin ? 'worse' : after < before - margin ? 'better' : 'same';
}
/** For counts (log lines): worse only past a quarter more and at least two more lines. */
export function fewerCount(before: number, after: number): SuccessVerdict {
  if (after > Math.max(before * 1.25, before + 2)) return 'worse';
  if (after < before * 0.75 || (before > 0 && after === 0)) return 'better';
  return 'same';
}

/** The check of one change at `now`: null while the week after is not over. `at` = when the change was applied. */
export function checkChange(at: number, c: SuccessCriterion, d: CheckData, now: number): SuccessCheck | null {
  if (now < at + WINDOW_MS) return null;
  const b0 = at - WINDOW_MS, a1 = at + WINDOW_MS;
  const done = (x: Omit<SuccessCheck, 'at'>): SuccessCheck => ({ at: now, ...x });
  switch (c.metric) {
    case 'fewer-corrections': {
      const pool = d.runs.filter(r => r.source !== 'oneshot' && !!r.corrections && (d.correctionsSince == null || r.startedAt >= d.correctionsSince)).filter(inRole(c));
      const v = (r: AgentRun) => r.corrections!.tagged + r.corrections!.afterReport;
      const before = pool.filter(r => ended(r, b0, at)).map(v), after = pool.filter(r => r.startedAt >= at && ended(r, at, a1)).map(v);
      const mb = mean(before), ma = mean(after);
      const verdict = before.length < MIN_RUNS || after.length < MIN_RUNS || mb === null || ma === null ? 'unknown' : lowerIsBetter(mb, ma);
      return done({ before: mb, after: ma, nBefore: before.length, nAfter: after.length, verdict });
    }
    case 'more-verified': {
      const judged = (from: number, to: number, after: boolean) => d.runs.filter(inRole(c)).filter(r => ended(r, from, to) && (!after || r.startedAt >= at))
        .map(r => verifiedVerdict(r, [], now)?.verdict).filter((x): x is NonNullable<typeof x> => !!x);
      const before = judged(b0, at, false), after = judged(at, a1, true);
      const share = (xs: string[]) => (xs.length ? xs.filter(x => x === 'success').length / xs.length : null);
      const sb = share(before), sa = share(after);
      const verdict: SuccessVerdict = before.length < MIN_RUNS || after.length < MIN_RUNS || sb === null || sa === null ? 'unknown'
        : sa < sb - SHARE_MARGIN ? 'worse' : sa > sb + SHARE_MARGIN ? 'better' : 'same';
      return done({ before: sb, after: sa, nBefore: before.length, nAfter: after.length, verdict });
    }
    case 'fewer-log-errors': {
      if (!d.logCount || !c.logKey) return done({ before: null, after: null, nBefore: 0, nAfter: 0, verdict: 'unknown' });
      const nb = d.logCount(c.logKey, b0, at), na = d.logCount(c.logKey, at, a1);
      return done({ before: nb, after: na, nBefore: nb, nAfter: na, verdict: fewerCount(nb, na) });
    }
    case 'skill-used': {
      const used = (from: number, to: number) => d.runs.filter(r => ended(r, from, to) && (r.tags?.skills ?? []).includes(c.skill ?? '')).length;
      const nb = used(b0, at), na = used(at, a1), want = c.n ?? DEFAULT_USES;
      // fewer uses than wanted says «worse» only when there was work to use it in: a quiet week is unknown
      const busy = d.runs.filter(r => ended(r, at, a1)).length >= MIN_RUNS;
      return done({ before: nb, after: na, nBefore: nb, nAfter: na, verdict: na >= want ? 'better' : busy ? 'worse' : 'unknown' });
    }
  }
}
