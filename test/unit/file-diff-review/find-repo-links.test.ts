// file-diff's repository lookup and network shares (security, regression of PR #26): main/file-diff.ts findRepo refuses a
// repository whose git folder or objects could lead to a network share before following the link (statSync/realpath
// would already connect to the share and send the login on Windows, unlike open-path.ts linksToShare, which
// lstat/readlinks first), and never falls back to the unresolved path when the share does not answer. On Linux a
// `//host/share/...` link target is just a missing path, which is exactly the "share did not answer" case.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {findRepo} from '../../../src/main/file-diff';

const temporary: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it.skipIf(process.platform === 'win32')('a .git that is a link to a network share is refused, not followed', () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-links-'))); temporary.push(dir);
  fs.symlinkSync('//host/share/repo.git', path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
  expect(findRepo(path.join(dir, 'a.ts'))).toBe('share');
});
