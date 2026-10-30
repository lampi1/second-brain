// The user's files as a lesson's sources (ADR 0204): main checks and caps what the page read
// (main/learn/user-files.ts), the material gets one file and its first part inline; the page's own rules for what to
// read (renderer/lib/impara-files.ts) leave out build folders, hidden files and binaries.
import { describe, expect, it } from 'vitest';
import { FILE_MAX, FILES_MAX, USER_FILES, cleanFiles, filesMarkdown, withUserFiles } from '../../src/main/learn/user-files';
import { mergeFiles, skipPath, PICK_MAX } from '../../src/renderer/lib/impara-files';

describe('cleanFiles', () => {
  it('keeps text files with a name, drops binaries, empties, repeats and odd shapes', () => {
    const out = cleanFiles([
      { name: 'src\\auth.ts', text: 'export const a = 1;' },
      { name: '/README.md', text: '# hi' },
      { name: 'img.png', text: 'PNG\u0000\u0001' },
      { name: 'empty.txt', text: '   ' },
      { name: 'src/auth.ts', text: 'again' },
      { name: 42, text: 'x' },
      'nope',
    ]);
    expect(out.map(f => f.name)).toEqual(['src/auth.ts', 'README.md']);
    expect(cleanFiles('x')).toEqual([]);
  });

  it('caps the number and the size', () => {
    const many = Array.from({ length: FILES_MAX + 5 }, (_, i) => ({ name: `f${i}.ts`, text: 'x' }));
    expect(cleanFiles(many)).toHaveLength(FILES_MAX);
    expect(cleanFiles([{ name: 'big.txt', text: 'y'.repeat(FILE_MAX + 10) }])[0]!.text).toHaveLength(FILE_MAX);
  });
});

describe('withUserFiles', () => {
  const base = { text: '## Testo', files: { 'testo.md': 't' }, cwd: null, sources: ['testo incollato'] };
  it('adds one file, a list inline and a source line each', () => {
    const m = withUserFiles(base, [{ name: 'a/b.ts', text: 'const b = 2;' }]);
    expect(Object.keys(m.files)).toEqual(['testo.md', USER_FILES]);
    expect(m.files[USER_FILES]).toContain('## a/b.ts');
    expect(m.text).toContain('- a/b.ts');
    expect(m.text).toContain('const b = 2;');
    expect(m.sources).toEqual(['testo incollato', 'file: a/b.ts']);
    expect(withUserFiles(base, undefined)).toBe(base);
  });

  it('fences a text that has fences of its own', () => {
    expect(filesMarkdown([{ name: 'x.md', text: '```js\n1\n```' }])).toContain('~~~~');
  });
});

describe('what the page reads', () => {
  it('skips build folders, hidden files and binaries', () => {
    expect(skipPath('repo/node_modules/x/index.js')).toBe(true);
    expect(skipPath('repo/.git/config')).toBe(true);
    expect(skipPath('repo/.env')).toBe(true);
    expect(skipPath('logo.png')).toBe(true);
    expect(skipPath('repo/src/auth.ts')).toBe(false);
  });

  it('merges new names only, up to the limit', () => {
    const have = [{ name: 'a', text: '1' }];
    expect(mergeFiles(have, [{ name: 'a', text: '2' }, { name: 'b', text: '3' }]).map(f => f.text)).toEqual(['1', '3']);
    expect(mergeFiles([], Array.from({ length: PICK_MAX + 3 }, (_, i) => ({ name: `${i}`, text: 'x' })))).toHaveLength(PICK_MAX);
  });
});
