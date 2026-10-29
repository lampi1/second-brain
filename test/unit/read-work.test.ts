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

it('sends the runs once per key: a read with the same key reuses the worker copy, a new key or worker sends them again (#276)', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z'), runs = demoEstimateRuns(now), runIds = runs.slice(-3).map(r => r.runId);
  const posted: { runs: number; cached?: true; runsKey?: string; op?: string }[] = [];
  const spy = (w: ReadWorker) => {
    const inner = (w as unknown as { worker: { postMessage(m: unknown): void } | null }).worker!;
    const post = inner.postMessage.bind(inner);
    inner.postMessage = (m: unknown) => {
      const x = m as { request: { op: string; runs?: unknown[]; input?: { runs: unknown[] } }; cached?: true; runsKey?: string; runsJson?: string };
      const own = x.request.runs ?? x.request.input?.runs ?? [];
      posted.push({ runs: x.runsJson !== undefined ? (JSON.parse(x.runsJson) as unknown[]).length : own.length, cached: x.cached, runsKey: x.runsKey, op: x.request.op });
      post(m);
    };
  };
  const expected = estimatesState(runs, runIds, now);
  expect(await worker.call({ op: 'estimates', runs, runIds, now }, 'k1')).toEqual(expected);
  spy(worker);
  expect(await worker.call({ op: 'estimates', runs, runIds, now }, 'k1')).toEqual(expected);
  expect(posted.at(-1)).toMatchObject({ runs: 0, cached: true });
  expect(await worker.call({ op: 'estimates', runs: runs.slice(0, -1), runIds, now }, 'k2')).toEqual(estimatesState(runs.slice(0, -1), runIds, now));
  expect(posted.at(-1)).toMatchObject({ runs: runs.length - 1, runsKey: 'k2' });
  worker.stop();
  expect(await worker.call({ op: 'estimates', runs, runIds, now }, 'k2')).toEqual(expected); // a new worker holds nothing: sent again
});

it('keeps one copy per kind of read: a brain view and an estimate with different keys do not send the runs again (#293-#297)', async () => {
  const now = Date.parse('2026-10-28T12:00:00Z'), runs = demoEstimateRuns(now), runIds = runs.slice(-3).map(r => r.runId);
  const w = new ReadWorker(path.join(root, 'read-worker.mjs'));
  try {
    const brain: BrainViewInput = { root: null, userData: root, home: null, profiles: [], runs, now };
    await w.call({ op: 'brain', input: brain }, 'store:1');
    await w.call({ op: 'estimates', runs, runIds, now }, 'store:1/9');
    const posted: { cached?: true; json: boolean }[] = [];
    const inner = (w as unknown as { worker: { postMessage(m: unknown): void } }).worker, post = inner.postMessage.bind(inner);
    inner.postMessage = (m: unknown) => { const x = m as { cached?: true; runsJson?: string }; posted.push({ cached: x.cached, json: x.runsJson !== undefined }); post(m); };
    expect(await w.call({ op: 'brain', input: brain }, 'store:1')).toEqual(readBrainView(brain));
    expect(await w.call({ op: 'estimates', runs, runIds, now }, 'store:1/9')).toEqual(estimatesState(runs, runIds, now));
    expect(posted).toEqual([{ cached: true, json: false }, { cached: true, json: false }]);
  } finally { w.stop(); }
});
