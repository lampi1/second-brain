// Runs a code block of a chat in Windows PowerShell 5.1 (macOS/Linux: the user's login shell, platform.ts userShell) when the user clicks "Esegui" under it, and streams the output
// back under the block (event run:updated). Why: the user runs the commands his chats propose (the user's brain rules: "Commands
// for him to run: one at a time … one click"); now the click is in the app and the chat can read the outcome (exit code
// + output: app_command_runs on /mcp/app, or "Manda l'esito alla chat").
// Rules:
// - Only the user's click starts a run (IPC run:start from the app page); agents have no way to start one.
// - The code must be a block of that chat's own assistant message (checked here), at most MAX_RUN_CODE characters.
// - A block that looks like production (shared/runnable.ts prodRisk) runs only with confirmProd: the UI asks a
//   second click that says why; the user is the one who runs production, never an agent.
// - powershell.exe -NoProfile -NonInteractive -Command - with a one-line bootstrap on stdin that decodes the block
//   (base64 UTF-16: no quoting issues, accents kept; -EncodedCommand would print errors as CLIXML), in the chat's folder,
//   without the app's own SB_* / ELECTRON_* variables; Stop kills the whole process tree; quitting the app kills all.
// Used by index.ts (IPC run:*), wiring.ts / demo-wiring.ts (built with the chat service), appctl/tools.ts (read-only).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { RunInfo } from '../../shared/contract';
import { MAX_RUN_CODE, prodRisk } from '../../shared/runnable';
import { killTrees } from '../chats/cli';
import { ownProcessGroup, userShell } from '../platform';
import { errText, log } from '../log';

const KEEP = 64_000;       // characters of output kept per run (the tail)
const MAX_RUNS = 50;       // finished runs kept in memory (newest)
const EMIT_MS = 120;       // output updates are batched

export interface RunnerDeps {
  /** the text of an assistant item of that chat, or null when there is no such item */
  itemText(chatId: string, itemId: string): string | null;
  /** the chat's working folder, or null */
  cwdOf(chatId: string): string | null;
  emit(run: RunInfo): void;
  /** test hook: the shell to start (default powershell.exe; $SHELL on macOS/Linux) */
  shell?: string;
}

/** Lines compared without their indentation (marked strips the indent of a fenced block inside a list). */
const flat = (s: string): string => s.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).join('\n').trim();

/** The script PowerShell runs: UTF-8 output, no progress bars, then the block, then an exit code that reflects it
 *  (a native program's exit code, else 1 when the last command failed). */
export function wrapScript(code: string): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$ProgressPreference = 'SilentlyContinue'",
    code,
    '$__sbOk = $?; $__sbCode = $global:LASTEXITCODE',
    'if ($__sbCode) { exit $__sbCode } elseif (-not $__sbOk) { exit 1 } else { exit 0 }',
  ].join('\n');
}

/** The one line powershell.exe reads on stdin: it decodes and runs the whole script in the global scope. */
export function bootstrap(code: string): string {
  const b64 = Buffer.from(wrapScript(code), 'utf16le').toString('base64');
  return `. ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}'))))\n`;
}

export class CommandRunner {
  private runs = new Map<string, RunInfo>();
  private procs = new Map<string, ChildProcess>();
  private timers = new Map<string, NodeJS.Timeout>();
  private seq = 0;

  constructor(private readonly d: RunnerDeps) {}

  list(chatId?: string): RunInfo[] {
    return [...this.runs.values()].filter(r => !chatId || r.chatId === chatId).sort((a, b) => a.startedAt - b.startedAt);
  }

