// Unit tests of main/ask-image.ts: an image a question names, read only inside the allowed folders, with its magic bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { askImageRoots, isInside, magicMatches, MAX_ASK_IMAGE, readAskImage } from '../../src/main/ask-image';

const r = String.raw;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-askimg-'));
const allowed = path.join(dir, 'evidence');
const other = path.join(dir, 'altro');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (p: string, data: Buffer) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);

describe('magic bytes and folders', () => {
  it('each type only with its own first bytes', () => {
    expect(magicMatches('image/png', PNG)).toBe(true);
    expect(magicMatches('image/jpeg', JPG)).toBe(true);
    expect(magicMatches('image/webp', WEBP)).toBe(true);
    expect(magicMatches('image/png', JPG)).toBe(false);
    expect(magicMatches('image/jpeg', Buffer.from('<svg'))).toBe(false);
  });
  it('inside means whole path segments, case-insensitive', () => {
    expect(isInside(r`C:\a\evidence\x.png`, r`C:\A\Evidence`, 'win32')).toBe(true);
    expect(isInside(r`C:\a\evidence-2\x.png`, r`C:\a\evidence`, 'win32')).toBe(false);
    expect(isInside(r`C:\a\evidence\..\x.png`, r`C:\a\evidence`, 'win32')).toBe(false);
  });
  it('macOS folds case like its disks, Linux does not; segments as on Windows', () => {
    expect(isInside('/Users/u/Evidence/x.png', '/Users/u/evidence', 'darwin')).toBe(true);
    expect(isInside('/Users/u/Prove/café/x.png', '/Users/u/prove/café', 'darwin')).toBe(true); // Finder writes NFD
    expect(isInside('/home/u/Evidence/x.png', '/home/u/evidence', 'linux')).toBe(false);
    expect(isInside('/home/u/evidence/x.png', '/home/u/evidence/', 'linux')).toBe(true);
    expect(isInside('/home/u/evidence-2/x.png', '/home/u/evidence', 'linux')).toBe(false);
    expect(isInside('/home/u/evidence/../x.png', '/home/u/evidence', 'linux')).toBe(false);
  });
  it('the roots: profile, both evidence folders, brain, the code and its worktrees', () => {
    const source = path.join(dir, 'src');
    const repo = path.join(source, 'second-brain-app');
    const roots = askImageRoots({ userData: 'U', appData: 'A', brainRoot: 'B', repos: [repo, null] });
    expect(roots).toEqual(['U', path.join('A', 'second-brain', 'evidence'), path.join('A', 'second-brain-dev', 'evidence'), 'B', repo, path.join(source, 'second-brain-wt')]);
  });
});

describe.runIf(process.platform === 'win32')('readAskImage', () => {
  it('a PNG, JPG or WebP in an allowed folder comes back as a data: URL', () => {
    for (const [n, b, m] of [['a.png', PNG, 'image/png'], ['b.jpg', JPG, 'image/jpeg'], ['c.webp', WEBP, 'image/webp']] as const) {
      const res = readAskImage(put(path.join(allowed, n), b), [allowed]);
      expect(res.kind).toBe('image');
      if (res.kind === 'image') expect(res.dataUrl.startsWith(`data:${m};base64,`)).toBe(true);
    }
    // a file:/// URL of the same file
    expect(readAskImage(`file:///${path.join(allowed, 'a.png').replace(/\\/g, '/')}`, [allowed]).kind).toBe('image');
  });
  it('refused: outside the folders, another type, a fake image, too big, a share; missing says so', () => {
    expect(readAskImage(put(path.join(other, 'x.png'), PNG), [allowed])).toMatchObject({ kind: 'refused', reason: /Fuori dalle cartelle/ });
    expect(readAskImage(put(path.join(allowed, 'x.gif'), PNG), [allowed])).toMatchObject({ kind: 'refused', reason: /PNG, JPG o WebP/ });
    expect(readAskImage(put(path.join(allowed, 'fake.png'), Buffer.from('MZ not an image at all')), [allowed])).toMatchObject({ kind: 'refused', reason: /non è l’immagine/ });
    expect(readAskImage(put(path.join(allowed, 'big.png'), Buffer.concat([PNG, Buffer.alloc(MAX_ASK_IMAGE)])), [allowed])).toMatchObject({ kind: 'refused', reason: /troppo grande/ });
    expect(readAskImage(r`\\host\share\a.png`, [allowed]).kind).toBe('refused');
    expect(readAskImage(r`relativa\a.png`, [allowed]).kind).toBe('refused');
    expect(readAskImage(path.join(allowed, '..', 'altro', 'x.png'), [allowed]).kind).toBe('refused');
    expect(readAskImage(path.join(allowed, 'manca.png'), [allowed]).kind).toBe('missing');
  });
});
