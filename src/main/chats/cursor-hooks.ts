// Cursor's subagent hooks for chats run through ACP. The CLI (2026.07) never fires subagentStart/subagentStop in an
// `agent acp` session (probe 2026-10-12: beforeShellExecution ran, subagent hooks never did), so the app runs the
// commands the user configured for them in ~/.cursor/hooks.json itself, with the hook's JSON on stdin. Fire and
// forget: output ignored, never blocks the chat, killed at the hook's timeout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../log';
import { killTrees } from './cli';

export type SubagentHook = 'subagentStart' | 'subagentStop';
interface HookCommand { command: string; timeoutMs: number }

/** The CLI's user hooks file: always ~/.cursor/hooks.json (it ignores CURSOR_CONFIG_DIR for hooks). */
export function userHooksFile(): string {
  return path.join(os.homedir(), '.cursor', 'hooks.json');
}

/** The commands configured for one event; a missing or broken file = none. */
export function hookCommands(file: string, event: SubagentHook): HookCommand[] {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as { hooks?: Record<string, unknown> };
    const list = all.hooks?.[event];
    if (!Array.isArray(list)) return [];
    return list.flatMap(h => {
      const c = h as { command?: unknown; timeout?: unknown };
      if (typeof c.command !== 'string' || !c.command.trim()) return [];
      const t = typeof c.timeout === 'number' && c.timeout > 0 ? c.timeout : 30;
      return [{ command: c.command, timeoutMs: t * 1000 }];
    });
  } catch { return []; }
}

/** Runs every command of the event with the payload on stdin; resolves when all ended (tests wait on it). */
export function runSubagentHooks(file: string, event: SubagentHook, payload: Record<string, unknown>, cwd: string): Promise<void> {
  const cmds = hookCommands(file, event);
  const input = JSON.stringify({ hook_event_name: event, ...payload });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return Promise.all(cmds.map(c => new Promise<void>(resolve => {
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(c.command, { shell: true, cwd: fs.existsSync(cwd) ? cwd : os.homedir(), env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (e) { log.warn('chats', 'cursor subagent hook not started', { data: { event, command: c.command, error: String(e) } }); return resolve(); }
    // shell:true → p is cmd.exe: kill the whole tree, or the hook's node would outlive the timeout
    const timer = setTimeout(() => { log.warn('chats', 'cursor subagent hook timed out', { data: { event, command: c.command } }); killTrees([p.pid], { fallback: () => p.kill() }); }, c.timeoutMs);
    timer.unref();
    p.on('error', e => { clearTimeout(timer); log.warn('chats', 'cursor subagent hook failed', { data: { event, command: c.command, error: String(e) } }); resolve(); });
    p.on('close', () => { clearTimeout(timer); resolve(); });
    p.stdin?.on('error', () => { /* the hook did not read its input */ });
    p.stdin?.end(input);
  }))).then(() => undefined);
}
