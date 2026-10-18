// The engines the app drives (ADR 0010: Claude embedded; ADR 0046: any ACP CLI or HTTP model of the registry): where
// they are, which version, whether the user is logged in, and opening the OFFICIAL login in a visible terminal. The app
// never sees, stores or types a login: the engine's own login flow runs in a console window the user works in (API keys
// are the one exception, typed in Settings: engines/secrets.ts). Built-in CLI status commands check login without
// starting a model or reading credential files. Unknown engines stay unknown. Tests run only fake CLIs.
// Resolution and process primitives (the
// embedded binary, Cursor's node.exe, fake .mjs engines for tests, kill tree) live in chats/cli.ts; used by index.ts,
// wiring.ts.
import { execFile, spawn } from 'node:child_process';
import { launchPosixLogin } from '../modules/ai-first/login-terminal';
import fs from 'node:fs';
import path from 'node:path';
import type { CliStatus, Harness } from '../shared/contract';
import { commandFor, engineAllowed, findCli, resolveAcp, resolveClaude, resolveCursor } from './chats/cli';
import { engineOrThrow, engines, type EngineDef } from './engines/registry';
import { log } from './log';
import { recordReadiness } from './engines/readiness';

/** The same Claude engine the chats run (embedded binary, ADR 0010), so status and login match what chats use. */
export const claudePath = (): string | null => resolveClaude()?.path ?? null;
/** Cursor's own launcher for status and the visible login window (chats start its node.exe directly). */
export const cursorPath = (): string | null => {
  const c = resolveCursor();
  if (!c) return null;
  if (c.kind !== 'node') return c.display;
  // the agent.cmd shim exists only on Windows; macOS/Linux install agent and cursor-agent in ~/.local/bin (ADR 0054)
  if (process.platform !== 'win32') return findCli('agent') ?? findCli('cursor-agent');
  const shim = path.join(process.env.LOCALAPPDATA ?? '', 'cursor-agent', 'agent.cmd');
  return findCli('agent') ?? (fs.existsSync(shim) ? shim : null);
};

/** Run a fixed-flag command, async (never block the main process). .cmd shims (Cursor on Windows) go through cmd.exe;
 *  the arguments are constants of this file, never user text. */
function runFixed(exe: string, args: string[], timeout = 20000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const shim = /\.(cmd|bat)$/i.test(exe);
  const c = shim
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`], env: process.env }
    : commandFor(exe, args, process.env);
  return new Promise(res => execFile(c.command, c.args, { encoding: 'utf8', timeout, windowsHide: true, windowsVerbatimArguments: shim, env: c.env },
    (err, stdout, stderr) => res({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ok: !err })));
}
const version = (out: string) => out.match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? (out.trim() || null);

async function claudeStatus(checkLogin: boolean): Promise<CliStatus> {
  const p = claudePath();
  if (!p) return { found: false, path: null, version: null, loggedIn: null };
  const v = await runFixed(p, ['--version']);
  let loggedIn: boolean | null = null, account: string | null = null;
  if (checkLogin && !process.env.SB_DEMO) {
    const a = await runFixed(p, ['auth', 'status']);
    try { const s = JSON.parse(a.stdout) as { loggedIn?: boolean; email?: string; authMethod?: string } | null; loggedIn = typeof s?.loggedIn === 'boolean' ? s.loggedIn : null; account = s?.email ? `${s.authMethod ?? ''} ${s.email}`.trim() : null; } catch { /* old or fake CLI: unknown */ }
  }
  return { found: true, path: p, version: version(v.stdout), loggedIn, account };
}

/** An ACP engine's command for status and login: Cursor's launcher, else its CLI as chats resolve it. */
function acpPath(e: EngineDef): string | null {
  return e.id === 'cursor' ? cursorPath() : resolveAcp(e.id, e.command ?? e.id)?.display ?? null;
}

/** May the app run this ACP CLI at all, even `--version`? Never a real one under tests (only a .mjs fake), and an
 *  engine that is not built in only with the definition the user turned on (registry trusted): a command an agent
 *  wrote into models.json never runs before the user's click. */
function acpRunnable(e: EngineDef): boolean {
  const c = e.id === 'cursor' ? resolveCursor() : resolveAcp(e.id, e.command ?? e.id);
  return !!c && engineAllowed(c) && e.trusted;
}

/** Only explicit status markers count; timeouts, unsupported flags and transport errors remain unknown. */
export function loginStatus(text: string): boolean | null {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  if (/\bnot (?:logged in|authenticated)\b|\blogged out\b/i.test(clean)) return false;
  if (/\blogged in\b|\bauthenticated\s*:\s*true\b/i.test(clean)) return true;
  return null;
}

async function acpStatus(e: EngineDef, checkLogin: boolean): Promise<CliStatus> {
  const p = acpPath(e);
  if (!p) return { found: false, path: null, version: null, loggedIn: null };
  if (!acpRunnable(e)) return { found: true, path: p, version: null, loggedIn: null };
  const v = await runFixed(p, ['--version']);
  let loggedIn: boolean | null = null;
  if (checkLogin && !process.env.SB_DEMO && (e.kind === 'codex' || e.id === 'cursor')) {
    const auth = await runFixed(p, e.kind === 'codex' ? ['login', 'status'] : ['status']);
    loggedIn = loginStatus(`${auth.stdout}\n${auth.stderr}`);
  }
  return { found: true, path: p, version: version(v.stdout), loggedIn };
}

/** One engine's status (found, version, login when it can be read without spending). An HTTP engine has no program:
 *  "found", with its endpoint as the path. */
export async function engineStatus(id: Harness, checkLogin = true): Promise<CliStatus> {
  const e = engineOrThrow(id);
  const status = e.kind === 'claude' ? await claudeStatus(checkLogin)
    : e.kind === 'api' ? { found: true, path: e.baseUrl ?? null, version: null, loggedIn: null }
    : await acpStatus(e, checkLogin);
  if (checkLogin) recordReadiness(id, status);
  return status;
}

/** Every engine's status, by id. */
export async function engineStatuses(): Promise<Record<Harness, CliStatus>> {
  const all = engines();
  const list = await Promise.all(all.map(e => engineStatus(e.id)));
  return Object.fromEntries(all.map((e, i) => [e.id, list[i] as CliStatus]));
}

/** Opens a visible console window running the engine's own login; returns at once (the user completes it there). */
export function openLogin(harness: Harness): void | Promise<void> {
  const e = engineOrThrow(harness);
  if (e.kind === 'api' || !e.login.length) throw new Error(`${e.label} non ha un comando di accesso: usa una chiave API (Impostazioni → Motori) o accedi dentro la sua CLI.`);
  if (e.kind !== 'claude' && !acpRunnable(e)) throw new Error(e.trusted ? `Nei test il login di ${e.label} non si apre mai.` : `Accendi prima ${e.label} in Impostazioni → Motori.`);
  const p = e.kind === 'claude' ? claudePath() : acpPath(e);
  if (!p) { log.error('cli', 'login requested but the CLI is missing', { cause: `${e.label} CLI not found on PATH`, hint: `install the ${e.label} CLI` }); throw new Error(`${e.label} CLI not found`); }
  if (process.platform === 'darwin' || process.platform === 'linux') return launchPosixLogin(process.platform, p, e.login);
  const args = e.login.join(' ');
  const title = `Accesso ${e.label}`;
  // `start "<title>" cmd /k ""<exe>" <args>"`: a new window that stays open after the login
  spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `start "${title}" cmd /k ""${p}" ${args}"`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true }).unref();
  log.info('cli', 'official login opened in a terminal', { data: { harness } });
}
