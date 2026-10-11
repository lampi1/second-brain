// The two engines the app drives (ADR 0010: Claude embedded, Cursor CLI): where they are, which version, whether the
// user is logged in, and opening the OFFICIAL login in a visible terminal. The app never sees, stores or types
// credentials: the engine's own login flow runs in a console window the user works in. Cursor's login state is checked
// only on the user's request (a click), never automatically: no call to Cursor's service happens unless asked (each
// engine spends only its own; agents testing the app must not trigger Cursor). Resolution and process primitives (the
// embedded binary, Cursor's node.exe, fake .mjs engines for tests, kill tree) live in chats/cli.ts; used by index.ts,
// wiring.ts.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CliStatus, Harness } from '../shared/contract';
import { commandFor, cursorAllowed, findCli, resolveClaude, resolveCursor } from './chats/cli';
import { log } from './log';

/** The same Claude engine the chats run (embedded binary, ADR 0010), so status and login match what chats use. */
export const claudePath = (): string | null => resolveClaude()?.path ?? null;
/** Cursor's own launcher for status and the visible login window (chats start its node.exe directly). */
export const cursorPath = (): string | null => {
  const c = resolveCursor();
  if (!c) return null;
  if (c.kind !== 'node') return c.display;
  const shim = path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent', 'agent.cmd');
  return findCli('agent') ?? (fs.existsSync(shim) ? shim : null);
};

/** Run a fixed-flag command, async (never block the main process). .cmd shims (Cursor on Windows) go through cmd.exe;
 *  the arguments are constants of this file, never user text. */
function runFixed(exe: string, args: string[], timeout = 20000): Promise<{ stdout: string; ok: boolean }> {
  const shim = /\.(cmd|bat)$/i.test(exe);
  const c = shim
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`], env: process.env }
    : commandFor(exe, args, process.env);
  return new Promise(res => execFile(c.command, c.args, { encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: shim, env: c.env },
    (err, stdout) => res({ stdout: String(stdout ?? ''), ok: !err })));
}
const version = (out: string) => out.match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? (out.trim() || null);

export async function claudeStatus(): Promise<CliStatus> {
  const p = claudePath();
  if (!p) return { found: false, path: null, version: null, loggedIn: null };
  const v = await runFixed(p, ['--version']);
  let loggedIn: boolean | null = null, account: string | null = null;
  if (!process.env.SB_DEMO) {
    const a = await runFixed(p, ['auth', 'status']);
    try { const s = JSON.parse(a.stdout) as { loggedIn?: boolean; email?: string; authMethod?: string }; loggedIn = !!s.loggedIn; account = s.email ? `${s.authMethod ?? ''} ${s.email}`.trim() : null; } catch { /* old or fake CLI: unknown */ }
  }
  return { found: true, path: p, version: version(v.stdout), loggedIn, account };
}

/** Under tests the real Cursor CLI is never run, not even `--version` (only the .mjs fake). */
const cursorRunnable = (): boolean => { const c = resolveCursor(); return !!c && cursorAllowed(c); };

export async function cursorStatus(): Promise<CliStatus> {
  const p = cursorPath();
  if (!p) return { found: false, path: null, version: null, loggedIn: null };
  if (!cursorRunnable()) return { found: true, path: p, version: null, loggedIn: null };
  const v = await runFixed(p, ['--version']);
  return { found: true, path: p, version: version(v.stdout), loggedIn: null };
}

/** Opens a visible console window running the engine's own login; returns at once (the user completes it there). */
export function openLogin(harness: Harness): void {
  if (harness === 'cursor' && !cursorRunnable()) throw new Error('Nei test il login di Cursor non si apre mai.');
  const p = harness === 'claude' ? claudePath() : cursorPath();
  if (!p) { log.error('cli', 'login requested but the CLI is missing', { cause: `${harness} CLI not found on PATH`, hint: harness === 'claude' ? 'install Claude Code' : 'install the Cursor CLI' }); throw new Error(`${harness} CLI not found`); }
  const args = harness === 'claude' ? 'auth login' : 'login';
  const title = harness === 'claude' ? 'Accesso Claude' : 'Accesso Cursor';
  // `start "<title>" cmd /k ""<exe>" <args>"`: a new window that stays open after the login
  spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `start "${title}" cmd /k ""${p}" ${args}"`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true }).unref();
  log.info('cli', 'official login opened in a terminal', { data: { harness } });
}
