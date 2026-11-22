// run_code's thin wrappers for the native tools a Code Mode chat no longer sees (ADR 0331): Bash (Git Bash on
// Windows, as Claude Code; /bin/sh elsewhere), PowerShell (Windows PowerShell 5.1, pwsh elsewhere; the command travels
// encoded, never through a shell's quoting), Read, Write, Edit, Grep and Glob, with Claude's own input names. They
// only execute: the permission chain ran before (code-mode/bridge.ts → ChatManager.decideFor). Paths are relative to
// the folder the chat really works in (a --worktree chat's worktree), Bash gets the chat's engine environment, and
// every wrapper stops when its run ends (the run's signal: the script finished, hit a limit, or was cancelled). Bash
// never outlives the run's remaining time; Read, Grep and Glob run in a worker thread with a time limit
// (code-mode/fs-run.ts), never on the main process. Used by code-mode/bridge.ts and its tests (a fake spawn and a
// direct file runner: no real process, no thread).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { gitBashPath } from '../platform';
import type { NativeWrapper } from './policy';
import { FS_LIMITS } from './fs-ops';
import { workerRunner, type FsRunner } from './fs-run';

/** the subset of child_process.spawn the Bash wrapper uses (tests pass a fake) */
export type Spawn = (command: string, args: string[], opts: SpawnOptions) => {
  stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null;
  on(event: 'close', fn: (code: number | null) => void): unknown; on(event: 'error', fn: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
};

export interface NativeEnv {
  cwd: string; spawn?: Spawn; shell?: string | null;
  /** PowerShell's executable (default powershell.exe on Windows, pwsh elsewhere); null: none here */
  psShell?: string | null;
  /** the chat's engine environment (Bash's); default this process's */
  env?: NodeJS.ProcessEnv;
  /** the run's signal: an abort kills a running command and drops a pending read */
  signal?: AbortSignal;
  /** ms the run has left: a command's timeout never goes past it */
  maxMs?: number;
  /** a search leaves out what this refuses (a Claude Read deny rule) */
  readable?: (abs: string) => boolean;
  /** the file reads' runner (default the worker thread) */
  fsRun?: FsRunner;
}

const OUT_MAX = 30_000;
const BASH_DEFAULT_MS = 120_000, BASH_MAX_MS = 600_000, FS_MAX_MS = 30_000;
const READ_LINES = 2000;

const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || !v) throw new Error(`${name} is required (a string)`); return v; };
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const tail = (s: string, max = OUT_MAX): string => (s.length > max ? `… [${s.length - max} characters cut]\n${s.slice(-max)}` : s);
const at = (cwd: string, p: string): string => path.resolve(cwd, p);
type In = Record<string, unknown>;

/** One native wrapper call. Throws an Error the script may catch (a missing file, a failed edit). */
export async function runNative(tool: NativeWrapper, input: In, env: NativeEnv): Promise<unknown> {
  if (env.signal?.aborted) throw new Error('The call was cancelled.');
  switch (tool) {
    case 'Bash': return bash(input, env);
    case 'PowerShell': return powershell(input, env);
    case 'Read': return read(input, env);
    case 'Write': return write(input, env.cwd);
    case 'Edit': return edit(input, env.cwd);
    case 'Grep': return grep(input, env);
    case 'Glob': return glob(input, env);
  }
}

/** A command's time: the asked one (1 s to 10 min, default 2 min), never past what the run has left. */
export function bashTimeout(asked: number | undefined, maxMs?: number): number {
  const ms = Math.min(Math.max(asked ?? BASH_DEFAULT_MS, 1000), BASH_MAX_MS);
  if (maxMs === undefined) return ms;
  if (maxMs < 1000) throw new Error('run_code has no time left for a command: return what you have');
  return Math.min(ms, Math.floor(maxMs));
}

type CommandResult = { exitCode: number | null; stdout: string; stderr: string; timedOut?: true };

