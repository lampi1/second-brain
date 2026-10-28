// Idle routine reconciliation must not copy the whole archive or rebuild unchanged dossiers per historical run.
// Exercises the real service and runtime; recovery and pending cleanup remain covered by the flow integration suites.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createFlowRuntime } from '../../src/main/flows/runtime';

const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

it('does bounded archive work with 21 cancelled runs and leaves unchanged dossiers alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-polling-')); folders.push(root);
  const runtime = createFlowRuntime({ userData: root, brainRoot: () => root, chats: () => [], changed: () => {} });
  try {
    const flow = runtime.service();
    flow.propose({ expectedRevision: 0, definition: { id: 'fixture', title: 'Fixture', description: 'Polling fixture', aliases: [], scope: {}, steps: [{ id: 'gate', title: 'Gate', kind: 'approval', instructions: 'Confirm', inputs: [], evidence: [], timeoutMs: 1000, maxAttempts: 1, effect: 'read-only' }] } });
    flow.decideDefinition({ id: 'fixture', expectedRevision: 1, answer: 'yes' });
    for (let i = 0; i < 21; i++) {
      const run = flow.start({ flowId: 'fixture', flowVersion: 1, subjectKey: `fixture-${i}`, scope: {}, inputs: {} }, 'owner');
      flow.cancel({ runId: run.id, expectedRevision: run.revision });
    }
    await runtime.tick(); // initial recovery and durable dossiers
    const clones = vi.spyOn(globalThis, 'structuredClone');
    const reads = vi.spyOn(fs, 'readFileSync');
    await runtime.tick();
    const archiveCopies = clones.mock.calls.filter(([value]) => value && typeof value === 'object' && 'versions' in value && 'runs' in value);
    expect(archiveCopies.length).toBeLessThanOrEqual(5);
    expect(reads.mock.calls.filter(([file]) => String(file).includes(`${path.sep}reports${path.sep}`))).toHaveLength(0);
    expect(flow.snapshot().runs).toHaveLength(21);
    expect(flow.snapshot().runs.every(run => run.status === 'cancelled')).toBe(true);
    const run = flow.runsSnapshot()[0]!;
    flow.settlementResult(run.id, 'Synthetic settlement error'); // this does not increment the run revision
    expect(flow.runSnapshot(run.id)!.revision).toBe(run.revision);
    reads.mockClear();
    await runtime.tick();
    expect(reads.mock.calls.some(([file]) => String(file).includes(`${path.sep}reports${path.sep}`))).toBe(true);
    reads.mockClear();
    await runtime.tick();
    expect(reads.mock.calls.filter(([file]) => String(file).includes(`${path.sep}reports${path.sep}`))).toHaveLength(0);
  } finally { runtime.stop(); }
});
