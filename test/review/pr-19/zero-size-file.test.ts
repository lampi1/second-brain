// Review of PR 19 (file viewer V1): readFileView (src/main/file-view.ts) sizes its read buffer from fstat (size + 1), so
// a regular file whose stat size is 0 but which has content (Linux procfs/sysfs, some FUSE mounts) shows only its
// first byte and `more: false`: the viewer presents one character as the whole file. Reachable since the PR removed
// the roots allow-list. Linux only (needs /proc). Fails on the PR head; see docs/reviews/pr-19.md, finding 4.
import { expect, it } from 'vitest';
import fs from 'node:fs';
import { readFileView } from '../../../src/main/file-view';

it.skipIf(process.platform !== 'linux' || !fs.existsSync('/proc/self/status'))('a zero-size procfs file is read past its stat size, or marked as cut', () => {
  const result = readFileView('/proc/self/status');
  expect(result.kind).toBe('text');
  if (result.kind !== 'text') return;
  // the real file is several hundred bytes ("Name:\t…\nUmask:…"); a correct viewer shows them or says it stopped early
  expect(result.text.length > 1 || result.more).toBe(true);
});
