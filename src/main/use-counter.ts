// The usage counter (ADR 0202; report «Cosa tenere» A0): how many times a day the user opened each page (and tab) and
// used each main action, so keeping or cutting a feature rests on numbers, not guesses. Zero tokens, local only: the
// counts live in userData/app.db (area `use_counts`, one row per day and key, ADR 0199), are kept 90 days and never
// leave the machine (no network, no log line with them, no agent but the Orchestrator's app_guide reading a summary).
// The renderer batches its counts (renderer/lib/use-counter.ts) and sends them with 'usecount:add'; Andamento → Uso reads
// 'usecount:report'. If the database cannot be opened the counts stay in memory for this session (said once in the log).
// One instance per process (`useCounts`), initialised by index.ts; read by ipc-handlers/app.ts and appctl/guide.ts.
// Tests: test/unit/use-counter.test.ts.
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { UseCountReport, UseCountRow } from '../shared/contract';
import { APP_DB, migrate, openAppDb, reopenAppDb, tx, type Migration } from './app-db';
import { errText, log } from './log';

export const AREA = 'use_counts';
/** Days kept: older rows are deleted at open and once a day. */
export const KEEP_DAYS = 90;
/** Days shown by default (Andamento → Uso, app_guide). */
export const SHOW_DAYS = 14;
/** A key: "page:<id>[/<tab>]" or "action:<name>"; lowercase words, digits, '-', '_', '.', one '/' level or two. */
export const KEY_RE = /^(page|action):[a-z0-9][a-z0-9_.-]{0,40}(\/[a-z0-9][a-z0-9_.-]{0,40}){0,2}$/;
/** At most this many keys in one batch and this many uses of one key in one batch: a broken page cannot flood the table. */
export const MAX_KEYS = 200;
export const MAX_N = 1000;

export const USE_STEPS: readonly Migration[] = [
  db => db.exec('create table use_counts(day text not null, key text not null, n integer not null, primary key(day, key))'),
];

/** The local calendar day of `ms` (YYYY-MM-DD): a day is the user's day, not UTC's. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The local day `n` days before `ms`'s. */
const dayBefore = (ms: number, n: number): string => { const d = new Date(ms); d.setDate(d.getDate() - n); return localDay(d.getTime()); };

/** The batch as stored: known key shapes only, whole counts from 1 to MAX_N, at most MAX_KEYS keys. */
export function cleanCounts(a: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const counts = a && typeof a === 'object' ? (a as { counts?: unknown }).counts : undefined;
  if (!counts || typeof counts !== 'object') return out;
  for (const [k, v] of Object.entries(counts as Record<string, unknown>)) {
    if (out.size >= MAX_KEYS) break;
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_N, Math.floor(v)) : 0;
    if (n >= 1 && KEY_RE.test(k)) out.set(k, n);
  }
  return out;
}

interface Row { day: string; key: string; n: number }

export class UseCounter {
  private db: DatabaseSync | null = null;
  private file: string | null = null;
  /** the counts when there is no database (not initialised yet, the demo, a database that would not open) */
  private mem = new Map<string, number>(); // "<day>\t<key>" → n
  private prunedOn = '';
  private now: () => number = Date.now;

  /** `userData` null = memory only (the demo, tests); `seed` = rows to start from (the demo's fake weeks). */
  init(o: { userData: string | null; now?: () => number; seed?: readonly Row[] }): void {
    this.close();
    this.mem.clear();
    this.prunedOn = '';
    if (o.now) this.now = o.now;
    for (const r of o.seed ?? []) this.mem.set(`${r.day}\t${r.key}`, (this.mem.get(`${r.day}\t${r.key}`) ?? 0) + r.n);
    this.file = o.userData ? path.join(o.userData, APP_DB) : null;
  }

  /** Opened at first use: the agent runs' store has opened (and checked) app.db at start by then. */
  private open(): DatabaseSync | null {
    if (!this.file) return null;
    if (this.db?.isOpen) return this.db;
    try {
      this.db = this.db ? reopenAppDb(this.file) : openAppDb(this.file).db;
      migrate(this.db, AREA, USE_STEPS);
      return this.db;
    } catch (e) {
      log.error('app', 'usage counter database not opened', { cause: errText(e), hint: 'the page and action counts stay in memory until the app quits; nothing else is affected' });
      this.file = null; // once: the rest of the session counts in memory
      this.db = null;
      return null;
    }
  }

  private prune(db: DatabaseSync | null): void {
    const today = localDay(this.now());
    if (this.prunedOn === today) return;
    this.prunedOn = today;
    const cutoff = dayBefore(this.now(), KEEP_DAYS - 1);
    if (db) { db.prepare('delete from use_counts where day < ?').run(cutoff); return; }
    for (const k of [...this.mem.keys()]) if (k.slice(0, 10) < cutoff) this.mem.delete(k);
  }

  /** Adds one batch to today's counts (one transaction). Bad keys and counts are dropped (cleanCounts). */
  add(a: unknown): void {
    const counts = cleanCounts(a);
    if (!counts.size) return;
    const day = localDay(this.now());
    const db = this.open();
    if (db) {
      try {
        tx(db, () => {
          const up = db.prepare('insert into use_counts(day, key, n) values(?, ?, ?) on conflict(day, key) do update set n = n + excluded.n');
          for (const [k, n] of counts) up.run(day, k, n);
        });
        this.prune(db);
        return;
      } catch (e) {
        log.error('app', 'usage counts not saved', { cause: errText(e), hint: 'this batch is kept in memory; the next batches try the database again' });
      }
    }
    for (const [k, n] of counts) this.mem.set(`${day}\t${k}`, (this.mem.get(`${day}\t${k}`) ?? 0) + n);
    if (!db) this.prune(null);
  }

