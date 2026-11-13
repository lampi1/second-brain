// Cross-worktree check:quick mutex. A common Git-directory file records the owner; an OS pipe serializes access
// without racy stale-file deletion. The kernel releases a dead owner's pipe, even after SIGKILL. Used by check-quick.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function checkLockFile(cwd) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return path.join(common, 'check-quick.lock.json');
}

/** Wait budget is only queue time, never the check's execution budget. No PID-only stale deletion (PID reuse/ABA). */
export async function acquireCheckLock(file, { waitMs = 600_000, onWait = console.log } = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('Invalid check lock wait timeout');
  const hash = createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 24);
  // Linux abstract sockets, like Windows named pipes, disappear on process death; no stale socket unlink race.
  if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('check lock supports Windows and Linux');
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\sb-check-${hash}` : `\0sb-check-${hash}`;
  const started = Date.now();
  let announced = false;
  for (;;) {
    const server = net.createServer(socket => socket.end());
    const error = await new Promise(resolve => {
      server.once('error', resolve);
      server.listen(endpoint, () => resolve(null));
    });
    if (!error) {
      const release = () => {
        try { fs.rmSync(file, { force: true }); } finally { server.close(); }
      };
      try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, cwd: process.cwd(), acquiredAt: new Date().toISOString() })); }
      catch (e) { server.close(); throw e; }
      let released = false;
      return () => { if (!released) { released = true; release(); } };
    }
    if (error.code !== 'EADDRINUSE') throw error;
    if (!announced) { onWait(`check:quick: another worktree holds ${file}; waiting (queue timeout ${waitMs} ms)`); announced = true; }
    if (Date.now() - started >= waitMs) throw new Error(`check:quick: lock wait timed out after ${waitMs} ms (checks not started)`);
    await delay(Math.min(250, Math.max(1, waitMs - (Date.now() - started))));
  }
}
