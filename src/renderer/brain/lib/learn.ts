// The data and words of «Regole imparate» (ADR 0030, once the Miglioramento page): /api/improve (the brain's ops/improve/improve.mjs status, one row
// per policy of the shared self-improvement loop) normalized defensively, and every number turned into a plain Italian
// line with its n: the typical error (× between estimate and truth, median of the last ones), how often the 80% range
// held, what a proposal gains on the shared items (paired bootstrap, 90% interval), the after-check of the last change.
// DOM-free, unit-tested (test/unit/brain-ui/learn.test.ts); used by pages/LearnedRules.tsx and lib/classifier-view.ts.
import { t, locale } from '../../i18n';

export interface Diff { mean: number; lo: number; hi: number }
export interface LearnProposal { id: string; kind: 'cambio' | 'ripristino'; name: string; at: string; shared: number | null; diff: Diff | null }
export interface LearnCheck { state: string; n: number | null; need: number | null; at: string | null }
/** No after-check yet for a version that replaced another: the brain writes one only once it has its 20 cases. */
export const WAITING = () => t('brainLib.learn.waiting', { n: 20 });
export interface LearnPolicy {
  domain: string; version: number | null; appliedAt: string | null; by: string | null; name: string | null;
  /** the version [Ripristina] goes back to (null: nothing before) */
  previous: number | null;
  pending: LearnProposal | null; lastCheck: LearnCheck | null;
  recorded: { predictions: number; known: number; unknown: number };
  n: number; noData: boolean; unknown: number; noPrediction: number;
  typical: number | null; spark: number[]; coverage: { rate: number; n: number } | null; driftChanged: boolean;
}

/** Below this many measured items a policy says "senza dati" (lib.mjs MIN_CAL). */
export const MIN_N = 20;

/** The page's "?" explanations, in plain words (the user, 2026-10-13: "spiega l'auto miglioramento nell'app, mi piacciono
 *  i punti di domanda con spiegazioni"). */
export const HELP = () => ({
  intro: t('brainLib.learn.helpIntro'),
  typical: t('brainLib.learn.helpTypical'),
  cover: t('brainLib.learn.helpCover'),
  out: t('brainLib.learn.helpOut'),
  noData: t('brainLib.learn.helpNoData', { min: MIN_N }),
  proposal: t('brainLib.learn.helpProposal'),
  check: t('brainLib.learn.helpCheck'),
  rollback: t('brainLib.learn.helpRollback'),
  drift: t('brainLib.learn.helpDrift'),
}) as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number => Math.max(0, Math.round(fin(v) ?? 0));
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const diffOf = (v: unknown): Diff | null => {
  const d = obj(v), mean = fin(d.mean), lo = fin(d.lo), hi = fin(d.hi);
  return mean != null && lo != null && hi != null ? { mean, lo, hi } : null;
};

/** What the page reads: the policies, and whether the brain has the loop at all. `loop: 'missing'` is main's answer
 *  for a brain without ops/improve/improve.mjs (src/main/brain/learn.ts learnStatusWithoutCli): the page then explains
 *  what it needs instead of showing an error. */
export interface LearnData { policies: LearnPolicy[]; loop: 'ok' | 'missing' }

export function normLearnData(v: unknown): LearnData {
  return { policies: normLearn(v), loop: obj(v).loop === 'missing' ? 'missing' : 'ok' };
}

