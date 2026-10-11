// GitHub sync of the product, as agreed with the brain-side chat that maintains it (2026-10-11). That chat owns the
// export, the data/secret check and the push (its command lives in %LOCALAPPDATA%/second-brain/sync.json, written by
// it); this module only (1) turns the outcome files of release syncs (written by scripts/release.mjs after a
// promotion) into feed events/notifications, and (2) starts the same command when files of the PRODUCT inside the
// brain change (paths from `product-sync.mjs paths --json`), after 10 minutes of quiet, never two at once.
// Stable instance only (SB_RELEASE set, not in tests): a dev build never syncs. Exit codes: 0 ok (or paused / nothing
// to do), 2 blocked by the check, anything else = error. Used by wiring.ts.
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

export function outcomeEvent(o: SyncOutcome): { kind: string; title: string; detail: string } | null {
  if (o.running || !o.endedAt) return null;
  const what = o.release.startsWith('brain-') ? 'prodotto nel cervello' : `versione ${o.release}`;
  if (o.ok) return { kind: 'sync-ok', title: `GitHub aggiornato (${what})`, detail: o.summary?.split('\n').at(-1) ?? '' };
  if (o.blocked) return { kind: 'sync-blocked', title: `Pubblicazione bloccata (${what})`, detail: o.summary ?? '' };
  return { kind: 'sync-error', title: `Pubblicazione non riuscita (${what})`, detail: o.summary ?? `codice ${o.exitCode}` };
}

export class ProductSync {
  private dir: string;
  private seen = new Set<string>();
  private watchers: fs.FSWatcher[] = [];
  private brainWatcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private patterns: RegExp[] = [];

  constructor(private o: { base: string; brainRoot: () => string | null; brain: BrainService; nodeExe: string }) {
    this.dir = path.join(o.base, 'sync');
  }

  start(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) this.seen.add(`${f}:${this.mtime(f)}`); // old outcomes: no notification
    this.watchers.push(fs.watch(this.dir, () => this.scanOutcomes()));
    void this.loadPaths();
    const hourly = setInterval(() => void this.loadPaths(), 3600e3);
    hourly.unref();
  }

  stop(): void { for (const w of this.watchers) w.close(); this.brainWatcher?.close(); if (this.timer) clearTimeout(this.timer); }

  private mtime(f: string): number { try { return fs.statSync(path.join(this.dir, f)).mtimeMs; } catch { return 0; } }

  private scanOutcomes(): void {
    for (const f of fs.readdirSync(this.dir).filter(n => n.endsWith('.json'))) {
      const key = `${f}:${this.mtime(f)}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      let o: SyncOutcome;
      try { o = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as SyncOutcome; } catch { continue; }
      const ev = outcomeEvent(o);
      if (ev) { this.o.brain.publish([ev]); log.info('sync', 'outcome', { data: { file: f, kind: ev.kind } }); }
    }
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
      const o: SyncOutcome = { release: id, startedAt, endedAt: new Date().toISOString(), exitCode: code, ok: code === 0, blocked: code === 2, summary: err ?? buf.trim().split(/\r?\n/).slice(-6).join('\n') };
      fs.writeFileSync(outFile, JSON.stringify(o));
      this.running = false;
      if (this.again) { this.again = false; this.timer = setTimeout(() => this.run(), QUIET_MS); }
    };
    p.on('close', code => finish(code ?? -1));
    p.on('error', e => finish(-1, e.message));
    log.info('sync', 'brain product changed: sync started', { data: { id } });
  }
}
