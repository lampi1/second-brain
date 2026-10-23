// Automatic-flow regression tests use fake clocks and injected read-only detectors, with real durable ledgers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowDefinition } from '../../src/shared/flows';
import type { FlowAutomationConfig, FlowDetectionResult } from '../../src/shared/flow-automation';
import { FlowService } from '../../src/main/flows/service';
import { FlowAutomationService } from '../../src/main/flows/automation';
import { automationTools } from '../../src/main/flows/automation-tools';
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const definition = (id = 'sample'): FlowDefinition => ({ id, title: id, description: 'Fixture', aliases: [], scope: { project: 'Project', areaPath: 'Team' }, steps: [{ id: 'review', title: 'Review', kind: 'approval', instructions: 'User reviews evidence', inputs: [], evidence: [], effect: 'read-only', maxAttempts: 1, timeoutMs: 1000 }] });
const config = (flowId = 'sample'): FlowAutomationConfig => ({ flowId, flowVersion: 1, scope: { project: 'Project', areaPath: 'Team' }, inputs: { workspace: '/project' }, priority: 'normal', trigger: { kind: 'interval', everyMinutes: 1 } });
const devops = (includeExisting = false): FlowAutomationConfig => ({ ...config(), trigger: { kind: 'devops', everyMinutes: 1, organization: 'organization', project: 'Project', areaPath: 'Team', workItemType: 'Task', states: ['New'], includeExisting } });
const result = (keys = ['1']): FlowDetectionResult => ({ cursor: { revision: keys.join(',') }, summary: 'Read only', items: keys.map(key => ({ key, title: `Task ${key}`, inputs: { 'work-item-id': key } })) });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-')); dirs.push(dir); let now = 1000;
  const flow = new FlowService({ file: path.join(dir, 'flows.json'), contextKey: 'brain', now: () => now });
  const activate = (id = 'sample', revision = 0): void => { flow.propose({ definition: definition(id), expectedRevision: revision }); flow.decideDefinition({ id, expectedRevision: revision + 1, answer: 'yes' }); };
  activate(); const file = path.join(dir, 'automation.json'), detect = vi.fn(async () => result()), dispatch = vi.fn(async () => true);
  const options = { file, flow: () => flow, now: () => now, detect, dispatch };
  const auto = new FlowAutomationService(options);
  const enable = (value = config()) => { const rule = auto.propose({ config: value, expectedRevision: 0 }, 'orch'); return auto.decide({ id: rule.id, expectedRevision: rule.revision, answer: 'yes' }); };
  return { auto, flow, options, file, detect, dispatch, activate, enable, advance: (ms = 60000) => { now += ms; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('automatic flow authorization and persistence', () => {
  it('starts empty, requires exact revision activation, and defaults background off', async () => {
    const { auto, dispatch } = setup(); expect(auto.snapshot()).toMatchObject({ paused: false, background: false, rules: [], events: [] });
    const rule = auto.propose({ config: config(), expectedRevision: 0 }, 'orch'); await auto.tick(); expect(dispatch).not.toHaveBeenCalled();
    auto.propose({ config: config(), expectedRevision: 1 }, 'orch'); expect(() => auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' })).toThrow('stale');
    expect(() => auto.pause({ id: rule.id, expectedRevision: 2, paused: false })).toThrow('approved');
    auto.decide({ id: rule.id, expectedRevision: 2, answer: 'yes' }); await auto.tick(); expect(dispatch).toHaveBeenCalledOnce();
  });
  it('replaces approved configs with inert proposals and invalidates queued events', async () => {
    const { auto, enable } = setup(); enable(); await auto.tick(); const event = auto.snapshot().events[0]!;
    auto.propose({ config: config(), expectedRevision: 1 }, 'orch'); expect(auto.snapshot().events[0]!.status).toBe('cancelled'); expect(() => auto.startEvent(event.id, 'orch')).toThrow('stale');
  });
  it('persists exact rejection feedback and global pause across restart', async () => {
    const { auto, options, dispatch } = setup(); const rule = auto.propose({ config: config(), expectedRevision: 0 }, 'orch');
    auto.decide({ id: rule.id, expectedRevision: 1, answer: 'other', feedback: 'Change scope' }); auto.control({ expectedRevision: auto.snapshot().revision, paused: true, background: true });
    const restarted = new FlowAutomationService(options); await restarted.tick(); expect(dispatch).not.toHaveBeenCalled(); expect(restarted.snapshot()).toMatchObject({ paused: true, background: true, rules: [{ status: 'rejected', feedback: 'Change scope' }] });
  });
  it('validates flow versions, exact DevOps scope, reserved inputs and executable fields', () => {
    const { auto, flow } = setup();
    for (const value of [{ ...config(), flowVersion: 2 }, { ...config(), scope: {} }, { ...devops(), inputs: { 'work-item-id': 'spoof' } }, { ...devops(), scope: { project: 'Project', areaPath: 'Team/Sub' } }, { ...config(), trigger: { kind: 'shell', everyMinutes: 1 } }]) expect(() => auto.propose({ config: value as FlowAutomationConfig, expectedRevision: 0 }, 'orch')).toThrow();
    const def = definition('unsafe'); def.steps[0]!.effect = 'production'; flow.propose({ definition: def, expectedRevision: 0 }); flow.decideDefinition({ id: 'unsafe', expectedRevision: 1, answer: 'yes' });
    expect(() => auto.propose({ config: config('unsafe'), expectedRevision: 0 }, 'orch')).toThrow('unsupported');
  });
  it('requires all step inputs and workspace before proposal and activation', () => {
    const { auto, flow } = setup(); const def = definition('required'); def.steps[0]!.inputs = ['workspace', 'target']; def.steps[0]!.workspaceInput = 'workspace';
    flow.propose({ definition: def, expectedRevision: 0 }); flow.decideDefinition({ id: def.id, expectedRevision: 1, answer: 'yes' });
    expect(() => auto.propose({ config: config('required'), expectedRevision: 0 }, 'orch')).toThrow('missing required');
    expect(() => auto.propose({ config: { ...config('required'), inputs: { target: 'x' } }, expectedRevision: 0 }, 'orch')).toThrow('workspace');
    expect(auto.propose({ config: { ...config('required'), inputs: { workspace: '/project', target: 'x' } }, expectedRevision: 0 }, 'orch').status).toBe('proposed');
  });
  it('requires metadata for scope-present builtins before approving automation', () => {
    const { auto, flow } = setup(); const def = definition('metadata'); def.scope = {}; def.steps[0] = { ...def.steps[0]!, kind: 'check', action: { kind: 'builtin', ref: 'scope-present' } };
    flow.propose({ definition: def, expectedRevision: 0 }); flow.decideDefinition({ id: def.id, expectedRevision: 1, answer: 'yes' });
    for (const scope of [{}, { project: 'Project' }, { areaPath: 'Team' }]) expect(() => auto.propose({ config: { ...config(def.id), scope }, expectedRevision: 0 }, 'orch')).toThrow('scope-present');
    expect(auto.propose({ config: config(def.id), expectedRevision: 0 }, 'orch').status).toBe('proposed');
  });
  it('allows DevOps host inputs in configuration but requires their actual values before starting', async () => {
    const { auto, flow, detect } = setup(); const def = definition('host-input'); def.steps[0]!.inputs = ['work-item-id', 'work-item-revision', 'work-item-url'];
    flow.propose({ definition: def, expectedRevision: 0 }); flow.decideDefinition({ id: def.id, expectedRevision: 1, answer: 'yes' });
    const rule = auto.propose({ config: { ...devops(true), flowId: def.id }, expectedRevision: 0 }, 'orch'); auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' });
    detect.mockResolvedValue(result()); await auto.tick(); expect(() => auto.startEvent(auto.snapshot().events[0]!.id, 'orch')).toThrow('missing required'); expect(flow.snapshot().runs).toHaveLength(0); expect(auto.snapshot().events[0]!.status).toBe('blocked');
  });
  it('recovers a closed owner through a fresh proposal requiring exact user approval', async () => {
    const { auto, enable } = setup(); enable(); await auto.tick(); const previous = auto.snapshot().events[0]!;
    expect(() => auto.propose({ config: config(), expectedRevision: 0 }, 'new-orch')).toThrow('changed');
    const replacement = auto.propose({ config: config(), expectedRevision: 1 }, 'new-orch'); expect(replacement).toMatchObject({ status: 'proposed', ownerOrchestratorId: 'new-orch', revision: 2 }); expect(auto.snapshot().events[0]!.status).toBe('cancelled');
    expect(() => auto.startEvent(previous.id, 'orch')).toThrow('another'); await auto.tick(); expect(auto.snapshot().events).toHaveLength(1);
    auto.decide({ id: replacement.id, expectedRevision: 2, answer: 'yes' }); await auto.tick(); const event = auto.snapshot().events[1]!; expect(auto.startEvent(event.id, 'new-orch').ownerOrchestratorId).toBe('new-orch');
  });
  it('fails closed on corrupt or semantically tampered storage', async () => {
    const { auto, enable, file, options } = setup(); enable(); await auto.tick(); const original = fs.readFileSync(file, 'utf8');
    for (const tamper of ['{', original.replace('"approvedRevision":1', '"approvedRevision":2'), original.replace('"subjectKey":"auto:', '"subjectKey":"spoof:'), original.replace('"attempts":1', '"attempts":999')]) {
      fs.writeFileSync(file, tamper); const broken = new FlowAutomationService(options); expect(broken.snapshot().storageError).toBeTruthy(); expect(() => broken.propose({ config: config(), expectedRevision: 0 }, 'orch')).toThrow('storage');
    }
  });
});
describe('durable automatic detection', () => {
  it('coalesces missed intervals, spends no detector calls and deduplicates across restart', async () => {
    const { auto, enable, advance, detect, options } = setup(); enable(); await auto.tick(); advance(600000); await auto.tick(); expect(auto.snapshot().events).toHaveLength(2); expect(detect).not.toHaveBeenCalled();
    const restarted = new FlowAutomationService(options); await restarted.tick(); expect(restarted.snapshot().events).toHaveLength(2);
  });
  it('baselines existing DevOps items and atomically remembers them across restart', async () => {
    const { auto, enable, advance, detect, options } = setup(); enable(devops()); await auto.tick(); expect(auto.snapshot().events).toHaveLength(0);
    const restarted = new FlowAutomationService(options); advance(); detect.mockResolvedValue(result(['1', '2'])); await restarted.tick(); expect(restarted.snapshot().events.map(event => event.sourceKey)).toEqual(['2']);
    advance(); await restarted.tick(); expect(restarted.snapshot().events).toHaveLength(1);
  });
  it('preserves real DevOps cursor metadata and more than 100 numeric ID revisions across restart', async () => {
    const { auto, enable, detect, options, advance, file } = setup(); enable(devops());
    const cursor = { __devopsBaseline: 'a'.repeat(64), ...Object.fromEntries(Array.from({ length: 150 }, (_, index) => [String(index + 1), '3'])) };
    detect.mockResolvedValue({ cursor, summary: 'DevOps baseline', items: [] }); await auto.tick(); expect(auto.snapshot().rules[0]!.error).toBeUndefined();
    expect(Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).cursors)[0]).toEqual(cursor);
    const restarted = new FlowAutomationService(options); expect(restarted.snapshot().storageError).toBeUndefined(); advance(); await restarted.tick();
    expect(detect).toHaveBeenLastCalledWith(expect.anything(), cursor, expect.any(AbortSignal));
  });
  it('bounds opaque cursor keys and rejects prototype-pollution fields without saving them', async () => {
    for (const cursor of [JSON.parse('{"__proto__":"x"}'), { constructor: 'x' }, { prototype: 'x' }, Object.fromEntries(Array.from({ length: 10002 }, (_, index) => [String(index), '1']))]) {
      const { auto, enable, detect, file } = setup(); enable(devops()); detect.mockResolvedValue({ cursor, summary: 'Invalid', items: [] }); await auto.tick();
      expect(auto.snapshot().rules[0]!.error).toMatch(/cursor/); expect(JSON.parse(fs.readFileSync(file, 'utf8')).cursors).toEqual({});
    }
  });
  it('includes existing items only when approved and detects input collisions without advancing cursor', async () => {
    const { auto, enable, detect, file } = setup(); enable(devops(true)); detect.mockResolvedValue({ ...result(), items: [{ key: '1', title: 'Bad', inputs: { workspace: '/other' } }] }); await auto.tick();
    expect(auto.snapshot().rules[0]!.error).toContain('conflict'); expect(JSON.parse(fs.readFileSync(file, 'utf8')).cursors).toEqual({});
    detect.mockResolvedValue(result()); auto.control({ expectedRevision: auto.snapshot().revision, paused: false }); await auto.tick(); expect(auto.snapshot().events).toHaveLength(1);
  });
  it('blocks excess backlog visibly without dropping the cursor and can explicitly recover', async () => {
    const { auto, enable, detect, file } = setup(); enable(devops(true)); detect.mockResolvedValue(result(Array.from({ length: 201 }, (_, i) => String(i)))); await auto.tick();
    expect(auto.snapshot().rules[0]!.error).toContain('backlog'); expect(auto.snapshot().events).toHaveLength(0); expect(JSON.parse(fs.readFileSync(file, 'utf8')).cursors).toEqual({});
  });
  it.each(['pause', 'stop', 'replace', 'brain'] as const)('discards stale asynchronous detector completion after %s', async action => {
    const { auto, enable, detect, options } = setup(); const wait = deferred<FlowDetectionResult>(); detect.mockImplementation(() => wait.promise); const rule = enable(devops(true)); const tick = auto.tick();
    if (action === 'pause') auto.pause({ id: rule.id, expectedRevision: 1, paused: true });
    if (action === 'stop') auto.stop();
    if (action === 'replace') auto.propose({ config: config(), expectedRevision: 1 }, 'orch');
    if (action === 'brain') options.flow = () => new FlowService({ file: `${options.file}.other`, contextKey: 'other' });
    wait.resolve(result()); await tick; expect(auto.snapshot().events).toHaveLength(0);
  });
  it('revalidates the pinned flow after an asynchronous detector returns', async () => {
    const { auto, enable, detect, activate } = setup(); const wait = deferred<FlowDetectionResult>(); detect.mockImplementation(() => wait.promise); enable(devops(true)); const tick = auto.tick(); activate('sample', 1); wait.resolve(result()); await tick;
    expect(auto.snapshot().events).toHaveLength(0); expect(auto.snapshot().rules[0]!.error).toContain('pinned');
  });
  it('invalidates in-flight state after a rejected mutation rolls back', async () => {
    const { auto, enable, detect } = setup(); const wait = deferred<FlowDetectionResult>(); detect.mockImplementation(() => wait.promise); const rule = enable(devops(true)); const tick = auto.tick();
    expect(() => auto.pause({ id: rule.id, expectedRevision: 999, paused: true })).toThrow('stale'); wait.resolve(result()); await tick; expect(auto.snapshot().events).toHaveLength(0);
  });
  it('exposes a storage blocker without committing a detector cursor when atomic persistence fails', async () => {
    const { auto, enable, file } = setup(); enable(); const prior = fs.readFileSync(file, 'utf8'); vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk unavailable'); }); await auto.tick();
    expect(auto.snapshot().storageError).toContain('unavailable'); expect(auto.snapshot().events).toHaveLength(0); expect(fs.readFileSync(file, 'utf8')).toBe(prior);
  });
  it('keeps single flight when a commit observer reenters the scheduler', async () => {
    const { options, dispatch } = setup(); const reentered: Promise<void>[] = []; let observing = false;
    const auto = new FlowAutomationService({ ...options, changed: () => { if (observing) reentered.push(auto.tick()); } });
    const rule = auto.propose({ config: config(), expectedRevision: 0 }, 'orch'); auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' }); observing = true;
    const tick = auto.tick(); await tick; expect(dispatch).toHaveBeenCalledOnce(); expect(reentered.length).toBeGreaterThan(0); expect(reentered.every(promise => promise === tick)).toBe(true);
  });
  it('uses single flight for concurrent scheduler ticks', async () => {
    const { auto, enable, detect } = setup(); const wait = deferred<FlowDetectionResult>(); detect.mockImplementation(() => wait.promise); enable(devops(true)); const first = auto.tick(), second = auto.tick(); expect(first).toBe(second); expect(detect).toHaveBeenCalledOnce(); wait.resolve(result()); await first; expect(auto.snapshot().events).toHaveLength(1);
  });
});
describe('Orchestrator notification and event starts', () => {
  it('never starts a flow during tick; authenticated starts derive input and deduplicate', async () => {
    const { auto, flow, enable } = setup(); enable(); await auto.tick(); expect(flow.snapshot().runs).toHaveLength(0); const event = auto.snapshot().events[0]!;
    expect(() => auto.startEvent(event.id, 'other')).toThrow('another'); const run = auto.startEvent(event.id, 'orch'); expect(run.inputs).toEqual(config().inputs); expect(run.subjectKey).toBe(event.subjectKey); expect(auto.startEvent(event.id, 'orch').id).toBe(run.id);
  });
  it('recovers a flow commit whose event write was interrupted', async () => {
    const { auto, flow, enable, options } = setup(); enable(); await auto.tick(); const event = auto.snapshot().events[0]!;
    const run = flow.start({ flowId: 'sample', flowVersion: 1, subjectKey: event.subjectKey, inputs: event.inputs, scope: config().scope }, 'orch');
    const restarted = new FlowAutomationService(options); expect(restarted.startEvent(event.id, 'orch').id).toBe(run.id); expect(restarted.snapshot().events[0]!.runId).toBe(run.id); expect(flow.snapshot().runs).toHaveLength(1);
  });
  it('caps automatic concurrency at two global and one per rule', async () => {
    const { auto, enable, activate, advance } = setup(); activate('second'); activate('third'); enable(); enable(config('second')); enable(config('third')); await auto.tick(); const events = auto.snapshot().events;
    auto.startEvent(events[0]!.id, 'orch'); auto.startEvent(events[1]!.id, 'orch'); expect(() => auto.startEvent(events[2]!.id, 'orch')).toThrow('concurrency');
    advance(); await auto.tick(); expect(() => auto.startEvent(auto.snapshot().events.find(event => event.ruleId === events[0]!.ruleId && event.id !== events[0]!.id)!.id, 'orch')).toThrow('concurrency');
  });
  it('dispatches urgent rules first and never consumes retry attempts for a busy owner', async () => {
    const { auto, enable, activate, dispatch } = setup(); activate('urgent'); enable(); enable({ ...config('urgent'), priority: 'urgent' }); dispatch.mockResolvedValue(false); await auto.tick();
    expect(dispatch.mock.calls[0]?.length).toBe(2); expect(auto.snapshot().events.every(event => event.attempts === 0)).toBe(true);
    const calls = dispatch.mock.calls as unknown as [ { config: FlowAutomationConfig }, unknown ][]; expect(calls[0]![0].config.flowId).toBe('urgent');
  });
  it('bounds dispatch failures, honors backoff across restart, and supports explicit recovery', async () => {
    const { auto, enable, dispatch, advance, options } = setup(); enable(); dispatch.mockRejectedValue(new Error('Owner closed')); await auto.tick(); await auto.tick(); expect(dispatch).toHaveBeenCalledTimes(1);
    advance(); const restarted = new FlowAutomationService(options); await restarted.tick(); advance(120000); await restarted.tick();
    const event = restarted.snapshot().events[0]!; expect(event).toMatchObject({ status: 'blocked', attempts: 3, reason: 'Owner closed' });
    dispatch.mockResolvedValue(true); restarted.control({ expectedRevision: restarted.snapshot().revision, paused: false }); await restarted.tick(); expect(restarted.snapshot().events[0]!.status).toBe('notified');
  });
  it('retries unacknowledged notifications after two minutes across restart, bounded to three dispatches', async () => {
    const { auto, enable, dispatch, advance, options } = setup(); enable({ ...config(), trigger: { kind: 'interval', everyMinutes: 60 } }); await auto.tick(); expect(auto.snapshot().events[0]).toMatchObject({ status: 'notified', attempts: 1, nextAttemptAt: 121000 });
    advance(119999); await auto.tick(); expect(dispatch).toHaveBeenCalledTimes(1);
    const restarted = new FlowAutomationService(options); advance(1); await restarted.tick(); expect(dispatch).toHaveBeenCalledTimes(2); expect(restarted.snapshot().events[0]).toMatchObject({ status: 'notified', attempts: 2 });
    advance(120000); await restarted.tick(); expect(dispatch).toHaveBeenCalledTimes(3); advance(120000); await restarted.tick(); expect(dispatch).toHaveBeenCalledTimes(3); expect(restarted.snapshot().events[0]).toMatchObject({ status: 'blocked', attempts: 3, reason: expect.stringContaining('acknowledgement timed out') });
  });
  it('does not consume acknowledgement retry attempts while the owner is busy', async () => {
    const { auto, enable, dispatch, advance } = setup(); enable({ ...config(), trigger: { kind: 'interval', everyMinutes: 60 } }); await auto.tick(); advance(120000); dispatch.mockResolvedValue(false); await auto.tick(); await auto.tick();
    expect(auto.snapshot().events[0]).toMatchObject({ status: 'pending', attempts: 1 }); dispatch.mockResolvedValue(true); await auto.tick(); expect(auto.snapshot().events[0]).toMatchObject({ status: 'notified', attempts: 2 });
  });
  it('ignores stale asynchronous dispatch completion after pause', async () => {
    const { auto, enable, dispatch } = setup(); const wait = deferred<boolean>(); dispatch.mockImplementation(() => wait.promise); enable(); const tick = auto.tick(); auto.control({ expectedRevision: auto.snapshot().revision, paused: true }); wait.resolve(true); await tick; expect(auto.snapshot().events[0]!.status).toBe('pending');
  });
  it('lists configuration revisions for owner recovery while keeping other-owner events out of tool output', async () => {
    const { auto, enable } = setup(); enable(); await auto.tick();
    const tools = automationTools({ service: () => auto, contextKey: () => 'brain', ownerId: 'new-orch' });
    const snapshot = await tools[0]!.run({}) as { rules: { ownerOrchestratorId: string; revision: number }[]; events: unknown[] };
    expect(snapshot.rules).toMatchObject([{ ownerOrchestratorId: 'orch', revision: 1 }]); expect(snapshot.events).toEqual([]);
    expect(() => auto.startEvent(auto.snapshot().events[0]!.id, 'new-orch')).toThrow('another');
  });
  it('blocks pinned versions made obsolete and exposes no approval or pause agent tools', async () => {
    const { auto, enable, activate } = setup(); enable(); await auto.tick(); activate('sample', 1); await auto.tick(); expect(auto.snapshot().rules[0]!.error).toContain('pinned');
    const tools = automationTools({ service: () => auto, contextKey: () => 'brain', ownerId: 'orch' }); expect(tools.map(tool => tool.name)).toEqual(['app_flow_auto_list', 'app_flow_auto_propose', 'app_flow_auto_start']);
    expect(() => tools[1]!.run({ contextKey: 'other', config: config(), expectedRevision: 1 })).toThrow('Brain context');
    expect(() => tools[2]!.run({ contextKey: 'brain', eventId: 'x', inputs: {} })).toThrow('unknown field');
    expect(automationTools({ service: () => auto, contextKey: () => 'brain', ownerId: '' })).toEqual([]);
  });
});
