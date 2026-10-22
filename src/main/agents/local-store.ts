// Local Agent/setup records: bounded atomic writes and corrupt-read preservation, used by the catalog and UI services.
// The rename step retries a few times on EPERM/EACCES/EBUSY: on Windows an antivirus, the search indexer or a backup tool
// can hold the target open for a moment (issue #71). A retry that worked logs a warn; only a rename that never worked throws.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { log } from '../log';

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_WAITS_MS = [20, 40, 60, 80, 100];
const sleeper = new Int32Array(new SharedArrayBuffer(4));
/** Synchronous short wait (writeLocal is synchronous by contract: callers save in-line after a mutation). */
function waitSync(ms: number): void { Atomics.wait(sleeper, 0, 0, ms); }

/** Renames tmp over file, retrying transient Windows locks; returns how many retries it needed. */
export function renameWithRetry(tmp: string, file: string, waits: readonly number[] = RENAME_WAITS_MS): number {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return attempt; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!RETRY_CODES.has(code) || attempt >= waits.length) throw e;
      waitSync(waits[attempt]!);
    }
  }
}

/** Bounded, local app data. A failed/corrupt read is never silently overwritten. */
export function readLocal(file: string): unknown {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8_000_000) throw new Error('Archivio locale non valido. Il file originale è stato conservato.');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function writeLocal(file: string, value: unknown): void {
  writeLocalText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** writeLocal of a body the caller already serialized (agent-runs.json: compact, serialized once). */
export function writeLocalText(file: string, body: string): void {
  if (Buffer.byteLength(body, 'utf8') > 8_000_000) throw new Error('Archivio locale troppo grande. Il file precedente è conservato.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { const s = fs.lstatSync(file); if (!s.isFile() || s.nlink !== 1) throw new Error('Archivio locale collegato: scrittura rifiutata.'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, body, { flag: 'wx', mode: 0o600 });
    const retries = renameWithRetry(tmp, file);
    if (retries > 0) log.warn('agents', 'local store saved after a retried rename', { data: { file: path.basename(file), retries }, hint: 'another process held the file for a moment (antivirus, indexer, backup); nothing was lost' });
  } finally { try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ } }
}
