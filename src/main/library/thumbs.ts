// Memoria → Artifact (ADR 0318): an image artifact's card picture, scaled down in main with Electron's nativeImage (the
// page never decodes the full file). Its size is read from the header first (agents/raster.ts) and a picture over the
// limits is never decoded, like the viewer's own rule (file-view.ts). Used by index.ts as LibraryPorts.thumbnail.
import fs from 'node:fs';
import path from 'node:path';
import type { NativeImage } from 'electron';
import { magicMatches } from '../ask-image';
import { rasterSize } from '../agents/raster';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_BYTES = 16_000_000;
const WIDTH = 480;

export function nativeThumb(native: { createFromBuffer(b: Buffer): NativeImage }): (file: string) => Promise<string | null> {
  return async file => {
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return null;
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = await fs.promises.readFile(file);
    const size = rasterSize(buf, mime);
    if (!magicMatches(mime, buf.subarray(0, 12)) || !size || size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192 || size.width * size.height > 24_000_000) return null;
    const img = native.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const small = size.width > WIDTH ? img.resize({ width: WIDTH, quality: 'good' }) : img;
    return `data:image/jpeg;base64,${small.toJPEG(80).toString('base64')}`;
  };
}
