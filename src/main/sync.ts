// GitHub sync of the product, as agreed with the brain-side chat that maintains it (2026-10-11). That chat owns the
// export, the data/secret check and the push (its command lives in %LOCALAPPDATA%/second-brain/sync.json, written by
// it); this module only (1) turns the outcome files of release syncs (written by scripts/release.mjs after a
// promotion) into feed events/notifications, and (2) starts the same command when files of the PRODUCT inside the
// brain change (paths from `product-sync.mjs paths --json`), after 10 minutes of quiet, never two at once.
// Stable instance only (SB_RELEASE set, not in tests): a dev build never syncs. Exit codes: 0 ok (or paused / nothing
// to do), 2 blocked by the check, anything else = error. A block or error with the same findings as the last one is
// published once (one item that stays until a sync goes through; 40 identical red toasts were seen on 12/10). What was
// already notified survives a restart (<base>/sync-state.json): an outcome written while the app was closed (a release
// sync ends after the promotion restarted the app) is notified at the next start, not marked as old (on 14/10 a crash
// and three days of blocks went unseen). A failure says since when GitHub is behind (the last ok outcome). Used by
// wiring.ts.
import { timersFor } from './timers';
const { setInterval, clearInterval } = timersFor('sync');
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BrainService } from './services';
import { log } from './log';

const QUIET_MS = Number(process.env.SB_SYNC_QUIET_MS ?? 10 * 60e3);

export interface SyncOutcome { release: string; startedAt: string; endedAt?: string; exitCode?: number; ok?: boolean; blocked?: boolean; summary?: string; running?: boolean }

/** Glob (relative, `/`-separated, `**` and `*`) → RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`, 'i');
}

/** "11/10 20:22" in the machine's time zone. */
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
};

/** An outcome → its feed event. lastOkAt: when GitHub was last updated (null = never; undefined = not known, no line). */
export function outcomeEvent(o: SyncOutcome, lastOkAt?: string | null): { kind: string; title: string; detail: string } | null {
  if (o.running || !o.endedAt) return null;
  const what = o.release.startsWith('brain-') ? 'prodotto nel brain' : `versione ${o.release}`;
  if (o.ok) return { kind: 'sync-ok', title: `GitHub aggiornato (${what})`, detail: o.summary?.split('\n').at(-1) ?? '' };
  const since = lastOkAt === undefined ? '' : `Ultimo aggiornamento riuscito di GitHub: ${lastOkAt ? when(lastOkAt) : 'mai'}\n`;
  if (o.blocked) {
    // the count line ("guard: BLOCKED, 110 findings (…)") is the last one: it goes first, under the date
    const lines = (o.summary ?? '').split('\n');
    const count = lines.findLast(l => /\bBLOCKED\b/.test(l));
    const body = count ? [count, ...lines.filter(l => l !== count)].join('\n') : (o.summary ?? '');
    return { kind: 'sync-blocked', title: `GitHub fermo: pubblicazione bloccata dal controllo (${what})`, detail: `${since}${body}` };
  }
  return { kind: 'sync-error', title: `GitHub fermo: pubblicazione non riuscita (${what})`, detail: `${since}${o.summary ?? `codice ${o.exitCode}`}` };
}

/** The output of a sync → its summary: the last lines, plus the first error line when it scrolled above them (a Node
 *  crash ends with a stack and the error object, its message is higher up). */
export function summarize(out: string, keep = 6): string {
  const lines = out.trim().split(/\r?\n/);
  const tail = lines.slice(-keep);
  const cause = lines.slice(0, -keep).find(l => /^\s*(?:\w*Error\b|fatal: |error: )/.test(l));
  return (cause ? [cause.trim(), '…', ...tail] : tail).join('\n');
}

/** What a failure is about, without what changes from run to run (release ids, timestamps): same signature = same
 *  problem still there. */
