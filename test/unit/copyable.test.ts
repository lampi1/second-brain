// Unit tests of lib/copyable.ts: which inline code of a message gets "click to copy" and which is a file path (preview).
import { describe, expect, it } from 'vitest';
import { isCopyable, isFilePath, isUrl, lineless } from '../../src/renderer/lib/copyable';

describe('isCopyable: things, not words', () => {
  it('copies paths, URLs, ids and commands', () => {
    for (const t of ['C:\\progetti\\a.md', 'src/order/total.ts', 'https://tracker.example.com/bug/4721', '4721', '#812', 'AB-1234',
      'npm run check:branch', 'git log --oneline -5', 'feat/genui', 'OrderTotalsService', 'SELECT * FROM t WHERE id = 3']) {
      expect(isCopyable(t), t).toBe(true);
    }
  });
  it('leaves short words and prose alone', () => {
    for (const t of ['true', 'map', 'id', 'null', '', '  ', 'il totale è sbagliato quando', 'x', 'il totale è sbagliato.',
      'non funziona: il totale', 'più o meno - circa', 'Apri fuori', 'sbagliato.']) expect(isCopyable(t), t).toBe(false);
  });
  it('a path with :line or :line:col is a path; lineless takes the suffix away', () => {
    expect(isFilePath('C:\\x\\ChatItems.tsx:296')).toBe(true);
    expect(isFilePath('src/a.ts:12:3')).toBe(true);
    expect(lineless('C:\\x\\ChatItems.tsx:296')).toBe('C:\\x\\ChatItems.tsx');
    expect(lineless('src/a.ts:12:3')).toBe('src/a.ts');
    expect(isFilePath('C:\\x\\evil.exe:a.md')).toBe(false);
  });
});

describe('isFilePath / isUrl', () => {
  it('a drive path, a file: URL or a relative path with a folder and an extension', () => {
    expect(isFilePath('C:\\progetti\\report\\tc7.png')).toBe(true);
    expect(isFilePath('file:///C:/x/y.md')).toBe(true);
    expect(isFilePath('src/a.ts')).toBe(true);
    expect(isFilePath('.\\docs\\x.md')).toBe(true);
  });
  it('never a share, a URL, a bare name or a command', () => {
    for (const t of ['\\\\host\\share\\a.md', '//host/a.md', 'https://x.example.com/a.ts', 'a.ts', 'npm run src/a.ts', 'feat/genui']) expect(isFilePath(t), t).toBe(false);
    expect(isUrl('https://x.example.com/a')).toBe(true);
    expect(isUrl('javascript:alert(1)')).toBe(false);
  });
});