function bash(input: In, env: NativeEnv): Promise<CommandResult> {
  const command = str(input.command, 'command');
  const shell = env.shell === undefined ? gitBashPath() : env.shell;
  if (!shell) throw new Error('Git Bash not found (set CLAUDE_CODE_GIT_BASH_PATH): Bash cannot run');
  return runCommand('Bash', shell, ['-c', command], bashTimeout(num(input.timeout), env.maxMs), env);
}

/** -EncodedCommand's limit: Windows' command line holds 32,767 characters; a longer script goes through a file */
const ENCODED_MAX = 30_000;
/** what every PowerShell command starts with: UTF-8 output (5.1 writes the OEM code page to a pipe) and no progress
 *  bars (they reach stderr as CLIXML) */
const PS_PRELUDE = "$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\n";

/** How the PowerShell wrapper starts its command: the script as -EncodedCommand (UTF-16LE base64: no quoting can
 *  change it), or as a temporary .ps1 (UTF-8 with BOM, -File) when it is too long for a command line. */
export function powershellArgs(command: string, tmpFile: () => string): { args: string[]; file?: string } {
  const script = PS_PRELUDE + command;
  const base = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  if (encoded.length <= ENCODED_MAX) return { args: [...base, '-EncodedCommand', encoded] };
  const file = tmpFile();
  fs.writeFileSync(file, `\uFEFF${script}`, 'utf8');
  return { args: [...base, '-File', file], file };
}

function powershell(input: In, env: NativeEnv): Promise<CommandResult> {
  const command = str(input.command, 'command');
  const shell = env.psShell === undefined ? (process.platform === 'win32' ? 'powershell.exe' : 'pwsh') : env.psShell;
  if (!shell) throw new Error('PowerShell not found: use Bash');
  const ms = bashTimeout(num(input.timeout), env.maxMs);
  const { args, file } = powershellArgs(command, () => path.join(os.tmpdir(), `sb-run-code-${randomUUID()}.ps1`));
  const done = (): void => { if (file) fs.rm(file, { force: true }, () => {}); };
  return runCommand('PowerShell', shell, args, ms, env).finally(done);
}

