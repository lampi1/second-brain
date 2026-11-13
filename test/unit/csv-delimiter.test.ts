// parseCsv (src/renderer/brain/lib/file-format.ts) guesses the delimiter from the first record outside double quotes:
// a quoted header cell holding `;` or tabs no longer flips a comma CSV (review of PR 19, finding 2).
import { expect, it } from 'vitest';
import { parseCsv } from '../../src/renderer/brain/lib/file-format';

it('a comma CSV whose quoted header cell contains semicolons is still split on commas', () => {
  expect(parseCsv('id,"notes; comments; misc"\n1,"a; b"\n', 'export.csv')).toEqual([
    ['id', 'notes; comments; misc'],
    ['1', 'a; b'],
  ]);
});

it('ignores tabs and escaped quotes inside quoted header cells, and still finds a real semicolon or tab delimiter', () => {
  expect(parseCsv('id,"a\tb\tc\td",x\n1,2,3', 'export.csv')).toEqual([['id', 'a\tb\tc\td', 'x'], ['1', '2', '3']]);
  expect(parseCsv('id,"say ""a;b;c;d""",x\n1,2,3')).toEqual([['id', 'say "a;b;c;d"', 'x'], ['1', '2', '3']]);
  expect(parseCsv('id;"x, y, z";n\n1;2;3')).toEqual([['id', 'x, y, z', 'n'], ['1', '2', '3']]);
  expect(parseCsv('id\t"x;y;z"\tn\n1\t2\t3')).toEqual([['id', 'x;y;z', 'n'], ['1', '2', '3']]);
});

it('counts the first record only, even when a quoted header cell spans lines', () => {
  expect(parseCsv('id,"two\nlines; with; semicolons"\n1,2')).toEqual([['id', 'two\nlines; with; semicolons'], ['1', '2']]);
  expect(parseCsv('a,b\n1;2;3;4')).toEqual([['a', 'b'], ['1;2;3;4']]);
});

it('treats a quote inside a cell as text, as the parser does (an inch mark does not open a quoted cell)', () => {
  expect(parseCsv('id,5" disk,"a;b;c;d"\n1,2,3')).toEqual([['id', '5" disk', 'a;b;c;d'], ['1', '2', '3']]);
});
