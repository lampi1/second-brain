// Review tests for PR 23 (file viewer V2, paged text): they pin two paging bugs and FAIL on the PR head on purpose.
// Why: a NUL byte past the first page turns that page into a "binary" error the pager cannot leave, and main's line
// numbers (counting "\n" only) disagree with the viewer's (which also breaks lines at a lone "\r"), so page numbers
// overlap. Who: the PR 23 reviewer; run with `npx vitest run --config test/review/pr-23/vitest.config.ts`.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readFileView, FILE_VIEW_BYTES } from '../../../src/main/file-view';

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
  // On the PR head this is {kind:'unsupported',reason:'binary'}: CitedFile then renders only <Empty>, with no pager to
  // go back or on, and re-opening the same link keeps that request (same `ref`), so the user is stuck on the error.
  expect(next.kind).toBe('text');
});

/** The viewer's own line rule (FileViewer.tsx: `lineCount`, and Code's `text.replace(/\r\n?/g,'\n').split('\n')`). */
const viewerLines = (text: string) => text.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(text) ? 1 : 0);

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
  // On the PR head main counts only "\n" (file-view.ts linesBefore/newlines) while the viewer also breaks at a lone
  // "\r", so page 2 claims to start at a line number page 1 already showed (68965 vs 172411 here): numbers repeat.
  expect(second.firstLine).toBe(lastShown + 1);
});
