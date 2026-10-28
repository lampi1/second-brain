// Requested statistics use a real worker: matching values, responsive main loop, read-only snapshots and recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ReadWorker } from '../../src/main/read-work';
import { demoEstimateRuns, estimatesState } from '../../src/main/agents/run-estimates';
import { readBrainView, type BrainViewInput } from '../../src/main/brainmodel/view';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-read-worker-'));
let worker: ReadWorker;
beforeAll(async () => {
  const file = path.join(root, 'read-worker.mjs');
  await build({ entryPoints: ['src/main/read-worker.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  worker = new ReadWorker(file);
});
afterAll(() => { worker?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
it('returns identical estimates while the main event loop keeps running, with an immutable input snapshot', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z'), runs = demoEstimateRuns(now), runIds = runs.slice(-3).map(r => r.runId);
  const expected = estimatesState(runs, runIds, now);
  let ticks = 0; const timer = setInterval(() => ticks++, 1);
  try {
    const pending = worker.call({ op: 'estimates', runs, runIds, now });
    runs[0]!.goal = 'Changed after the request'; runs[0]!.costUsd = 12345;
    expect(await pending).toEqual(expected); expect(ticks).toBeGreaterThan(0);
  } finally { clearInterval(timer); }
});
it('reads the same brain view without rewriting files, and observes the next explicit file change', async () => {
  const brain = path.join(root, 'brain'); fs.mkdirSync(brain);
  const file = path.join(brain, 'now.md'); fs.writeFileSync(file, '# Open threads\n- First fixture.\n');
  const input: BrainViewInput = { root: brain, userData: root, home: null, profiles: [], runs: [], now: Date.now() };
  const before = fs.statSync(file).mtimeMs;
  expect(await worker.call({ op: 'brain', input })).toEqual(readBrainView(input));
  expect(fs.statSync(file).mtimeMs).toBe(before);
  expect(fs.existsSync(path.join(root, 'brain-changes.json'))).toBe(false);
  fs.writeFileSync(file, '# Open threads\n- Second fixture.\n');
  const next = await worker.call({ op: 'brain', input }); expect(next.memory[0]!.preview).toContain('Second fixture.');
});
it('rejects pending work on stop and serves a later request with a new worker', async () => {
  const request = { op: 'estimates' as const, runs: [], runIds: [], now: Date.now() };
  const pending = worker.call(request); const rejected = expect(pending).rejects.toThrow('stopped'); worker.stop(); await rejected;
  expect(await worker.call(request)).toEqual(estimatesState([], [], request.now));
});

it.each(['brain-migration.json', 'brain-maintenance.json'])('keeps Memoria available with a corrupt optional %s report', async name => {
  const file = path.join(root, name); fs.writeFileSync(file, '{');
  try {
    const input: BrainViewInput = { root: null, userData: root, home: null, profiles: [], runs: [], now: Date.now() };
    expect(await worker.call({ op: 'brain', input })).toMatchObject({ skills: [], changes: [], migration: null, lastRun: null });
    expect(fs.readFileSync(file, 'utf8')).toBe('{');
  } finally { fs.unlinkSync(file); }
});
