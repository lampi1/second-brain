// Finding and starting the two engines (ADR 0010) without a shell, so arguments are never re-parsed and nothing is
// injected: Claude = the official binary embedded in the app (dependency @anthropic-ai/claude-agent-sdk-win32-x64; a
// release passes its copy in SB_ENGINE_CLAUDE), Cursor = the user's installed CLI started as its own `node.exe
// index.js` (no PowerShell launcher). A .mjs/.js path runs with Electron as Node: that is how tests swap in the fake
// engines, and under tests the real Cursor engine is refused (never spend Cursor credits). Also: kill whole process
// trees on app exit (Windows keeps the engines' children alive). Used by claude.ts, cursor.ts, manager.ts, ../cli.ts.
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEngine } from '../release';

const found = new Map<string, string | null>();
const isScript = (p: string): boolean => /\.(m?js|cjs)$/i.test(p);

const EMBEDDED_CLAUDE = path.join('node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');

/** First existing `rel` in `start` or one of its parents. */
function findUp(start: string, rel: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export type ClaudeSource = 'override' | 'release' | 'embedded' | 'path';

/** The Claude engine: SB_CLAUDE_PATH (tests) → SB_ENGINE_CLAUDE (a release's copy) → the embedded dependency next to
 *  the app (dev) → `claude` on PATH (last fallback). null = none. */
export function resolveClaude(override?: string | null): { path: string; source: ClaudeSource } | null {
  const o = override ?? process.env.SB_CLAUDE_PATH;
  if (o) return { path: o, source: 'override' };
  const rel = releaseEngine();
  if (rel && fs.existsSync(rel)) return { path: rel, source: 'release' };
  let here = process.cwd();
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { /* not a file URL */ }
  const emb = findUp(here, EMBEDDED_CLAUDE) ?? findUp(process.cwd(), EMBEDDED_CLAUDE);
  if (emb) return { path: emb, source: 'embedded' };
  const p = findCli('claude');
  return p ? { path: p, source: 'path' } : null;
}

/** How to start the Cursor engine. kind fake = a .mjs test double (Electron as Node), node = the CLI's own node.exe
 *  + index.js of the newest version, cmd = agent.cmd through cmd.exe (fallback), exe = a given executable. */
export interface CursorCommand { kind: 'fake' | 'node' | 'cmd' | 'exe'; command: string; prefix: string[]; env: NodeJS.ProcessEnv; verbatim: boolean; display: string }

const VERSION_DIR = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;

/** Newest version folder of the Cursor CLI (same rule as its own launcher: YYYY.MM.DD[-HH-MM-SS]-commit). */
export function newestCursorVersion(versionsDir: string): string | null {
  let names: string[] = [];
  try { names = fs.readdirSync(versionsDir); } catch { return null; }
  const key = (m: RegExpMatchArray): number => Number(`${m[1]}${(m[2] ?? '').padStart(2, '0')}${(m[3] ?? '').padStart(2, '0')}${m[4] ?? '00'}${m[5] ?? '00'}${m[6] ?? '00'}`);
  const ok = names.map(n => ({ n, m: n.match(VERSION_DIR) }))
    .filter((x): x is { n: string; m: RegExpMatchArray } => !!x.m && fs.existsSync(path.join(versionsDir, x.n, 'node.exe')) && fs.existsSync(path.join(versionsDir, x.n, 'index.js')))
    .sort((a, b) => key(b.m) - key(a.m));
  return ok[0] ? path.join(versionsDir, ok[0].n) : null;
}

export function resolveCursor(override?: string | null, env: NodeJS.ProcessEnv = process.env): CursorCommand | null {
  const o = override ?? env.SB_CURSOR_PATH;
  const base: NodeJS.ProcessEnv = { ...env, CURSOR_INVOKED_AS: env.CURSOR_INVOKED_AS ?? 'agent.cmd' };
  delete base.ELECTRON_RUN_AS_NODE;
  if (o) {
    if (isScript(o)) return { kind: 'fake', command: process.execPath, prefix: [o], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, verbatim: false, display: o };
    if (/\.(cmd|bat)$/i.test(o)) return cmdShim(o, base);
    return { kind: 'exe', command: o, prefix: [], env: base, verbatim: false, display: o };
  }
  const local = env.LOCALAPPDATA;
  const dir = local ? newestCursorVersion(path.join(local, 'cursor-agent', 'versions')) : null;
  if (dir) {
    const cache = env.NODE_COMPILE_CACHE ?? path.join(local ?? '', 'cursor-compile-cache');
    return { kind: 'node', command: path.join(dir, 'node.exe'), prefix: [path.join(dir, 'index.js')], env: { ...base, NODE_COMPILE_CACHE: cache }, verbatim: false, display: dir };
  }
  const shim = findCli('agent');
  return shim ? (/\.(cmd|bat)$/i.test(shim) ? cmdShim(shim, base) : { kind: 'exe', command: shim, prefix: [], env: base, verbatim: false, display: shim }) : null;
}

function cmdShim(p: string, env: NodeJS.ProcessEnv): CursorCommand {
  return { kind: 'cmd', command: env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe', prefix: [], env, verbatim: true, display: p };
}

/** Full argv for a Cursor command. cmd.exe gets one verbatim line: only plain flag-safe arguments may pass. */
export function cursorArgv(c: CursorCommand, args: string[]): { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean } {
  if (c.kind !== 'cmd') return { command: c.command, args: [...c.prefix, ...args], env: c.env, verbatim: false };
  for (const a of args) if (!/^[\w.:@/=[\],-]+$/.test(a)) throw new Error(`argomento non sicuro per cmd.exe: ${a}`);
  return { command: c.command, args: ['/d', '/s', '/c', `""${c.display}" ${args.join(' ')}"`], env: c.env, verbatim: true };
}

/** Tests never start the real Cursor engine (SB_TEST: e2e, VITEST: unit tests): only a .mjs fake that does not live in
 *  Cursor's own install folder (its index.js run as a script would be the real engine). */
export function cursorAllowed(c: CursorCommand, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!(env.SB_TEST || env.VITEST)) return true;
  return c.kind === 'fake' && /\.mjs$/i.test(c.display) && !/[\\/]cursor-agent[\\/]/i.test(c.display);
}

/** Absolute path of a CLI on PATH (cached), or the given path when it already is one. null = not installed. */
export function findCli(name: string): string | null {
  if (/[\\/]/.test(name)) return name;
  if (!found.has(name)) {
    const r = process.platform === 'win32'
      ? spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
      : spawnSync('which', ['-a', name], { encoding: 'utf8' });
    const all = (r.stdout ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    found.set(name, all.find(p => /\.exe$/i.test(p)) ?? all[0] ?? null);
  }
  return found.get(name) ?? null;
}

/** Command + args to start a CLI. Scripts (.mjs/.cjs/.js) run with this process's runtime as Node. */
export function commandFor(cliPath: string, args: string[], env: NodeJS.ProcessEnv): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (/\.(m?js|cjs)$/i.test(cliPath)) return { command: process.execPath, args: [cliPath, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  const clean = { ...env };
  delete clean.ELECTRON_RUN_AS_NODE; // never leak the Node switch into the real CLI's own children
  return { command: cliPath, args, env: clean };
}

/** `claude --version` → "2.1.282" (async, never blocks the main process; null when it does not answer in 15 s). */
export function cliVersion(cliPath: string): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const c = commandFor(cliPath, ['--version'], process.env);
      execFile(c.command, c.args, { encoding: 'utf8', windowsHide: true, timeout: 15000, env: c.env },
        (_err, stdout) => resolve(String(stdout ?? '').match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? null));
    } catch { resolve(null); }
  });
}

