// Starts an engine's CLI only to ask for its models (ADR 0256), for engines/model-lists.ts: the same binary and the
// same resolution the chats use (chats/cli.ts), no prompt ever sent (no token spent), killed as soon as the answer
// came. Claude Code runs with no MCP server and no saved session; Cursor reads the app's own copy of its config folder
// (the one its chats use: rule 6, the user's own Cursor config is never the one started), so it is asked only after
// its first chat in the app made that copy. Tests never start a real CLI (engineAllowed); the unit tests pass fake
// channels to ModelLists instead of this file.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cliArgv, commandFor, engineAllowed, killTrees, resolveAcp, resolveClaude } from '../chats/cli';
import { ownProcessGroup } from '../platform';
import type { LineChannel, OpenProbe } from './model-lists';
import type { EngineDef } from './registry';

type Obj = Record<string, unknown>;
const CLAUDE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--strict-mcp-config', '--no-session-persistence'];

/** The probe opener of the app: userData holds the Cursor config copy; cwd is an empty folder the CLI starts in. */
export function cliProbe(userData: string, cwd: string): OpenProbe {
  return (e: EngineDef) => {
    try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* spawn reports it */ }
    let start: { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean };
    if (e.kind === 'claude') {
      const cli = resolveClaude()?.path ?? null;
      if (!cli || !fs.existsSync(cli)) return { error: 'motore Claude non trovato' };
      if ((process.env.SB_TEST || process.env.VITEST) && !/\.mjs$/i.test(cli)) return { error: 'nei test il motore reale non parte' };
      start = { ...commandFor(cli, CLAUDE_ARGS, process.env), verbatim: false };
    } else {
      const cmd = resolveAcp(e.id, e.command ?? e.id);
      if (!cmd) return { error: `${e.label} CLI non trovata` };
      if (!engineAllowed(cmd)) return { error: 'nei test il motore reale non parte' };
      try { start = cliArgv(cmd, e.args ?? (e.kind === 'codex' ? ['app-server'] : [])); } catch (err) { return { error: String(err) }; }
      if (e.cursorExtras) {
        const dir = path.join(userData, `${e.id}-config`);
        if (!fs.existsSync(dir)) return { error: `${e.label}: l'elenco arriva alla prima chat nell'app` };
        start.env = { ...start.env, CURSOR_CONFIG_DIR: dir };
      }
    }
    return channel(start, cwd);
  };
}

function channel(c: { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean }, cwd: string): LineChannel | { error: string } {
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(c.command, c.args, { cwd, env: c.env, windowsHide: true, detached: ownProcessGroup(), stdio: ['pipe', 'pipe', 'ignore'], windowsVerbatimArguments: c.verbatim });
  } catch (err) { return { error: String(err) }; }
  const seen: Obj[] = [];
  const waiters = new Set<{ match: (m: Obj) => boolean; ok: (m: Obj) => void; ko: (e: Error) => void }>();
  let gone: Error | null = null, buf = '';
  const offer = (m: Obj): void => { seen.push(m); for (const w of waiters) if (w.match(m)) { waiters.delete(w); w.ok(m); } };
  proc.stdout?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try { offer(JSON.parse(line) as Obj); } catch { /* not a message */ }
    }
  });
  const end = (e: Error): void => { gone = gone ?? e; for (const w of waiters) w.ko(gone); waiters.clear(); };
  proc.on('error', err => end(err));
  proc.on('exit', code => end(new Error(`la CLI è uscita (${String(code)}) prima di rispondere`)));
  proc.stdin?.on('error', () => { /* exited: the exit handler reports it */ });
  return {
    send: msg => { if (!gone) proc.stdin?.write(`${JSON.stringify(msg)}\n`); },
    reply: (match, timeoutMs) => {
      const hit = seen.find(match);
      if (hit) return Promise.resolve(hit);
      if (gone) return Promise.reject(gone);
      return new Promise((ok, ko) => {
        const w = { match, ok: (m: Obj) => { clearTimeout(t); ok(m); }, ko: (e: Error) => { clearTimeout(t); ko(e); } };
        const t = setTimeout(() => { waiters.delete(w); ko(new Error(`nessuna risposta in ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        waiters.add(w);
      });
    },
    close: () => { try { proc.stdin?.end(); } catch { /* gone */ } killTrees([proc.pid], { fallback: () => proc.kill() }); },
  };
}

/** GET a JSON listing (an HTTP engine's /models), 20 s at most; a non-2xx answer throws with its status. */
export async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<unknown>;
}
