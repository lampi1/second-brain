// Is cookie encryption at rest on for the running Electron binary? Electron ships with its EnableCookieEncryption fuse
// OFF: cookies are then stored in plaintext in <userData>/Partitions/<env>/Network/Cookies (verified 2026-10-11 on
// 44.4.5). With the fuse on, Chromium encrypts cookie values (AES-GCM, "v10") with a key that Windows DPAPI protects
// for the user (Local State os_crypt.encrypted_key). scripts/fuses.mjs flips it (release.mjs does it for the stable
// copy). This module only reads the fuse wire, streaming the binary, so the app can warn and show it per environment.
// Pure apart from file reading; unit-tested; used by browser/tabs.ts.
import fs from 'node:fs';

export const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
export const FUSE_COOKIE_ENCRYPTION = 1;            // index in the v1 wire (0 = RunAsNode)

/** The fuse wire ("101100011") right after the sentinel in a buffer, or null. */
export function readFuseWire(buf: Buffer): string | null {
  const i = buf.indexOf(FUSE_SENTINEL);
  if (i < 0) return null;
  const p = i + FUSE_SENTINEL.length;
  const len = buf[p + 1];
  if (buf[p] !== 1 || len === undefined || p + 2 + len > buf.length) return null;
  return buf.subarray(p + 2, p + 2 + len).toString('latin1');
}

/** true / false from the binary's fuse wire; null when it cannot be read (not an Electron binary, unknown wire).
 *  The wire sits near the end of electron.exe: the last 24 MB are read first, the whole file only if needed. */
export async function cookieEncryptionEnabled(exe: string): Promise<boolean | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(exe, 'r');
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 24 * 1024 * 1024);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const wireTail = readFuseWire(tail);
    if (wireTail && wireTail.length > FUSE_COOKIE_ENCRYPTION) {
      const c = wireTail[FUSE_COOKIE_ENCRYPTION];
      return c === '1' ? true : c === '0' ? false : null;
    }
    const chunk = 8 * 1024 * 1024, keep = 128;
    const buf = Buffer.alloc(chunk + keep);
    let carry = 0;
    for (let pos = 0; pos < size; pos += chunk) {
      const { bytesRead } = await fh.read(buf, carry, chunk, pos);
      const view = buf.subarray(0, carry + bytesRead);
      const at = view.indexOf(FUSE_SENTINEL);
      if (at >= 0) {
        const tail = Buffer.alloc(FUSE_SENTINEL.length + 2 + 64);
        await fh.read(tail, 0, tail.length, pos - carry + at);
        const wire = readFuseWire(tail);
        if (!wire || wire.length <= FUSE_COOKIE_ENCRYPTION) return null;
        const c = wire[FUSE_COOKIE_ENCRYPTION];
        return c === '1' ? true : c === '0' ? false : null;
      }
      carry = Math.min(keep, view.length);
      view.copy(buf, 0, view.length - carry, view.length);
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}
