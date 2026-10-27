// A tiny zip reader for routine packages (ADR 0175): `routine run <package>.zip` extracts the archive into a private temp
// folder and runs the routine.json inside (at the root or in a single top folder). Only what a package needs: stored
// and deflated entries from the central directory; no zip64, no encryption. Every entry path is checked, so an archive
// can never write outside its folder. Used by cli.ts; no dependency (zlib is Node's).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAX_TOTAL = 64 * 1024 * 1024;

export interface ZipEntry { name: string; data: Buffer }

/** The file entries of a zip buffer (directories skipped). Throws on anything it does not read safely. */
export function readZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16), total = 0;
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip central directory');
    const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10);
    const compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28), extraLen = buffer.readUInt16LE(p + 30), commentLen = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name}: encrypted zip entries are not supported`);
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('broken zip entry');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    total += size;
    if (total > MAX_TOTAL) throw new Error('zip larger than 64 MB once extracted');
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: size + 1 }) : (() => { throw new Error(`${name}: zip method ${method} is not supported`); })();
    if (data.length !== size) throw new Error(`${name}: size mismatch`);
    out.push({ name, data });
  }
  return out;
}

/** Extracts a zip into `dir` (created); returns the folder that holds routine.json (dir itself or its single top folder). */
export function extractPackageZip(file: string, dir: string): string {
  const root = path.resolve(dir);
  for (const entry of readZip(fs.readFileSync(file))) {
    const target = path.resolve(root, entry.name);
    if (!target.startsWith(root + path.sep) || /(^|\/)\.\.(\/|$)/.test(entry.name) || path.isAbsolute(entry.name)) throw new Error(`${entry.name}: unsafe path in zip`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data, { mode: 0o600 });
  }
  if (fs.existsSync(path.join(root, 'routine.json'))) return root;
  const tops = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  if (tops.length === 1 && fs.existsSync(path.join(root, tops[0]!.name, 'routine.json'))) return path.join(root, tops[0]!.name);
  throw new Error('routine.json not found in the zip (at its root or in its single top folder)');
}
