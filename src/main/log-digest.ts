// The logs' daily digest (ADR 0192): one small zero-token summary per finished day, kept DIGEST_KEEP_DAYS (90), so a
// «Manutenzione» clicked after three weeks still sees the days whose raw files are gone (technical logs keep 14 days,
// log.ts; the Log page's journal 7, activity/journal.ts). Per day: lines per level, the warn/error groups (scope | msg |
// cause folded like the maintenance log step, groupKey) and the busiest info groups, the main-process stalls (count and
// worst ms), the slow-typing reports, the interface errors (scope `renderer`, ADR 0192) and the journal's events per
// kind. One JSON line per day in <userData>/logs/digest-YYYY-MM.jsonl, written at start for the past days not yet
// summarized and again at each day's rollover (log.ts housekeep), always before the raw files of that day may be
// deleted. Each line is bounded (DIGEST_LINE_MAX). Reads stream the files line by line (async: a big day never freezes
// the window). Imports no app module but fs (log.ts imports it). Used by log.ts (build, rotation),
// brainmodel/log-scan.ts (groups of days whose raw file is gone), brainmodel/research.ts (the pack's digest section) and
// activity/wiring.ts (the journal keeps a day until it is summarized); tests: test/unit/log-digest.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const DIGEST_KEEP_DAYS = 90;
/** The journal's folder under userData (activity/journal.ts), read here without importing it (journal imports log). */
export const JOURNAL_DIR = 'activity';
const LOG_FILE = /^app-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const JOURNAL_FILE = /^log-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DIGEST_FILE = /^digest-(\d{4}-\d{2})\.jsonl$/;
const DAY = 864e5;
/** Groups kept per day: warn/error first, then the busiest info ones. */
const GROUPS_ISSUES = 60, GROUPS_INFO = 15, UI_GROUPS = 20;
/** One day's line never passes this many bytes (groups are dropped from the tail until it fits). */
export const DIGEST_LINE_MAX = 32_000;

const fold = (s: string): string => s.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 200);
/** The key of a log group: scope | msg | cause with the numbers folded (a pid, an id, a count), so one problem is one group. */
export const groupKey = (scope: string, msg: string, cause: string): string => `${scope} | ${fold(msg)} | ${fold(cause)}`;