/** How long a closing engine may take to exit by itself once its stdin is closed, before its tree is killed.
 *  claude.exe needs 3-5 s even when idle (measured 2026-10-13: 4.3-4.7 s with and without MCP servers, on a loaded box
 *  30 s for init alone); the old 3 s cut almost every clean close ("session did not exit, killing"). */
export const CLOSE_GRACE_MS = 10000;

/** Kills processes and their children (MCP servers, shells, background tasks the CLI started).
 *  Why trees: on Windows libuv puts our direct children in a kill-on-close job, so claude.exe dies with the app, but
 *  ITS children escape that job and would live on as orphans; `taskkill /T` must run while claude.exe is still alive.
 *  taskkill takes ~1.6 s on a quiet box but 15-40 s on a loaded one (it walks every process; measured 2026-10-11).
 *  It reads the process tree as it starts, so once started it kills the children even if the parent is gone by then.
 *  Never waited for: detached and never killed, it finishes the tree even after the app is gone (the quit's bounded
 *  wait is killTreesWithin). If taskkill cannot start, `fallback` terminates the processes alone. */
export function killTrees(pids: (number | null | undefined)[], opts: { fallback?: () => void; /** false: only these pids, not their children */ tree?: boolean } = {}): void {
  const list = pids.filter((p): p is number => typeof p === 'number' && p > 0);
  if (!list.length) return;
  const fallback = (): void => { try { opts.fallback?.(); } catch { /* gone */ } };
  try {
    if (process.platform !== 'win32') { for (const p of list) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } return; }
    const args = [...list.flatMap(p => ['/pid', String(p)]), ...(opts.tree === false ? [] : ['/T']), '/F'];
    const k = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore', detached: true });
    k.on('error', fallback);
    k.unref();
  } catch { fallback(); }
}

