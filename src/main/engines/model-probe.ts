// Starts an engine's CLI only to ask for its models (ADR 0256), for engines/model-lists.ts: the same binary and the
// same resolution the chats use (chats/cli.ts), no prompt ever sent (no token spent), killed as soon as the answer
// came or the app quits (ModelLists.stop). Claude Code runs with no MCP server, no claude.ai connector, no hook and no
// saved session; Codex's app-server opens no thread. ACP CLIs are never started here (rule 4: `agent` only for Cursor
// chats; their lists come from their chats). Tests never start a real CLI (engineAllowed); the channel is tested with
// an injected spawn (test/unit/engines/model-probe.test.ts).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { cliArgv, commandFor, engineAllowed, killTrees, resolveAcp, resolveClaude } from '../chats/cli';
import { ownProcessGroup } from '../platform';
import type { LineChannel, OpenProbe } from './model-lists';
import type { EngineDef } from './registry';

type Obj = Record<string, unknown>;
const CLAUDE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--strict-mcp-config', '--no-session-persistence',
  '--settings', JSON.stringify({ disableAllHooks: true })];

type Spawn = typeof spawn;

/** The probe opener of the app: cwd is an empty folder the CLI starts in. */
export function cliProbe(cwd: string, spawnFn: Spawn = spawn): OpenProbe {
  return (e: EngineDef) => {
    try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* spawn reports it */ }
    let start: { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean };
    if (e.kind === 'claude') {
      const cli = resolveClaude()?.path ?? null;
      if (!cli || !fs.existsSync(cli)) return { error: 'motore Claude non trovato' };
      if ((process.env.SB_TEST || process.env.VITEST) && !/\.mjs$/i.test(cli)) return { error: 'nei test il motore reale non parte' };
      start = { ...commandFor(cli, CLAUDE_ARGS, process.env), verbatim: false };
      start.env = { ...start.env, ENABLE_CLAUDEAI_MCP_SERVERS: '0' };
    } else if (e.kind === 'codex') {
      const cmd = resolveAcp(e.id, e.command ?? e.id);
      if (!cmd) return { error: `${e.label} CLI non trovata` };
      if (!engineAllowed(cmd)) return { error: 'nei test il motore reale non parte' };
      try { start = cliArgv(cmd, e.args ?? ['app-server']); } catch (err) { return { error: String(err) }; }
    } else return { error: `${e.label}: non parte solo per chiedere i modelli` };
    return channel(start, cwd, spawnFn);
  };
}

/** A JSON-lines channel on a started CLI (exported for its unit test). */
export function channel(c: { command: string; args: string[]; env: NodeJS.ProcessEnv; verbatim: boolean }, cwd: string, spawnFn: Spawn = spawn): LineChannel | { error: string } {
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawnFn(c.command, c.args, { cwd, env: c.env, windowsHide: true, detached: ownProcessGroup(), stdio: ['pipe', 'pipe', 'ignore'], windowsVerbatimArguments: c.verbatim });
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
    close: () => { try { proc.stdin?.end(); } catch { /* gone */ } if (proc.pid) killTrees([proc.pid], { fallback: () => proc.kill() }); else proc.kill(); },
  };
}

/** GET a JSON listing (an HTTP engine's /models), 20 s at most; a non-2xx answer throws with its status. */
export async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<unknown>;
}
