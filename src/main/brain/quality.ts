// The app's half of the Qualità page (/api/quality, answered by main, not by the brain's server): what only the app
// knows. Turns: the finished turns of the chats run in this app, per Rome day, from its own logs ('turn done' of Claude,
// 'acp turn done' with engine cursor, earlier 'cursor turn done', of Cursor; the logs keep 14 days), the denominator of
// "errors you had to catch per 100 turns".
// PRs: the user's active PRs at the last DevOps read (tasks/service.ts) that a failed build or QA holds (a linked
// test case Failed/Blocked, a reviewer's "rifiutata" or "in attesa dell'autore"). Reopened bugs: the brain's
// read-only ops/tools/bug-reopen.mjs (his resolved bugs sent back to an open state), run in the background at most every
// 12 h while DevOps reading is on, its last result kept in userData/quality-reopen.json. Why: the user, 2026-10-13, "la
// sezione qualità sia veramente utile e veritiera": few numbers, each with its source and dates. Pure parts exported
// for test/unit/brain/quality.test.ts; wired in wiring.ts through brain.serveApi.
import fs from 'node:fs';
import path from 'node:path';
import type { AppQuality, DevopsDetail, DevopsPr, QualityPrBlock } from '../../shared/contract';
import type { RunResult } from './node';
import { log, errText } from '../log';

export const REOPEN_SCRIPT = 'ops/tools/bug-reopen.mjs';
export const REOPEN_TTL_MS = 12 * 3600e3;
/** after a failed read (az login expired…), wait this long before trying again: a page open never spawns a read each time */
export const REOPEN_RETRY_MS = 10 * 60e3;
const REOPEN_DAYS = 90;

const romeDay = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

