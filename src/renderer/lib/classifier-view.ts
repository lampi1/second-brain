// Pure view helpers of the Classificatori grid (owner, 2026-10-19: "card e statistiche per ciascuno, con spiegazione",
// "cose curiose che catturano l'attenzione e ti facciano capire a cosa servono"). One CardView per classifier: the
// four record-keeping ones from main (ClassifiersState.cards), the estimates one from the brain's loop
// (/api/improve, LearnPolicy 'estimates') and the task estimator's weekly backtest (IPC agents:estimates → accuracy,
// ADR 0087); the weekly hit series and the advice, built only from data, only from MIN_FACT cases up and only when it
// ends with something the user can do (ADR 0101: the "Lo sapevi?" curiosities on 5 cases, the "sta imparando" trends
// and the "pronto a calibrarsi" meter of a calibration removed in bb953da are gone). The brain's own estimates loop is
// no card any more (ADR 0053 retired that estimator from the UI; ADR 0101 hid its last card). A value without data
// stays null ("nessun dato ancora"), never zero. No React, no IPC: unit-tested in
// test/unit/brain-ui/classifier-view.test.ts; used by components/brain-model/ClassifiersPage.tsx and ClassifierDetail.tsx.
import type { ClassifierCard, ClassifierCardId, ClassifierStat, ClassifierWeek, ClassifiersState } from '@shared/brain-model';
import type { EstimateAccuracy } from '@shared/task-estimate';
import type { LearnPolicy } from '../brain/lib/learn';
import { t, locale } from '../i18n';
import { getKindIt } from './routing';
import { formatCost, prettyModel } from './format';

export type CardId = ClassifierCardId | 'estimates' | 'tasks';
export const CARD_ORDER: CardId[] = ['kind', 'model', 'tasks', 'jobkind'];

export interface CardView {
  id: CardId;
  decisions: number;
  hit: ClassifierStat;
  success: ClassifierStat;
  /** cases with only an unverified outcome (the brain's proxy), shown apart from success (ADR 0095) */
  unverified?: ClassifierStat;
  avgCostUsd: number | null;
  /** weekly series (null: the classifier reports none, e.g. the estimates loop) */
  weeks: ClassifierWeek[] | null;
  /** the estimates loop's last typical errors (×), oldest first */
  spark: number[];
  slices: ClassifierCard['slices'];
  compare: ClassifierCard['compare'];
  lastAt: number | null;
  /** the estimates loop's own figures */
  estimates?: { typical: number | null; version: number | null; check: string | null; pending: boolean; n: number };
  /** the task estimator's own figures: per week the share resting on the same role and kind, the last median gap */
  tasks?: { specific: (number | null)[]; medianErr: number | null; lastSpecific: number | null };
}

