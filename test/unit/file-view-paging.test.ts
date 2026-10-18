// Paged text (SPEC 22 V2) from the PR 23 review: a NUL byte past the first page keeps the page readable text (binary is
// decided from the head of the file only), and main and the viewer number lines by one rule (lineCount: "\n" only, a
// lone "\r" stays inside its line), so page numbers never overlap. Pins src/main/file-view.ts and src/shared/file-view.ts.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readFileView, FILE_VIEW_BYTES } from '../../src/main/file-view';
import { lineCount, lineText } from '../../src/shared/file-view';

const temporary: string[] = [];
const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-review-23-')); temporary.push(d); return d; };
afterEach(() => { for (const d of temporary.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

it('a page after the first stays readable text when a NUL byte appears further into a log', async () => {
  // 1.5 MB of log lines, then a run of NUL padding (what a crash or power loss leaves in a preallocated log), then more
  const root = dir(), line = 'INFO 2026-10-18 work done\n';
  const head = line.repeat(Math.ceil(1_500_000 / line.length));
  fs.writeFileSync(path.join(root, 'app.log'), Buffer.concat([Buffer.from(head), Buffer.alloc(64), Buffer.from(line.repeat(1000))]));
  const first = await readFileView('app.log', { cwd: root });
  expect(first).toMatchObject({ kind: 'text', offset: 0, more: true });
  if (first.kind !== 'text') return;
  // the pager's Next (FileViewer.tsx Pager: go({offset:end})) asks for the page that starts where page 1 ended
  const next = await readFileView('app.log', { cwd: root, offset: first.offset + first.shown });
  // before the fix this was {kind:'unsupported',reason:'binary'}: the viewer showed only an error, with no pager
  expect(next.kind).toBe('text');
  if (next.kind !== 'text') return;
  // the NULs show as replacement characters, the bytes around them unchanged
  expect(next.text).toContain('�'.repeat(64) + line);
  expect(next.text).not.toContain('\0');
  expect(next.more).toBe(false);
});

it('a NUL byte in the head of the file still makes it binary, on any page asked for', async () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'data.bin'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(8), Buffer.from('x\n'.repeat(1_200_000))]));
  expect(await readFileView('data.bin', { cwd: root })).toMatchObject({ kind: 'unsupported', reason: 'binary' });
  expect(await readFileView('data.bin', { cwd: root, offset: 2_000_000 })).toMatchObject({ kind: 'unsupported', reason: 'binary' });
});

/** The viewer's own line rule (FileViewer.tsx: the pager's and TextBody's `lineCount`, Code's rows from `lineText`). */
const viewerLines = (text: string) => lineCount(text);

it('page 2 starts at the line after the last line the viewer numbered on page 1 (lone \\r progress lines)', async () => {
  // a build log with progress redraws ("\r" without "\n"), as npm, pip, curl or git write when their output is captured
  const root = dir();
  const block = 'step 1/3\r 10%\r 50%\r100%\ndone\n';
  fs.writeFileSync(path.join(root, 'build.log'), block.repeat(Math.ceil(2_200_000 / block.length)));
  const first = await readFileView('build.log', { cwd: root });
  expect(first).toMatchObject({ kind: 'text', offset: 0, firstLine: 1, more: true });
  if (first.kind !== 'text') return;
  expect(first.shown).toBeLessThanOrEqual(FILE_VIEW_BYTES);
  // what the pager shows for page 1: `lines first–last` with last = firstLine + lineCount(text) - 1
  const lastShown = first.firstLine! + viewerLines(first.text) - 1;
  const second = await readFileView('build.log', { cwd: root, offset: first.offset + first.shown });
  expect(second.kind).toBe('text');
  if (second.kind !== 'text') return;
  // before the fix main counted only "\n" while the viewer also broke lines at a lone "\r", so page 2 claimed to start
  // at a line number page 1 already showed (68965 vs 172411 here)
  expect(second.firstLine).toBe(lastShown + 1);
});

it('the viewer draws one row per line of the rule: "\\n" and "\\r\\n" end a line, a lone "\\r" stays inside it', () => {
  expect(lineCount('a\r 50%\r100%\nb\r\nc')).toBe(3);
  expect(lineCount('a\nb\n')).toBe(2);
  expect(lineCount('')).toBe(1);
  expect(lineText('a\r 50%\r100%\nb\r\nc').split('\n')).toEqual(['a  50% 100%', 'b', 'c']);
  // Code splits lineText(text) on "\n": as many rows as lineCount, plus the empty row after a final line end
  for (const text of ['x\ry\n', 'x\r\n\r\ny', '\r\r\n']) expect(lineText(text).split('\n').length - (text.endsWith('\n') ? 1 : 0)).toBe(lineCount(text));
});
