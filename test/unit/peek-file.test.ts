// Unit tests of main/peek-file.ts: the preview of a file a message names (first lines, thumbnail, or why not).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PEEK_LINES, peekFile, resolvePeek } from '../../src/main/peek-file';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-peek-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name: string, data: string | Buffer) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

describe('resolvePeek: which paths are read', () => {
  it('absolute drive paths, and relative ones inside the chat folder', () => {
    expect(resolvePeek('C:\\x\\a.md')).toBe('C:\\x\\a.md');
    expect(resolvePeek('src/a.ts', 'C:\\repo')).toBe('C:\\repo\\src\\a.ts');
  });
  it('never a share, a way out of the folder, another scheme or a relative path without a folder', () => {
    expect(resolvePeek('\\\\host\\share\\a.md', 'C:\\repo')).toBeNull();
    expect(resolvePeek('../secret.txt', 'C:\\repo')).toBeNull();
    expect(resolvePeek('src/../../x.md', 'C:\\repo')).toBeNull();
    expect(resolvePeek('/etc/passwd', 'C:\\repo')).toBeNull();
    expect(resolvePeek('https://x.example.com/a.md', 'C:\\repo')).toBeNull();
    expect(resolvePeek('src/a.ts')).toBeNull();
    expect(resolvePeek('src/a.ts', '\\\\host\\share')).toBeNull();
  });
});

describe.runIf(process.platform === 'win32')('peekFile', () => {
  it('the first lines of a text file, marked when there is more', () => {
    const p = put('a.md', Array.from({ length: 40 }, (_, i) => `riga ${i + 1}`).join('\r\n'));
    const r = peekFile(p);
    expect(r).toMatchObject({ kind: 'text', more: true });
    if (r.kind !== 'text') throw new Error();
    expect(r.text.split('\n')).toHaveLength(PEEK_LINES);
    expect(r.text.startsWith('riga 1\nriga 2')).toBe(true);
  });
  it('a relative path inside the chat folder', () => {
    put('src/b.ts', 'export const b = 1;\n');
    expect(peekFile('src/b.ts', dir)).toMatchObject({ kind: 'text', text: 'export const b = 1;\n', more: false });
  });
  it('UTF-16 text with its BOM (Windows PowerShell `>`) is text, not binary', () => {
    const p = put('out.log', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('riga 1\r\nriga 2', 'utf16le')]));
    expect(peekFile(p)).toMatchObject({ kind: 'text', text: 'riga 1\nriga 2' });
  });
  it('an image as a data URL thumbnail', () => {
    const p = put('s.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const r = peekFile(p);
    expect(r.kind).toBe('image');
    if (r.kind === 'image') expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('no content for secrets, binaries or unknown types; missing and refused say why', () => {
    expect(peekFile(put('.env', 'TOKEN=x'))).toMatchObject({ kind: 'other' });
    expect(peekFile(put('k.pem', 'KEY'))).toMatchObject({ kind: 'other', what: 'pem' });
    expect(peekFile(put('bin.json', Buffer.from([0x7b, 0, 0x7d])))).toMatchObject({ kind: 'other', what: 'binario' });
    expect(peekFile(path.join(dir, 'nope.md'))).toMatchObject({ kind: 'missing' });
    expect(peekFile('\\\\host\\share\\a.md')).toMatchObject({ kind: 'refused' });
    expect(peekFile(dir)).toMatchObject({ kind: 'other', what: 'cartella' });
  });
});
