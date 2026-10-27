// The app's routine host (ADR 0175): an app run of an active routine version is executed by the shared package (the
// approval step dropped, a plain session per step) and its run folder is mirrored back into the app's run view, so the
// Routine page shows it completed; the app trigger goes through the package's shared loop (one run per work item).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRoutineHost, type RoutineHost } from '../../../src/main/flows/routine-host';
import { createFlowRuntime } from '../../../src/main/flows/runtime';
import type { ChatSummary } from '../../../src/shared/contract';
import { FlowService } from '../../../src/main/flows/service';
import { DevOpsWriter } from '../../../src/main/flows/devops-writer';
import { APP_OWNER, type FlowDefinition } from '../../../src/shared/flows';
import type { FlowAutomationConfig } from '../../../src/shared/flow-automation';
import { done, scriptedEngine, tempDir } from './fakes';

const definition: FlowDefinition = { id: 'triage', title: 'Triage', description: 'Fixture', aliases: [], scope: {}, steps: [
  { id: 'read', title: 'Read', kind: 'agent', instructions: 'Read work item {{work-item-id}}.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], effect: 'read-only', maxAttempts: 1, timeoutMs: 600000 },
  { id: 'ok', title: 'Approve', kind: 'approval', instructions: 'Approve.', inputs: [], evidence: [], effect: 'read-only', maxAttempts: 1, timeoutMs: 600000 },
  { id: 'fix', title: 'Fix', kind: 'agent', instructions: 'Fix it.', inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], effect: 'read-only', maxAttempts: 1, timeoutMs: 600000 },
] } as unknown as FlowDefinition;

function setup() {
  const folder = tempDir('routine-host-');
  const flow = new FlowService({ file: path.join(folder, 'flows', 'ctx', 'state.json'), contextKey: 'ctx' });
  flow.propose({ expectedRevision: 0, definition }); flow.decideDefinition({ id: 'triage', expectedRevision: 1, answer: 'yes' });
  const engine = scriptedEngine(request => done(`did ${request.stepId}`));
  const host = createRoutineHost({ userData: folder, engine, token: { authorization: async () => 'Bearer fixture' } });
  return { folder, flow, engine, host };
}

