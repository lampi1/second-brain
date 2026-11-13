// Runs the user's own PreToolUse hooks for `Write` before the app writes a skill or agent file, so the app obeys the
// same limits as a chat (the brain's brain-limits.mjs: fixed-context budget). Why: ADR 0018, "l'app deve mostrare
// l'errore dell'hook o rispettare lo stesso limite, mai aggirarlo". Hooks come from ~/.claude/settings.json and the
// project's .claude/settings.json / settings.local.json (read only, never written: AGENTS.md rule 6); each command hook
// whose matcher matches "Write" gets the JSON Claude Code would give it on stdin. Refused = exit 2 (stderr is the
// message), or stdout JSON `decision: "block"` / `hookSpecificOutput.permissionDecision: "deny"` (or "ask": the app has
// no one to ask, so it refuses with the hook's reason) / `continue: false`. A matching hook the app cannot run (not
// "command", e.g. "prompt") refuses too: never a silent bypass. Like Claude Code, a hook that fails otherwise or times
// out does not block (logged). Used by skills/service.ts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { errText, log } from '../log';

export interface HookRefusal { command: string; message: string }
export interface GuardInput { home: string; root: string | null; filePath: string; content: string }
interface HookDef { command: string; timeoutS: number; file: string; type: string }
type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

function readJson(file: string): Obj | null {
  try { return o(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))); } catch { return null; }
}

/** Claude Code's matcher: empty or "*" = every tool, else a regex on the tool name (exact match for a plain word). */
export function matches(matcher: unknown, tool: string): boolean {
  const m = typeof matcher === 'string' ? matcher.trim() : '';
  if (!m || m === '*') return true;
  try { return new RegExp(`^(?:${m})$`).test(tool); } catch { return m === tool; }
}

/** The command hooks that would run before a Write, from the settings files that apply to this file. */
export function writeHooks(home: string, root: string | null): HookDef[] {
  const files = [path.join(home, '.claude', 'settings.json')];
  if (root) files.push(path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json'));
  const out: HookDef[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const pre = o(readJson(file)?.hooks).PreToolUse;
    for (const entry of Array.isArray(pre) ? pre.map(o) : []) {
      if (!matches(entry.matcher, 'Write')) continue;
      for (const h of Array.isArray(entry.hooks) ? entry.hooks.map(o) : []) {
        const command = typeof h.command === 'string' ? h.command.trim() : '';
        const type = typeof h.type === 'string' ? h.type : 'command';
        const key = type === 'command' ? command : `${type}:${JSON.stringify(h)}`;
        if ((type === 'command' && !command) || seen.has(key)) continue;
        seen.add(key);
        // the hook's own timeout, as Claude Code (default 60 s); capped at 10 min so a save cannot hang for ever
        out.push({ command: command || `(${type})`, timeoutS: typeof h.timeout === 'number' && h.timeout > 0 ? Math.min(h.timeout, 600) : 60, file, type });
      }
    }
  }
  return out;
}

/** Git Bash, as Claude Code uses it for hooks on Windows; null = run through cmd.exe. */
function bashPath(): string | null {
  const env = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const cands = [env, 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].filter((p): p is string => !!p);
  return process.platform === 'win32' ? cands.find(p => fs.existsSync(p)) ?? null : '/bin/sh';
}

/** Why the hook's answer refuses the write, or null. */
export function refusal(code: number | null, stdout: string, stderr: string): string | null {
  if (code === 2) return stderr.trim() || stdout.trim() || 'rifiutato dall’hook (nessun messaggio)';
  if (code !== 0) return null;
  const t = stdout.trim();
  if (!t.startsWith('{')) return null;
  try {
    const j = o(JSON.parse(t));
    const hs = o(j.hookSpecificOutput);
    if (hs.permissionDecision === 'deny' || hs.permissionDecision === 'ask') return String(hs.permissionDecisionReason ?? j.reason ?? 'rifiutato dall’hook');
    if (j.decision === 'block') return String(j.reason ?? 'rifiutato dall’hook');
    if (j.continue === false) return String(j.stopReason ?? 'rifiutato dall’hook');
  } catch { /* not JSON: plain output, ignored like Claude Code does */ }
  return null;
}

function runHook(h: HookDef, input: string, cwd: string, projectDir: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const bash = bashPath();
    const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
    let child;
    try {
      child = bash
        ? spawn(bash, ['-c', h.command], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${h.command}"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { resolve({ code: null, stdout: '', stderr: errText(e), timedOut: false }); return; }
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout = (stdout + d).slice(-20000); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20000); });
    const timer = setTimeout(() => {
      timedOut = true;
      // the whole tree: on Windows kill() stops bash only, and its child would keep the pipes (and the save) open
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill();
    }, h.timeoutS * 1000);
    child.on('error', e => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr || errText(e), timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => { /* a hook that does not read stdin */ });
    child.stdin.end(input);
  });
}

/** Runs the Write hooks in order; the first refusal wins. null = the write may go on. */
export async function checkWrite(g: GuardInput): Promise<HookRefusal | null> {
  const hooks = writeHooks(g.home, g.root);
  if (!hooks.length) return null;
  const cwd = g.root && fs.existsSync(g.root) ? g.root : g.home;
  const input = JSON.stringify({
    session_id: 'second-brain-app', transcript_path: '', cwd, hook_event_name: 'PreToolUse', permission_mode: 'default',
    tool_name: 'Write', tool_input: { file_path: g.filePath, content: g.content },
  });
  for (const h of hooks) {
    if (h.type !== 'command') {
      log.warn('skills', 'a PreToolUse hook the app cannot run matches Write: the write is refused', { data: { file: g.filePath, type: h.type }, cause: `hook type "${h.type}"`, hint: `save from a Claude chat, or check the hook in ${h.file}` });
      return { command: h.command, message: `Un hook di tipo "${h.type}" in ${h.file} controlla le scritture e l’app non sa eseguirlo: salva da una chat di Claude.` };
    }
    const r = await runHook(h, input, cwd, cwd);
    const why = r.timedOut ? null : refusal(r.code, r.stdout, r.stderr);
    if (why) {
      log.info('skills', 'write refused by a hook', { data: { file: g.filePath, hook: h.command } });
      return { command: h.command, message: why };
    }
    if (r.timedOut || (r.code !== 0 && r.code !== 2)) {
      log.warn('skills', 'a PreToolUse hook failed: the write goes on (as in Claude Code)', { data: { hook: h.command, code: r.code, timedOut: r.timedOut, stderr: r.stderr.slice(0, 400) }, cause: r.timedOut ? 'timeout' : `exit ${r.code}`, hint: `run the hook by hand to see why (${h.file})` });
    }
  }
  return null;
}
