// The clipboard image main reads for a Ctrl+V that carried no image (main/clipboard-image.ts): the first image item,
// never text, nothing when empty, too big or unreadable; under SB_TEST the in-memory clipboard of the e2e suite.
import { afterEach, describe, expect, it } from 'vitest';
import { CLIPBOARD_IMAGE_MAX, clipReader, readClipboardImage, type ClipReader } from '../../src/main/clipboard-image';

const item = (types: string[], blobs: Record<string, unknown>) => ({ types, getType: async (t: string) => blobs[t] });
const clip = (items: ReturnType<typeof item>[]): ClipReader => ({ read: async () => items });

describe('readClipboardImage', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).__sbClipboardImage; });

  it('returns the bytes of the first image item, skipping text and raw OS formats', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const r = await readClipboardImage(clip([
      item(['text/plain'], { 'text/plain': new Blob(['ciao']) }),
      item(['electron application/osclipboard;format="PNG"', 'image/png'], { 'image/png': new Blob([png], { type: 'image/png' }) }),
    ]), ['Files']);
    expect(r).toEqual({ mimeType: 'image/png', bytes: png });
  });

  it('nothing when there is no image, it is empty or too big, or the clipboard cannot be read', async () => {
    expect(await readClipboardImage(clip([item(['text/plain'], { 'text/plain': new Blob(['password']) })]))).toBeNull();
    expect(await readClipboardImage(clip([item(['image/png'], { 'image/png': new Blob([]) })]))).toBeNull();
    const huge = { size: CLIPBOARD_IMAGE_MAX + 1 };
    Object.setPrototypeOf(huge, Blob.prototype);
    expect(await readClipboardImage(clip([item(['image/png'], { 'image/png': huge })]))).toBeNull();
    expect(await readClipboardImage({ read: async () => { throw new Error('OpenClipboard failed'); } })).toBeNull();
  });

  it('under SB_TEST reads the e2e in-memory clipboard, never the system one', async () => {
    const r = clipReader({ SB_TEST: '1' });
    expect(await readClipboardImage(r)).toBeNull();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    (globalThis as Record<string, unknown>).__sbClipboardImage = [item(['image/png'], { 'image/png': new Blob([png], { type: 'image/png' }) })];
    expect(await readClipboardImage(r)).toEqual({ mimeType: 'image/png', bytes: png });
  });
});