/** The quit's bounded kill (the job guard off or failed): the same detached taskkill, then the event loop stays free
 *  while we wait for the processes to die; the ones still alive are terminated directly, their pictured children first
 *  (`kids`), then handed to `after` in one call: a reaper that outlives the app finds what the picture missed (not taken
 *  yet under load, or born since) and taskkill, if it had not read the tree yet, can no longer see. Resolves within `ms`
 *  of the call at full CPU too, as long as `ms` leaves room for one spawn: the deadline is set before anything is
 *  spawned, and the wait stops early by what the steps after it cost now (two spawns' worth, measured on taskkill's, or
 *  `spawnMs` when the caller started taskkill itself): spawning taskkill before the deadline and the reaper after it
 *  pushed the quit 146 ms past the app's 6 s cap (2026-10-14). Never blocks the main process: a synchronous wait here
 *  held the whole quit past that cap on a loaded machine (2026-10-13). */
export async function killTreesWithin(pids: (number | null | undefined)[], ms: number, opts: { fallback?: () => void; /** what a pid started, children first (proctree.ts snapshotTrees) */ kids?: (pid: number) => number[];
  /** the caller already started their tree kill (killNow): no second taskkill; what one spawn costs now, measured by it */ started?: { spawnMs: number };
  /** the pids terminated directly, and when: whoever finds what they started once they are gone (proctree.ts reapAfterQuit) */ after?: (pids: number[], at: number) => void } = {}): Promise<void> {
  const until = Date.now() + Math.max(0, ms);
  const list = pids.filter((p): p is number => typeof p === 'number' && p > 0);
  if (!list.length) return;
  const t0 = Date.now();
  if (!opts.started) killTrees(list, { ...(opts.fallback ? { fallback: opts.fallback } : {}) });
  const spawnMs = opts.started?.spawnMs ?? Date.now() - t0;
  const stop = until - Math.max(QUIT_RESERVE_MIN_MS, 2 * spawnMs);
  while (list.some(pidAlive) && Date.now() < stop) await new Promise(r => setTimeout(r, Math.max(1, Math.min(50, stop - Date.now()))));
  const killed: number[] = [];
  for (const p of list) {
    if (!pidAlive(p)) continue;
    // its children first, while it still runs (the picture was taken under it: no pid reuse yet), then itself
    for (const k of opts.kids?.(p) ?? []) { try { process.kill(k); } catch { /* gone */ } }
    try { process.kill(p); killed.push(p); } catch { /* gone */ }
  }
  if (killed.length) opts.after?.(killed, Date.now());
}

/** What the steps after killTreesWithin's wait cost at least (direct kills, one reaper spawn, the manager's last writes). */
const QUIT_RESERVE_MIN_MS = 300;

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

