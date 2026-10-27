// File helpers of the routine runtime (ADR 0175): the atomic rename every store uses (moved from
// src/main/rules/storage.ts, which re-exports it for the rest of the app), and the read-once config of the MCP servers.
import fs from 'node:fs';

/** On Windows an antivirus or indexer briefly holding the target makes rename fail with EPERM/EACCES/EBUSY: retry a
 * few times with a short pause (~1 s in all) before giving up with the real error. */
export function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
}

/** Reads an MCP server's config file and deletes it: the secrets it may hold (a PAT, site passwords) stay on disk only
 *  until the server started, never where the session could read them later. */
export function readConfigOnce<T>(file: string): T {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  try { fs.rmSync(file, { force: true }); } catch { /* the runtime's disposer removes its temp folder */ }
  return config;
}
