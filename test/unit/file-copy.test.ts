// The viewer's copy icon (main/file-copy.ts): text as text, an image as an image, anything else as the file itself;
// never a relative path or a network share.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyFile, fileFormat, looksText, readSmall, TEXT_BYTES, type ClipboardLike } from '../../src/main/file-copy';

function fake(image = true) {
  const got: { text?: string; raw?: { format: string; buffer: Buffer }; image?: string } = {};
  const clip: ClipboardLike = {
    writeText: async t => { got.text = t; },
    writeRaw: async (format, buffer) => { got.raw = { format, buffer }; },
    writeImageFromPath: async p => { if (image) got.image = p; return image; },
  };
  return { clip, got };
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-copy-'));
const file = (name: string, data: string | Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return fs.realpathSync.native(p); };
const posix = process.platform !== 'win32';

describe('file copy', () => {
  it.runIf(posix)('a text file goes as its whole text', async () => {
    const { clip, got } = fake();
    expect(await copyFile(file('a.ts', 'const x = 1;\nexport {};\n'), clip)).toEqual({ how: 'text' });
    expect(got.text).toBe('const x = 1;\nexport {};\n');
  });
  it.runIf(posix)('an image as an image; one that cannot be decoded and a binary file as the file', async () => {
    const png = file('p.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    const a = fake();
    expect(await copyFile(png, a.clip)).toEqual({ how: 'image' });
    expect(a.got.image).toBe(png);
    const b = fake(false);
    expect(await copyFile(png, b.clip)).toEqual({ how: 'file' });
    const c = fake();
    expect(await copyFile(file('d.pdf', Buffer.from([0x25, 0x50, 0, 0xff])), c.clip)).toEqual({ how: 'file' });
    expect(c.got.raw?.format).toBe(process.platform === 'darwin' ? 'public.file-url' : 'text/uri-list');
  });
  it('refuses relative paths and shares; a missing file says so', async () => {
    const { clip, got } = fake();
    expect((await copyFile('relative/a.txt', clip)).how).toBe('refused');
    expect((await copyFile('\\\\host\\share\\a.txt', clip, 'win32')).how).toBe('refused');
    expect((await copyFile(path.join(dir, 'missing.txt'), clip)).how).toBe(posix ? 'missing' : 'missing');
    expect(got).toEqual({});
  });
  it('the OS formats and the text test', () => {
    expect(fileFormat('C:\\a\\b.pdf', 'win32')).toEqual({ format: 'FileNameW', buffer: Buffer.from('C:\\a\\b.pdf\0', 'utf16le') });
    expect(fileFormat('/a/b c.pdf', 'linux').buffer.toString()).toBe('file:///a/b%20c.pdf\r\n');
    expect(looksText(Buffer.from('ciao è'))).toBe(true);
    expect(looksText(Buffer.from([0x61, 0, 0x62]))).toBe(false);
    expect(looksText(Buffer.from([0xff, 0xfe, 0x41]))).toBe(false);
    expect(TEXT_BYTES).toBeGreaterThan(1_000_000);
  });
  it('reads through one descriptor, never past the cap', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-copy-small-'));
    try {
      fs.writeFileSync(path.join(d, 'a.txt'), 'ciao');
      fs.writeFileSync(path.join(d, 'big.txt'), Buffer.alloc(TEXT_BYTES + 10, 0x61));
      expect(readSmall(path.join(d, 'a.txt'))?.toString()).toBe('ciao');
      expect(readSmall(path.join(d, 'big.txt'))).toBeNull();
      expect(readSmall(d)).toBeNull();
      expect(readSmall(path.join(d, 'none.txt'))).toBeNull();
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
