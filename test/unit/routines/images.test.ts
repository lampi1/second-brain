// Explicit run-image boundary: tall browser captures work; escaped, linked, oversized and changing inputs do not.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readRoutineImage } from '../../../src/main/routines/images';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-image-')); dirs.push(dir); return dir; }
function png(width: number, height: number) {
  const b = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b;
}
it('reads tall full-page screenshots relative to the selected run and reloads overwritten files', async () => {
  const dir = await fixture(), file = path.join(dir, 'page.png');
  await fs.writeFile(file, png(1366, 6000));
  const first = await readRoutineImage(dir, 'page.png'); expect(first.kind).toBe('image');
  await fs.writeFile(file, png(1366, 7000));
  const second = await readRoutineImage(dir, file); expect(second.kind).toBe('image'); expect(second).not.toEqual(first);
});
it('refuses traversal, hard links, oversized raster dimensions and malformed images', async () => {
  const dir = await fixture(), outside = await fixture();
  const file = path.join(outside, 'page.png'); await fs.writeFile(file, png(20, 20));
  await expect(readRoutineImage(dir, file)).rejects.toThrow();
  await fs.link(file, path.join(dir, 'linked.png'));
  expect((await readRoutineImage(dir, 'linked.png')).kind).toBe('refused');
  await fs.writeFile(path.join(dir, 'large.png'), png(8192, 32768));
  expect((await readRoutineImage(dir, 'large.png')).kind).toBe('unsupported');
  await fs.writeFile(path.join(dir, 'bad.png'), 'not an image');
  expect((await readRoutineImage(dir, 'bad.png')).kind).toBe('unsupported');
});
it('binds the opened descriptor to the checked file, even when its pathname is restored', async () => {
  const dir = await fixture(), outside = await fixture(), safe = path.join(dir, 'safe.png'), secret = path.join(outside, 'private.png');
  await fs.writeFile(safe, png(20, 20)); await fs.writeFile(secret, png(30, 30));
  const canonicalSafe = await fs.realpath(safe);
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(((file: string, flags: number) => original(file === canonicalSafe ? secret : file, flags)) as typeof fs.open);
  expect(await readRoutineImage(dir, safe)).toMatchObject({ kind: 'refused', reason: 'changed' });
});
