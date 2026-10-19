// The process and HTTP primitives the cloud providers use (ADR 0080), behind two small function types so the unit
// tests replay recorded vendor answers (test/fixtures/cloud) and never start a real CLI or call a real API. Real runs:
// the CLIs resolve as the chats resolve them (chats/cli.ts: the embedded Claude, Codex on PATH or SB_CODEX_PATH); a
// Windows npm .cmd shim is run through its own .js target (the prompt is user text: it never goes through cmd.exe,
// whose quoting cannot hold it), and an unsafe argument for cmd.exe fails closed (cliArgv). Under SB_TEST / VITEST only a
// .mjs fake may start (engineAllowed). Used by cursor.ts, codex.ts, claude.ts, repo.ts and service.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cliArgv, engineAllowed, resolveAcp, resolveClaude, type CliCommand } from '../chats/cli';

export interface ExecResult { code: number | null; stdout: string; stderr: string }
/** Runs a program with fixed argv (no shell); `cli` = an engine CLI resolved like the chats', `git` = git on PATH. */
export type Exec = (cli: 'claude' | 'codex' | 'git', args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;
/** fetch, injectable (the Cursor provider): tests pass a fake that answers from fixtures. */
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

/** An npm .cmd shim's JavaScript target ("%dp0%\node_modules\@openai\codex\bin\codex.js"), or null. */
export function shimTarget(shim: string, read: (p: string) => string = p => fs.readFileSync(p, 'utf8')): string | null {
  let text: string;
  try { text = read(shim); } catch { return null; }
  const m = /%~?dp0%?\\?([^"%\r\n]+?\.(?:c|m)?js)"/i.exec(text);
  return m?.[1] ? path.join(path.dirname(shim), m[1].replace(/\\/g, path.sep)) : null;
}

function resolve(cli: 'claude' | 'codex'): CliCommand | null {
  let c: CliCommand | null;
  if (cli === 'claude') {
    const found = resolveClaude(process.env.SB_CLAUDE_PATH);
    c = !found ? null : /\.(m?js|cjs)$/i.test(found.path)
      ? { kind: 'fake', command: process.execPath, prefix: [found.path], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, verbatim: false, display: found.path }
      : /\.(cmd|bat)$/i.test(found.path) ? { kind: 'cmd', command: process.env.ComSpec ?? 'cmd.exe', prefix: [], env: process.env, verbatim: true, display: found.path }
      : { kind: 'exe', command: found.path, prefix: [], env: process.env, verbatim: false, display: found.path };
  } else c = resolveAcp('codex', 'codex');
  if (c?.kind !== 'cmd') return c;
  const js = shimTarget(c.display);
  return js && fs.existsSync(js) ? { kind: 'node', command: process.execPath, prefix: [js], env: { ...c.env, ELECTRON_RUN_AS_NODE: '1' }, verbatim: false, display: c.display } : c;
}

/** The real Exec. A CLI that is not installed answers code null with the reason in stderr. */
export const realExec: Exec = (cli, args, opts = {}) => new Promise(res => {
  let command: string, argv: string[], env: NodeJS.ProcessEnv = process.env, verbatim = false;
  if (cli === 'git') { command = 'git'; argv = args; }
  else {
    const c = resolve(cli);
    if (!c) { res({ code: null, stdout: '', stderr: `${cli} non trovato` }); return; }
    if (!engineAllowed(c)) { res({ code: null, stdout: '', stderr: `${cli}: i test non avviano il programma vero` }); return; }
    try { ({ command, args: argv, env, verbatim } = cliArgv(c, args)); }
    catch (e) { res({ code: null, stdout: '', stderr: (e as Error).message }); return; }
  }
  execFile(command, argv, { cwd: opts.cwd, encoding: 'utf8', timeout: opts.timeoutMs ?? 60_000, windowsHide: true, windowsVerbatimArguments: verbatim, env, maxBuffer: 8 * 1024 * 1024 },
    (err, stdout, stderr) => res({ code: err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
});

export const realHttp: Http = (url, init) => fetch(url, init);