describe('app routine host', () => {
  it('runs an app run through the package and mirrors it completed, approval included', async () => {
    const { folder, flow, engine, host } = setup();
    const run = flow.start({ flowId: 'triage', flowVersion: 1, subjectKey: 'item:42', scope: {}, inputs: { 'work-item-id': '42', workspace: folder } }, APP_OWNER);
    const { runId, finished } = host.execute(run, definition, undefined, record => flow.mirrorPackageRun(run.id, { ...record, folder: path.join(host.runsRoot('triage'), record.runId) }));
    const record = await finished;
    expect(record.status).toBe('done');
    expect(engine.requests.map(r => r.stepId)).toEqual(['read', 'fix']);
    expect(engine.requests[0]!.prompt).toContain('42');
    const mirrored = flow.snapshot().runs.find(r => r.id === run.id)!;
    expect(mirrored.status).toBe('completed');
    expect(mirrored.currentStep).toBe(3);
    expect(mirrored.steps.map(s => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(mirrored.steps[0]!.receipt?.summary).toBe('did read');
    expect(fs.existsSync(path.join(host.runsRoot('triage'), runId, 'report.md'))).toBe(true);
    expect(host.packageRunOf(run.id)).toBe(runId);
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'routine-runs', 'links.json'), 'utf8'))).toEqual({ [run.id]: runId });
  });

  it('starts the app trigger once per work item through the shared loop', async () => {
    const { host } = setup();
    const config = { flowId: 'triage', flowVersion: 1, scope: {}, inputs: {}, priority: 'normal',
      trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true } } as unknown as FlowAutomationConfig;
    const item = { key: '42', title: 'Bug', inputs: { 'work-item-id': '42', 'work-item-revision': '3' } };
    const started: number[] = [];
    const loop = host.trigger(definition, config, async () => ({ cursor: {}, items: [item], summary: '1 item' }), workItem => { started.push(workItem); return { runId: `app:${workItem}` }; });
    await loop.tick();
    await loop.tick();
    expect(started).toEqual([42]);
  });

  it('ends a migrated legacy run and settles its verified pending writes, leaving unverified ones alone', () => {
    const { folder, flow } = setup();
    const run = flow.start({ flowId: 'triage', flowVersion: 1, subjectKey: 'item:7', scope: {}, inputs: { 'work-item-id': '7', workspace: folder } }, APP_OWNER);
    flow.endLegacyRun(run.id, 'legacy write verified: not applied');
    expect(flow.snapshot().runs.find(r => r.id === run.id)!.status).toBe('cancelled');
    const file = path.join(folder, 'ledger.json');
    const op = (state: string) => ({ runId: run.id, state, op: 'comment', organization: 'contoso', workItemId: 7, at: 1 });
    fs.writeFileSync(file, JSON.stringify({ schema: 1, runs: {}, operations: { a: op('pending'), b: op('pending'), c: op('done') } }));
    const writer = new DevOpsWriter({ file } as never);
    writer.settleLegacy([{ id: 'a', outcome: 'not-done', note: 'absent on DevOps' }, { id: 'c', outcome: 'not-done', note: 'ignored' }]);
    expect(writer.operationsFor(run.id).map(o => [o.requestHash, o.state])).toEqual([['a', 'not-done'], ['b', 'pending'], ['c', 'done']]);
  });

  it('cancels a running session through the runtime that started it, even after a trigger tick', async () => {
    const folder = tempDir('routine-host-cancel-');
    const flow = new FlowService({ file: path.join(folder, 'state.json'), contextKey: 'ctx' });
    flow.propose({ expectedRevision: 0, definition }); flow.decideDefinition({ id: 'triage', expectedRevision: 1, answer: 'yes' });
    let aborted = false;
    const engine = { async run(request: { signal: AbortSignal }) { await new Promise<void>(resolve => request.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); return { exitCode: 1, error: 'stopped' }; } };
    const host = createRoutineHost({ userData: folder, engine: engine as never, token: { authorization: async () => 'Bearer fixture' } });
    const run = flow.start({ flowId: 'triage', flowVersion: 1, subjectKey: 'item:9', scope: {}, inputs: { 'work-item-id': '9', workspace: folder } }, APP_OWNER);
    const { finished } = host.execute(run, definition);
    await vi.waitFor(() => expect(host.packageRunOf(run.id)).toBeDefined());
    const config = { flowId: 'triage', flowVersion: 1, scope: {}, inputs: {}, priority: 'normal', trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true } } as unknown as FlowAutomationConfig;
    await host.trigger(definition, config, async () => ({ cursor: {}, items: [], summary: 'none' }), () => ({ runId: 'x' })).tick();
    await new Promise(resolve => setTimeout(resolve, 50));
    host.cancel(run.id, definition);
    expect((await finished).status).toBe('cancelled');
    expect(aborted).toBe(true);
  });

  it('releases a trigger item the app never queued, keeps the ones it did', async () => {
    const { host } = setup();
    const config = { flowId: 'triage', flowVersion: 1, scope: {}, inputs: {}, priority: 'normal', trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true } } as unknown as FlowAutomationConfig;
    const items = [41, 42].map(id => ({ key: String(id), title: 'Bug', inputs: { 'work-item-id': String(id), 'work-item-revision': '1' } }));
    const started: number[] = [];
    const loop = () => host.trigger(definition, config, async () => ({ cursor: { 41: '1', 42: '1' }, items, summary: '2 items' }), id => { started.push(id); return { runId: `app:triage:${id}` }; });
    await loop().tick();
    expect(host.releaseLost(definition, 'app:triage:', id => id === 41)).toEqual([42]);
    await loop().tick();
    expect(started).toEqual([41, 42, 42]);
  });

  it('never resumes a blocked app run on its own: one package start, however often the store changes', async () => {
    const folder = tempDir('routine-host-pump-'), brain = path.join(folder, 'brain'); fs.mkdirSync(brain);
    const execute = vi.fn((_run: unknown, _def: unknown, _auto: unknown, changed?: (record: never) => void) => {
      const record = { runId: 'p1', routineId: 'triage', status: 'failed', error: 'step failed', steps: [{ id: 'read', status: 'failed', error: 'no result' }, { id: 'fix', status: 'pending' }] } as never;
      changed?.(record);
      return { runId: 'p1', finished: Promise.resolve(record) };
    });
    const host = { execute, cancel: vi.fn(), trigger: vi.fn(), releaseLost: vi.fn(() => []), migrateLegacy: vi.fn(async () => ({ operations: [], runs: [] })), packageRunOf: () => 'p1', runsRoot: () => path.join(folder, 'runs') } as unknown as RoutineHost;
    const runtime = createFlowRuntime({ userData: folder, brainRoot: () => brain, chats: () => [{ id: 'o', isOrchestrator: true, state: 'idle' }] as ChatSummary[], changed: () => {}, send: vi.fn(async () => {}), routineHost: host });
    const flow = runtime.service();
    flow.propose({ expectedRevision: 0, definition }); flow.decideDefinition({ id: 'triage', expectedRevision: 1, answer: 'yes' });
    const run = flow.start({ flowId: 'triage', flowVersion: 1, subjectKey: 'item:5', scope: {}, inputs: { 'work-item-id': '5', workspace: brain } }, APP_OWNER);
    await runtime.tick();
    await vi.waitFor(() => expect(flow.snapshot().runs.find(r => r.id === run.id)!.status).toBe('blocked'));
    for (let i = 0; i < 3; i++) { await runtime.tick(); await new Promise(resolve => setTimeout(resolve, 20)); }
    expect(execute).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('M2: interruptLegacy links the app run to an interrupted package run, so execute never restarts it', async () => {
    const { folder, flow, engine, host } = setup();
    const run = flow.start({ flowId: 'triage', flowVersion: 1, subjectKey: 'item:77', scope: {}, inputs: { 'work-item-id': '77', workspace: folder } }, APP_OWNER);
    const runId = host.interruptLegacy(run, definition, 'interrupted by migration: test');
    expect(host.packageRunOf(run.id)).toBe(runId);
    const record = await host.execute(run, definition).finished;
    expect(record.status).toBe('cancelled');
    expect(engine.requests).toEqual([]);
    expect(fs.readFileSync(path.join(host.runsRoot('triage'), runId, 'report.md'), 'utf8')).toContain('interrupted by migration');
  });
});
