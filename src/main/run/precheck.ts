// The check an Esegui command passes before it is shown to the user (#388): shared/command-check.ts (placeholders,
// interactive shells, missing paths) plus, on Windows, a parse in Windows PowerShell 5.1, the shell Esegui runs it in.
// Why: a command that cannot even start costs the user a run, a failure and a new question; it goes back to the chat
// that wrote it instead (run/asks.ts). The parse never decides alone that a command is good or bad when powershell.exe
// is missing or slow: no answer within PARSE_MS = no problem found (a good command is never held back).
// Used by wiring-shared.ts (attachCommandAsks), pinned by test/unit/command-check.test.ts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { commandProblems } from '../../shared/command-check';
import { errText, log } from '../log';

const PARSE_MS = 8000;

/** The script that parses the block (base64 UTF-16 on stdin, as runner.ts) and prints its parse errors, one per line. */
export function parseScript(code: string): string {
  const b64 = Buffer.from(code, 'utf16le').toString('base64');
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$c = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}'))`,
    '$e = $null; $t = $null',
    '[void][System.Management.Automation.Language.Parser]::ParseInput($c, [ref]$t, [ref]$e)',
    'foreach ($x in $e) { "riga $($x.Extent.StartLineNumber): $($x.Message)" }',
  ].join('\n');
}

/** PowerShell 5.1's parse errors of the block (Italian prefix, the message as Windows writes it); [] when none or unknown. */
export function parseErrors(code: string, shell = 'powershell.exe'): Promise<string[]> {
  return new Promise(resolve => {
    let out = '', done = false;
    const end = (v: string[]): void => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const t = setTimeout(() => { p.kill(); end([]); }, PARSE_MS);
      t.unref?.();
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (b: string) => { out += b; });
      p.stdin.on('error', () => { /* a shell that dies at once closes stdin under us: 'close' answers */ });
      p.on('error', err => { clearTimeout(t); log.debug('run', 'command parse check not available', { cause: errText(err) }); end([]); });
      p.on('close', () => { clearTimeout(t); end(out.split(/\r?\n/).map(l => l.trim()).filter(l => /^riga \d+:/.test(l)).slice(0, 3)); });
      p.stdin.end(`${parseScript(code).split('\n').join('; ')}\n`);
    } catch (err) {
      log.debug('run', 'command parse check not available', { cause: errText(err) });
      end([]);
    }
  });
}

export interface PrecheckDeps { platform?: NodeJS.Platform; exists?(p: string): boolean; parse?(code: string): Promise<string[]> }

/** Every problem found in the block run in that folder ([] = it can start). */
export async function precheckCommand(code: string, cwd: string, d: PrecheckDeps = {}): Promise<string[]> {
  const platform = d.platform ?? process.platform;
  const exists = d.exists ?? ((p: string) => { try { return fs.existsSync(p); } catch { return true; } });
  const found = commandProblems(code, { cwd, exists, env: process.env, home: os.homedir(), platform });
  const parse = d.parse ?? (platform === 'win32' ? (c: string) => parseErrors(c) : null);
  const errs = parse ? await parse(code).catch(() => []) : [];
  return [...found, ...errs.map(e => `non si legge in PowerShell 5.1 (${e})`)];
}
