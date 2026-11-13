// The view reader follows append-only journals without reparsing history, handles partial writes, and never returns
// evidence outside its run. These are filesystem lifecycle/security regressions, not a mock of the CLI executor.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createRunReader } from '../../../src/main/routines/reader';
import { createDemoRoutines } from '../../../src/main/routines/demo';
import { tempDir } from '../routine-runtime/fakes';

async function fixture() {
  const root = tempDir('run-reader-'), app = createDemoRoutines(root, Date.now());
  const selected = await app.run(app.snapshot().runs.find(r => r.status === 'done')!);
  return { root, dir: selected.dir, events: path.join(selected.dir, 'events.jsonl'), reader: createRunReader(), selected };
}
it('carries an incomplete UTF-8 event across reads and resets the cache on truncation', async () => {
  const f = await fixture(), initial = await f.reader.read(f.dir);
  const line = Buffer.from(JSON.stringify({ type: 'action', at: 10, n: 1, text: 'Verifica già conclusa' }) + '\n');
  const split = line.indexOf(Buffer.from('à')) + 1;
  fs.appendFileSync(f.events, line.subarray(0, split));
  expect((await f.reader.read(f.dir)).events).toEqual(initial.events);
  fs.appendFileSync(f.events, line.subarray(split));
  expect((await f.reader.read(f.dir)).events.at(-1)).toMatchObject({ text: 'Verifica già conclusa' });
  fs.writeFileSync(f.events, JSON.stringify({ type: 'action', at: 12, n: 1, text: 'Nuovo journal' }) + '\n');
  expect((await f.reader.read(f.dir)).events).toEqual([{ type: 'action', at: 12, n: 1, text: 'Nuovo journal' }]);
});
it('retains screenshots while bounding the action tail, and resolves relative image events', async () => {
  const f = await fixture(), shot = f.selected.steps.flatMap(s => s.screenshots)[0]!;
  const events = [{ type: 'screenshot', at: 1, n: 3, path: path.relative(f.dir, shot) },
    ...Array.from({ length: 300 }, (_, i) => ({ type: 'action', at: i + 2, n: 3, text: `action ${i}` }))];
  fs.writeFileSync(f.events, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const result = await f.reader.read(f.dir);
  expect(result.events.filter(e => e.type === 'action')).toHaveLength(200);
  expect(result.events[0]).toMatchObject({ type: 'screenshot', path: fs.realpathSync(shot) });
});
it('refuses symlink evidence and screenshot paths outside the selected run', async () => {
  const f = await fixture(), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  const file = path.join(outside, 'private.png'); fs.writeFileSync(file, 'not run evidence');
  const stepDir = f.selected.steps[0]!.dir; fs.mkdirSync(stepDir, { recursive: true });
  fs.symlinkSync(outside, path.join(stepDir, 'evidence'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.appendFileSync(f.events, JSON.stringify({ type: 'screenshot', at: 1, n: 1, path: file }) + '\n');
  const read = await f.reader.read(f.dir);
  expect(read.steps[0]!.evidence).toEqual([]);
  expect(read.events.some(e => e.type === 'screenshot' && e.path === file)).toBe(false);
});
it('an already closed view performs no reader work', async () => {
  const reader = createRunReader(), controller = new AbortController(); controller.abort();
  await expect(reader.read('/does-not-exist', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
