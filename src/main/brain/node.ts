// Runs the brain's own Node tools (chats.mjs, cost.mjs, brain-site.mjs) as child processes of the app. Why: the brain
// is data plus its tools (ADR 0004); Electron's binary runs them as plain Node with ELECTRON_RUN_AS_NODE=1 set for that
// child only, so no separate Node install is needed and the app itself never runs as Node. Used by live.ts (chat
// poll), usage.ts (cost), estimates.ts (backfill) and api.ts (data server). Tests pass a real `node` instead.
import { execFile } from 'node:child_process';

/** How to start a Node child: the executable and its environment. */
export interface NodeRunner { exe: string; env: NodeJS.ProcessEnv }

/** In the Electron main process: Electron as Node. Elsewhere (unit tests under plain Node): the same binary. */
export function electronNode(): NodeRunner {
  return { exe: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
}

export interface RunResult { stdout: string; stderr: string; code: number | null; error?: string }

/** Runs `script args` in `cwd`; resolves always (never rejects): a failure comes back as code/error with stderr.
 *  input = what the script reads on its stdin (closed right after; none: closed at once). */
export function runNode(node: NodeRunner, script: string, args: string[], cwd: string, timeoutMs = 60000, input?: string): Promise<RunResult> {
  return new Promise(resolve => {
    const child = execFile(node.exe, [script, ...args], { cwd, env: node.env, timeout: timeoutMs, maxBuffer: 64e6, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null) : 0;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code, ...(err ? { error: err.message } : {}) });
    });
    child.stdin?.on('error', () => { /* the script exited without reading it: its exit code says the rest */ });
    child.stdin?.end(input ?? '');
  });
}
