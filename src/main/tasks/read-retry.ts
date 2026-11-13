// Bounded retry for read-only task readers. Explicit transport failures retry; auth, parse and configuration failures
// do not. Callers retain old data until both reads succeed and cancel the wait when their service shuts down.
import type { RunResult } from '../brain/node';
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('tasks/read-retry');
export const transientReadError = (r: RunResult): boolean => r.code !== 0 && !r.killed && /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b/.test(`${r.stderr}\n${r.error ?? ''}`) && !/\b(?:AADSTS\d+|401|403)\b/.test(`${r.stderr}\n${r.error ?? ''}`);
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  });
}
export async function retryTaskRead(run: () => Promise<RunResult>, signal: AbortSignal, current: () => boolean, warn: () => void): Promise<RunResult | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted || !current()) return null;
    let result: RunResult;
    try { result = await run(); } catch (error) { const e = error as { code?: string; message?: string; cause?: { code?: string } }; result = { stdout: '', stderr: [e?.code, e?.cause?.code, e?.message ?? String(error)].filter(Boolean).join(': '), code: 1 }; }
    if (signal.aborted || !current()) return null;
    if (!transientReadError(result) || attempt === 2) return result;
    if (attempt === 0) warn();
    await wait(attempt === 0 ? 1000 : 3000, signal);
  }
  return null;
}
