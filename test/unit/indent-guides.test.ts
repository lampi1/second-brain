// Unit tests of brain/lib/indent-guides.ts (ADR 0316): the indent of each line in columns, the file's step, blank lines
// bridged by the lines around them.
import { expect, it } from 'vitest';
import { indentGuides } from '../../src/renderer/brain/lib/indent-guides';

it('measures spaces, finds the step and bridges blank lines', () => {
  expect(indentGuides(['def a():', '  if x:', '    y()', '', '  z()', 'end'])).toEqual({ unit: 2, cols: [0, 2, 4, 2, 2, 0] });
  expect(indentGuides(['class A {', '    b() {', '', '        c();', '    }', '}'])).toEqual({ unit: 4, cols: [0, 4, 4, 8, 4, 0] });
});
it('tabs count to the next stop of 4; no indent: step 4', () => {
  expect(indentGuides(['a', '\tb', '\t\tc', '  \td'])).toEqual({ unit: 4, cols: [0, 4, 8, 4] });
  expect(indentGuides(['a', 'b'])).toEqual({ unit: 4, cols: [0, 0] });
  expect(indentGuides([' a', 'b']).unit).toBe(2);
  expect(indentGuides(['            a', 'b']).unit).toBe(8);
});
