// IPC routine snapshots keep unchanged identities without overlooking changed revisions or removed fields.
import { expect, it } from 'vitest';
import { shareSnapshot } from '../../src/renderer/lib/share-snapshot';
it('reuses the whole value or unchanged catalog/run branches on heartbeat updates', () => {
  const before = { versions: [{ text: 'a'.repeat(600_000) }], runs: [{ id: 'r', revision: 1 }], automation: { tick: 1 } };
  expect(shareSnapshot(before, structuredClone(before))).toBe(before);
  const next = shareSnapshot(before, { ...structuredClone(before), automation: { tick: 2 } });
  expect(next).not.toBe(before);
  expect(next.versions).toBe(before.versions);
  expect(next.runs).toBe(before.runs);
  expect(next.automation).toEqual({ tick: 2 });
});
it('never hides changed approval revisions, reordered rows, deletions or null resets', () => {
  const before = [{ id: 'a', revision: 1, reason: 'blocked' }, { id: 'b', revision: 2 }];
  for (const next of [[{ id: 'a', revision: 2 }, before[1]!], [...before].reverse(), before.slice(1)]) {
    expect(shareSnapshot(before, next)).toEqual(next);
    expect(shareSnapshot(before, next)).not.toBe(before);
  }
  expect(shareSnapshot<unknown>(before, null)).toBeNull();
  expect(shareSnapshot({ absent: undefined }, {})).toEqual({});
  expect(shareSnapshot({}, { absent: undefined })).toHaveProperty('absent');
});
