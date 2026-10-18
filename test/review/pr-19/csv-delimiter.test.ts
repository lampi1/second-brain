// Review of PR 19 (file viewer V1): parseCsv (src/renderer/brain/lib/file-format.ts) guesses the delimiter by counting
// characters in the raw first line, quoted text included, so a quoted header cell with `;` (or tabs) flips a comma CSV
// to `;` and the table view shows garbage columns. Fails on the PR head; see docs/reviews/pr-19.md, finding 2.
import { expect, it } from 'vitest';
import { parseCsv } from '../../../src/renderer/brain/lib/file-format';

it('a comma CSV whose quoted header cell contains semicolons is still split on commas', () => {
  expect(parseCsv('id,"notes; comments; misc"\n1,"a; b"\n', 'export.csv')).toEqual([
    ['id', 'notes; comments; misc'],
    ['1', 'a; b'],
  ]);
});
