// Gallery pairing survives alphabetic file order (after sorts first), Windows paths and directories named before.
import { expect, it, vi } from 'vitest';
import { screenshotPairs } from '../../../src/renderer/components/RoutineScreenshots';
it('pairs before/after irrespective of order and keeps unmatched screenshots', () => {
  expect(screenshotPairs(['/before/after.png', '/before/before.png', '/before/detail.png', '/before/detail.png']))
    .toEqual([['/before/before.png', '/before/after.png'], ['/before/detail.png']]);
  expect(screenshotPairs(['C:\\run\\dopo.png', 'C:\\run\\prima.png'])).toEqual([['C:\\run\\prima.png', 'C:\\run\\dopo.png']]);
});

vi.mock('../../../src/renderer/sb', () => ({ sb: { invoke: vi.fn() } }));
