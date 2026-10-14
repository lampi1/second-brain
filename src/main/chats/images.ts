// Images attached to a message (pasted or dropped screenshots). chat:send comes from the renderer, so nothing is
// trusted: only png/jpeg/gif/webp whose first bytes match the type, real base64 of at most IMAGE_MAX_BYTES, at most
// IMAGE_MAX_COUNT per message, previews only as small data:image URLs. Also writes them to files for an engine that
// cannot take image blocks (Cursor without promptCapabilities.image): the message then carries their paths.
// Used by manager.ts (checkImages) and cursor.ts (writeImageFiles).
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, IMAGES_MAX_TOTAL, THUMB_MAX_CHARS, type ImageAttachment } from '../../shared/contract';

const MIME: Record<ImageAttachment['mimeType'], { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: 'webp', magic: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const THUMB = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

/** The images of a chat:send, checked; [] when there are none. Throws an Italian message on anything wrong. */
export function checkImages(v: unknown): ImageAttachment[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error('Immagini non valide.');
  if (v.length > IMAGE_MAX_COUNT) throw new Error(`Troppe immagini: al massimo ${IMAGE_MAX_COUNT} per messaggio.`);
  let total = 0;
  return v.map((raw, i) => {
    const im = (raw ?? {}) as Partial<ImageAttachment>;
    const n = i + 1;
    const kind = typeof im.mimeType === 'string' ? MIME[im.mimeType as ImageAttachment['mimeType']] : undefined;
    if (!kind) throw new Error(`Immagine ${n}: formato non supportato (solo PNG, JPEG, GIF, WebP).`);
    const data = typeof im.data === 'string' ? im.data : '';
    if (!data || data.length % 4 !== 0 || !B64.test(data)) throw new Error(`Immagine ${n}: dati non validi.`);
    const bytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes > IMAGE_MAX_BYTES) throw new Error(`Immagine ${n}: troppo grande (${(bytes / 1e6).toFixed(1)} MB, massimo ${(IMAGE_MAX_BYTES / 1e6).toFixed(1)} MB).`);
    total += bytes;
    if (total > IMAGES_MAX_TOTAL) throw new Error(`Immagini troppo pesanti insieme: al massimo ${(IMAGES_MAX_TOTAL / 1e6).toFixed(0)} MB per messaggio.`);
    if (!kind.magic(Buffer.from(data.slice(0, 24), 'base64'))) throw new Error(`Immagine ${n}: il contenuto non è un ${im.mimeType}.`);
    const thumb = typeof im.thumb === 'string' && im.thumb.length <= THUMB_MAX_CHARS && THUMB.test(im.thumb) ? im.thumb : undefined;
    return { mimeType: im.mimeType as ImageAttachment['mimeType'], data, ...(thumb ? { thumb } : {}) };
  });
}

/** Writes checked images into dir (created) as image-<stamp>-<n>.<ext>; returns their absolute paths. */
export function writeImageFiles(dir: string, images: readonly ImageAttachment[]): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const files: string[] = [];
  try {
    images.forEach((im, i) => {
      const file = path.join(dir, `image-${stamp}-${i + 1}.${MIME[im.mimeType].ext}`);
      fs.writeFileSync(file, Buffer.from(im.data, 'base64'));
      files.push(file);
    });
  } catch (e) {
    // a half-written set never stays on disk: the caller only gets (and later deletes) a complete one
    for (const f of files) fs.rmSync(f, { force: true });
    throw e;
  }
  return files;
}
