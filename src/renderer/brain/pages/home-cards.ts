// Home's small card registry: validated projections over the same read models as the detail pages, with no I/O.
import { normCost, normTables } from '../types';
import { ruleStats } from '../lib/quality';
import { errorPatterns } from '../lib/stats';
import { locale, t } from '../../i18n';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function homeCost(v: unknown) {
  const o = record(v);
  return finite(o.total) && finite(o.calls) && date(o.from) && date(o.to) ? normCost(v) : null;
}
export function homeTables(v: unknown) {
  const o = record(v), q = record(o.quality);
  return {
    tables: normTables(v),
    ideasKnown: Array.isArray(o.ideas) && o.ideas.every(x => typeof record(x).stato === 'string'),
    errorsKnown: Array.isArray(o.errors) && o.errors.every(x => date(record(x).data)),
    rulesKnown: Array.isArray(q.rules) && q.rules.every(x => ['tornato', 'non-tornato', 'troppo-presto', 'senza-tipo'].includes(String(record(x).status))) && finite(q.windowDays) && date(q.from) && date(q.to),
  };
}
export interface HomeData { cost: ReturnType<typeof homeCost>; tables: ReturnType<typeof homeTables> | null }
export interface HomeReading { value: string; explanation: string; source: string }
interface HomeCard { id: string; title: () => string; target: string; read: (data: HomeData) => HomeReading | null }
export const HOME_CARDS: readonly HomeCard[] = [
  { id: 'spend', title: () => t('home.spend'), target: 'costi/7', read: ({ cost }) => cost ? {
    value: new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD' }).format(cost.total),
    explanation: t('home.spendReading', { calls: cost.calls }), source: `${cost.from} – ${cost.to} · /api/cost?days=7`,
  } : null },
  { id: 'works', title: () => t('home.works'), target: 'qualita', read: ({ tables: d }) => {
    const q = d?.tables.quality;
    if (!d?.rulesKnown || !q) return null;
    const r = ruleStats(q);
    return { value: r.judged ? `${r.nonTornato}/${r.judged}` : '—',
      explanation: r.judged ? t('home.rulesReading', { days: q.windowDays, pending: r.presto + r.senzaTipo }) : t('home.noRules'),
      source: `${q.from} – ${q.to} · ai-errors.md` };
  } },
  { id: 'errors', title: () => t('home.errors'), target: 'qualita', read: ({ tables: d }) => {
    if (!d?.errorsKnown || !date(d.tables.today)) return null;
    const p = errorPatterns(d.tables.errors, d.tables.quality?.rules ?? [], d.tables.today, '');
    return { value: String(p.recurring.length + p.quiet.length), explanation: t('home.errorsReading', { count: d.tables.errors.length, unknown: p.unknown.length }), source: `${t('home.registeredThrough')} ${d.tables.today} · ai-errors.md` };
  } },
  { id: 'ideas', title: () => t('home.ideas'), target: 'idee', read: ({ tables: d }) => d?.ideasKnown ? {
    value: String(d.tables.ideas.filter(x => x.stato === 'aperta').length),
    explanation: t('home.ideasReading', { active: d.tables.ideas.filter(x => x.stato === 'in corso').length }), source: 'ideas.md · /api/tables',
  } : null },
];
