// Tiny deterministic classic ZIP fixtures, generated offline with stored/deflated bytes and explicit metadata.
import { deflateRawSync } from 'node:zlib';
export interface ZipFixtureEntry { name: string; data?: string | Buffer; mode?: number; length?: number; deflate?: boolean }
export function fixtureZip(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), raw = Buffer.from(entry.data ?? ''), data = entry.deflate ? deflateRawSync(raw) : raw;
    let crc = 0xffffffff;
    for (const byte of raw) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30), header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(entry.length ?? raw.length, 22); local.writeUInt16LE(name.length, 26);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE((3 << 8) | 20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(entry.deflate ? 8 : 0, 10); header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(entry.length ?? raw.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(((entry.mode ?? 0x81a4) * 65536) >>> 0, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, data); central.push(header, name); offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
