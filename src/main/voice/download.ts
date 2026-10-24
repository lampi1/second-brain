// Downloads a voice model part (main/voice/catalog.ts) into userData/voice/<part id>/ and checks every file before it is
// used (ADR 0152): sha256 of the bytes or the git blob id, a .part file renamed only after the hash matches, a stalled
// transfer aborted. A .tar.bz2 part (Piper voices) is unpacked with seek-bzip and the small tar reader below, its top
// folder dropped, every entry kept inside the part's folder. The folder gets a `.ok` marker only when all its files
// passed, so a half-done part is never loaded. Runs in the voice process (worker.ts), never in main's event loop.
// Pinned by test/unit/voice-download.test.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Bunzip from 'seek-bzip';
import type { VoiceFile, VoicePart } from './catalog';

const STALL_MS = 30_000;
const OK = '.ok';

export const partDir = (root: string, p: VoicePart): string => path.join(root, p.id);
export const partReady = (root: string, p: VoicePart): boolean => fs.existsSync(path.join(partDir(root, p), OK));

/** Hash check of a whole buffer (sha256, or git's blob sha1 with its size). */
export function verify(bytes: Uint8Array, check: VoiceFile['check']): boolean {
  if ('sha256' in check) return crypto.createHash('sha256').update(bytes).digest('hex') === check.sha256;
  if (bytes.length !== check.size) return false;
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === check.gitBlob;
}

/** Fetches one file to `dest` (streamed, hashed on the way). progress gets the bytes of this file so far. */
async function fetchFile(f: VoiceFile, dest: string, progress: (n: number) => void, fetchFn: typeof fetch): Promise<void> {
  const ac = new AbortController();
  const stalled = () => ac.abort(new Error(`download di ${f.name} fermo da ${STALL_MS / 1000} s`));
  let stall = setTimeout(stalled, STALL_MS);
  const part = `${dest}.part`;
  try {
    const res = await fetchFn(f.url, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download di ${f.name}: HTTP ${res.status}`);
    const out = fs.createWriteStream(part);
    const sha256 = crypto.createHash('sha256'), chunks: Uint8Array[] = [];
    let n = 0;
    try {
      for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
        clearTimeout(stall); stall = setTimeout(stalled, STALL_MS);
        if ('sha256' in f.check) sha256.update(c); else chunks.push(c);
        if (!out.write(c)) await new Promise<void>(r => out.once('drain', () => r()));
        n += c.length; progress(n);
      }
      await new Promise<void>((ok, ko) => out.end((e?: Error | null) => (e ? ko(e) : ok())));
    } catch (e) { out.destroy(); throw e; }
    const good = 'sha256' in f.check ? sha256.digest('hex') === f.check.sha256 : verify(Buffer.concat(chunks), f.check);
    if (!good) throw new Error(`${f.name}: l'impronta non corrisponde, file scartato`);
    fs.renameSync(part, dest);
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch { /* best effort */ }
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
  } finally { clearTimeout(stall); }
}

/** Downloads, checks and (for archives) unpacks a part. progress(done) counts bytes over the part's files. */
export async function ensurePart(root: string, p: VoicePart, progress: (done: number) => void, fetchFn: typeof fetch = fetch): Promise<void> {
  const dir = partDir(root, p);
  if (partReady(root, p)) return;
  fs.mkdirSync(dir, { recursive: true });
  let before = 0;
  for (const f of p.files) {
    const dest = path.join(dir, f.name);
    if (!fs.existsSync(dest)) await fetchFile(f, dest, n => progress(before + n), fetchFn);
    before += f.bytes; progress(before);
    if (f.untar) { untarBz2(fs.readFileSync(dest), dir); fs.rmSync(dest, { force: true }); }
  }
  fs.writeFileSync(path.join(dir, OK), new Date().toISOString());
}

/** Unpacks a .tar.bz2 into `dir`, dropping the archive's top folder. Only plain files and folders; a name that would
 *  leave `dir` (absolute, ..) is refused. */
export function untarBz2(bz2: Uint8Array, dir: string): void {
  untar(Bunzip.decode(bz2), dir);
}

export function untar(tar: Buffer, dir: string): void {
  const root = path.resolve(dir);
  let off = 0, longName: string | null = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a: number, b: number) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(345, 500);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue; } // GNU long name
    if (type === 'x' || type === 'g') continue; // pax headers: names here are short enough
    name = name.replace(/\\/g, '/').split('/').slice(1).join('/'); // drop the top folder
    if (!name) continue;
    const dest = path.resolve(root, name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error(`archivio non valido: ${name}`);
    if (type === '5') { fs.mkdirSync(dest, { recursive: true }); continue; }
    if (type !== '0' && type !== '7') continue; // links and devices are never written
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
}