  /** Every row from `from` on (the database's and the memory's together). */
  private rows(from: string): Row[] {
    const out: Row[] = [];
    const db = this.open();
    if (db) {
      try { out.push(...(db.prepare('select day, key, n from use_counts where day >= ?').all(from) as unknown as Row[]).map(r => ({ day: String(r.day), key: String(r.key), n: Number(r.n) }))); } catch (e) {
        log.error('app', 'usage counts not read', { cause: errText(e), hint: 'Andamento → Uso shows only this session\'s counts' });
      }
    }
    for (const [k, n] of this.mem) { const [day = '', key = ''] = k.split('\t'); if (day >= from) out.push({ day, key, n }); }
    return out;
  }

  private firstDay(): string | null {
    let first: string | null = null;
    const db = this.open();
    if (db) { try { first = (db.prepare('select min(day) d from use_counts').get() as { d: string | null } | undefined)?.d ?? null; } catch { /* the report says «nessun dato» */ } }
    for (const k of this.mem.keys()) { const d = k.slice(0, 10); if (!first || d < first) first = d; }
    return first;
  }

  /** The last `days` days (today included): per key its total, on how many days, last day; per day the total. */
  report(days = SHOW_DAYS): UseCountReport {
    const n = Math.max(1, Math.min(KEEP_DAYS, Math.floor(Number(days) || SHOW_DAYS)));
    const now = this.now(), to = localDay(now), from = dayBefore(now, n - 1);
    const per = new Map<string, { n: number; days: Set<string>; last: string }>();
    const perDay = new Map<string, number>();
    let total = 0;
    for (const r of this.rows(from)) {
      const e = per.get(r.key) ?? { n: 0, days: new Set<string>(), last: '' };
      e.n += r.n; e.days.add(r.day); if (r.day > e.last) e.last = r.day;
      per.set(r.key, e);
      perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.n);
      total += r.n;
    }
    const byDay: { day: string; n: number }[] = [];
    for (let i = n - 1; i >= 0; i--) { const day = dayBefore(now, i); byDay.push({ day, n: perDay.get(day) ?? 0 }); }
    const rows: UseCountRow[] = [...per].map(([key, e]) => ({ key, n: e.n, days: e.days.size, last: e.last }))
      .sort((a, b) => b.n - a.n || b.days - a.days || a.key.localeCompare(b.key));
    return { from, to, days: n, total, since: this.firstDay(), byDay, rows };
  }

  /** The report in a few lines for the Orchestrator (app_guide): the most and the least used, never anything else. */
  summary(days = SHOW_DAYS): string {
    const r = this.report(days);
    if (!r.total) return `No use counted in the last ${r.days} days${r.since ? '' : ' (the counter has no data yet)'}. Open: app_ui page andamento/uso.`;
    const line = (x: UseCountRow) => `${x.key.replace(/^page:/, 'page ').replace(/^action:/, 'action ')} ${x.n}× on ${x.days} d`;
    const top = r.rows.slice(0, 12).map(line).join('; ');
    const rare = r.rows.length > 12 ? ` Least used: ${r.rows.slice(-5).map(line).join('; ')}.` : '';
    return `Local usage counter, ${r.from} → ${r.to}${r.since && r.since > r.from ? ` (counting since ${r.since})` : ''}: ${r.total} uses. Most used: ${top}.${rare} A page never opened is absent. Open: app_ui page andamento/uso.`;
  }

  close(): void {
    try { if (this.db?.isOpen) this.db.close(); } catch { /* already closed */ }
    this.db = null;
  }
}

/** The app's one counter (index.ts initialises it with userData). */
export const useCounts = new UseCounter();

/** Two weeks of plausible use for the demo (memory only, never written): the Uso tab and the screenshots have data. */
export function demoUseCounts(now: number): Row[] {
  const plan: [string, number][] = [
    ['page:home', 14], ['action:orchestrator', 9], ['page:memoria/proposte', 6], ['action:new-request', 5], ['page:task', 5],
    ['action:discuss', 3], ['page:andamento/costi', 3], ['page:impara', 2], ['page:log', 2], ['action:dictation', 2],
    ['page:memoria/skill', 1], ['page:andamento/qualita', 1], ['action:next-thing', 2], ['page:registrazioni', 1], ['page:guida', 1],
  ];
  const out: Row[] = [];
  for (let i = 0; i < SHOW_DAYS; i++) {
    const day = dayBefore(now, i), weekend = new Date(`${day}T12:00:00`).getDay() % 6 === 0;
    for (const [j, [key, base]] of plan.entries()) {
      const n = Math.round(base * (weekend ? 0.3 : 1) * (0.6 + ((i * 7 + j * 3) % 9) / 10));
      if (n > 0) out.push({ day, key, n });
    }
  }
  out.push({ day: dayBefore(now, 9), key: 'page:andamento/classificatori', n: 1 });
  return out;
}