type Lvl = 'debug' | 'info' | 'warn' | 'error';
export interface DigestGroup { key: string; lvl: Lvl; scope: string; msg: string; cause: string; count: number }
export interface DigestDay {
  /** YYYY-MM-DD: the technical log's day (UTC, its file name) and the journal's (local) */
  day: string;
  v: 1;
  levels: Record<Lvl, number>;
  /** warn/error groups (all of them up to GROUPS_ISSUES) and the busiest info groups, worst first */
  groups: DigestGroup[];
  /** groups left out by the caps */
  more?: number;
  /** distinct agent runs named in the day's lines (log Entry.run) */
  runs: number;
  /** main process blocked (perf.ts): stalls counted (the ones folded into a minute's line too) and the worst */
  perf: { stalls: number; maxMs: number; slowTyping: number };
  /** interface errors (scope renderer): how many and their groups */
  ui: { errors: number; groups: { key: string; msg: string; count: number }[] };
  /** the Log page's journal of that day: events per kind and per level; null = its file was already gone */
  journal: { events: number; kinds: Record<string, number>; warn: number; error: number } | null;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The first day not over yet: the earlier of today in UTC (log files) and today here (journal files). */
export const openDay = (now: number): string => { const a = ymd(now), b = localDay(now); return a < b ? a : b; };
const cutoff = (now: number) => ymd(now - DIGEST_KEEP_DAYS * DAY);

async function eachLine(file: string, fn: (line: string) => void): Promise<boolean> {
  let stream: fs.ReadStream;
  try { await fs.promises.access(file); stream = fs.createReadStream(file, { encoding: 'utf8' }); } catch { return false; }
  try {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) if (line) fn(line);
    return true;
  } catch { return false; } finally { stream.destroy(); }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One day's digest from its files (either may be missing). Pure but for the reads. */
export async function digestDay(logDir: string, journalDir: string | null, day: string): Promise<DigestDay> {
  const levels: Record<Lvl, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  const groups = new Map<string, DigestGroup>(), ui = new Map<string, { key: string; msg: string; count: number }>(), runs = new Set<string>();
  const perf = { stalls: 0, maxMs: 0, slowTyping: 0 };
  let uiErrors = 0;
  await eachLine(path.join(logDir, `app-${day}.jsonl`), line => {
    let e: { lvl?: unknown; scope?: unknown; msg?: unknown; cause?: unknown; run?: unknown; data?: unknown };
    try { e = JSON.parse(line) as typeof e; } catch { return; }
    const lvl = (['debug', 'info', 'warn', 'error'] as const).find(l => l === e.lvl);
    if (!lvl) return;
    levels[lvl]++;
    const scope = String(e.scope ?? ''), msg = String(e.msg ?? ''), cause = typeof e.cause === 'string' ? e.cause : '';
    if (typeof e.run === 'string') runs.add(e.run);
    if (scope === 'perf' && msg === 'main process blocked') {
      const d = (e.data ?? {}) as Record<string, unknown>;
      perf.stalls += 1 + num(d.sinceLast);
      perf.maxMs = Math.max(perf.maxMs, num(d.ms), num(d.worstSinceLast));
    } else if (scope === 'perf' && msg === 'input lag' && lvl === 'warn') perf.slowTyping++;
    if (scope === 'renderer' && (lvl === 'error' || lvl === 'warn')) {
      uiErrors++;
      const k = groupKey(scope, msg, cause), g = ui.get(k);
      if (g) g.count++; else ui.set(k, { key: k, msg: msg.slice(0, 200), count: 1 });
    }
    if (lvl === 'debug') return;
    const key = groupKey(scope, msg, cause), g = groups.get(key);
    if (g) { g.count++; if (lvl === 'error' || (lvl === 'warn' && g.lvl === 'info')) g.lvl = lvl; return; }
    groups.set(key, { key, lvl, scope, msg: msg.slice(0, 200), cause: cause.slice(0, 300), count: 1 });
  });
  let journal: DigestDay['journal'] = null;
  if (journalDir) {
    const j = { events: 0, kinds: {} as Record<string, number>, warn: 0, error: 0 };
    const seen = await eachLine(path.join(journalDir, `log-${day}.jsonl`), line => {
      let e: { kind?: unknown; level?: unknown };
      try { e = JSON.parse(line) as typeof e; } catch { return; }
      j.events++;
      const kind = typeof e.kind === 'string' ? e.kind.slice(0, 40) : '?';
      j.kinds[kind] = (j.kinds[kind] ?? 0) + 1;
      if (e.level === 'warn') j.warn++; else if (e.level === 'error') j.error++;
    });
    if (seen) journal = j;
  }
  const rank = (g: DigestGroup) => (g.lvl === 'error' ? 0 : g.lvl === 'warn' ? 1 : 2);
  const all = [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count);
  const issues = all.filter(g => g.lvl === 'warn' || g.lvl === 'error'), info = all.filter(g => g.lvl === 'info');
  const kept = [...issues.slice(0, GROUPS_ISSUES), ...info.slice(0, GROUPS_INFO)];
  const out: DigestDay = {
    day, v: 1, levels, groups: kept, runs: runs.size, perf,
    ui: { errors: uiErrors, groups: [...ui.values()].sort((a, b) => b.count - a.count).slice(0, UI_GROUPS) }, journal,
  };
  const more = all.length - kept.length;
  if (more > 0) out.more = more;
  // bounded: drop groups from the tail until the line fits
  while (JSON.stringify(out).length > DIGEST_LINE_MAX && out.groups.length) { out.groups.pop(); out.more = (out.more ?? 0) + 1; }
  return out;
}

/** Every digested day in `logDir` (oldest first), the ones older than DIGEST_KEEP_DAYS left out. */
export function readDigest(logDir: string, now = Date.now()): DigestDay[] {
  const from = cutoff(now), out = new Map<string, DigestDay>();
  let names: string[] = [];
  try { names = fs.readdirSync(logDir).filter(f => DIGEST_FILE.test(f)).sort(); } catch { return []; }
  for (const name of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(logDir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { const d = JSON.parse(line) as DigestDay; if (d && typeof d.day === 'string' && d.day >= from && Array.isArray(d.groups)) out.set(d.day, d); } catch { /* cut line */ }
    }
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The days already summarized (a cheap read for the journal's keep rule). */
export function digestedDays(logDir: string, now = Date.now()): Set<string> {
  return new Set(readDigest(logDir, now).map(d => d.day));
}

/** Summarizes every finished day that has a log or journal file and no digest line yet, within DIGEST_KEEP_DAYS; then
 *  deletes the digest months entirely past DIGEST_KEEP_DAYS. Returns the days written. Never throws. */
export async function updateDigest(logDir: string, journalDir: string | null, now = Date.now()): Promise<string[]> {
  const written: string[] = [];
  try {
    const open = openDay(now), from = cutoff(now), done = digestedDays(logDir, now);
    const days = new Set<string>();
    const scan = (dir: string | null, re: RegExp) => { if (!dir) return; try { for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m) days.add(m[1]!); } } catch { /* no folder */ } };
    scan(logDir, LOG_FILE); scan(journalDir, JOURNAL_FILE);
    for (const day of [...days].sort()) {
      if (day >= open || day < from || done.has(day)) continue;
      const d = await digestDay(logDir, journalDir, day);
      try { fs.appendFileSync(path.join(logDir, `digest-${day.slice(0, 7)}.jsonl`), `${JSON.stringify(d)}\n`); written.push(day); } catch { /* disk full: next start retries */ }
    }
    for (const f of fs.readdirSync(logDir)) {
      const m = DIGEST_FILE.exec(f);
      if (m && `${m[1]}-31` < from) try { fs.unlinkSync(path.join(logDir, f)); } catch { /* in use */ }
    }
  } catch { /* the digest never breaks the log */ }
  return written;
}
