// Where the app keeps its machine-wide files on each OS, and which embedded Claude engine package fits this machine
// (ADR 0054). One place, so no module reads %LOCALAPPDATA% or names the win32-x64 package by itself. The scripts that
// run without the build (release.mjs, doctor.mjs, logs.mjs) carry the same three-line rule, pointing here.
// Used by wiring.ts (releases root, sync), chats/cli.ts (embedded engine), chats/claude.ts (stable guards),
// brain/cursor-ledger.ts (shared ledger), shortcuts.ts; the process helpers (own process group, restart waiter, user
// shell, ps elapsed time) by chats/claude.ts, chats/acp.ts, chats/cli.ts, chats/proctree.ts, run/runner.ts, wiring.ts.
import os from 'node:os';
import path from 'node:path';

/** The app's shared folder, outside userData (stable and dev read it both; the releases and launchers live there):
 *  Windows %LOCALAPPDATA%/second-brain · macOS ~/Library/Application Support/second-brain-shared (Application Support
 *  is also Electron's appData, and second-brain there is the stable userData) · Linux $XDG_DATA_HOME/second-brain. */
export function sharedDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'second-brain');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'second-brain-shared');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'second-brain');
}

/** The official Claude binary shipped as an npm package per OS and CPU (optionalDependencies: npm installs only the
 *  one that fits). Null where Anthropic ships none. */
export function claudeEnginePackage(platform: NodeJS.Platform = process.platform, arch: string = process.arch): { pkg: string; bin: string } | null {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) return null;
  return { pkg: `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`, bin: platform === 'win32' ? 'claude.exe' : 'claude' };
}

/** macOS/Linux: each engine and each user command starts as the leader of its own process group, so a whole tree is
 *  killed with one kill(-pgid) (Windows has the job guard and taskkill /T for that, ADR 0026/0054). */
export const ownProcessGroup = (platform: NodeJS.Platform = process.platform): boolean => platform !== 'win32';

/** The launcher the releases root holds (ADR 0007): launch.cmd on Windows, launch.sh elsewhere (ADR 0054 stage 4). */
export const launcherName = (platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? 'launch.cmd' : 'launch.sh');

/** The detached waiter of "Aggiorna": waits for this process to exit (at most 60 s), then starts the launcher, which
 *  opens the new current release. Windows: PowerShell Wait-Process (unchanged); elsewhere a /bin/sh loop on kill -0.
 *  The launcher path travels as an argument ($0 of the sh script), never inside the script text: no quoting. */
export function restartWaiter(pid: number, launcher: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const script = `Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue; & cmd.exe /d /c ${q(launcher)}`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script] };
  }
  const script = `i=0; while kill -0 ${pid} 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i+1)); done; exec /bin/sh "$0"`;
  return { command: '/bin/sh', args: ['-c', script, launcher] };
}

/** How "Esegui" runs a user command block: Windows PowerShell 5.1 reading the block from stdin (runner.ts bootstrap);
 *  macOS/Linux the user's login shell ($SHELL, zsh or bash; /bin/sh when unset) with the block as its -c script, so
 *  their PATH and aliases from the profile apply as in their terminal. */
export function userShell(code: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; stdin: boolean } {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], stdin: true };
  const sh = env.SHELL && path.posix.isAbsolute(env.SHELL) ? env.SHELL : '/bin/sh';
  return { command: sh, args: ['-l', '-c', code], stdin: false };
}

/** Seconds from ps's etime ([[dd-]hh:]mm:ss): the one elapsed-time column that both Linux procps and macOS BSD ps
 *  print (etimes is Linux only). NaN for anything else. */
export function etimeSeconds(s: string): number {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(s);
  if (!m) return Number.NaN;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** A POSIX shell word: single-quoted, a ' inside written as '\''. */
export const shWord = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The Linux menu entry (freedesktop .desktop) of the stable app: runs launch.sh through /bin/sh. Exec quoting per
 *  the spec: double quotes, with " ` $ \ escaped by a backslash and % doubled. */
export function linuxDesktopEntry(launcher: string, icon: string): string {
  const arg = (s: string) => `"${s.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;
  return ['[Desktop Entry]', 'Type=Application', 'Name=second-brain', 'Comment=La cabina di comando di Claude e Cursor',
    `Exec=/bin/sh ${arg(launcher)}`, `Icon=${icon}`, 'Terminal=false', 'Categories=Development;Utility;', 'StartupWMClass=second-brain', ''].join('\n');
}

/** The macOS desktop launcher of the stable app: a .command file the Finder opens in Terminal, which starts launch.sh
 *  (it returns at once: the app keeps running after the Terminal window closes). */
export const macCommandFile = (launcher: string): string => `#!/bin/sh\n# second-brain: starts the stable app (launch.sh)\nexec /bin/sh ${shWord(launcher)}\n`;
