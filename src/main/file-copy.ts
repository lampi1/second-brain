// The viewer's copy icon (owner, 2026-10-30: «ogni file possa essere copiato dal tasto copia, solo l'icona»): puts the
// file the user is looking at on the system clipboard. A text file up to TEXT_BYTES goes as its whole text (paste it in
// a chat, a mail, an editor); an image as an image; anything else (a PDF, a bigger file) as the file itself, the way
// Explorer's Ctrl+C does (Windows FileNameW, macOS a file URL, Linux text/uri-list), so it pastes in a folder, a mail
// or a chat app. The path is untrusted like every viewer link: open-path.ts rules (local only, never a network share,
// realpath). Read-only: nothing is written, opened or run. Used by ipc-handlers/app.ts (app:copyFile); pinned by
// test/unit/file-copy.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CopyFileResult } from '../shared/contract';
import { linksToShare, localPath } from './open-path';

/** a text file up to this size is copied as its text, a bigger one as the file */
export const TEXT_BYTES = 5_000_000;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);

/** The part of Electron's clipboard and nativeImage this needs (tests pass fakes). Electron 44's clipboard is async
 *  and W3C-like: a raw OS format goes as `electron application/osclipboard;format="<name>"` (ipc-handlers/app.ts). */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
  /** the bytes under a raw OS clipboard format */
  writeRaw(format: string, buffer: Buffer): Promise<void>;
  /** the image at this path as PNG; false when it cannot be decoded */
  writeImageFromPath(file: string): Promise<boolean>;
}

/** Whether a buffer reads as text: no NUL byte and valid UTF-8. */
export function looksText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

/** The clipboard format and bytes that make a file paste as a file on this OS. */
export function fileFormat(real: string, platform: NodeJS.Platform = process.platform): { format: string; buffer: Buffer } {
  if (platform === 'win32') return { format: 'FileNameW', buffer: Buffer.from(`${real}\0`, 'utf16le') };
  const url = pathToFileURL(real).href;
  return platform === 'darwin' ? { format: 'public.file-url', buffer: Buffer.from(url, 'utf8') } : { format: 'text/uri-list', buffer: Buffer.from(`${url}\r\n`, 'utf8') };
}

export async function copyFile(raw: string, clip: ClipboardLike, platform: NodeJS.Platform = process.platform): Promise<CopyFileResult> {
  const p = localPath(raw, platform);
  if (!p) return { how: 'refused', reason: 'Solo file di questo computer.' };
  if (linksToShare(p, platform)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  let real: string, size: number;
  try { real = fs.realpathSync.native(p); const st = fs.statSync(real); if (!st.isFile()) return { how: 'refused', reason: 'Non è un file.' }; size = st.size; }
  catch { return { how: 'missing', reason: `Il file non c'è più: ${p}` }; }
  if (/^[\\/]{2}/.test(real)) return { how: 'refused', reason: 'Il percorso porta a una cartella di rete.' };
  if (IMAGE_EXT.has(path.extname(real).toLowerCase()) && await clip.writeImageFromPath(real)) return { how: 'image' };
  if (size <= TEXT_BYTES) {
    let buf: Buffer | null = null;
    try { buf = fs.readFileSync(real); } catch { buf = null; }
    if (buf && looksText(buf)) { await clip.writeText(buf.toString('utf8')); return { how: 'text' }; }
  }
  const f = fileFormat(real, platform);
  await clip.writeRaw(f.format, f.buffer);
  return { how: 'file' };
}
