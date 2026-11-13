// View helpers of the evidence layer (ADR 0109): a change's claim as one line of text, its verdict's tone, where it is
// measured, and a role's weekly corrections per run as points (a week without runs has none). Pure; used by
// components/brain-model/LearningPage.tsx and MaintenancePanel.tsx; tests: test/unit/learning-view.test.ts.
import type { ChangeClaim, ClaimVerdict, LearningRole } from '@shared/brain-model';
import { locale, t } from '../i18n';

export const VERDICTS: readonly ClaimVerdict[] = ['aiuta', 'nessun-effetto', 'raccolta', 'peggiora', 'annullato'];
export const verdictTone = (v: ClaimVerdict): 'green' | 'muted' | 'blue' | 'amber' => (v === 'aiuta' ? 'green' : v === 'peggiora' ? 'amber' : v === 'raccolta' ? 'blue' : 'muted');

/** 1 decimal in the current locale; signed = always a sign, with a real minus */
export function num(x: number, signed = false): string {
  const r = Math.round(x * 10) / 10, s = Math.abs(r).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${r < 0 ? '−' : signed ? '+' : ''}${s}`;
}

/** The claim's numbers in one line: the difference with its interval and the verdict, or how far the runs are. */
export function claimLine(c: ChangeClaim): string {
  const verdict = t(`learn.v.${c.verdict}`).toLowerCase();
  if (c.before.n < 20 && c.verdict !== 'annullato') return t('learn.claim.noBaseline', { n: c.before.n });
  if (c.diff && c.before.mean !== null && c.after.mean !== null) {
    const parts = [t('learn.claim.diff', { d: num(c.after.mean - c.before.mean, true), n: c.after.judged, low: num(c.diff.low, true), high: num(c.diff.high, true) }),
      t('learn.claim.before', { mean: num(c.before.mean), n: c.before.judged })];
    parts.push(c.verdict === 'raccolta' && c.need ? `${verdict}, ${t('learn.claim.next', { need: c.need })}` : verdict);
    return parts.join(' · ');
  }
  if (c.verdict === 'annullato') return t('learn.claim.undone');
  return t('learn.claim.collecting', { n: c.after.n, need: c.need ?? 20 });
}

/** «misurata su Artisan, Scout, solo le esecuzioni che caricano «x»» (or every role). */
export function scopeLine(c: ChangeClaim, names: ReadonlyMap<string, string>): string {
  const roles = c.scope.length ? c.scope.map(id => names.get(id) ?? id).join(', ') : t('learn.scopeAll');
  return t('learn.scope', { roles }) + (c.skill ? t('learn.scopeSkill', { skill: c.skill }) : '');
}

/** The role's weeks as points: index of the week and mean corrections per run (weeks without runs are left out). */
export function curve(r: LearningRole): { i: number; mean: number; runs: number; start: number }[] {
  return r.weeks.flatMap((w, i) => (w.runs ? [{ i, mean: w.corrections / w.runs, runs: w.runs, start: w.start }] : []));
}
