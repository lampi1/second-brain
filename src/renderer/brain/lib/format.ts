// Number and date formatting for the brain pages (Italian locale): money, integers, thousands, days, "x min fa".
// Pure functions (no DOM), unit-tested in test/unit/brain-ui/format.test.ts. Dates of the brain are local calendar days
// "AAAA-MM-GG"; day arithmetic is done at noon so a DST change never shifts a day.

import { locale, t } from '../../i18n';

const it = (v: number, digits: number) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmt = {
  /** 1,84 $ under 10 $, 38 $ above (list-price estimates: the decimals stop mattering) */
  usd(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    return `${it(v, Math.abs(v) < 10 ? 2 : 0)} $`;
  },
  int(v: number | null | undefined): string { return v == null || !Number.isFinite(v) ? '' : Math.round(v).toLocaleString(locale()); },
  /** 704k, 1,2M */
  k(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })}M`;
    if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}k`;
    return String(Math.round(v));
  },
  pct(a: number, b: number): number { return b ? Math.round((a / b) * 100) : 0; },
  /** "sab 11/10" */
  day(s: string | null | undefined): string {
    const d = dayDate(s);
    return d ? d.toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' }) : String(s ?? '');
  },
  /** "sabato 11 ottobre" */
  dayLong(s: string | null | undefined): string {
    const d = dayDate(s);
    return d ? d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : String(s ?? '');
  },
  /** "11/10, 14:08" from an ISO string or ms */
  when(t: string | number | null | undefined): string {
    if (t == null || t === '') return '';
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  time(t: number): string { return new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }); },
  ago(t: string | number | null | undefined, now = Date.now()): string {
    if (t == null || t === '') return '';
    const ms = typeof t === 'number' ? t : new Date(t).getTime();
    if (!Number.isFinite(ms)) return '';
    return minutesAgo(Math.floor((now - ms) / 6e4));
  },
};

export function minutesAgo(m: number): string {
  if (m < 1) return t('costs.now');
  if (m < 60) return t('costs.minutesAgo',{count:m});
  if (m < 1440) return t('costs.hoursAgo',{count:Math.round(m/60)});
  const d = Math.round(m / 1440);
  return d === 1 ? t('costs.yesterday') : t('costs.daysAgo',{count:d});
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function dayDate(s: string | null | undefined): Date | null {
  const m = DAY_RE.exec(String(s ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
export function isDay(s: unknown): s is string { return typeof s === 'string' && DAY_RE.test(s); }

/** Local calendar day of a time ("AAAA-MM-GG"). */
export function ymd(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day `delta` days after `day`. */
export function shiftDay(day: string, delta: number): string {
  const d = dayDate(day);
  if (!d) return day;
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

/** Whole days from `day` to `today` (both "AAAA-MM-GG"); NaN when unreadable. */
export function daysBetween(day: string, today: string): number {
  const a = dayDate(day), b = dayDate(today);
  return a && b ? Math.round((b.getTime() - a.getTime()) / 864e5) : NaN;
}

/** "oggi" / "ieri" / "5 giorni fa" for a day, and a tone: green ≤ 3 days, amber ≤ 7, red beyond. */
export function dayAge(day: string, today: string): { label: string; tone: 'good' | 'warn' | 'bad' } | null {
  const n = daysBetween(day, today);
  if (!Number.isFinite(n)) return null;
  const label = n <= 0 ? t('costs.today').toLocaleLowerCase(locale()) : n === 1 ? t('costs.yesterday') : t('costs.daysAgo',{count:n});
  return { label, tone: n > 7 ? 'bad' : n > 3 ? 'warn' : 'good' };
}

/** "Oggi" / "Ieri" / "sab 11/10" relative to today. */
export function dayName(day: string, today: string): string {
  const n = daysBetween(day, today);
  return n === 0 ? t('costs.today') : n === 1 ? t('costs.yesterday').replace(/^./, letter => letter.toLocaleUpperCase(locale())) : fmt.day(day);
}
