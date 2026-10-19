// The Task page's data (ADR 0079: the section was DevOps), kept by main: the tasks imported by themselves from the
// connected tools, Azure DevOps today: runs the brain's own read-only script ops/tools/devops-me.mjs (news for the
// user since the last read, open work items, old reviews, then --prs for the live PRs; both with --full: the details of
// each work item, i.e. description, last comments and test cases, so the page shows them without opening DevOps) as a Node child with Electron's
// binary, never an AI chat, so a read costs no tokens. On its own timer only when the user turns it on (setting
// tasks.enabled, off by default: his rule is "nothing on fixed intervals unless he wants it"; tasks.everyMin), else
// only on "Aggiorna ora". New unread news go to the feed (the Orchestrator's "Novità") once; the ones about the user's own
// things (a mention, his items and PRs, a state/assignee change on a followed ticket) also as a task-alert, which the
// renderer shows as a toast with a short sound: never twice for the same change (keys kept in tasks.json), nothing on
// the very first read (baseline), zero tokens (ADR 0029). The repos of the PRs on the page are matched to local clones
// (repoDirs: "Discuti" tells the Orchestrator the folder of a PR's work). State and read marks are kept in
// userData/tasks.json so the page opens with the last read. Then, when the brain has it, ops/tools/qa-status.mjs
// --mine --json: the "Test e QA" section (my PRs' test plans); a failure there keeps the last QA and never fails the read. Read-only by construction: the app never writes to DevOps.
// Used by wiring.ts (tasks:* channels); logic in model.ts.
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('tasks/service');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DevopsDetail, DevopsItem, DevopsPr, DevopsPrRef, TasksState, QaReport, Settings } from '../../shared/contract';
import type { FeedInput } from '../services';
import type { RunResult } from '../brain/node';
import { log, errText } from '../log';
import { alertEvents, alertsFor, detailsOf, errorOf, feedFor, itemOf, mergeNews, newsOf, parseNewsRun, parsePrsRun, parseQaRun, prOf, qaReportOf, prRefOf, windowDays, MAX_NOTIFIED, type StoredNews } from './model';

export const SCRIPT = 'ops/tools/devops-me.mjs';
export const QA_SCRIPT = 'ops/tools/qa-status.mjs';
/** the state file's name before ADR 0079 (the section was called DevOps) */
const LEGACY_FILE = 'devops.json';
const RUN_TIMEOUT_MS = 180_000;
const FIRST_DELAY_MS = 5_000;          // turned on (or app start) with an old read: read again soon, not at once
const MAX_READ_KEYS = 2000;

interface Saved {
  lastOk: number | null;
  news: StoredNews[];
  read: string[];
  assigned: DevopsItem[];
  urgent: DevopsItem[];
  oldReviews: DevopsPrRef[];
  reviews: DevopsPrRef[];
  prs: DevopsPr[];
  details: Record<string, DevopsDetail>;
  qa: QaReport[];
  /** keys of the news already seen by a read (alerts dedupe across restarts) */
  notified: string[];
}
const some = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : []);
const found = (root: string, rel: string): string | null => { const p = path.join(root, rel); return fs.existsSync(p) ? p : null; };
const defaultLocate = (root: string): string | null => found(root, SCRIPT);
const defaultLocateQa = (root: string): string | null => found(root, QA_SCRIPT);
const EMPTY: Saved = { lastOk: null, news: [], read: [], assigned: [], urgent: [], oldReviews: [], reviews: [], prs: [], details: {}, qa: [], notified: [] };
/** A repo name usable as a folder name (no path separators, not only dots). */
const SAFE_REPO = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/;
const defaultRepoDir = (repo: string): string | null => { const p = path.join(os.homedir(), 'source', 'repos', repo); return fs.existsSync(p) ? p : null; };