/** JSONL log lines → finished turns per Rome day, oldest first. Unreadable lines are skipped. */
export function turnsByDay(lines: Iterable<string>): AppQuality['turns']['byDay'] {
  const m = new Map<string, { date: string; claude: number; cursor: number }>();
  for (const l of lines) {
    if (!l.includes('turn done')) continue;
    let e: { t?: unknown; msg?: unknown; data?: { engine?: unknown } };
    try { e = JSON.parse(l) as typeof e; } catch { continue; }
    // 'cursor turn done' = Cursor's line before the ACP adapter was shared (ADR 0046); now 'acp turn done' + data.engine
    const cursorTurn = e.msg === 'cursor turn done' || (e.msg === 'acp turn done' && e.data?.engine === 'cursor');
    const kind = e.msg === 'turn done' ? 'claude' : cursorTurn ? 'cursor' : null;
    const t = typeof e.t === 'string' ? Date.parse(e.t) : NaN;
    if (!kind || Number.isNaN(t)) continue;
    const d = romeDay(t);
    const row = m.get(d) ?? { date: d, claude: 0, cursor: 0 };
    row[kind]++;
    m.set(d, row);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Why a PR is held: a failed build, a linked test case Failed/Blocked, a reviewer (not its author) who rejected it or
 *  waits for the author. [] = not held. */
export function prReasons(pr: DevopsPr, details: Record<string, DevopsDetail>): string[] {
  const out: string[] = [];
  const b = pr.build?.result;
  if (b === 'failed') out.push('build fallita');
  else if (b === 'partiallySucceeded') out.push('build parzialmente fallita');
  for (const wi of pr.workItems) {
    for (const t of details[String(wi.id)]?.tests ?? []) {
      if (t.outcome === 'Failed') out.push(`test case fallito: ${t.title}`);
      else if (t.outcome === 'Blocked') out.push(`test case bloccato: ${t.title}`);
    }
  }
  for (const r of pr.reviewers) {
    if (r.name === pr.author) continue;
    if (r.vote === -10) out.push(`rifiutata da ${r.name}`);
    else if (r.vote === -5) out.push(`${r.name} aspetta tue modifiche`);
  }
  return [...new Set(out)];
}

export function prBlocks(prs: DevopsPr[], details: Record<string, DevopsDetail>): QualityPrBlock[] {
  return prs.map(pr => ({ id: pr.id, title: pr.title, repo: pr.repo, url: pr.url, reasons: prReasons(pr, details) })).filter(p => p.reasons.length);
}

type Reopen = AppQuality['reopen'];
const EMPTY_REOPEN: Reopen = { at: null, days: REOPEN_DAYS, resolved: 0, reopened: 0, bugs: [], error: null, refreshing: false };
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const a = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : []);

/** bug-reopen.mjs --json output (or the cache) → the page's shape; links only https. Throws on non-JSON. */
export function parseReopen(text: string): Omit<Reopen, 'error' | 'refreshing'> {
  const o = JSON.parse(text) as Record<string, unknown>;
  return {
    at: s(o.at) || null, days: n(o.days) || REOPEN_DAYS, resolved: n(o.resolved), reopened: n(o.reopened),
    bugs: a(o.bugs).map(b => ({ id: n(b.id), title: s(b.title), state: s(b.state), url: /^https:\/\//.test(s(b.url)) ? s(b.url) : '',
      reopened: a(b.reopened).map(r => ({ resolvedAt: s(r.resolvedAt), reopenedAt: s(r.reopenedAt), by: s(r.by), to: s(r.to) })) })),
  };
}

/** A failed run → one Italian line (login expired says what to run). */
export function reopenError(r: RunResult): string {
  const text = `${r.stderr}\n${r.error ?? ''}`;
  if (r.code === 2 || /az login|get-access-token|expired/i.test(text)) return 'Accesso ad Azure DevOps scaduto: lancia «az login» in un terminale, poi Aggiorna.';
  return `lettura dei bug riaperti fallita: ${(r.stderr || r.error || `uscita ${r.code}`).trim().slice(0, 200)}`;
}

export interface QualityDeps {
  logDir: string;
  cacheFile: string;                                                   // userData/quality-reopen.json
  brainRoot: () => string | null;
  tasks: () => { at: number | null; prs: DevopsPr[]; details: Record<string, DevopsDetail>; error: { message: string } | null; enabled: boolean };
  run: (script: string, args: string[], cwd: string, timeoutMs: number) => Promise<RunResult>;
  now?: () => number;
}

export class Quality {
  private running: Promise<void> | null = null;
  private lastError: string | null = null;
  private failedAt = 0;
  private readonly now: () => number;
  constructor(private readonly d: QualityDeps) { this.now = d.now ?? Date.now; }

  private turns(): AppQuality['turns'] {
    let files: string[] = [];
    try { files = fs.readdirSync(this.d.logDir).filter(f => /^app-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { /* no logs yet */ }
    const lines: string[] = [];
    for (const f of files) { try { lines.push(...fs.readFileSync(path.join(this.d.logDir, f), 'utf8').split('\n')); } catch { /* rotated away */ } }
    const byDay = turnsByDay(lines);
    // the covered range is the log files' days (a day with no turns still counts as covered)
    // files are UTC days, turns Rome days: the oldest file misses the first Rome hours of its day (they were in the
    // deleted file before it), so with older files gone the covered range starts the day after; it ends at the last turn
    const day = (f: string) => f.slice(4, 14);
    const next = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const from = files.length > 1 ? next(day(files[0]!)) : files[0] ? day(files[0]) : null;
    const last = files.at(-1) ? day(files.at(-1)!) : null;
    const to = last && byDay.at(-1) && byDay.at(-1)!.date > last ? byDay.at(-1)!.date : last;
    return { from, to, byDay: from ? byDay.filter(d => d.date >= from) : byDay };
  }

  private cached(): Omit<Reopen, 'error' | 'refreshing'> | null {
    try { return parseReopen(fs.readFileSync(this.d.cacheFile, 'utf8')); } catch { return null; }
  }

  /** Starts a background read when the cache is older than 12 h (DevOps reading on, script present); never waits for it. */
  private maybeRefresh(cache: Omit<Reopen, 'error' | 'refreshing'> | null, fresh: boolean): void {
    if (this.running || !this.d.tasks().enabled) return;
    const age = cache?.at ? this.now() - Date.parse(cache.at) : Infinity;
    if (!fresh && (age < REOPEN_TTL_MS || this.now() - this.failedAt < REOPEN_RETRY_MS)) return;
    const root = this.d.brainRoot();
    const script = root ? path.join(root, REOPEN_SCRIPT) : null;
    if (!root || !script || !fs.existsSync(script)) { this.lastError = `nel brain manca ${REOPEN_SCRIPT}`; return; }
    this.running = this.d.run(script, ['--json', '--days', String(REOPEN_DAYS)], root, 300e3).then(r => {
      if (r.code !== 0) { this.lastError = reopenError(r); this.failedAt = this.now(); log.warn('quality', 'bug-reopen read failed', { cause: this.lastError, hint: 'az login, then Aggiorna on the Qualità page' }); return; }
      parseReopen(r.stdout); // only valid JSON reaches the cache
      fs.writeFileSync(this.d.cacheFile, r.stdout.trim());
      this.lastError = null; this.failedAt = 0;
    }).catch(e => { this.lastError = `lettura dei bug riaperti fallita: ${errText(e)}`; this.failedAt = this.now(); log.warn('quality', 'bug-reopen result unusable', { cause: errText(e), hint: 'run ops/tools/bug-reopen.mjs --json by hand' }); })
      .finally(() => { this.running = null; });
  }

  /** fresh = the user pressed Aggiorna (after az login, say): read DevOps now, past the 12 h cache and the wait after a failure. */
  get({ fresh = false }: { fresh?: boolean } = {}): AppQuality {
    const dv = this.d.tasks();
    const cache = this.cached();
    this.maybeRefresh(cache, fresh);
    const reopen: Reopen = { ...EMPTY_REOPEN, ...(cache ?? {}), error: this.lastError ?? (dv.enabled || cache ? null : 'lettura DevOps spenta: accendila nella pagina Task'), refreshing: !!this.running };
    return {
      turns: this.turns(),
      prs: { at: dv.at, total: dv.prs.length, blocked: prBlocks(dv.prs, dv.details), error: dv.error?.message ?? null },
      reopen,
    };
  }

  /** Waits for a background read (tests). */
  idle(): Promise<void> { return this.running ?? Promise.resolve(); }
}