  start(req: { chatId: string; itemId: string; code: string; lang?: string; confirmProd?: boolean }): RunInfo {
    const code = String(req.code ?? '').replace(/\r\n/g, '\n').trimEnd();
    if (!code.trim()) throw new Error('Blocco vuoto: niente da eseguire.');
    if (code.length > MAX_RUN_CODE) throw new Error(`Blocco troppo lungo per Esegui (${code.length} caratteri, massimo ${MAX_RUN_CODE}): copialo e lancialo tu.`);
    const text = this.d.itemText(req.chatId, req.itemId);
    if (text === null || !flat(text).includes(flat(code))) {
      log.warn('run', 'refused: the code is not a block of that chat message', { chat: req.chatId, data: { itemId: req.itemId } });
      throw new Error('Questo comando non è nel messaggio della chat: non lo eseguo.');
    }
    const risk = prodRisk(code);
    if (risk && !req.confirmProd) throw new Error(`Comando di produzione (${risk}): conferma con un secondo clic.`);
    if ([...this.runs.values()].some(r => r.chatId === req.chatId && r.itemId === req.itemId && r.code === code && r.state === 'running')) {
      throw new Error('Questo comando è già in esecuzione.');
    }
    const cwd = this.d.cwdOf(req.chatId);
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(SB_|ELECTRON_)/i.test(k)) env[k] = v;
    const id = `run-${Date.now().toString(36)}-${++this.seq}`;
    const run: RunInfo = { id, chatId: req.chatId, itemId: req.itemId, code, cwd: dir, state: 'running', exitCode: null, output: '', startedAt: Date.now(), ...(risk ? { prod: risk } : {}) };
    this.runs.set(id, run);
    this.trim();
    const sh = userShell(code);
    const shell = this.d.shell ?? sh.command;
    log.info('run', 'start', { chat: req.chatId, data: { id, cwd: dir, chars: code.length, prod: risk ?? null } });
    let p: ChildProcess;
    try {
      p = spawn(shell, sh.args, { cwd: dir, env, windowsHide: true, detached: ownProcessGroup(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return this.end(id, 'error', null, `\nNon parte: ${errText(e)}`);
    }
    this.procs.set(id, p);
    p.stdin?.on('error', () => {}); // a shell that dies at once closes stdin under us: the close handler reports it
    p.stdin?.end(sh.stdin ? bootstrap(code) : undefined);
    p.stdout?.setEncoding('utf8'); // decoded across chunks: an accent split in two stays one letter
    p.stderr?.setEncoding('utf8');
    const add = (d: Buffer | string) => { this.append(id, typeof d === 'string' ? d : d.toString('utf8')); };
    p.stdout?.on('data', add);
    p.stderr?.on('data', add);
    p.on('error', e => { this.end(id, 'error', null, `\nNon parte: ${errText(e)}`); });
    p.on('close', (c: number | null) => {
      const cur = this.runs.get(id);
      if (!cur || cur.state !== 'running') return;
      this.end(id, c === 0 ? 'ok' : 'error', c);
    });
    this.d.emit({ ...run });
    return { ...run };
  }

  stop(runId: string): void {
    const p = this.procs.get(runId);
    const run = this.runs.get(runId);
    if (!run || run.state !== 'running') return;
    log.info('run', 'stop', { chat: run.chatId, data: { id: runId } });
    this.end(runId, 'stopped', null, '\n(fermato)');
    if (p?.pid) killTrees([p.pid], { fallback: () => p.kill() });
  }

  /** App quit: the runs' trees killed by a detached taskkill, never waited for (a blocking wait held the quit past its
   *  cap on a loaded machine); the shells die with the app anyway (libuv's kill-on-close job). */
  shutdown(): void {
    const pids = [...this.procs.values()].map(p => p.pid);
    killTrees(pids);
    this.procs.clear();
  }

  private append(id: string, text: string): void {
    const run = this.runs.get(id);
    if (!run || run.state !== 'running') return;
    const out = run.output + text.replace(/\r\n/g, '\n');
    run.output = out.length > KEEP ? `…${out.slice(-KEEP)}` : out;
    if (!this.timers.has(id)) {
      const t = setTimeout(() => { this.timers.delete(id); const r = this.runs.get(id); if (r) this.d.emit({ ...r }); }, EMIT_MS);
      t.unref?.();
      this.timers.set(id, t);
    }
  }

  private end(id: string, state: RunInfo['state'], exitCode: number | null, tail = ''): RunInfo {
    const run = this.runs.get(id)!;
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    this.procs.delete(id);
    if (run.state === 'running') {
      run.state = state;
      run.exitCode = exitCode;
      run.endedAt = Date.now();
      if (tail) run.output += tail;
      log.info('run', 'end', { chat: run.chatId, data: { id, state, exitCode, ms: run.endedAt - run.startedAt } });
    }
    this.d.emit({ ...run });
    return { ...run };
  }

  private trim(): void {
    const done = [...this.runs.values()].filter(r => r.state !== 'running').sort((a, b) => a.startedAt - b.startedAt);
    while (this.runs.size > MAX_RUNS && done.length) this.runs.delete(done.shift()!.id);
  }
}
