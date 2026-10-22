// The file viewer's tools: Ctrl+F offsets, the line link, and the side-by-side rows of a comparison with word marks.
import { structuredPatch } from 'diff';
import { expect, it } from 'vitest';
import { fileLink, findOffsets, splitRows, wordParts } from '../../src/renderer/brain/lib/viewer-tools';
import { readFileViewArg } from '../../src/shared/file-view';
import { parseLink } from '../../src/renderer/lib/notify';

it('finds every case-insensitive occurrence, without overlaps, up to the limit', () => {
  expect(findOffsets('Const a = CONST; const', 'const')).toEqual([0, 10, 17]);
  expect(findOffsets('aaaa', 'aa')).toEqual([0, 2]);
  expect(findOffsets('abc', '')).toEqual([]);
  expect(findOffsets('x'.repeat(100), 'x', 7)).toHaveLength(7);
});

it('links to a file line through the internal link the viewer opens, keeping the chat scope', () => {
  const link = fileLink({ path: 'C:\\work\\a b.ts', line: 3, column: 2, chatId: 'c1' }, 12);
  const parsed = parseLink(link);
  expect(parsed?.page).toBe('file');
  expect(readFileViewArg(parsed?.element ?? undefined)).toEqual({ path: 'C:\\work\\a b.ts', line: 12, chatId: 'c1' });
  expect(readFileViewArg(parseLink(fileLink({ path: '/x.md', line: 4 }))?.element ?? undefined)).toEqual({ path: '/x.md' });
});

it('marks the changed words of a paired line, not of unrelated lines', () => {
  const p = wordParts('export const b = 2;', 'export const b = 20;')!;
  expect(p.left.filter(x => x.changed).map(x => x.text)).toEqual(['2']);
  expect(p.right.filter(x => x.changed).map(x => x.text)).toEqual(['20']);
  expect(p.right.map(x => x.text).join('')).toBe('export const b = 20;');
  expect(wordParts('alpha beta gamma', 'totally different words here')).toBeNull();
});

it('pairs removed and added runs side by side, with blanks where one side has more lines', () => {
  const patch = structuredPatch('a', 'b', 'one\ntwo\nthree\nfour\n', 'one\n2\nthree\nfour\nfive\nsix\n', '', '', { context: 3 });
  const rows = splitRows(patch);
  expect(rows[0]).toMatchObject({ kind: 'hunk' });
  const lines = rows.filter(r => r.kind === 'line');
  expect(lines.map(r => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([
    ['same', 'same'], ['del', 'add'], ['same', 'same'], ['same', 'same'], [null, 'add'], [null, 'add'],
  ]);
  expect(lines[1]).toMatchObject({ left: { n: 2, text: 'two' }, right: { n: 2, text: '2' } });
  expect(lines[5]).toMatchObject({ right: { n: 6, text: 'six' } });
});
