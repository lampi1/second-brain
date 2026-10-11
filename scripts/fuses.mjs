// Electron fuses of a binary: check them, and turn ON cookie encryption at rest (EnableCookieEncryption, wire index 1).
// Electron ships with it OFF, so cookies (sign-in sessions of the browser environments) would sit in plaintext on disk;
// with it ON Chromium encrypts them with a key protected by Windows DPAPI (ADR 0003). RunAsNode stays as it is (the
// release launcher and the brain tools need it). One-way for a profile: a binary without the fuse cannot read
// encrypted cookies back (they are dropped, the user signs in again).
// Usage: node scripts/fuses.mjs [--enable-cookie-encryption] [path/to/electron.exe]   (default: node_modules electron)
// Used by scripts/release.mjs on the stable runtime copy. Close every app running from that binary first (Windows
// locks a running .exe).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const NAMES = ['RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges', 'WasmTrapHandlers'];

function wireAt(buf) {
  const i = buf.indexOf(SENTINEL);
  if (i < 0) throw new Error('fuse sentinel not found: not an Electron binary?');
  const p = i + SENTINEL.length;
  if (buf[p] !== 1) throw new Error(`unknown fuse wire version ${buf[p]}`);
  return { start: p + 2, length: buf[p + 1] };
}

export function readFuses(exe) {
  const buf = fs.readFileSync(exe);
  const { start, length } = wireAt(buf);
  return Object.fromEntries([...buf.subarray(start, start + length)].map((c, i) => [NAMES[i] ?? `fuse${i}`, String.fromCharCode(c)]));
}

/** Turns EnableCookieEncryption on (idempotent). Returns 'already' | 'enabled'. */
export function ensureCookieEncryption(exe) {
  const buf = fs.readFileSync(exe);
  const { start, length } = wireAt(buf);
  if (length < 2) throw new Error('fuse wire too short');
  const at = start + 1;
  if (buf[at] === 0x31) return 'already';
  if (buf[at] !== 0x30) throw new Error(`EnableCookieEncryption is "${String.fromCharCode(buf[at])}" (removed?): not changed`);
  buf[at] = 0x31;
  const tmp = `${exe}.fuses-tmp`;
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, exe); } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`cannot replace ${exe} (${e.code ?? e.message}): close every app running from it and try again`);
  }
  return 'enabled';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const exe = args.find(a => !a.startsWith('--')) ?? path.join(repo, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  try {
    if (args.includes('--enable-cookie-encryption')) console.log(`EnableCookieEncryption: ${ensureCookieEncryption(exe)} (${exe})`);
    console.log(JSON.stringify(readFuses(exe), null, 1));
  } catch (e) {
    console.error(`fuses: ${e.message}`);
    process.exit(1);
  }
}