/** One command process: its output kept to the last OUT_MAX characters each, killed at its timeout or the run's end. */
function runCommand(name: string, shell: string, args: string[], ms: number, env: NativeEnv): Promise<CommandResult> {
  const spawn = env.spawn ?? (nodeSpawn as unknown as Spawn);
  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, { cwd: env.cwd, env: env.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false, aborted = false;
    const keep = (s: string, add: string): string => { const n = s + add; return n.length > OUT_MAX * 2 ? n.slice(-OUT_MAX * 2) : n; };
    child.stdout?.on('data', (d: Buffer | string) => { out = keep(out, String(d)); });
    child.stderr?.on('data', (d: Buffer | string) => { err = keep(err, String(d)); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, ms);
    timer.unref?.();
    const abort = (): void => { aborted = true; child.kill(); };
    env.signal?.addEventListener('abort', abort);
    child.on('error', e => { clearTimeout(timer); env.signal?.removeEventListener('abort', abort); reject(new Error(`${name} did not start: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer); env.signal?.removeEventListener('abort', abort);
      if (aborted) { reject(new Error('The command was stopped: its run ended.')); return; }
      resolve({ exitCode: code, stdout: tail(out), stderr: tail(err), ...(timedOut ? { timedOut: true as const } : {}) });
    });
  });
}

const fsTimeout = (env: NativeEnv): number => Math.max(1000, Math.min(FS_MAX_MS, env.maxMs ?? FS_MAX_MS));
const fsOpts = (env: NativeEnv): { timeoutMs: number; signal?: AbortSignal } => ({ timeoutMs: fsTimeout(env), ...(env.signal ? { signal: env.signal } : {}) });
const runner = (env: NativeEnv): FsRunner => env.fsRun ?? workerRunner;

async function read(input: In, env: NativeEnv): Promise<string> {
  const file = at(env.cwd, str(input.file_path, 'file_path'));
  const from = Math.max(1, num(input.offset) ?? 1), count = Math.max(1, num(input.limit) ?? READ_LINES);
  const r = await runner(env)({ op: 'read', file, from, count }, fsOpts(env));
  return r.op === 'read' ? r.text : '';
}

function write(input: In, cwd: string): string {
  const file = at(cwd, str(input.file_path, 'file_path'));
  if (typeof input.content !== 'string') throw new Error('content is required (a string)');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.content, 'utf8');
  return `wrote ${Buffer.byteLength(input.content)} bytes to ${file}`;
}

function edit(input: In, cwd: string): string {
  const file = at(cwd, str(input.file_path, 'file_path'));
  const old = str(input.old_string, 'old_string');
  if (typeof input.new_string !== 'string') throw new Error('new_string is required (a string)');
  if (old === input.new_string) throw new Error('old_string and new_string are the same');
  if (fs.statSync(file).size > FS_LIMITS.maxFileBytes) throw new Error(`${file} is over ${FS_LIMITS.maxFileBytes / 1048576} MB: Edit does not take it`);
  const text = fs.readFileSync(file, 'utf8');
  const n = text.split(old).length - 1;
  if (!n) throw new Error(`old_string not found in ${file}`);
  if (n > 1 && input.replace_all !== true) throw new Error(`old_string found ${n} times in ${file}: give more context or replace_all true`);
  fs.writeFileSync(file, input.replace_all === true ? text.split(old).join(input.new_string) : text.replace(old, () => input.new_string as string), 'utf8');
  return `edited ${file} (${input.replace_all === true ? n : 1} replacement${n > 1 && input.replace_all === true ? 's' : ''})`;
}

/** A glob (**, *, ?, {a,b}) as a RegExp over a relative path with /; a pattern with no / matches the file name anywhere. */
export function globRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') { re += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += pattern[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = pattern.indexOf('}', i); if (end < 0) { re += '\\{'; continue; } re += `(?:${pattern.slice(i + 1, end).split(',').map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`; i = end; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern.includes('/') ? '' : '(?:.*/)?'}${re}$`, process.platform === 'win32' ? 'i' : '');
}

/** The files under a search's root (or the root itself, a file), less what the chat's rules keep from reading. */
async function files(root: string, env: NativeEnv, only: RegExp | null): Promise<{ base: string; list: string[] }> {
  const r = await runner(env)({ op: 'walk', root }, fsOpts(env));
  if (r.op !== 'walk') return { base: root, list: [] };
  const base = r.single ? path.dirname(root) : root;
  const list = r.files.filter(f => (r.single || !only || only.test(f)) && (!env.readable || env.readable(path.join(base, f))));
  return { base, list };
}

async function glob(input: In, env: NativeEnv): Promise<string[]> {
  const root = at(env.cwd, typeof input.path === 'string' && input.path ? input.path : '.');
  const re = globRegExp(str(input.pattern, 'pattern'));
  const { base, list } = await files(root, env, null);
  return list.filter(f => re.test(f)).map(f => path.join(base, f));
}

async function grep(input: In, env: NativeEnv): Promise<string> {
  const root = at(env.cwd, typeof input.path === 'string' && input.path ? input.path : '.');
  // a leading (?i) (PCRE, ripgrep) is read as -i: JavaScript has no such inline flag
  const asked = str(input.pattern, 'pattern'), inline = /^\(\?i\)/.test(asked);
  const pattern = inline ? asked.slice(4) : asked;
  if (!pattern) throw new Error('pattern is required (a string)');
  // a bad pattern fails here, before any thread work (compiling never runs it)
  try { new RegExp(pattern); } catch (e) { throw new Error(`${(e as Error).message}: pattern is a JavaScript regex (no inline flags such as (?s); case-insensitive is "-i": true)`); }
  const only = typeof input.glob === 'string' && input.glob ? globRegExp(input.glob) : null;
  const mode = input.output_mode === 'content' || input.output_mode === 'count' ? input.output_mode : 'files_with_matches';
  const { base, list } = await files(root, env, only);
  const r = await runner(env)({ op: 'grep', base, files: list, pattern, ignoreCase: inline || input['-i'] === true, mode, limit: num(input.head_limit) ?? 250 }, fsOpts(env));
  return tail(r.op === 'grep' ? r.lines.join('\n') : '');
}
