// mem.mjs error tags the agent run an error belongs to (" · run: r_…"): the brain's own tools read it; the app's per-run
// ai-errors column is gone (ADR 0182: the app's own `error` command never wrote a run, so it was always empty).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const mem = path.resolve(import.meta.dirname, '../../brain-template/ops/tools/mem.mjs');
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const makeDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-run-test-')); dirs.push(dir); return dir; };

function setup(chats: unknown[]) {
  const root = makeDir(), app = makeDir();
  fs.writeFileSync(path.join(app, 'chats.json'), JSON.stringify({ chats }));
  const write = (text: string, ...extra: string[]) => execFileSync(process.execPath, [mem, 'error', '--root', root, '--app', app, '--text', text, ...extra], { encoding: 'utf8', windowsHide: true });
  const lines = () => fs.readFileSync(path.join(root, 'ai-errors.md'), 'utf8').split(/\r?\n/).filter(l => l.startsWith('- '));
  return { write, lines };
}

it('adds the run of the app chat the line names, the newest chat of a reused title', () => {
  const { write, lines } = setup([
    { id: 'c1', title: 'Fix login', createdAt: 1, run: { runId: 'r_000000000001' } },
    { id: 'c2', title: 'Fix login', createdAt: 2, run: { runId: 'r_000000000002' } },
    { id: 'c3', title: 'Plain chat', createdAt: 3 },
  ]);
  write('2026-10-18 10:00 · Fix login · area · altro · detto: x · vero: y · visto da: Brother');
  write('2026-10-18 10:01 · Plain chat · area · altro · detto: x · vero: y · visto da: Brother');
  const [a, b] = lines();
  expect(a).toMatch(/ · run: r_000000000002$/);
  expect(b).not.toContain(' · run: ');
});

it('takes --run over the chat, and refuses a bad id or a run already in the text', () => {
  const { write, lines } = setup([{ id: 'c1', title: 'Fix login', createdAt: 1, run: { runId: 'r_000000000001' } }]);
  write('2026-10-18 10:00 · Fix login · area · altro · detto: x · vero: y · visto da: Brother', '--run', 'r_0000000000aa');
  expect(lines()[0]).toMatch(/ · run: r_0000000000aa$/);
  expect(() => write('2026-10-18 10:01 · Fix login · area · altro · detto: x · vero: y · visto da: Brother', '--run', 'r_bad')).toThrow();
  expect(() => write('2026-10-18 10:02 · Fix login · area · altro · detto: x · vero: y · visto da: Brother · run: r_000000000001')).toThrow();
  expect(lines()).toHaveLength(1);
});