export function failureSignature(ev: { kind: string; detail: string }): string {
  const text = ev.detail
    .replace(/\bbrain-[\w-]+/g, 'brain-*')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}[:-]\d{2}(?:[:-]\d{2})?(?:[.,-]\d+)?Z?/g, '<time>')
    .replace(/\s+/g, ' ').trim();
  return `${ev.kind}|${text}`;
}

/** Outcome events → the ones to publish: a failure only when it differs from the open one; an ok closes it. */
export class FailureDedup {
  constructor(public open: string | null = null) {}
  pass(ev: { kind: string; detail: string }): boolean {
    if (ev.kind === 'sync-ok') { this.open = null; return true; }
    const sig = failureSignature(ev);
    if (sig === this.open) return false;
    this.open = sig;
    return true;
  }
}

interface SyncState { seenUntil: number; open: string | null }

export class ProductSync {
  private dedup = new FailureDedup();
  private dir: string;
  private stateFile: string;
  private seenUntil = 0;
  private lastOkAt: string | null = null;
  private firstScan: NodeJS.Timeout | null = null;
  private hourly: NodeJS.Timeout | null = null;
  private seen = new Set<string>();
  private watchers: fs.FSWatcher[] = [];
  private brainWatcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private patterns: RegExp[] = [];

  /** firstScanMs: the outcomes that ended while the app was closed are read this long after start, once the window is
   *  up (an event already in the feed when the renderer loads never toasts, lib/layer.ts); tests pass 0. */
  constructor(private o: { base: string; brainRoot: () => string | null; brain: BrainService; nodeExe: string; firstScanMs?: number }) {
    this.dir = path.join(o.base, 'sync');
    this.stateFile = path.join(o.base, 'sync-state.json');
  }

  start(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const files = this.outcomeFiles();
    let state: SyncState | null = null;
    try { state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as SyncState; } catch { /* first start with this version */ }
    // with a state: what was notified before the restart stays quiet, what came while the app was closed goes through
    // scanOutcomes; without one: old outcomes are not replayed, except the newest when it failed (seen once)
    const last = files.at(-1);
    const old = state ? files.filter(f => this.mtime(f) <= state.seenUntil) : files.filter(f => f !== last || this.read(f)?.ok !== false);
    if (state) { this.dedup.open = state.open; this.seenUntil = state.seenUntil; }
    for (const f of old) {
      this.seen.add(`${f}:${this.mtime(f)}`);
      const o = this.read(f);
      if (o?.ok && o.endedAt) this.lastOkAt = o.endedAt;
    }
    // the watcher first: an outcome written during the first scan is not missed
    this.watchers.push(fs.watch(this.dir, () => this.scanOutcomes()));
    const first = this.o.firstScanMs ?? 30e3;
    if (first > 0) { this.firstScan = setTimeout(() => this.scanOutcomes(), first); this.firstScan.unref(); } else this.scanOutcomes();
    void this.loadPaths();
    this.hourly = setInterval(() => void this.loadPaths(), 3600e3);
    this.hourly.unref();
  }

  stop(): void { for (const w of this.watchers) w.close(); this.brainWatcher?.close(); if (this.timer) clearTimeout(this.timer); if (this.firstScan) clearTimeout(this.firstScan); clearInterval(this.hourly); this.hourly = null; }

  private mtime(f: string): number { try { return fs.statSync(path.join(this.dir, f)).mtimeMs; } catch { return 0; } }

  /** Outcome files, oldest first (the order they ended in). */
  private outcomeFiles(): string[] {
    return fs.readdirSync(this.dir).filter(n => n.endsWith('.json')).map(f => ({ f, t: this.mtime(f) })).sort((a, b) => a.t - b.t).map(x => x.f);
  }

