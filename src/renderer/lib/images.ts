// Pasted or dropped images → message attachments (contract ImageAttachment): base64 data the engines accept (PNG, JPEG,
// GIF, WebP up to IMAGE_MAX_BYTES and MAX_EDGE px, the type read from the bytes, not the file name; anything else is
// re-encoded, scaled down to MAX_EDGE: the API refuses > 8000 px, and > 2000 px once a chat holds 20 images) plus a small WebP
// preview for the composer, the queue and the history. Canvas work runs in the renderer (no Node, no main round trip).
// Used by ChatInput (Ctrl+V, drag and drop: every chat tile and the Regia) and pinned by test/unit/images.test.ts (the
// pure parts).
import { IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, type ImageAttachment } from '@shared/contract';

const DIRECT: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** longest side sent; the Claude API scales anything above ~1568 px down anyway and refuses > 2000 px in long chats */
export const MAX_EDGE = 1920;
const THUMB_W = 240, THUMB_H = 160;

/** The image files of a paste or a drop (clipboard items first: a screenshot shows up there, not always in files). */
export function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const fromItems = [...dt.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f);
  return fromItems.length ? fromItems : [...dt.files].filter(f => f.type.startsWith('image/'));
}

/** What a Ctrl+V in a chat input is: text (the textarea pastes it; text wins, Excel and Word also put a picture of
 *  what was copied), image files, or nothing usable: then main reads the clipboard's image ('clipboard:image'), since
 *  a fresh Windows 11 screenshot (Win+Shift+S, delayed rendering) can reach the paste event as no item at all. */
export type PasteKind = { kind: 'text' } | { kind: 'files'; files: File[] } | { kind: 'main'; seen: string[] };
export function pasteKind(dt: DataTransfer | null): PasteKind {
  if (dt?.getData('text/plain').trim()) return { kind: 'text' };
  const files = imageFiles(dt);
  return files.length ? { kind: 'files', files } : { kind: 'main', seen: dt ? [...dt.types] : [] };
}

/** The real type from the first bytes (a dropped "foto.jpg" may be a WebP); null when not one the engines take. */
export function sniff(head: Uint8Array): ImageAttachment['mimeType'] | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => head[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** What to do with an image: keep the bytes, or re-encode (type not accepted, too heavy, too big) at a scale. */
export function plan(type: string | null, bytes: number, w: number, h: number): { reencode: false } | { reencode: true; scale: number } {
  if (type && DIRECT.includes(type) && bytes <= IMAGE_MAX_BYTES && Math.max(w, h) <= MAX_EDGE) return { reencode: false };
  return { reencode: true, scale: Math.min(1, MAX_EDGE / Math.max(w, h, 1)) };
}

/** Room left in a message for more images. */
export const roomFor = (have: number) => Math.max(0, IMAGE_MAX_COUNT - have);

function draw(bmp: ImageBitmap, w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas non disponibile');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

const toDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error ?? new Error('lettura non riuscita'));
  r.readAsDataURL(b);
});

/** One image file → an attachment (throws an Italian message when it cannot be read or stays too big). */
export async function toAttachment(file: Blob): Promise<ImageAttachment> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Immagine non leggibile.'); }
  try {
    const real = sniff(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    const p = plan(real, file.size, bmp.width, bmp.height);
    let blob: Blob = file;
    if (p.reencode) {
      const c = draw(bmp, bmp.width * p.scale, bmp.height * p.scale);
      blob = await c.convertToBlob({ type: 'image/png' });
      if (blob.size > IMAGE_MAX_BYTES) blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      if (blob.size > IMAGE_MAX_BYTES) throw new Error('Immagine troppo grande anche ridotta.');
    }
    const k = Math.min(1, THUMB_W / bmp.width, THUMB_H / bmp.height);
    const thumb = await toDataUrl(await draw(bmp, bmp.width * k, bmp.height * k).convertToBlob({ type: 'image/webp', quality: 0.8 }));
    const url = await toDataUrl(blob);
    const mimeType = p.reencode ? (blob.type as ImageAttachment['mimeType']) : real!;
    return { mimeType, data: url.slice(url.indexOf(',') + 1), thumb };
  } finally { bmp.close(); }
}

/** The full image as a data: URL (the viewer). */
export const fullSrc = (im: Pick<ImageAttachment, 'mimeType' | 'data'>) => `data:${im.mimeType};base64,${im.data}`;
