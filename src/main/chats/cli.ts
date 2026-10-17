// Finding and starting the engines (ADR 0010, ADR 0046) without a shell, so arguments are never re-parsed and nothing
// is injected: Claude = the official binary embedded in the app (the dependency for this OS and CPU, platform.ts; a
// release passes its copy in SB_ENGINE_CLAUDE), Cursor = the user's installed CLI started as its own `node.exe
// index.js` (no PowerShell launcher), other CLIs = their command on PATH, with Codex's Windows app install as a
// fallback (resolveAcp). A .mjs/.js path runs with Electron as Node: that is how tests swap in the fake engines, and
// under tests a real engine is refused (never spend the user's credits). Also: kill whole process trees on app exit
// (Windows keeps the engines' children alive). Used by claude.ts, acp.ts, manager.ts, ../cli.ts.
import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEngine } from '../release';
import { cursorInstall, discoverClaude, findCli } from './discovery.mjs';
export { findCli, newestCursorVersion } from './discovery.mjs';
export type { ClaudeSource } from './discovery.mjs';

const isScript = (p: string): boolean => /\.(m?js|cjs)$/i.test(p);

/** The Claude engine: SB_CLAUDE_PATH (tests) → SB_ENGINE_CLAUDE (a release's copy) → the embedded dependency next to
 *  the app (dev) → `claude` on PATH (last fallback). null = none. */
export function resolveClaude(override?: string | null): ReturnType<typeof discoverClaude> {
  let here = process.cwd();
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { /* not a file URL */ }
  return discoverClaude({ override, release: releaseEngine(), starts: [here, process.cwd()] });
}

/** How to start a CLI engine. kind fake = a .mjs test double (Electron as Node), node = the CLI's own node.exe
 *  + index.js of the newest version (Cursor), cmd = a .cmd/.bat shim through cmd.exe, exe = a given executable. */
export interface CliCommand { kind: 'fake' | 'node' | 'cmd' | 'exe'; command: string; prefix: string[]; env: NodeJS.ProcessEnv; verbatim: boolean; display: string }

/** The Cursor CLI: SB_CURSOR_PATH (tests) → the newest version under its install folder (Windows
 *  %LOCALAPPDATA%/cursor-agent, macOS/Linux ~/.local/share/cursor-agent, ADR 0054) → its launcher on PATH. */
export function resolveCursor(override?: string | null, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = (platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir()): CliCommand | null {
  const win = platform === 'win32';
  const o = override ?? env.SB_CURSOR_PATH;
  const base: NodeJS.ProcessEnv = { ...env, CURSOR_INVOKED_AS: env.CURSOR_INVOKED_AS ?? (win ? 'agent.cmd' : 'cursor-agent') };
  delete base.ELECTRON_RUN_AS_NODE;
  if (o) return commandAt(o, env, base);
  const local = win ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local') : path.posix.join(home, '.local', 'share');
  const node = win ? 'node.exe' : 'node';
  const dir = cursorInstall(env, platform, home);
  if (dir) {
    const cache = env.NODE_COMPILE_CACHE ?? path.join(local ?? '', 'cursor-compile-cache');
    return { kind: 'node', command: path.join(dir, node), prefix: [path.join(dir, 'index.js')], env: { ...base, NODE_COMPILE_CACHE: cache }, verbatim: false, display: dir };
  }
  const shim = findCli('agent', env, platform, home) ?? (win ? null : findCli('cursor-agent', env, platform, home));
  return shim ? installed(shim, base) : null;
}

/** Resolve an installed CLI: Cursor keeps its own install rule; other engines use their SB_<ID>_PATH override or the
 *  command on PATH. Codex on Windows also searches its desktop app's versioned install folder. null = not installed. */
export function resolveAcp(engineId: string, command: string, override?: string | null, env: NodeJS.ProcessEnv = process.env): CliCommand | null {
  if (engineId === 'cursor') return resolveCursor(override, env);
  const base: NodeJS.ProcessEnv = { ...env };
  delete base.ELECTRON_RUN_AS_NODE; // never leak the Node switch into the real CLI's own children
  const o = override ?? env[`SB_${engineId.toUpperCase().replace(/-/g, '_')}_PATH`];
  if (o) return commandAt(o, env, base);
  const cli = findCli(command, env);
  return cli ? installed(cli, base) : null;
}

/** An override as a command: a script = a fake run by Electron as Node, else like an installed CLI. */
function commandAt(p: string, env: NodeJS.ProcessEnv, base: NodeJS.ProcessEnv): CliCommand {
  if (isScript(p)) return { kind: 'fake', command: process.execPath, prefix: [p], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, verbatim: false, display: p };
  return installed(p, base);
}

/** An installed CLI: a .cmd/.bat shim runs through cmd.exe, anything else as an executable. */
function installed(p: string, base: NodeJS.ProcessEnv): CliCommand {
  return /\.(cmd|bat)$/i.test(p) ? cmdShim(p, base) : { kind: 'exe', command: p, prefix: [], env: base, verbatim: false, display: p };
}

function cmdShim(p: string, env: NodeJS.ProcessEnv): CliCommand {
  return { kind: 'cmd', command: env.ComSpec ?? 'cmd.exe', prefix: [], env, verbatim: true, display: p };
}

/** Full argv for a CLI command. cmd.exe gets one verbatim line: only plain flag-safe arguments may pass. */
export function cliArgv(c: CliCommand, args: string[]): { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean } {
  if (c.kind !== 'cmd') return { command: c.command, args: [...c.prefix, ...args], env: c.env, verbatim: false };
  for (const a of args) if (!/^[\w.:@/=[\],-]+$/.test(a)) throw new Error(`argomento non sicuro per cmd.exe: ${a}`);
  return { command: c.command, args: ['/d', '/s', '/c', `""${c.display}" ${args.join(' ')}"`], env: c.env, verbatim: true };
}

/** Tests never start a real engine (SB_TEST: e2e, VITEST: unit tests): only a .mjs fake that does not live in a
 *  vendor's install folder (Cursor's index.js run as a script would be the real engine). */
export function engineAllowed(c: CliCommand, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!(env.SB_TEST || env.VITEST)) return true;
  return c.kind === 'fake' && /\.mjs$/i.test(c.display) && !/[\\/]cursor-agent[\\/]/i.test(c.display);
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
    if (process.platform !== 'win32') {
      // macOS/Linux: engines and runs lead their own process group (platform.ts ownProcessGroup): kill(-pid) takes the
      // whole tree; a pid that leads no group (ESRCH) is killed alone
      for (const p of list) {
        try { if (opts.tree === false) throw new Error('alone'); process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
      }
      return;
    }
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

/** What the steps after killTreesWithin's wait cost at least (direct kills, one reaper spawn, the manager's last writes),
 *  the wait's own last timer included: with the process-spawning unit files all running, it fired over 300 ms late
 *  (2026-10-14, the reserve was 300 then). */
const QUIT_RESERVE_MIN_MS = 500;

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

