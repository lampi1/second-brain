// Pure view helpers of the Classificatori grid (owner, 2026-10-19: "card e statistiche per ciascuno, con spiegazione",
// "cose curiose che catturano l'attenzione e ti facciano capire a cosa servono"). One CardView per classifier: the
// four record-keeping ones from main (ClassifiersState.cards) and the estimates one from the brain's loop
// (/api/improve, LearnPolicy 'estimates'); the weekly hit series, the learning progress toward the 20 verified cases
// and the "curious facts", each built only from data and only above a minimum count (no fact from 2 cases). A value
// without data stays null ("nessun dato ancora"), never zero. No React, no IPC: unit-tested in
// test/unit/brain-ui/classifier-view.test.ts; used by components/brain-model/ClassifiersPage.tsx and ClassifierDetail.tsx.
import type { ClassifierCard, ClassifierCardId, ClassifierStat, ClassifierWeek, ClassifiersState } from '@shared/brain-model';
import { CLASSIFIER_NEED } from '@shared/brain-model';
import { roleName } from '@shared/roles';
import type { LearnPolicy } from '../brain/lib/learn';
import { t, locale } from '../i18n';
import { getKindIt } from './routing';
import { prettyModel } from './format';

export type CardId = ClassifierCardId | 'estimates';
export const CARD_ORDER: CardId[] = ['kind', 'model', 'skills', 'estimates', 'jobkind'];

export interface CardView {
  id: CardId;
  decisions: number;
  hit: ClassifierStat;
  success: ClassifierStat;
  avgCostUsd: number | null;
  threshold: number | null;
  /** weekly series (null: the classifier reports none, e.g. the estimates loop) */
  weeks: ClassifierWeek[] | null;
  /** the estimates loop's last typical errors (×), oldest first */
  spark: number[];
  slices: ClassifierCard['slices'];
  compare: ClassifierCard['compare'];
  lastAt: number | null;
  /** verified cases toward the calibration need */
  progress: { n: number; need: number };
  /** the estimates loop's own figures */
  estimates?: { typical: number | null; version: number | null; check: string | null; pending: boolean };
}

