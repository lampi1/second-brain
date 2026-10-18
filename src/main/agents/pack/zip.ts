// Bounded ZIP codec for agent packs. Importers inspect bytes before any filesystem write; no external zip tools.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = { packed: 20 * 1024 ** 2, unpacked: 50 * 1024 ** 2, entries: 500, file: 2 * 1024 ** 2, ratio: 100, depth: 8 } as const;
export type PackFiles = Map<string, Buffer>;
const fail = (): never => { throw new Error('Invalid or unsafe agent pack archive'); };
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Windows-safe paths also remain safe on POSIX; reject aliases before materializing any file. */
export function checkPackPath(name: string): void {
  const parts = name.split('/');
  if (!name || name.length > 240 || parts.length > ZIP_LIMITS.depth || /[\\:\x00-\x1f\x7f]/.test(name)
    || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*]/.test(p)
      || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p))) fail();
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function extra(bytes: Buffer): void {
  for (let at = 0; at < bytes.length;) {
    if (at + 4 > bytes.length) fail();
    const id = bytes.readUInt16LE(at), size = bytes.readUInt16LE(at + 2);
    // ZIP64 and Unicode path overrides must never disagree with the validated entry name.
    if (id === 1 || id === 0x7075 || at + 4 + size > bytes.length) fail();
    at += 4 + size;
  }
}

/** Supports stored/deflate and data descriptors; central and local metadata must agree. */
export function readZip(bytes: Buffer): PackFiles {
  if (bytes.length < 22 || bytes.length > ZIP_LIMITS.packed) fail();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) fail();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), central = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count
    || count > ZIP_LIMITS.entries || central + centralSize !== end) fail();
  const files: PackFiles = new Map(), names = new Set<string>(), regions: [number, number][] = [];
  let at = central, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), crc = bytes.readUInt32LE(at + 16);
    const packed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nl = bytes.readUInt16LE(at + 28), el = bytes.readUInt16LE(at + 30), cl = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42), attrs = bytes.readUInt32LE(at + 38), mode = (attrs >>> 16) & 0xf000;
    if (flags & ~0x080e || ![0, 8].includes(method) || bytes.readUInt16LE(at + 34) || (mode && mode !== 0x8000 && mode !== 0x4000)
      || size > ZIP_LIMITS.file || size > Math.max(1, packed) * ZIP_LIMITS.ratio || at + 46 + nl + el + cl > end) fail();
    const rawName = bytes.subarray(at + 46, at + 46 + nl), name = decoder.decode(rawName), directory = name.endsWith('/');
    const normalized = directory ? name.slice(0, -1) : name;
    checkPackPath(normalized);
    if (names.has(normalized.toLowerCase()) || directory && size !== 0 || !directory && mode === 0x4000) fail();
    names.add(normalized.toLowerCase());
    extra(bytes.subarray(at + 46 + nl, at + 46 + nl + el));
    total += size;
    if (total > ZIP_LIMITS.unpacked || local + 30 > central || bytes.readUInt32LE(local) !== 0x04034b50) fail();
    const lnl = bytes.readUInt16LE(local + 26), lel = bytes.readUInt16LE(local + 28), start = local + 30 + lnl + lel;
    if (start + packed > central || flags !== bytes.readUInt16LE(local + 6) || method !== bytes.readUInt16LE(local + 8)
      || !rawName.equals(bytes.subarray(local + 30, local + 30 + lnl))) fail();
    extra(bytes.subarray(local + 30 + lnl, start));
    if (!(flags & 8) && (crc !== bytes.readUInt32LE(local + 14) || packed !== bytes.readUInt32LE(local + 18) || size !== bytes.readUInt32LE(local + 22))) fail();
    let finish = start + packed;
    if (flags & 8) {
      if (finish + 12 > central) fail();
      if (bytes.readUInt32LE(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > central || bytes.readUInt32LE(finish) !== crc || bytes.readUInt32LE(finish + 4) !== packed || bytes.readUInt32LE(finish + 8) !== size) fail();
      finish += 12;
    }
    if (regions.some(([a, b]) => local < b && finish > a)) fail();
    regions.push([local, finish]);
    const data = bytes.subarray(start, start + packed);
    const body = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: Math.max(1, size) });
    if (body.length !== size || crc32(body) !== crc) fail();
    if (!directory) files.set(name, body);
    at += 46 + nl + el + cl;
  }
  if (at !== end) fail();
  for (const name of files.keys()) {
    const parts = name.toLowerCase().split('/');
    parts.pop();
    while (parts.length) { if ([...files.keys()].some(k => k.toLowerCase() === parts.join('/'))) fail(); parts.pop(); }
  }
  return files;
}

/** Stable timestamps/order make repeated exports byte-identical. Highly compressible text is stored to respect ratio limits. */
export function writeZip(files: PackFiles): Buffer {
  if (files.size > ZIP_LIMITS.entries) fail();
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    checkPackPath(name);
    if (body.length > ZIP_LIMITS.file) fail();
    const encoded = Buffer.from(name), compressed = deflateRawSync(body);
    const method = compressed.length < body.length && body.length <= compressed.length * ZIP_LIMITS.ratio ? 8 : 0;
    const data = method ? compressed : body, crc = crc32(body);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(encoded.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    local.copy(central, 8, 6, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, encoded, data); centrals.push(central, encoded); offset += local.length + encoded.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...locals, directory, end]);
  readZip(result);
  return result;
}
