// The Log page's journal (shared/activity-log.ts): every readable event the app records, kept in memory (the last
// LOG_RECENT) and on disk as one JSON line each in <userData>/activity/log-YYYY-MM-DD.jsonl, pushed to the window in
// small batches (log:events) so the page follows in real time. It cleans itself: days older than LOG_KEEP_DAYS and,
// past LOG_MAX_BYTES, the oldest days are deleted at start and every hour; each text field is cut to LOG_FIELD_MAX.
// Secrets are redacted like the technical logs (log.ts redact). Zero tokens: nothing here calls a model.
// One instance, `journal`, imported by the modules that record (activity/wiring.ts, mail.ts, pulse/service.ts, …);
// tests: test/unit/activity/journal.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { clip, LOG_FIELD_MAX, LOG_KEEP_DAYS, LOG_MAX_BYTES, LOG_RECENT, type LogEvent, type LogInput, type LogList } from '../../shared/activity-log';
import { redact } from '../log';

const DAY_MAX_BYTES = LOG_MAX_BYTES / 2;

const FILE = /^log-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TEXT_FIELDS = ['title', 'text', 'input', 'output', 'error', 'task'] as const;
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export class Journal {
  private dir: string | null = null;
  private recent: LogEvent[] = [];
  private batch: LogEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanTimer: ReturnType<typeof setInterval> | null = null;
  private emitFn: ((events: LogEvent[]) => void) | null = null;
  private seq = 0;
  constructor(private readonly now: () => number = Date.now) {}

  /** Opens the folder, cleans it and loads the last events (newest LOG_RECENT of the kept days). */
  init(userData: string, emit?: (events: LogEvent[]) => void): void {
    this.dir = path.join(userData, 'activity');
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { this.dir = null; return; }
    this.emitFn = emit ?? null;
    this.clean();
    this.recent = this.load();
    this.cleanTimer = setInterval(() => this.clean(), 3600_000);
    this.cleanTimer.unref?.();
  }

  stop(): void {
    if (this.cleanTimer) clearInterval(this.cleanTimer);
    this.flush();
  }

  /** Records one event; never throws (the log never breaks the app). */
  record(input: LogInput): LogEvent | null {
    try {
      const e = { ...input, id: `${(this.now()).toString(36)}-${(this.seq++).toString(36)}-${randomBytes(2).toString('hex')}`, at: input.at ?? this.now() } as LogEvent;
      for (const k of TEXT_FIELDS) {
        // redacted whole, then cut: a secret cut in half by the clip would slip past the exact-match redaction
        const raw = e[k];
        const v = clip(typeof raw === 'string' ? redact(raw) : raw, k === 'title' ? 200 : LOG_FIELD_MAX);
        if (v === undefined) delete e[k]; else e[k] = v;
      }
      if (!e.title) e.title = '—';
      if (e.tools) e.tools = e.tools.slice(0, 40).map(t => String(t).slice(0, 80));
      this.recent.push(e);
      if (this.recent.length > LOG_RECENT) this.recent.splice(0, this.recent.length - LOG_RECENT);
      this.write(e);
      this.batch.push(e);
      if (!this.flushTimer) { this.flushTimer = setTimeout(() => this.flush(), 250); this.flushTimer.unref?.(); }
      return e;
    } catch { return null; }
  }

  /** Demo events (activity/demo.ts): in memory only, never on disk. */
  seed(events: readonly LogEvent[]): void {
    this.recent = [...events, ...this.recent].sort((a, b) => a.at - b.at).slice(-LOG_RECENT);
  }

  list(): LogList {
    return { events: [...this.recent], bytes: this.bytes(), keepDays: LOG_KEEP_DAYS, maxBytes: LOG_MAX_BYTES };
  }

  private flush(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.batch.length) return;
    const out = this.batch; this.batch = [];
    try { this.emitFn?.(out); } catch { /* window gone */ }
  }

  /** One day's file stops growing at half the folder's cap (a noisy loop must not fill the disk or slow the start):
   *  past it, one marker line, then the day's events stay in memory only. */
  private write(e: LogEvent): void {
    if (!this.dir) return;
    try {
      const day = localDay(e.at), file = path.join(this.dir, `log-${day}.jsonl`);
      if (this.day?.day !== day) {
        let n = 0; try { n = fs.statSync(file).size; } catch { /* new day */ }
        this.day = { day, bytes: n, full: n >= DAY_MAX_BYTES };
      }
      if (this.day.full) return;
      let line = `${JSON.stringify(e)}\n`;
      if (this.day.bytes + Buffer.byteLength(line) > DAY_MAX_BYTES) {
        this.day.full = true;
        line = `${JSON.stringify({ id: `${e.id}-full`, at: e.at, kind: 'app', level: 'warn', title: 'Log di oggi pieno: i prossimi eventi restano solo in memoria fino a domani' })}\n`;
      }
      fs.appendFileSync(file, line);
      this.day.bytes += Buffer.byteLength(line);
    } catch { /* disk full: memory only */ }
  }
  private day: { day: string; bytes: number; full: boolean } | null = null;

  private files(): { name: string; day: string; size: number }[] {
    if (!this.dir) return [];
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    return names.flatMap(name => {
      const m = FILE.exec(name); if (!m) return [];
      try { return [{ name, day: m[1]!, size: fs.statSync(path.join(this.dir!, name)).size }]; } catch { return []; }
    }).sort((a, b) => a.day.localeCompare(b.day));
  }

  private bytes(): number { return this.files().reduce((n, f) => n + f.size, 0); }

  /** Deletes the days past LOG_KEEP_DAYS, then the oldest days while the folder is over LOG_MAX_BYTES (today stays). */
  clean(): void {
    if (!this.dir) return;
    const today = localDay(this.now()), oldest = localDay(this.now() - (LOG_KEEP_DAYS - 1) * 864e5);
    let files = this.files();
    for (const f of files) if (f.day < oldest) this.drop(f.name);
    files = this.files();
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= LOG_MAX_BYTES || f.day === today) break;
      this.drop(f.name); total -= f.size;
    }
  }

  private drop(name: string): void { try { fs.unlinkSync(path.join(this.dir!, name)); } catch { /* in use or gone */ } }

  /** The newest LOG_RECENT events on disk, oldest first; a broken line is skipped. */
  private load(): LogEvent[] {
    const out: LogEvent[] = [];
    for (const f of this.files().reverse()) {
      let text = '';
      try { text = fs.readFileSync(path.join(this.dir!, f.name), 'utf8'); } catch { continue; }
      const rows: LogEvent[] = [];
      for (const line of text.split('\n')) {
        if (!line) continue;
        try { const e = JSON.parse(line) as LogEvent; if (e && typeof e.id === 'string' && typeof e.at === 'number' && typeof e.title === 'string') rows.push(e); } catch { /* cut line */ }
      }
      out.unshift(...rows);
      if (out.length >= LOG_RECENT) break;
    }
    return out.slice(-LOG_RECENT);
  }
}

export const journal = new Journal();
/** Short alias for the modules that record one event. */
export const logEvent = (e: LogInput): void => { journal.record(e); };
