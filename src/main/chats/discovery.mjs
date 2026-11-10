// Filesystem-only CLI discovery shared by the Electron resolvers and scripts/doctor.mjs. Explorer may supply an old
// PATH; known per-user installs remain discoverable. Never starts a candidate and never caches an install or a miss.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const value = (env, key, platform) => env[key] ?? (platform === 'win32' ? Object.entries(env).find(([k, v]) => v !== undefined && k.toUpperCase() === key.toUpperCase())?.[1] : undefined);
const homeOf = (env, platform) => value(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform) || os.homedir();
const localOf = (env, home) => value(env, 'LOCALAPPDATA', 'win32') || path.join(home, 'AppData', 'Local');
const file = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const executable = (p, platform) => {
  if (!file(p)) return false;
  if (platform === 'win32') return true;
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
};
// Code-point comparison, independent of the OS locale and filesystem enumeration order.
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function inDirectories(name, directories, platform) {
  const suffixes = platform === 'win32' && !path.extname(name) ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];
  for (const suffix of suffixes) for (const dir of directories) {
    const p = path.resolve(dir, name + suffix);
    if (executable(p, platform)) return p;
  }
  return null;
}

/** Absolute installed command. PATH wins over conventional user install folders; exe/cmd/bat win over Unix shims on
 * Windows. Explicit paths retain script/diagnostic semantics in the caller (Node can run a non-executable .mjs).
 * Empty PATH segments never add the working directory. The supplied environment is the only PATH source. */
export function findCli(name, env = process.env, platform = process.platform, home = homeOf(env, platform)) {
  if (!name) return null;
  if (/[\\/]/.test(name)) return name;
  const dirs = (value(env, 'PATH', platform) || '').split(platform === 'win32' ? ';' : ':')
    .map(p => p.trim().replace(/^"(.*)"$/, '$1')).filter(p => p && path.isAbsolute(p));
  const onPath = inDirectories(name, dirs, platform);
  if (onPath) return onPath;
  const known = platform === 'win32'
    ? [path.join(value(env, 'APPDATA', platform) || path.join(home, 'AppData', 'Roaming'), 'npm'),
      path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(localOf(env, home), 'Microsoft', 'WinGet', 'Links'),
      ...(['agent', 'cursor-agent'].includes(name) ? [path.join(localOf(env, home), 'cursor-agent')] : [])]
    : [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), '/usr/local/bin', ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : [])];
  const installed = inDirectories(name, known, platform);
  if (installed) return installed;
  return platform === 'win32' && name.toLowerCase() === 'codex' ? codexAppInstall(env, home) : null;
}

/** Codex desktop's version-hashed install. An update can add/remove folders while the app runs; newest file wins,
 * then its full path breaks timestamp ties deterministically. Incomplete installs and directories are ignored. */
export function codexAppInstall(env = process.env, home = homeOf(env, 'win32')) {
  const bin = path.join(localOf(env, home), 'OpenAI', 'Codex', 'bin');
  let names;
  try { names = fs.readdirSync(bin); } catch { return null; }
  const candidates = names.flatMap(name => {
    const exe = path.join(bin, name, 'codex.exe');
    try { const stat = fs.statSync(exe); return stat.isFile() ? [{ exe, modified: stat.mtimeMs }] : []; } catch { return []; }
  }).sort((a, b) => b.modified - a.modified || compare(a.exe, b.exe));
  return candidates[0]?.exe ?? null;
}

const VERSION_DIR = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;
const versionKey = m => Number(`${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}${m[4] ?? '00'}${m[5] ?? '00'}${m[6] ?? '00'}`);

/** Cursor's newest complete date-stamped install (the launcher's ordering, with a deterministic commit tie-break). */
export function newestCursorVersion(versionsDir, node = 'node.exe') {
  let names;
  try { names = fs.readdirSync(versionsDir); } catch { return null; }
  const candidates = names.map(n => ({ n, m: n.match(VERSION_DIR) }))
    .filter(x => x.m && file(path.join(versionsDir, x.n, node)) && file(path.join(versionsDir, x.n, 'index.js')))
    .sort((a, b) => versionKey(b.m) - versionKey(a.m) || compare(a.n, b.n));
  return candidates[0] ? path.join(versionsDir, candidates[0].n) : null;
}

