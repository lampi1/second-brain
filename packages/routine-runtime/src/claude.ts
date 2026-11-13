// The default EngineRunner of the routine runtime (ADR 0175): one plain Claude Code session per step attempt,
// `claude -p --output-format stream-json --verbose --permission-mode auto`, the prompt on stdin. No roles, no app MCP:
// only the tools and MCP servers the package declares. The app passes its own command resolution (the embedded engine,
// Electron as Node for a .js) and process-tree kill; a terminal host uses `claude` on PATH. Never through a shell: on
// Windows the command is resolved to claude.exe, or to node + the npm package's cli.js behind a claude.cmd shim, so an
// argument is never re-parsed by cmd.exe.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { EngineRunner, EngineStepOutcome, EngineStepRequest } from './ports';

/** The CLI arguments of one step session (the prompt goes on stdin, never on the command line). */
export function claudeArgs(request: Pick<EngineStepRequest, 'model' | 'effort' | 'allowedTools' | 'mcpConfig'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto'];
  if (request.model) args.push('--model', request.model);
  if (request.effort) args.push('--effort', request.effort);
  if (request.allowedTools?.length) args.push('--allowedTools', request.allowedTools.join(','));
  if (request.mcpConfig) args.push('--mcp-config', request.mcpConfig, '--strict-mcp-config');
  return args;
}

export interface ClaudeEngineOptions {
  /** how to start the CLI with these args (default: `claude` on PATH, resolved by resolveClaudeCommand, no shell) */
  command?(args: string[], env: NodeJS.ProcessEnv): { command: string; args: string[]; env: NodeJS.ProcessEnv };
  /** base environment (default process.env) */
  env?: NodeJS.ProcessEnv;
  /** kills the session's whole process tree (default: child.kill) */
  killTree?(pid: number): void;
}

const sessionIdOf = (line: string): string | undefined => {
  try { const v = JSON.parse(line) as { session_id?: unknown }; return typeof v.session_id === 'string' ? v.session_id : undefined; } catch { return undefined; }
};

/** Finds `claude` on PATH without a shell. Windows: claude.exe as is; a claude.cmd npm shim → the Node running this
 *  process with the package's cli.js. Null when not found. */
export function resolveClaudeCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = fs.existsSync): { command: string; prefix: string[] } | null {
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
  const sep = platform === 'win32' ? ';' : ':', join = platform === 'win32' ? path.win32.join : path.posix.join;
  const dirs = (env[pathKey] ?? '').split(sep).map(d => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const dir of dirs) {
    if (platform !== 'win32') { const file = join(dir, 'claude'); if (exists(file)) return { command: file, prefix: [] }; continue; }
    const exe = join(dir, 'claude.exe');
    if (exists(exe)) return { command: exe, prefix: [] };
    if (exists(join(dir, 'claude.cmd'))) {
      const cli = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (exists(cli)) return { command: process.execPath, prefix: [cli] };
    }
  }
  return null;
}

export function createClaudeEngine(options: ClaudeEngineOptions = {}): EngineRunner {
  const start = options.command ?? ((args: string[], env: NodeJS.ProcessEnv) => {
    const found = resolveClaudeCommand(env);
    if (!found) throw new Error('claude not found on PATH: install Claude Code and run `claude` once to log in');
    return { command: found.command, args: [...found.prefix, ...args], env };
  });
  return {
    run(request: EngineStepRequest): Promise<EngineStepOutcome> {
      return new Promise(resolve => {
        const env = { ...(options.env ?? process.env), ...(request.env ?? {}) };
        let cmd: ReturnType<typeof start>;
        try { cmd = start(claudeArgs(request), env); } catch (e) { resolve({ exitCode: null, error: e instanceof Error ? e.message : String(e) }); return; }
        let sessionId: string | undefined, error: string | undefined, settled = false, buffer = '';
        const child = spawn(cmd.command, cmd.args, { cwd: request.cwd, env: cmd.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const kill = (why: string) => {
          error ??= why;
          if (child.pid !== undefined && options.killTree) { try { options.killTree(child.pid); } catch { child.kill(); } } else child.kill();
        };
        const timer = setTimeout(() => kill(`the step timed out after ${Math.round(request.timeoutMs / 60_000)} min`), request.timeoutMs);
        const onAbort = () => kill('the run was stopped');
        if (request.signal.aborted) onAbort(); else request.signal.addEventListener('abort', onAbort, { once: true });
        const line = (text: string) => { if (!text.trim()) return; sessionId ??= sessionIdOf(text); request.onLine(text); };
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          let i: number;
          while ((i = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
        });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
        const done = (exitCode: number | null) => {
          if (settled) return; settled = true;
          clearTimeout(timer); request.signal.removeEventListener('abort', onAbort);
          if (buffer) line(buffer);
          if (exitCode !== 0 && !error) error = stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `claude exited with ${exitCode}`;
          resolve({ exitCode, ...(sessionId ? { sessionId } : {}), ...(error ? { error } : {}) });
        };
        child.on('error', e => { error ??= `claude could not start: ${e.message}`; done(null); });
        child.on('close', code => done(code));
        child.stdin.on('error', () => { /* the CLI closed stdin early: its exit tells why */ });
        child.stdin.end(request.prompt);
      });
    },
  };
}