  private read(f: string): SyncOutcome | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as SyncOutcome; } catch { return null; }
  }

  private scanOutcomes(): void {
    let changed = false;
    for (const f of this.outcomeFiles()) {
      const t = this.mtime(f);
      const key = `${f}:${t}`;
      if (this.seen.has(key)) continue;
      const o = this.read(f);
      if (!o) continue; // half written: the next change event reads it
      this.seen.add(key);
      const ev = outcomeEvent(o, this.lastOkAt);
      if (!ev) continue; // still running: its final write gets a new mtime
      if (o.ok && o.endedAt) this.lastOkAt = o.endedAt;
      this.seenUntil = Math.max(this.seenUntil, t);
      changed = true;
      if (!this.dedup.pass(ev)) { log.info('sync', 'same failure as before: not published again', { data: { file: f, kind: ev.kind } }); continue; }
      this.o.brain.publish([ev]);
      log.info('sync', 'outcome', { data: { file: f, kind: ev.kind } });
    }
    if (!changed) return;
    const state: SyncState = { seenUntil: this.seenUntil, open: this.dedup.open };
    try { fs.writeFileSync(this.stateFile, JSON.stringify(state)); } catch (e) { log.warn('sync', 'sync state not saved: a restart may notify an outcome again', { cause: e instanceof Error ? e.message : String(e), hint: `check that ${this.stateFile} is writable` }); }
  }

  private config(): { command: string; args?: string[]; cwd?: string } | null {
    try { const c = JSON.parse(fs.readFileSync(path.join(this.o.base, 'sync.json'), 'utf8')) as { command?: string; args?: string[]; cwd?: string }; return c.command ? { command: c.command, ...(c.args ? { args: c.args } : {}), ...(c.cwd ? { cwd: c.cwd } : {}) } : null; } catch { return null; }
  }

  private async loadPaths(): Promise<void> {
    const root = this.o.brainRoot();
    const tool = root && path.join(root, 'ops', 'tools', 'product-sync.mjs');
    if (!root || !tool || !fs.existsSync(tool) || !this.config()) return;
    const out = await new Promise<string | null>(res => execFile(this.o.nodeExe, [tool, 'paths', '--json'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000, windowsHide: true }, (err, stdout) => res(err ? null : String(stdout))));
    let globs: string[] = [];
    try { const j = JSON.parse(out ?? '') as unknown; globs = Array.isArray(j) ? j.filter((g): g is string => typeof g === 'string') : Array.isArray((j as { paths?: unknown })?.paths) ? ((j as { paths: unknown[] }).paths).filter((g): g is string => typeof g === 'string') : []; } catch { /* below */ }
    if (!globs.length) { log.warn('sync', 'product paths unavailable: no automatic sync from the brain', { data: { tool } }); return; }
    this.patterns = globs.map(globToRegExp);
    this.brainWatcher ??= fs.watch(root, { recursive: true }, (_e, f) => { if (f) this.changed(String(f).replace(/\\/g, '/')); });
    log.info('sync', 'watching product paths in the brain', { data: { count: globs.length } });
  }

  changed(rel: string): void {
    if (/^(\.git|node_modules)\//.test(rel) || !this.patterns.some(p => p.test(rel))) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), QUIET_MS);
  }

  private run(): void {
    if (this.running) { this.again = true; return; }
    const c = this.config();
    if (!c) return;
    this.running = true;
    const id = `brain-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const outFile = path.join(this.dir, `${id}.json`);
    const startedAt = new Date().toISOString();
    let buf = '';
    const env = { ...process.env };
    delete env.SB_RELEASE_ID;
    const p = spawn(c.command, c.args ?? [], { cwd: c.cwd, env, windowsHide: true });
    p.stdout.on('data', d => { buf += String(d); });
    p.stderr.on('data', d => { buf += String(d); });
    const finish = (code: number, err?: string) => {
      const o: SyncOutcome = { release: id, startedAt, endedAt: new Date().toISOString(), exitCode: code, ok: code === 0, blocked: code === 2, summary: err ?? summarize(buf) };
      fs.writeFileSync(outFile, JSON.stringify(o));
      this.running = false;
      if (this.again) { this.again = false; this.timer = setTimeout(() => this.run(), QUIET_MS); }
    };
    p.on('close', code => finish(code ?? -1));
    p.on('error', e => finish(-1, e.message));
    log.info('sync', 'brain product changed: sync started', { data: { id } });
  }
}
