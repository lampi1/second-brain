// Unit tests of main/projectmap/size.ts (ADR 0316): files and lines under a piece's evidence, counted once, binary files
// and dependency or hidden folders skipped, nothing outside the map's folder, bounded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sizeOf } from '../../src/main/projectmap/size';

const temporary: string[] = [];
afterEach(() => { for (const d of temporary.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tree = (files: Record<string, string | Buffer>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-size-'));
  temporary.push(root);
  for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); }
  return root;
};

it('counts files and lines under the evidence, once each', async () => {
  const root = tree({ 'src/a.ts': 'a\nb\n', 'src/b.ts': 'one line', 'src/sub/c.ts': '\n\n\n', 'src/node_modules/x.js': 'x\n', 'src/.git/h': 'x\n', 'src/img.png': Buffer.from([1, 0, 2, 10]), 'docs/d.md': 'd\n' });
  expect(await sizeOf(root, ['src/', 'src/a.ts'])).toEqual({ files: 4, lines: 2 + 1 + 3, capped: false });
  expect(await sizeOf(root, ['docs/d.md', '../outside', 'missing/'])).toEqual({ files: 1, lines: 1, capped: false });
  expect(await sizeOf(root, [])).toEqual({ files: 0, lines: 0, capped: false });
});