export function cursorInstall(env = process.env, platform = process.platform, home = homeOf(env, platform)) {
  const local = platform === 'win32' ? localOf(env, home) : path.join(home, '.local', 'share');
  return newestCursorVersion(path.join(local, 'cursor-agent', 'versions'), platform === 'win32' ? 'node.exe' : 'node');
}

function findUp(start, relative) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, relative);
    if (file(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Shared Claude precedence (ADR 0267): an explicit override (SB_CLAUDE_PATH, or the caller's), then the Claude Code the
 * user installed (PATH, then ~/.local/bin and the other known folders: findCli), so a model out today works the day its
 * CLI knows it; only when none is installed the copy shipped with the app (a release's SB_ENGINE_CLAUDE, else the
 * embedded SDK binary), marked fallback: it can be older and not know the newest models. The caller supplies the
 * release engine only in a stable context; a dev doctor ignores inherited stable variables just like initRelease.
 * Overrides keep the runtime's existing explicit-path semantics. */
export function discoverClaude({ override, release = null, starts = [process.cwd()], env = process.env, platform = process.platform, arch = process.arch } = {}) {
  const o = override ?? env.SB_CLAUDE_PATH;
  if (o) return { path: o, source: 'override' };
  const installed = installedClaude(env, platform);
  if (installed) return { path: installed, source: 'path' };
  const shipped = bundledClaude({ release, starts, platform, arch });
  return shipped ? { ...shipped, fallback: true } : null;
}

/** The installed Claude Code the app can start without a shell. On Windows a claude.exe (native installer, WinGet);
 * an npm install's claude.cmd shim cannot be spawned without a shell (Node refuses .cmd since CVE-2024-27980, and the
 * chat arguments are not shell-safe), so its package's cli.js runs instead with the user's node (claudeScriptCommand; as
 * packages/routine-runtime resolveClaudeCommand); a shim without cli.js or node counts as not installed. */
function installedClaude(env, platform) {
  if (platform !== 'win32') return findCli('claude', env, platform);
  const exe = findCli('claude.exe', env, platform);
  if (exe) return exe;
  const shim = findCli('claude', env, platform);
  if (!shim || !/\.(cmd|bat)$/i.test(shim)) return null;
  const cli = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  return file(cli) && findCli('node.exe', env, platform) ? cli : null;
}

/** An npm Claude Code's cli.js (Windows, installedClaude): a real engine, started with the user's own node. */
export const isClaudePackageScript = p => /[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/i.test(p);

/** How to start such a cli.js: the user's node (npm needs one), never Electron as Node, whose ELECTRON_RUN_AS_NODE
 * would reach every child of Claude Code (an `npx electron .` in a chat would open no window). null = no node. */
export function claudeScriptCommand(cli, env = process.env, platform = process.platform) {
  const node = findCli(platform === 'win32' ? 'node.exe' : 'node', env, platform);
  if (!node) return null;
  const clean = { ...env };
  for (const k of Object.keys(clean)) if (k.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete clean[k];
  return { command: node, args: [cli], env: clean };
}

/** The Claude Code shipped with the app: a release's copy, else the SDK's binary for this OS and CPU; null = none. */
export function bundledClaude({ release = null, starts = [process.cwd()], platform = process.platform, arch = process.arch } = {}) {
  if (release && file(release)) return { path: release, source: 'release' };
  if (['win32', 'darwin', 'linux'].includes(platform) && ['x64', 'arm64'].includes(arch)) {
    const rel = path.join('node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}-${arch}`, platform === 'win32' ? 'claude.exe' : 'claude');
    for (const start of starts) { const p = findUp(start, rel); if (p) return { path: p, source: 'embedded' }; }
  }
  return null;
}