export interface TaskDeps {
  file: string;                                          // userData/tasks.json
  brainRoot: () => string | null;
  settings: () => Settings['tasks'];
  run: (script: string, args: string[], cwd: string, timeoutMs: number) => Promise<RunResult>;
  emit: (s: TasksState) => void;
  feed: (events: FeedInput[]) => void;
  now?: () => number;
  /** where the script is in the brain (null = missing); default <brainRoot>/ops/tools/devops-me.mjs if it exists */
  locate?: (root: string) => string | null;
  /** where qa-status.mjs is (null = missing: no "Test e QA"); default <brainRoot>/ops/tools/qa-status.mjs if it exists */
  locateQa?: (root: string) => string | null;
  /** a repo's local clone (null = none); default <home>/source/repos/<repo> if it exists */
  repoDir?: (repo: string) => string | null;
}

export class TaskService {
  private saved: Saved;
  private running: Promise<TasksState> | null = null;
  private error: TasksState['error'] = null;
  private qaError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly dirs = new Map<string, string | null>();

  constructor(private readonly d: TaskDeps) {
    this.now = d.now ?? Date.now;
    this.saved = this.load();
  }

  get(): TasksState {
    const s = this.d.settings();
    const read = new Set(this.saved.read);
    const news = this.saved.news.map(n => ({ ...n, unread: !read.has(n.key) }));
    return {
      enabled: s.enabled, everyMin: s.everyMin, sound: s.sound !== false, running: this.running !== null, at: this.saved.lastOk, nextAt: this.nextAt, error: this.error,
      news, assigned: this.saved.assigned, urgent: this.saved.urgent, oldReviews: this.saved.oldReviews, reviews: this.saved.reviews, prs: this.saved.prs, details: this.saved.details,
      unread: news.filter(n => n.unread).length, qa: this.saved.qa, qaError: this.qaError, repoDirs: this.repoDirs(),
    };
  }

  /** The local clones of the repos on the page (looked up once per repo name while the app runs). */
  private repoDirs(): Record<string, string> {
    const repos = new Set([...this.saved.prs, ...this.saved.reviews, ...this.saved.qa.flatMap(q => (q.pr ? [q.pr] : []))].map(p => p.repo));
    const out: Record<string, string> = {};
    for (const r of repos) {
      if (!SAFE_REPO.test(r)) continue;
      if (!this.dirs.has(r)) this.dirs.set(r, (this.d.repoDir ?? defaultRepoDir)(r));
      const dir = this.dirs.get(r);
      if (dir) out[r] = dir;
    }
    return out;
  }

  /** Connector account verification starts its own read after any older read finishes. */
  async refreshFresh(): Promise<TasksState> {
    // Connector verification must not inherit a read started before its account check.
    while (this.running) await this.running;
    return this.refresh();
  }

  /** Reads DevOps now; a read already running is joined (one at a time). */
  refresh(): Promise<TasksState> {
    if (this.running) return this.running;
    // the answer is the state AFTER the read (running false, next timer planned), not the one read() saw
    this.running = this.read().finally(() => { this.running = null; this.schedule(); }).then(() => this.get());
    this.d.emit(this.get());
    return this.running;
  }

  markRead(keys?: string[]): TasksState {
    const all = keys ?? this.saved.news.map(n => n.key);
    const read = new Set(this.saved.read);
    for (const k of all) if (typeof k === 'string') read.add(k);
    this.saved = { ...this.saved, read: [...read].slice(-MAX_READ_KEYS) };
    this.save();
    const s = this.get();
    this.d.emit(s);
    return s;
  }

