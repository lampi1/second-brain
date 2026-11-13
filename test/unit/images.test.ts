// Pasted screenshots: main's check of chat:send images (type, real base64, magic bytes, size, count, previews), the
// files written for an engine without image blocks, and the renderer's pure helpers (which files of a paste are
// images, when an image must be re-encoded, room left in a message).
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, IMAGES_MAX_TOTAL } from '../../src/shared/contract';
import { checkImages, writeImageFiles } from '../../src/main/chats/images';
import { MAX_EDGE, imageFiles, pasteKind, plan, roomFor, sniff } from '../../src/renderer/lib/images';
import { PNG_1PX, tmp } from './chats/helpers';

const png = { mimeType: 'image/png' as const, data: PNG_1PX };

describe('checkImages (main)', () => {
  it('passes good images, keeps only small data:image previews', () => {
    expect(checkImages(undefined)).toEqual([]);
    expect(checkImages([])).toEqual([]);
    const thumb = 'data:image/webp;base64,UklGRg==';
    expect(checkImages([{ ...png, thumb }])).toEqual([{ ...png, thumb }]);
    expect(checkImages([{ ...png, thumb: 'javascript:alert(1)' }])).toEqual([png]);
    expect(checkImages([{ ...png, thumb: `data:image/png;base64,${'A'.repeat(200_000)}` }])).toEqual([png]);
    expect(checkImages([{ ...png, extra: 'dropped' }])[0]).not.toHaveProperty('extra');
  });

  it('refuses wrong types, fake content, bad base64, too big, too many', () => {
    expect(() => checkImages('x')).toThrow(/non valide/);
    expect(() => checkImages([{ mimeType: 'image/svg+xml', data: PNG_1PX }])).toThrow(/formato non supportato/);
    expect(() => checkImages([{ mimeType: 'image/jpeg', data: PNG_1PX }])).toThrow(/non è un image\/jpeg/);
    expect(() => checkImages([{ mimeType: 'image/png', data: 'not base64!' }])).toThrow(/dati non validi/);
    expect(() => checkImages([{ mimeType: 'image/png', data: '' }])).toThrow(/dati non validi/);
    const big = PNG_1PX.slice(0, 12) + 'A'.repeat(Math.ceil((IMAGE_MAX_BYTES + 10) / 3) * 4);
    expect(() => checkImages([{ mimeType: 'image/png', data: big }])).toThrow(/troppo grande/);
    expect(() => checkImages(Array.from({ length: IMAGE_MAX_COUNT + 1 }, () => png))).toThrow(/Troppe immagini/);
    expect(checkImages(Array.from({ length: IMAGE_MAX_COUNT }, () => png))).toHaveLength(IMAGE_MAX_COUNT);
    // each one under its own limit, all together over the message limit (the API takes 32 MB per request)
    const heavy = { mimeType: 'image/png' as const, data: PNG_1PX.slice(0, 12) + 'A'.repeat(Math.floor((IMAGE_MAX_BYTES - 100) / 3) * 4) };
    const n = Math.floor(IMAGES_MAX_TOTAL / IMAGE_MAX_BYTES) + 1;
    expect(() => checkImages(Array.from({ length: n }, () => heavy))).toThrow(/troppo pesanti insieme/);
  });

  it('writes the images as files with the right extension and bytes', () => {
    const dir = path.join(tmp('img'), 'chat');
    const files = writeImageFiles(dir, [png, png]);
    expect(files).toHaveLength(2);
    expect(files.every(f => f.startsWith(dir) && f.endsWith('.png'))).toBe(true);
    expect(fs.readFileSync(files[0]!)).toEqual(Buffer.from(PNG_1PX, 'base64'));
  });

  it('a write that fails half way leaves no file behind', () => {
    const dir = path.join(tmp('img'), 'chat');
    const real = fs.writeFileSync;
    let n = 0;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((...a: Parameters<typeof fs.writeFileSync>) => {
      if (++n === 2) throw new Error('disco pieno');
      real(...a);
    });
    try { expect(() => writeImageFiles(dir, [png, png])).toThrow(/disco pieno/); } finally { spy.mockRestore(); }
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('renderer helpers', () => {
  it('imageFiles takes the image files of a paste (clipboard items first) and ignores text', () => {
    const f = (type: string) => ({ type, name: 'x' }) as unknown as File;
    const item = (kind: string, type: string, file: File | null) => ({ kind, type, getAsFile: () => file });
    const shot = f('image/png');
    const dt = (items: unknown[], files: File[]) => ({ items, files }) as unknown as DataTransfer;
    expect(imageFiles(null)).toEqual([]);
    expect(imageFiles(dt([item('string', 'text/plain', null), item('file', 'image/png', shot)], []))).toEqual([shot]);
    expect(imageFiles(dt([item('string', 'text/plain', null)], [f('text/plain')]))).toEqual([]);
    const dropped = f('image/jpeg');
    expect(imageFiles(dt([], [dropped, f('application/pdf')]))).toEqual([dropped]);
  });

  it('pasteKind: text wins, then image files, else main reads the clipboard (a fresh Win+Shift+S screenshot)', () => {
    const shot = { type: 'image/png', name: 'image.png' } as unknown as File;
    const dt = (text: string, items: unknown[], types: string[]) => ({ getData: () => text, items, files: [], types }) as unknown as DataTransfer;
    const img = { kind: 'file', type: 'image/png', getAsFile: () => shot };
    expect(pasteKind(dt('A1 B1', [img], ['text/plain', 'Files']))).toEqual({ kind: 'text' });
    expect(pasteKind(dt('', [img], ['Files']))).toEqual({ kind: 'files', files: [shot] });
    // the image item is there but Chromium could not read it (delayed rendering), or no item at all
    expect(pasteKind(dt('', [{ kind: 'file', type: 'image/png', getAsFile: () => null }], ['Files']))).toEqual({ kind: 'main', seen: ['Files'] });
    expect(pasteKind(dt('  ', [], []))).toEqual({ kind: 'main', seen: [] });
    expect(pasteKind(null)).toEqual({ kind: 'main', seen: [] });
  });

  it('plan keeps small accepted images as they are; anything else is re-encoded, at most MAX_EDGE px', () => {
    expect(plan('image/png', 1000, 1920, 1080)).toEqual({ reencode: false });
    expect(plan('image/png', 1000, 3840, 2160)).toEqual({ reencode: true, scale: MAX_EDGE / 3840 }); // 4K screen
    expect(plan('image/png', 2_500_000, 1920, 9000)).toEqual({ reencode: true, scale: MAX_EDGE / 9000 }); // full-page shot
    expect(plan(null, 1000, 100, 100)).toEqual({ reencode: true, scale: 1 }); // BMP, or bytes that are not what the name says
    expect(plan('image/png', IMAGE_MAX_BYTES + 1, 1000, 800)).toEqual({ reencode: true, scale: 1 });
    expect(MAX_EDGE).toBeLessThanOrEqual(2000); // the API limit once a chat holds more than 20 images
    expect(roomFor(0)).toBe(IMAGE_MAX_COUNT);
    expect(roomFor(IMAGE_MAX_COUNT + 3)).toBe(0);
  });

  it('sniff reads the real type from the first bytes', () => {
    const b = (...x: number[]) => new Uint8Array([...x, ...Array(12).fill(0)]);
    expect(sniff(new Uint8Array(Buffer.from(PNG_1PX, 'base64')))).toBe('image/png');
    expect(sniff(b(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniff(new Uint8Array(Buffer.from('GIF89a'.padEnd(12, ' '), 'latin1')))).toBe('image/gif');
    expect(sniff(new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBP', 'latin1')))).toBe('image/webp');
    expect(sniff(b(0x42, 0x4d))).toBeNull(); // BMP
  });
});