/** no advice rests on fewer cases (5 was noise, E-apprendimento §5; ADR 0101) */
export const MIN_FACT = 20;
const pctFmt = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
export const pctOf = (s: ClassifierStat): string | null => (s.value === null ? null : pctFmt(s.value));
/** "34/46": the count behind a share, shown beside every percentage that stays (ADR 0101) */
export const kOfN = (s: ClassifierStat): string => `${s.value === null ? 0 : Math.round(s.value * s.n)}/${s.n}`;
const num = (v: number, d = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
const money = (v: number) => formatCost(v);
export const usdOf = (v: number | null): string | null => (v === null ? null : money(v));

/** The value a slice key stands for, in words. */
export function sliceLabel(id: CardId, key: string): string {
  // one taxonomy (ADR 0182): the cost ledger's kinds are the routing table's
  if (id === 'kind' || id === 'jobkind') return (getKindIt() as Record<string, string>)[key] ?? key;
  if (id === 'model') return key === '—' ? t('stats.cls.defaultModel') : prettyModel(key);
  return key;
}

/** Main's card as the page draws it. */
export function fromMain(c: ClassifierCard): CardView {
  return { id: c.id, decisions: c.decisions, hit: c.hit, success: c.success, ...(c.unverified ? { unverified: c.unverified } : {}), avgCostUsd: c.avgCostUsd, weeks: c.weeks, spark: [], slices: c.slices, compare: c.compare, lastAt: c.lastAt };
}

/** The estimates loop's policy as a card: decisions = estimates recorded, hit = how often the real value fell inside
 *  the estimated range (coverage). Not in CARD_ORDER (ADR 0053/0101): kept for the brain's loop data shape. */
export function fromEstimates(p: LearnPolicy | undefined): CardView {
  const appliedAt = p?.appliedAt ? Date.parse(p.appliedAt) : NaN;
  return {
    id: 'estimates', decisions: p?.recorded.predictions ?? 0,
    hit: p?.coverage ? { value: p.coverage.rate, n: p.coverage.n } : { value: null, n: 0 },
    success: { value: null, n: 0 }, avgCostUsd: null, weeks: null, spark: p?.spark ?? [], slices: [], compare: null,
    lastAt: Number.isFinite(appliedAt) ? appliedAt : null,
    estimates: { typical: p?.typical ?? null, version: p?.version ?? null, check: p?.lastCheck?.state ?? null, pending: !!p?.pending, n: p?.n ?? 0 },
  };
}

/** ISO week label ("2026-W42") of a local Monday: the week's Thursday decides the year (as main's isoWeek). */
export function isoWeekOf(weekStart: number): string {
  const d = new Date(weekStart + 3 * 86400e3); d.setHours(0, 0, 0, 0);
  const thu = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const y = thu.getUTCFullYear(), w = Math.ceil(((thu.getTime() - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** The task estimator's backtest as a card: decisions = ended tasks that had an estimate, hit = the share that held
 *  (real time between half and double), weeks = its 8 weeks. */
export function fromTaskAccuracy(a: EstimateAccuracy | null | undefined): CardView {
  const points = a?.points ?? [];
  const withData = points.filter(p => p.n > 0);
  const last = withData[withData.length - 1];
  return {
    id: 'tasks', decisions: a?.n ?? 0, hit: { value: a?.hitRate ?? null, n: a?.n ?? 0 }, success: { value: null, n: 0 },
    avgCostUsd: null, spark: [], slices: [], compare: null, lastAt: null,
    weeks: points.map(p => ({ week: isoWeekOf(p.weekStart), decisions: p.n, hits: p.hitRate === null ? 0 : Math.round(p.hitRate * p.n), known: 0, ok: 0, avgCostUsd: null })),
    tasks: { specific: points.map(p => (p.n ? p.specificShare : null)), medianErr: last?.medianErr ?? null, lastSpecific: last?.specificShare ?? null },
  };
}

/** Every card in the page's order (a classifier main did not report gets an empty card, never a hidden one). */
export function cardViews(state: ClassifiersState | null, estimates: LearnPolicy | undefined, tasks?: EstimateAccuracy | null): CardView[] {
  const byId = new Map((state?.cards ?? []).map(c => [c.id, fromMain(c)]));
  return CARD_ORDER.map(id => (id === 'estimates' ? fromEstimates(estimates) : id === 'tasks' ? fromTaskAccuracy(tasks) : byId.get(id) ?? fromMain(emptyCard(id))));
}
export function emptyCard(id: ClassifierCardId): ClassifierCard {
  return { id, decisions: 0, hit: { value: null, n: 0 }, success: { value: null, n: 0 }, avgCostUsd: null, weeks: [], slices: [], compare: null, lastAt: null };
}

/** The weekly hit share (null: a week without decisions). */
export const hitSeries = (weeks: ClassifierWeek[]): (number | null)[] => weeks.map(w => (w.decisions ? w.hits / w.decisions : null));
export const successSeries = (weeks: ClassifierWeek[]): (number | null)[] => weeks.map(w => (w.known ? w.ok / w.known : null));
/** "2026-W42" → "W42" */
export const weekLabel = (w: string): string => w.replace(/^\d{4}-/, '');

/** Hit share of the first half of the weeks with data against the last half (null: under MIN_FACT on a side). */
export function hitTrend(weeks: ClassifierWeek[]): { before: number; after: number } | null {
  const full = weeks.filter(w => w.decisions > 0);
  if (full.length < 2) return null;
  const mid = Math.floor(full.length / 2), a = full.slice(0, mid), b = full.slice(mid);
  const sum = (xs: ClassifierWeek[], k: 'hits' | 'decisions') => xs.reduce((s, w) => s + w[k], 0);
  if (sum(a, 'decisions') < MIN_FACT || sum(b, 'decisions') < MIN_FACT) return null;
  return { before: sum(a, 'hits') / sum(a, 'decisions'), after: sum(b, 'hits') / sum(b, 'decisions') };
}

/** The advice a card can give, most useful first: each rests on at least MIN_FACT cases (or 10 per side of a
 *  comparison) and ends with what to do; a figure that leads to no action is not told (ADR 0101). */
export function facts(c: CardView, _sources: ClassifiersState['sources'] = []): string[] {
  const out: string[] = [];
  const total = c.slices.reduce((s, x) => s + x.count, 0);
  const priced = (other: string) => c.slices.filter(s => s.key !== other && s.avgCostUsd !== null && s.count >= 10).sort((a, b) => b.avgCostUsd! - a.avgCostUsd!);
  if (c.id === 'kind' && total >= MIN_FACT) {
    const other = c.slices.find(s => s.key === 'altro')?.count ?? 0;
    if (other / total >= 0.25) out.push(t('stats.fact.kindOther', { k: other, n: total }));
  }
  if (c.id === 'model' || c.id === 'jobkind') {
    const list = priced(c.id === 'model' ? '' : 'altro'), hi = list[0], lo = list[list.length - 1];
    if (hi && lo && hi !== lo && lo.avgCostUsd! > 0 && hi.avgCostUsd! / lo.avgCostUsd! >= 1.5) {
      const p = { hi: sliceLabel(c.id, hi.key), lo: sliceLabel(c.id, lo.key), x: num(hi.avgCostUsd! / lo.avgCostUsd!), nHi: hi.count, nLo: lo.count };
      out.push(c.id === 'model' ? t('stats.fact.modelCost', p) : t('stats.fact.jobCost', p));
    }
  }
  if (c.id === 'tasks' && c.hit.value !== null && c.hit.n >= MIN_FACT && c.hit.value < 0.5) out.push(t('stats.fact.taskLoose', { k: Math.round(c.hit.value * c.hit.n), n: c.hit.n }));
  return out;
}