  /** Settings changed (or app start): (re)plan the automatic read. */
  schedule(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.nextAt = null;
    const s = this.d.settings();
    if (this.stopped || !s.enabled) { this.d.emit(this.get()); return; }
    const every = s.everyMin * 60_000;
    const now = this.now();
    const due = this.saved.lastOk === null ? now + FIRST_DELAY_MS : Math.max(now + FIRST_DELAY_MS, this.saved.lastOk + every);
    // after a failure, try again one interval later (not in a loop)
    this.nextAt = this.error ? now + every : due;
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, this.nextAt - now);
    this.timer.unref?.();
    this.d.emit(this.get());
  }

  shutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async read(): Promise<TasksState> {
    const root = this.d.brainRoot();
    const script = root ? (this.d.locate ?? defaultLocate)(root) : null;
    if (!root || !script) {
      this.error = { kind: 'script', message: root ? `Nella cartella del cervello manca ${SCRIPT}: la pagina Task legge da lì.` : 'Scegli prima la cartella del cervello: la pagina Task usa il suo script devops-me.mjs.' };
      return this.get();
    }
    const now = this.now();
    const days = windowDays(this.saved.lastOk, now);
    const t0 = Date.now();
    const news = await this.d.run(script, ['--json', '--full', '--days', String(days)], root, RUN_TIMEOUT_MS);
    if (news.code !== 0) return this.fail(news, 'Lettura delle novità');
    let parsed;
    try { parsed = parseNewsRun(news.stdout); } catch (e) { return this.fail({ ...news, code: 1, stderr: errText(e) }, 'Lettura delle novità'); }
    const prs = await this.d.run(script, ['--prs', '--json', '--full'], root, RUN_TIMEOUT_MS);
    if (prs.code !== 0) return this.fail(prs, 'Lettura delle PR');
    let prList;
    try { prList = parsePrsRun(prs.stdout); } catch (e) { return this.fail({ ...prs, code: 1, stderr: errText(e) }, 'Lettura delle PR'); }

    const { all, added } = mergeNews(this.saved.news, parsed.news, now);
    const firstRead = this.saved.lastOk === null;
    const { alerts, notified } = alertsFor(parsed.news, this.saved.notified, firstRead);
    // details only of what this read listed (an older brain script without --full gives none: the page shows rows only)
    this.saved = { ...this.saved, lastOk: now, news: all, assigned: parsed.assigned, urgent: parsed.urgent, oldReviews: parsed.oldReviews,
      reviews: [...parsed.news.flatMap(n => (n.kind === 'review' && n.pr ? [n.pr] : [])), ...parsed.oldReviews], prs: prList.prs, details: { ...prList.details, ...parsed.details }, notified };
    this.error = null;
    this.save();
    // what interrupts (an alert) is not said twice: the quiet list gets the other new news only
    const alerted = new Set(alerts.map(n => n.key));
    const quiet = added.filter(n => !alerted.has(n.key));
    const events = feedFor(quiet, new Set(this.saved.read));
    // a first read sends one line (a summary when there are more), never a flood
    if (events.length) this.d.feed(firstRead && events.length > 1 ? feedFor(quiet, new Set(this.saved.read), 1) : events);
    if (alerts.length) this.d.feed(alertEvents(alerts));
    this.d.emit(this.get());   // the page shows news and PRs now, not after the (slower) QA read
    await this.readQa(root);
    log.info('task', 'read', { data: { days, news: parsed.news.length, added: added.length, assigned: parsed.assigned.length, prs: prList.prs.length, ms: Date.now() - t0 } });
    return this.get();
  }

  /** "Test e QA" after a good read: qa-status.mjs --mine --json; its failure is said in the section, the last QA stays. */
  private async readQa(root: string): Promise<void> {
    const script = (this.d.locateQa ?? defaultLocateQa)(root);
    if (!script) { this.qaError = null; return; }
    const r = await this.d.run(script, ['--mine', '--json'], root, RUN_TIMEOUT_MS);
    let qa: QaReport[] | null = null;
    let bad = r;
    try { if (r.code === 0) qa = parseQaRun(r.stdout); } catch (e) { bad = { ...r, code: 1, stderr: errText(e) }; }
    if (!qa) {
      this.qaError = errorOf(bad, 'Lettura dei test').message;
      log.warn('task', 'QA read failed', { cause: (bad.stderr || bad.error || `code ${bad.code}`).slice(0, 300), hint: `run node ${QA_SCRIPT} --mine in the brain folder to see the error`, data: { code: r.code } });
      return;
    }
    this.qaError = null;
    this.saved = { ...this.saved, qa };
    this.save();
  }

  private fail(r: RunResult, what: string): TasksState {
    const was = this.error?.kind;
    this.error = errorOf(r, what);
    // an expired login says so in the feed once (also when the page is closed), not at every automatic read
    if (this.error.kind === 'login' && was !== 'login') this.d.feed([{ kind: 'task', title: 'DevOps: accesso scaduto', detail: 'Lancia «az login» in un terminale, poi «Aggiorna ora» nella pagina Task' }]);
    log.warn('task', `${what} failed`, { cause: (r.stderr || r.error || `code ${r.code}`).slice(0, 300), hint: this.error.kind === 'login' ? 'run `az login` in a terminal, then Aggiorna ora' : `run node ${SCRIPT} --json in the brain folder to see the error`, data: { code: r.code } });
    return this.get();
  }

  private load(): Saved {
    // the file was devops.json before the section became Task (ADR 0079): renamed once, so the last read is kept
    const old = path.join(path.dirname(this.d.file), LEGACY_FILE);
    try { if (!fs.existsSync(this.d.file) && fs.existsSync(old)) fs.renameSync(old, this.d.file); } catch (e) { log.warn('task', `${LEGACY_FILE} not renamed`, { cause: errText(e), hint: 'the page starts empty and reads again' }); }
    try {
      const raw = JSON.parse(fs.readFileSync(this.d.file, 'utf8')) as Partial<Saved>;
      const news = some(raw.news, newsOf), oldReviews = some(raw.oldReviews, prRefOf);
      // a file from before "reviews" existed (2026-10-12): rebuilt from its review news and old reviews, as a read does
      const reviews = Array.isArray(raw.reviews) ? some(raw.reviews, prRefOf)
        : [...news.flatMap(n => (n.kind === 'review' && n.pr ? [n.pr] : [])), ...oldReviews].filter((p, i, xs) => xs.findIndex(x => x.id === p.id) === i);
      return {
        lastOk: typeof raw.lastOk === 'number' ? raw.lastOk : null,
        // every row checked again, like the script's output: a hand-edited file never breaks the start
        news, read: Array.isArray(raw.read) ? raw.read.filter(k => typeof k === 'string') : [],
        assigned: some(raw.assigned, itemOf), urgent: some(raw.urgent, itemOf), oldReviews, reviews, prs: some(raw.prs, prOf), details: detailsOf(raw.details), qa: some(raw.qa, qaReportOf),
        // a file from before the alerts (2026-10-13): what it already lists is the baseline, never alerted
        notified: Array.isArray(raw.notified) ? raw.notified.filter((k): k is string => typeof k === 'string').slice(-MAX_NOTIFIED) : news.map(n => n.key),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('task', 'tasks.json unreadable, starting empty', { cause: errText(e), hint: 'it is rebuilt on the next read' });
      return { ...EMPTY };
    }
  }

  /** Temp file + rename. On Windows the rename can fail for a moment (EPERM/EBUSY while an antivirus or the indexer
   *  holds the file, seen under the full test run: a mark read was lost): retry briefly, then write the file directly
   *  (as config.ts). */
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
      const text = JSON.stringify(this.saved);
      const tmp = `${this.d.file}.tmp`;
      fs.writeFileSync(tmp, text);
      for (let i = 0; i < 5; i++) {
        try { fs.renameSync(tmp, this.d.file); return; } catch (e) {
          if (!['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
        }
      }
      fs.writeFileSync(this.d.file, text);
      try { fs.unlinkSync(tmp); } catch { /* left behind: harmless */ }
    } catch (e) {
      log.warn('task', 'tasks.json not saved', { cause: errText(e), hint: 'check userData is writable; the page keeps working from memory' });
    }
  }
}
