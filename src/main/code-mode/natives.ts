// run_code's thin wrappers for the native tools a Code Mode chat no longer sees (ADR 0331): Bash (Git Bash on
// Windows, as Claude Code; /bin/sh elsewhere), Read, Write, Edit, Grep and Glob over Node fs, with Claude's own input
// names. They only execute: the permission chain ran before (code-mode/bridge.ts → ChatManager.decideFor). Paths are
// the chat's folder's when relative. Used by code-mode/bridge.ts and its tests (a fake spawn: no real process).
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { gitBashPath } from '../platform';
import type { NativeWrapper } from './policy';

/** the subset of child_process.spawn the Bash wrapper uses (tests pass a fake) */
export type Spawn = (command: string, args: string[], opts: SpawnOptions) => {
  stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null;
  on(event: 'close', fn: (code: number | null) => void): unknown; on(event: 'error', fn: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
};

export interface NativeEnv { cwd: string; spawn?: Spawn; shell?: string | null; env?: NodeJS.ProcessEnv; signal?: AbortSignal }

const OUT_MAX = 30_000;
const BASH_DEFAULT_MS = 120_000, BASH_MAX_MS = 600_000;
const READ_LINES = 2000, LINE_MAX = 2000;
const WALK_MAX = 20_000;
const SKIP_DIRS = new Set(['node_modules', '.git']);

const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || !v) throw new Error(`${name} is required (a string)`); return v; };
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const tail = (s: string, max = OUT_MAX): string => (s.length > max ? `… [${s.length - max} characters cut]\n${s.slice(-max)}` : s);
const at = (cwd: string, p: string): string => path.resolve(cwd, p);
type In = Record<string, unknown>;

/** One native wrapper call. Throws an Error the script may catch (a missing file, a failed edit). */
export async function runNative(tool: NativeWrapper, input: In, env: NativeEnv): Promise<unknown> {
  switch (tool) {
    case 'Bash': return bash(input, env);
    case 'Read': return read(input, env.cwd);
    case 'Write': return write(input, env.cwd);
    case 'Edit': return edit(input, env.cwd);
    case 'Grep': return grep(input, env.cwd);
    case 'Glob': return glob(input, env.cwd);
  }
}

function bash(input: In, env: NativeEnv): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut?: true }> {
  const command = str(input.command, 'command');
  const shell = env.shell === undefined ? gitBashPath() : env.shell;
  if (!shell) throw new Error('Git Bash not found (set CLAUDE_CODE_GIT_BASH_PATH): Bash cannot run');
  const ms = Math.min(Math.max(num(input.timeout) ?? BASH_DEFAULT_MS, 1000), BASH_MAX_MS);
  const spawn = env.spawn ?? (nodeSpawn as unknown as Spawn);
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-c', command], { cwd: env.cwd, env: env.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    const keep = (s: string, add: string): string => { const n = s + add; return n.length > OUT_MAX * 2 ? n.slice(-OUT_MAX * 2) : n; };
    child.stdout?.on('data', (d: Buffer | string) => { out = keep(out, String(d)); });
    child.stderr?.on('data', (d: Buffer | string) => { err = keep(err, String(d)); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, ms);
    timer.unref?.();
    const abort = (): void => { child.kill(); };
    env.signal?.addEventListener('abort', abort);
    child.on('error', e => { clearTimeout(timer); env.signal?.removeEventListener('abort', abort); reject(new Error(`Bash did not start: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer); env.signal?.removeEventListener('abort', abort);
      resolve({ exitCode: code, stdout: tail(out), stderr: tail(err), ...(timedOut ? { timedOut: true as const } : {}) });
    });
  });
}

function read(input: In, cwd: string): string {
  const file = at(cwd, str(input.file_path, 'file_path'));
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const from = Math.max(1, num(input.offset) ?? 1), count = Math.max(1, num(input.limit) ?? READ_LINES);
  return lines.slice(from - 1, from - 1 + count).map((l, i) => `${from + i}\t${l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l}`).join('\n');
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
  const text = fs.readFileSync(file, 'utf8');
  const n = text.split(old).length - 1;
  if (!n) throw new Error(`old_string not found in ${file}`);
  if (n > 1 && input.replace_all !== true) throw new Error(`old_string found ${n} times in ${file}: give more context or replace_all true`);
  fs.writeFileSync(file, input.replace_all === true ? text.split(old).join(input.new_string) : text.replace(old, () => input.new_string as string), 'utf8');
  return `edited ${file} (${input.replace_all === true ? n : 1} replacement${n > 1 && input.replace_all === true ? 's' : ''})`;
}

/** Every file under dir (node_modules and .git left out), relative paths with /, at most WALK_MAX. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string, rel: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= WALK_MAX) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(path.join(d, e.name), r); }
      else if (e.isFile()) out.push(r);
    }
  };
  go(dir, '');
  return out;
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

function glob(input: In, cwd: string): string[] {
  const root = at(cwd, typeof input.path === 'string' && input.path ? input.path : '.');
  const re = globRegExp(str(input.pattern, 'pattern'));
  return walk(root).filter(f => re.test(f)).map(f => path.join(root, f));
}

function grep(input: In, cwd: string): string {
  const root = at(cwd, typeof input.path === 'string' && input.path ? input.path : '.');
  const re = new RegExp(str(input.pattern, 'pattern'), input['-i'] === true ? 'i' : '');
  const only = typeof input.glob === 'string' && input.glob ? globRegExp(input.glob) : null;
  const mode = input.output_mode === 'content' || input.output_mode === 'count' ? input.output_mode : 'files_with_matches';
  const limit = num(input.head_limit) ?? 250;
  const single = fs.existsSync(root) && fs.statSync(root).isFile();
  const files = single ? [path.basename(root)] : walk(root).filter(f => !only || only.test(f));
  const base = single ? path.dirname(root) : root;
  const out: string[] = [];
  for (const f of files) {
    if (limit > 0 && out.length >= limit) break;
    let text: string;
    try { text = fs.readFileSync(path.join(base, f), 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue; // a binary file
    const full = path.join(base, f);
    if (mode === 'files_with_matches') { if (re.test(text)) out.push(full); continue; }
    const lines = text.split(/\r?\n/);
    if (mode === 'count') { const n = lines.filter(l => re.test(l)).length; if (n) out.push(`${full}:${n}`); continue; }
    lines.forEach((l, i) => { if ((limit <= 0 || out.length < limit) && re.test(l)) out.push(`${full}:${i + 1}:${l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l}`); });
  }
  return tail(out.join('\n'));
}