export function normLearn(v: unknown): LearnPolicy[] {
  const list = Array.isArray(obj(v).policies) ? (obj(v).policies as unknown[]) : [];
  return list.filter(isObj).filter(p => typeof p.domain === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(p.domain)).map(p => {
    const pend = isObj(p.pending) && typeof p.pending.id === 'string' ? p.pending : null;
    // the after-check of the version in force only (the brain keeps the last one written, maybe of an older version)
    const ev = obj(pend?.evidence), chk = isObj(p.lastCheck) && p.lastCheck.version === p.version ? p.lastCheck : null, rec = obj(p.recorded), cov = obj(p.coverage);
    return {
      domain: String(p.domain), version: fin(p.version), appliedAt: s(p.appliedAt), by: s(p.by), name: s(p.name), previous: fin(p.previous),
      pending: pend ? { id: String(pend.id), kind: pend.kind === 'ripristino' ? 'ripristino' : 'cambio', name: s(pend.name) ?? '', at: s(pend.at) ?? '', shared: fin(ev.shared), diff: diffOf(ev.diff) } : null,
      lastCheck: chk ? { state: s(chk.state) ?? '', n: fin(chk.n), need: fin(chk.need), at: s(chk.at) ?? s(chk.since) } : null,
      recorded: { predictions: int(rec.predictions), known: int(rec.known), unknown: int(rec.unknown) },
      n: int(p.n), noData: p.noData !== false, unknown: int(p.unknownItems) + int(rec.unknown), noPrediction: int(p.noPrediction),
      typical: fin(p.typical), spark: (Array.isArray(p.spark) ? p.spark : []).map(fin).filter((x): x is number => x != null),
      coverage: fin(cov.rate) != null && int(cov.n) > 0 ? { rate: fin(cov.rate)!, n: int(cov.n) } : null,
      driftChanged: obj(p.drift).changed === true,
    };
  });
}

/** What each policy decides, in the owner's words. */
export const POLICY_LABEL = () => ({ estimates: t('brainLib.learn.policyEstimates'), routing: t('brainLib.learn.policyRouting'), notifications: t('brainLib.learn.policyNotifications') });
export const policyLabel = (d: string): string => POLICY_LABEL()[d as keyof ReturnType<typeof POLICY_LABEL>] ?? d;

const n1 = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: v < 10 ? 1 : 0 });
const pc = (v: number) => `${Math.round(v * 100)}%`;

/** "×1,9": the estimate is typically off by this factor, either way. */
export const factor = (x: number): string => `×${n1(x)}`;

/** "senza dati: 12 misurati, ne servono 20" or the typical error with its n. */
export function errorLine(p: LearnPolicy): string {
  if (p.noData) return t('brainLib.learn.errorLineNoData', { n: p.n, min: MIN_N });
  return p.typical == null ? t('brainLib.learn.errorLineUnmeasured') : t('brainLib.learn.errorLineMeasured', { factor: factor(p.typical), count: p.spark.length });
}

/** "l'intervallo dell'80% ha contenuto il reale 84 volte su 100 (su 50)" */
export function coverageLine(c: LearnPolicy['coverage']): string | null {
  return c ? t('brainLib.learn.coverageLine', { rate: pc(c.rate), n: c.n }) : null;
}

/** What a proposal gains, from the 90% interval of the per-item log-error difference (in force − proposed: > 0 =
 *  better): "errore più piccolo del 12% (tra 4% e 19%), su 42 casi in comune". A revert proposal carries the
 *  after-check's diff (old − in force: < 0 = the old one was better, so going back gains), hence the sign flip. */
export function gainLine(p: LearnProposal): string {
  if (!p.diff) return p.shared ? t('brainLib.learn.gainLineWithShared', { shared: p.shared }) : t('brainLib.learn.gainLineNoShared');
  const g = (x: number) => Math.round((1 - Math.exp(-x)) * 100);
  const sign = p.kind === 'ripristino' ? -1 : 1, mean = g(sign * p.diff.mean);
  const [a, b] = [g(sign * p.diff.lo), g(sign * p.diff.hi)].sort((x, y) => x - y);
  const better = mean >= 0;
  return better ? t('brainLib.learn.gainLineBetter', { pct: Math.abs(mean), lo: a ?? 0, hi: b ?? 0, shared: p.shared ?? undefined }) : t('brainLib.learn.gainLineWorse', { pct: Math.abs(mean), lo: a ?? 0, hi: b ?? 0, shared: p.shared ?? undefined });
}

/** The after-check of the last change in words. */
export function checkLine(c: LearnCheck | null): string | null {
  if (!c?.state) return null;
  if (c.state === 'in attesa') return t('brainLib.learn.checkLineWaiting', { n: c.n ?? 0, need: c.need ?? MIN_N });
  if (c.state === 'peggiorata') return t('brainLib.learn.checkLineFailed', { n: c.n ?? undefined });
  return t('brainLib.learn.checkLineOther', { state: c.state, n: c.n ?? undefined });
}
