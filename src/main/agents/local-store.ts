// Local Agent/setup records: bounded atomic writes and corrupt-read preservation, used by the catalog and UI services.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Bounded, local app data. A failed/corrupt read is never silently overwritten. */
export function readLocal(file: string): unknown {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8_000_000) throw new Error('Archivio locale non valido. Il file originale è stato conservato.');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function writeLocal(file: string, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > 8_000_000) throw new Error('Archivio locale troppo grande. Il file precedente è conservato.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { const s = fs.lstatSync(file); if (!s.isFile() || s.nlink !== 1) throw new Error('Archivio locale collegato: scrittura rifiutata.'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, body, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ } }
}
