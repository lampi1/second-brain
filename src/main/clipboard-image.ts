// The image on the system clipboard, read by main for a chat input's Ctrl+V that carried no image and no text. Why: on
// Windows 11 a fresh Win+Shift+S / Snipping Tool screenshot is offered with delayed rendering, and Chromium's paste
// event can come without it (the user, 2026-10-13: "se faccio Ctrl+V non li incolla", Win+V history works); main asks
// the clipboard again (Electron 44: clipboard.read()). Images only, never text (a login hand-off password may be there).
// Under SB_TEST the clipboard is an in-memory one the e2e suite fills (globalThis.__sbClipboardImage): a test never
// touches what the user copied. Used by index.ts ('clipboard:image'), pinned by test/unit/clipboard-image.test.ts.
import { clipboard } from 'electron';
import type { ClipboardImage } from '../shared/contract';
import { log } from './log';

/** larger is not a screenshot the engines would take anyway (the renderer scales and checks it again) */
export const CLIPBOARD_IMAGE_MAX = 50 * 1024 * 1024;

/** The slice of Electron's clipboard used here (structural: the tests pass a fake). */
export interface ClipReader { read(): Promise<{ types: readonly string[]; getType(type: string): Promise<unknown> }[]> }

/** The first image item of the clipboard, or null (none, unreadable, too big). `seen`: what the paste event carried,
 *  logged so a paste that still fails can be told apart. */
export async function readClipboardImage(clip: ClipReader, seen: readonly string[] = []): Promise<ClipboardImage | null> {
  let found: string[] = [];
  try {
    const items = await clip.read();
    found = items.flatMap(i => i.types.filter(t => !t.startsWith('electron application/')));
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      if (!(blob instanceof Blob) || blob.size === 0) continue;
      if (blob.size > CLIPBOARD_IMAGE_MAX) { log.warn('clipboard', 'pasted image too big', { data: { size: blob.size }, cause: `${blob.size} bytes`, hint: 'a screenshot is a few MB; nothing was attached' }); return null; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      log.info('clipboard', 'paste image read by main', { data: { seen, type, bytes: bytes.length } });
      return { mimeType: type, bytes };
    }
    log.info('clipboard', 'paste with no image', { data: { seen, found } });
  } catch (e) {
    log.warn('clipboard', 'clipboard not readable', { cause: e instanceof Error ? e.message : String(e), data: { seen, found }, hint: 'another app may hold the clipboard; copy the image again' });
  }
  return null;
}

/** The system clipboard, or (SB_TEST=1) the e2e suite's in-memory one. */
export function clipReader(env: NodeJS.ProcessEnv = process.env): ClipReader {
  if (env.SB_TEST !== '1') return clipboard;
  return { read: async () => ((globalThis as Record<string, unknown>).__sbClipboardImage as Awaited<ReturnType<ClipReader['read']>> | undefined) ?? [] };
}
