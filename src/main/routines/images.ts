// Bounded, explicitly requested run screenshots. Full-page captures may be tall; this separate reader does not
// relax the generic file viewer. No decoders or synchronous disk reads run on the Electron main thread.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { confined } from './reader';
import { rasterSize } from '../agents/raster';
import { magicMatches } from '../ask-image';
import type { FileViewResult } from '../../shared/file-view';
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export async function readRoutineImage(dir: string, requested: string): Promise<FileViewResult> {
  if (typeof requested !== 'string' || requested.length > 4096 || /^[\\/]{2}/.test(requested)) return { kind: 'refused', reason: 'outside' };
  const requestedPath = path.resolve(dir, requested);
  const real = await confined(dir, requestedPath);
  const mime = MIME[path.extname(real).toLowerCase()]; if (!mime) return { kind: 'unsupported', reason: 'image' };
  const expected = await fs.lstat(real);
  if (!expected.isFile() || expected.nlink !== 1) return { kind: 'refused', reason: 'changed' };
  const fd = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const first = await fd.stat();
    if (first.dev !== expected.dev || first.ino !== expected.ino) return { kind: 'refused', reason: 'changed' };
    if (!first.isFile() || first.nlink !== 1 || first.size > 8_000_000) return { kind: 'unsupported', reason: 'image' };
    const bytes = Buffer.alloc(first.size + 1);
    let count = 0;
    while (count < bytes.length) { const { bytesRead } = await fd.read(bytes, count, bytes.length - count, count); if (!bytesRead) break; count += bytesRead; }
    const last = await fd.stat(), current = await confined(dir, requestedPath);
    const currentStat = await fs.lstat(current);
    if (!currentStat.isFile() || currentStat.dev !== first.dev || currentStat.ino !== first.ino || first.mtimeMs !== last.mtimeMs || first.ctimeMs !== last.ctimeMs || first.size !== count || current !== real) return { kind: 'refused', reason: 'changed' };
    const data = bytes.subarray(0, count), size = rasterSize(data, mime);
    if (!magicMatches(mime, data) || !size || size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 32768 || size.width * size.height > 32_000_000) return { kind: 'unsupported', reason: 'image' };
    return { kind: 'image', path: real, size: count, mtimeMs: last.mtimeMs, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } finally { await fd.close(); }
}
