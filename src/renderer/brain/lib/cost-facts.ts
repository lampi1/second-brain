// The "curious facts" about costs (owner, 2026-10-19: "dati fighi con spiegazioni, cose curiose che
// catturano l'attenzione"): the priciest day against the 7-day average, the model that takes most of the week's spend
// and the priciest kind of work, each only when the data hold enough to say it; and whether a Cursor export covers the
// period (cursorCoverage). Pure; unit-tested in
// test/unit/dashboard-errors.test.ts. Used by Andamento → Costi (pages/Costi.tsx), the one costs page since the
// Dashboard's Costi tab was removed (#125).
import type { CostData } from '../types';
import { locale, t } from '../../i18n';

const pctFmt = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
const x = (v: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v);

export function costFacts(c: Pick<CostData, 'byDay' | 'byModel' | 'byKind' | 'total'>, money: (v: number) => string): string[] {
  const out: string[] = [];
  const days = Object.entries(c.byDay).filter(([, v]) => v.usd > 0);
  if (days.length >= 3) {
    const avg = days.reduce((s, [, v]) => s + v.usd, 0) / days.length;
    const [day, top] = days.reduce((a, b) => (b[1].usd > a[1].usd ? b : a));
    if (avg > 0 && top.usd / avg >= 1.3) out.push(t('stats.cost.factDay', { day: new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }), usd: money(top.usd), x: x(top.usd / avg) }));
  }
  const models = Object.entries(c.byModel).sort(([, a], [, b]) => b.usd - a.usd);
  const total = models.reduce((s, [, v]) => s + v.usd, 0);
  if (models.length >= 2 && total > 0) out.push(t('stats.cost.factModel', { model: models[0]![0], pct: pctFmt(models[0]![1].usd / total) }));
  const kinds = Object.entries(c.byKind).filter(([, v]) => v.usd > 0).sort(([, a], [, b]) => b.usd - a.usd);
  if (kinds.length >= 2) out.push(t('stats.cost.factKind', { kind: kinds[0]![0], usd: money(kinds[0]![1].usd) }));
  return out;
}

/** Cursor export coverage, judged like usage.ts: by the Rome day the export was downloaded (lastRow is only the last
 *  usage row, which can be old even for a fresh export). null = no export or no readable date. */
export function cursorCoverage(cursor: { downloaded?: string }, periodEnd: string): boolean | null {
  const at = cursor.downloaded ? Date.parse(cursor.downloaded) : NaN;
  return Number.isFinite(at) && /^\d{4}-\d{2}-\d{2}/.test(periodEnd) ? ROME_DAY.format(new Date(at)) >= periodEnd.slice(0, 10) : null;
}
const ROME_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
