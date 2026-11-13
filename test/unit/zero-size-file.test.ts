// readFileView (src/main/file-view.ts) reads up to its cap whatever fstat says: a regular file whose stat size is 0 but
// which has content (Linux procfs/sysfs, some FUSE mounts) is shown whole or marked as cut, never as its first byte
// (review of PR 19, finding 4). `await` keeps these tests valid if readFileView becomes async.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileView, FILE_VIEW_BYTES } from '../../src/main/file-view';

const temporary: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const file = (text: string | Buffer) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-zero-'));
  temporary.push(dir);
  const p = path.join(dir, 'status.txt');
  fs.writeFileSync(p, text);
  return p;
};
/** fstat on the open descriptor says size 0, as procfs does (the path's stat is left alone). */
const zeroSizeDescriptors = () => {
  const real = fs.fstatSync;
  vi.spyOn(fs, 'fstatSync').mockImplementation(((fd: number) => Object.assign(real(fd), { size: 0 })) as typeof fs.fstatSync);
};

it.skipIf(process.platform !== 'linux' || !fs.existsSync('/proc/self/status'))('a zero-size procfs file is read past its stat size, or marked as cut', async () => {
  const result = await readFileView('/proc/self/status');
  expect(result.kind).toBe('text');
  if (result.kind !== 'text') return;
  // the real file is several hundred bytes ("Name:\t…\nUmask:…"); a correct viewer shows them or says it stopped early
  expect(result.text.length > 1 || result.more).toBe(true);
});

it('shows the whole content of a file whose descriptor reports size 0 (any platform)', async () => {
  const text = 'Name:\tnode\nUmask:\t0022\nState:\tR (running)\n';
  const p = file(text);
  zeroSizeDescriptors();
  expect(await readFileView(p)).toMatchObject({ kind: 'text', text, shown: text.length, more: false });
});

it('marks such a file as cut when it is longer than the cap', async () => {
  const p = file(Buffer.alloc(FILE_VIEW_BYTES + 10, 'a'));
  zeroSizeDescriptors();
  expect(await readFileView(p)).toMatchObject({ kind: 'text', shown: FILE_VIEW_BYTES, more: true });
});