const MIN_FACT = 5; // no fact rests on fewer cases
const pctFmt = (v: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(v);
export const pctOf = (s: ClassifierStat): string | null => (s.value === null ? null : pctFmt(s.value));
const num = (v: number, d = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
const money = (v: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: v < 1 ? 2 : 2 }).format(v);
export const usdOf = (v: number | null): string | null => (v === null ? null : money(v));

/** The value a slice key stands for, in words. */
export function sliceLabel(id: CardId, key: string): string {
  if (id === 'kind') return (getKindIt() as Record<string, string>)[key] ?? key;
  if (id === 'model') return key === '—' ? t('stats.cls.defaultModel') : prettyModel(key);
  if (id === 'skills') return key || t('stats.cls.noSkill');
  if (id === 'jobkind') return JOB_KINDS.includes(key as JobKindKey) ? t(`stats.jk.${key as JobKindKey}`) : key;
  return key;
}
const JOB_KINDS = ['fix', 'qa', 'review', 'feature', 'research', 'question', 'other'] as const;
type JobKindKey = (typeof JOB_KINDS)[number];

/** Main's card as the page draws it. */
export function fromMain(c: ClassifierCard): CardView {
  const known = c.id === 'jobkind' ? c.hit.n : c.success.n;
  return { id: c.id, decisions: c.decisions, hit: c.hit, success: c.success, avgCostUsd: c.avgCostUsd, threshold: c.threshold, weeks: c.weeks, spark: [], slices: c.slices, compare: c.compare, lastAt: c.lastAt, progress: { n: known, need: CLASSIFIER_NEED } };
}

/** The estimates loop's policy as a card: decisions = estimates recorded, hit = how often the real value fell inside
 *  the estimated range (coverage), progress = measured items toward the loop's minimum. */
export function fromEstimates(p: LearnPolicy | undefined): CardView {
  const appliedAt = p?.appliedAt ? Date.parse(p.appliedAt) : NaN;
  return {
    id: 'estimates', decisions: p?.recorded.predictions ?? 0,
    hit: p?.coverage ? { value: p.coverage.rate, n: p.coverage.n } : { value: null, n: 0 },
    success: { value: null, n: 0 }, avgCostUsd: null, threshold: null, weeks: null, spark: p?.spark ?? [], slices: [], compare: null,
    lastAt: Number.isFinite(appliedAt) ? appliedAt : null,
    progress: { n: p?.n ?? 0, need: CLASSIFIER_NEED },
    estimates: { typical: p?.typical ?? null, version: p?.version ?? null, check: p?.lastCheck?.state ?? null, pending: !!p?.pending },
  };
}

/** Every card in the page's order (a classifier main did not report gets an empty card, never a hidden one). */
export function cardViews(state: ClassifiersState | null, estimates: LearnPolicy | undefined): CardView[] {
  const byId = new Map((state?.cards ?? []).map(c => [c.id, fromMain(c)]));
  return CARD_ORDER.map(id => (id === 'estimates' ? fromEstimates(estimates) : byId.get(id) ?? fromMain(emptyCard(id))));
}
export function emptyCard(id: ClassifierCardId): ClassifierCard {
  return { id, decisions: 0, hit: { value: null, n: 0 }, success: { value: null, n: 0 }, avgCostUsd: null, threshold: null, weeks: [], slices: [], compare: null, lastAt: null };
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

/** The curious facts a card can tell, most telling first; each needs at least MIN_FACT cases. */
export function facts(c: CardView, sources: ClassifiersState['sources'] = []): string[] {
  const out: string[] = [];
  const total = c.slices.reduce((s, x) => s + x.count, 0);
  const top = c.slices[0];
  const week = c.weeks?.[c.weeks.length - 1], prev = c.weeks?.[c.weeks.length - 2];
  if (c.id === 'kind') {
    const big = c.slices.find(s => s.key !== 'altro' && s.top && s.count >= MIN_FACT && s.top.count / s.count >= 0.5);
    if (big?.top) out.push(t('stats.fact.kindRole', { pct: pctFmt(big.top.count / big.count), kind: sliceLabel('kind', big.key), role: roleName(big.top.key) }));
    if (top && total >= MIN_FACT) out.push(t('stats.fact.kindTop', { pct: pctFmt(top.count / total), kind: sliceLabel('kind', top.key) }));
    const tr = c.weeks ? hitTrend(c.weeks) : null;
    if (tr && tr.after > tr.before + 0.02) out.push(t('stats.fact.kindLearns', { from: pctFmt(1 - tr.before), to: pctFmt(1 - tr.after) }));
    if (c.compare && c.compare.hit.n >= MIN_FACT && c.compare.miss.n >= 3) out.push(t('stats.fact.kindCompare', { hit: pctFmt(c.compare.hit.value!), miss: pctFmt(c.compare.miss.value!) }));
  }
  if (c.id === 'model') {
    const all = sources.reduce((s, x) => s + x.chats, 0), agent = sources.find(s => s.source === 'agent')?.chats ?? 0;
    if (all >= MIN_FACT && agent) out.push(t('stats.fact.modelAgent', { k: Math.round((agent / all) * 10), n: 10 }));
    const priced = c.slices.filter(s => s.avgCostUsd !== null && s.count >= 3).sort((a, b) => b.avgCostUsd! - a.avgCostUsd!);
    const hi = priced[0], lo = priced[priced.length - 1];
    if (hi && lo && hi !== lo && lo.avgCostUsd! > 0 && hi.avgCostUsd! / lo.avgCostUsd! >= 1.5) out.push(t('stats.fact.modelCost', { hi: sliceLabel('model', hi.key), lo: sliceLabel('model', lo.key), x: num(hi.avgCostUsd! / lo.avgCostUsd!) }));
    if (top && total >= MIN_FACT) out.push(t('stats.fact.modelTop', { pct: pctFmt(top.count / total), model: sliceLabel('model', top.key) }));
  }
  if (c.id === 'skills') {
    if (c.hit.n >= MIN_FACT && c.hit.value !== null) out.push(t('stats.fact.skillsHit', { k: Math.round(c.hit.value * 10), n: 10 }));
    if (week && week.decisions >= MIN_FACT) out.push(t('stats.fact.skillsWeek', { miss: week.decisions - week.hits, n: week.decisions }));
    if (c.compare && c.compare.hit.n >= MIN_FACT && c.compare.miss.n >= 3) out.push(t('stats.fact.skillsCompare', { hit: pctFmt(c.compare.hit.value!), miss: pctFmt(c.compare.miss.value!) }));
  }
  if (c.id === 'jobkind') {
    const priced = c.slices.filter(s => s.key !== 'other' && s.avgCostUsd !== null && s.count >= 3).sort((a, b) => b.avgCostUsd! - a.avgCostUsd!);
    const hi = priced[0], lo = priced[priced.length - 1];
    if (hi && lo && hi !== lo && lo.avgCostUsd! > 0) out.push(t('stats.fact.jobCost', { hi: sliceLabel('jobkind', hi.key), lo: sliceLabel('jobkind', lo.key), x: num(hi.avgCostUsd! / lo.avgCostUsd!) }));
    if (top && total >= MIN_FACT) out.push(t('stats.fact.jobTop', { pct: pctFmt(top.count / total), kind: sliceLabel('jobkind', top.key) }));
  }
  if (c.id === 'estimates') {
    if (c.hit.value !== null && c.hit.n >= MIN_FACT) out.push(t('stats.fact.estCover', { k: Math.round(c.hit.value * 10), n: 10 }));
    if (c.estimates?.typical != null && c.progress.n >= MIN_FACT) out.push(t('stats.fact.estTypical', { x: num(c.estimates.typical) }));
    if (c.estimates?.check === 'migliorata' && c.estimates.version !== null) out.push(t('stats.fact.estBetter', { v: c.estimates.version }));
  }
  if (week && prev && week.decisions + prev.decisions >= MIN_FACT && c.id !== 'skills') {
    const d = week.decisions - prev.decisions;
    out.push(d === 0 ? t('stats.fact.weekSame', { n: week.decisions }) : t('stats.fact.weekDelta', { n: week.decisions, d: Math.abs(d), more: d > 0 }));
  }
  return out;
}

/** The progress meter's state: learning (under the need), ready (enough to calibrate), or idle (no case at all). */
export function progressState(c: CardView): 'idle' | 'learning' | 'ready' {
  return c.progress.n === 0 ? 'idle' : c.progress.n >= c.progress.need ? 'ready' : 'learning';
}
