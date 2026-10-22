// The viewer overlay's session list: an entry goes after the current one, the same one twice is one entry, back and
// forward stop at the ends, a close keeps the list for the next open.
import { expect, it } from 'vitest';
import { canStep, currentEntry, emptyViewer, pushEntry, stepEntry, VIEWER_STACK_MAX, type ViewerEntry } from '../../src/renderer/lib/viewer-stack';

const file = (arg: string): ViewerEntry => ({ kind: 'file', arg });

it('opens, moves back and forward, and drops what was ahead when a new file opens from the middle', () => {
  let v = pushEntry(emptyViewer, file('a'));
  expect(currentEntry(v)).toEqual(file('a'));
  v = pushEntry(pushEntry(v, file('b')), file('c'));
  expect(v.stack.map(e => e.kind === 'file' && e.arg)).toEqual(['a', 'b', 'c']);
  expect(canStep(v, 1)).toBe(false);
  v = stepEntry(stepEntry(v, -1), -1);
  expect(currentEntry(v)).toEqual(file('a'));
  expect(stepEntry(v, -1)).toBe(v);
  v = pushEntry(v, file('d'));
  expect(v.stack.map(e => e.kind === 'file' && e.arg)).toEqual(['a', 'd']);
});

it('keeps one entry for the same file and the same pair, and keeps the list across a close', () => {
  const shots: ViewerEntry = { kind: 'shots', before: { path: '/e/x-before.png', caption: 'Prima' }, after: { path: '/e/x-after.png', caption: 'Dopo' } };
  let v = pushEntry(pushEntry(emptyViewer, file('a')), file('a'));
  expect(v.stack).toHaveLength(1);
  v = pushEntry(pushEntry(v, shots), { ...shots, title: 'again' } as ViewerEntry);
  expect(v.stack).toHaveLength(2);
  v = { ...v, open: false };
  expect(currentEntry(v)).toBeNull();
  expect(stepEntry(v, -1)).toBe(v);
  v = pushEntry(v, file('b'));
  expect(v.open).toBe(true);
  expect(v.stack.map(e => e.kind)).toEqual(['file', 'shots', 'file']);
});

it('keeps at most the newest entries', () => {
  let v = emptyViewer;
  for (let i = 0; i < VIEWER_STACK_MAX + 5; i++) v = pushEntry(v, file(String(i)));
  expect(v.stack).toHaveLength(VIEWER_STACK_MAX);
  expect(v.stack[0]).toEqual(file('5'));
  expect(v.at).toBe(VIEWER_STACK_MAX - 1);
});
