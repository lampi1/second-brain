// Explicit routine recovery regressions: terminal cancellation, fresh run identity, native approval and event release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowDefinition, FlowRestart, FlowRun, FlowStep } from '../../src/shared/flows';
import type { ChatSummary } from '../../src/shared/contract';
import { FlowService } from '../../src/main/flows/service';
import { FlowAutomationService } from '../../src/main/flows/automation';
import { createFlowRuntime } from '../../src/main/flows/runtime';
import { flowTools } from '../../src/main/flows/tools';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const work = (id: string): FlowStep => ({ id, title: id, kind: 'agent', instructions: 'Use the fixture.', workspaceInput: 'workspace', inputs: ['workspace'], evidence: ['result'], timeoutMs: 1000, maxAttempts: 2, effect: 'read-only' });
const definition = (steps = [work('first'), work('second'), work('third')]): FlowDefinition => ({ id: 'fixture', title: 'Fixture', description: 'Synthetic recovery fixture.', aliases: [], scope: {}, steps });
function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-recovery-')); dirs.push(dir); let now = 1000;
  const options = { file: path.join(dir, 'state.json'), contextKey: 'fixture-brain', now: () => now,
    resolveReport: (binding: { chatId: string; chatRunId: string; taskVersion: number }, id: string) => ({ ...binding, id, completed: true, summary: 'Fixture report', evidence: ['result: fixture output'] }) };
  const flow = new FlowService(options);
  const activate = (steps?: FlowStep[]) => { const revision = flow.snapshot().drafts[0]?.revision ?? 0; flow.propose({ definition: definition(steps), expectedRevision: revision }); flow.decideDefinition({ id: 'fixture', expectedRevision: revision + 1, answer: 'yes' }); };
  activate();
  const start = (subjectKey = 'task', owner = 'owner') => flow.start({ flowId: 'fixture', flowVersion: flow.snapshot().active.fixture!, subjectKey, inputs: { workspace: dir }, scope: {} }, owner);
  const bind = (run: FlowRun, chatId = 'worker') => flow.bindAgent(run.id, run.revision, run.steps[run.currentStep]!.stepId, { chatId, chatRunId: `${chatId}-run`, taskVersion: 1 }, run.ownerOrchestratorId);
  const finish = (run: FlowRun) => flow.report({ runId: run.id, expectedRevision: run.revision, stepId: run.steps[run.currentStep]!.stepId, reportId: 'fixture-report' }, run.ownerOrchestratorId);
  const restart = (run: FlowRun, stepId?: string): FlowRestart => { const version = flow.snapshot().versions.find(v => v.version === (stepId ? run.flowVersion : flow.snapshot().active.fixture))!; return { runId: run.id, expectedRevision: run.revision, mode: stepId ? 'from-step' : 'from-start', ...(stepId ? { stepId } : {}), targetVersion: version.version, targetDigest: version.digest, acknowledgeEffects: true }; };
  return { dir, flow, options, activate, start, bind, finish, restart, advance: () => { now += 2000; } };
}
function automatic(w: ReturnType<typeof world>) {
  const options = { file: path.join(w.dir, 'automatic.json'), flow: () => w.flow, now: w.options.now, detect: vi.fn(async () => ({ cursor: {}, items: [], summary: 'Fixture' })), dispatch: vi.fn(async () => true) };
  const auto = new FlowAutomationService(options);
  const enable = () => { const old = auto.snapshot().rules[0]; const rule = auto.propose({ expectedRevision: old?.revision ?? 0, config: { flowId: 'fixture', flowVersion: w.flow.snapshot().active.fixture!, trigger: { kind: 'interval', everyMinutes: 1 }, scope: {}, inputs: { workspace: w.dir }, priority: 'normal' } }, 'owner'); return auto.decide({ id: rule.id, expectedRevision: rule.revision, answer: 'yes' }); };
  return { auto, options, enable };
}

describe('terminal cancellation and fresh recovery', () => {
  it('cancels only the exact owned revision, retains receipts, rejects late reports and survives restart idempotently', () => {
    const w = world(), run = w.bind(w.start()), input = { runId: run.id, expectedRevision: run.revision };
    expect(() => w.flow.cancel(input, 'other')).toThrow('another');
    expect(() => w.flow.cancel({ ...input, expectedRevision: 1 }, 'owner')).toThrow('changed');
    const cancelled = w.flow.cancel(input, 'owner'); expect(cancelled.status).toBe('cancelled'); expect(cancelled.steps[0]!.status).toBe('cancelled');
    expect(() => w.finish(cancelled)).toThrow('changed'); expect(() => w.bind(cancelled, 'fresh')).toThrow('changed');
    expect(() => w.flow.decide({ ...input, expectedRevision: cancelled.revision, stepId: 'first', answer: 'yes' })).toThrow('changed');
    const restored = new FlowService(w.options); expect(restored.snapshot().storageError).toBeUndefined(); expect(restored.cancel(input, 'owner')).toEqual(cancelled);
    expect(restored.start({ flowId: 'fixture', flowVersion: 1, subjectKey: 'task', inputs: run.inputs, scope: {} }, 'owner').id).toBe(run.id);
  });
  it('treats No retry as terminal, while Other stays an explicit blocker', () => {
    const w = world(), first = w.bind(w.start()); w.advance(); const blocked = w.flow.status(first.id, 'owner');
    expect(blocked.status).toBe('blocked');
    const no = w.flow.decide({ runId: blocked.id, expectedRevision: blocked.revision, stepId: 'first', answer: 'no' });
    expect(no.status).toBe('cancelled'); expect(no.steps[0]!.decisionPending).toBe(false);
    const second = w.bind(w.start('other'), 'second'); w.advance(); const other = w.flow.status(second.id, 'owner');
    expect(w.flow.decide({ runId: other.id, expectedRevision: other.revision, stepId: 'first', answer: 'other', feedback: 'Inspect the fixture' }).status).toBe('blocked');
  });
  it('restarts a completed prefix from a selected step with fresh identities and durable inherited evidence', () => {
    const w = world(), prefix = w.finish(w.bind(w.start())), running = w.bind(prefix, 'second');
    expect(() => w.flow.restart(w.restart(running, 'third'))).toThrow('preceding');
    const input = w.restart(running, 'second'), next = w.flow.restart(input);
    expect(next.id).not.toBe(running.id); expect(next.currentStep).toBe(1); expect(next.steps[0]).toEqual(prefix.steps[0]); expect(next.steps[1]).toMatchObject({ status: 'ready', attempts: 0 });
    expect(w.flow.status(running.id, 'owner').status).toBe('cancelled'); expect(w.flow.restart(input).id).toBe(next.id);
    expect(() => w.bind(next, 'second')).toThrow('already bound');
    expect(new FlowService(w.options).snapshot().storageError).toBeUndefined();
    const disk = JSON.parse(fs.readFileSync(w.options.file, 'utf8')); disk.runs[1].steps[0].receipt.summary = 'Forged prefix'; fs.writeFileSync(w.options.file, JSON.stringify(disk));
    expect(new FlowService(w.options).snapshot().storageError).toBeTruthy();
  });
  it('pins the reviewed target version and never cancels a source for a stale target or missing consent', () => {
    const w = world(), source = w.start(), old = w.restart(source); w.activate([work('new-step')]);
    expect(() => w.flow.restart(old)).toThrow('target changed'); expect(w.flow.status(source.id, 'owner').status).toBe('active');
    const input = w.restart(source); expect(() => w.flow.restart({ ...input, acknowledgeEffects: false })).toThrow('acknowledgement');
    const next = w.flow.restart(input); expect(next.flowVersion).toBe(2); expect(next.steps[0]!.stepId).toBe('new-step'); expect(next.steps.every(step => !step.receipt)).toBe(true);
  });
  it('requires native approval for model cancellation/recovery and invalidates proposals on source changes', async () => {
    const w = world(), run = w.start(), tools = flowTools({ service: () => w.flow, ownerId: 'owner', resolveBinding: () => null,
      proposeCancel: async (input, owner) => w.flow.proposeCancel(input, owner), proposeRestart: async (input, owner) => w.flow.proposeRestart(input, owner) });
    const cancel = tools.find(tool => tool.name === 'app_flow_cancel_propose')!;
    expect(tools.some(tool => tool.name === 'app_flow_cancel')).toBe(false);
    const proposal = await cancel.run({ contextKey: 'fixture-brain', runId: run.id, expectedRevision: run.revision }) as FlowRun;
    expect(proposal.status).toBe('active'); expect(proposal.pendingCancellation?.revision).toBe(proposal.revision);
    expect(() => cancel.run({ contextKey: 'wrong', runId: run.id, expectedRevision: proposal.revision })).toThrow('Brain context');
    const { acknowledgeEffects: _ack, ...request } = w.restart(proposal);
    const requested = w.flow.proposeRestart(request, 'owner');
    expect(requested.pendingCancellation).toBeUndefined(); expect(requested.pendingRecovery).toBeTruthy();
    const bound = w.bind(requested); expect(bound.pendingRecovery).toBeUndefined();
    expect(() => w.flow.recovery({ runId: run.id, expectedRevision: requested.revision, answer: 'yes' })).toThrow('changed');
  });
  it('clears an approved recovery proposal on an already-cancelled source and replays the same request only once', () => {
    const w = world(), source = w.start(), cancelled = w.flow.cancel({ runId: source.id, expectedRevision: source.revision });
    const { acknowledgeEffects: _ack, ...request } = w.restart(cancelled);
    const proposed = w.flow.proposeRestart(request, 'owner'), input = w.flow.recovery({ runId: source.id, expectedRevision: proposed.revision, answer: 'yes' });
    const next = w.flow.restart(input); expect(w.flow.status(source.id, 'owner').pendingRecovery).toBeUndefined();
    const restored = new FlowService(w.options); expect(restored.restart(input).id).toBe(next.id); expect(restored.snapshot().runs).toHaveLength(2);
  });
});

describe('automatic concurrency recovery', () => {
  it('releases a declined old-version run so the current version event starts without restarting the app', async () => {
    const w = world(), a = automatic(w); a.enable(); await a.auto.tick(); const oldEvent = a.auto.snapshot().events[0]!;
    const source = w.bind(a.auto.startEvent(oldEvent.id, 'owner')); w.advance(); const blocked = w.flow.status(source.id, 'owner');
    // Historical No and Other were both persisted as blocked + no pending decision. Recover that exact shape.
    const legacy = w.flow.decide({ runId: source.id, expectedRevision: blocked.revision, stepId: 'first', answer: 'other', feedback: 'No retry' });
    for (let version = 2; version <= 6; version++) w.activate();
    a.enable(); await a.auto.tick(); const queued = a.auto.snapshot().events.find(event => event.ruleRevision === 2)!;
    expect(() => a.auto.startEvent(queued.id, 'owner')).toThrow('Automatic flow concurrency limit reached');
    const cancelled = w.flow.cancel({ runId: legacy.id, expectedRevision: legacy.revision });
    expect(() => a.auto.startEvent(queued.id, 'owner')).toThrow('concurrency');
    w.flow.confirmInterruption(cancelled.id, cancelled.cancellation!.expectedRevision);
    expect(a.auto.snapshot().events.find(event => event.id === oldEvent.id)?.status).toBe('cancelled');
    expect(a.auto.startEvent(queued.id, 'owner').flowVersion).toBe(6);
    expect(() => a.auto.startEvent(oldEvent.id, 'owner')).toThrow('stale');
    const restored = new FlowAutomationService(a.options); await restored.tick(); expect(restored.snapshot().events).toHaveLength(2);
    expect(w.flow.snapshot().runs).toHaveLength(2);
  });
  it('No retry frees the current rule and does not redetect the cancelled event', async () => {
    const w = world(), a = automatic(w); a.enable(); await a.auto.tick(); const event = a.auto.snapshot().events[0]!;
    const source = w.bind(a.auto.startEvent(event.id, 'owner')); w.advance(); const blocked = w.flow.status(source.id, 'owner');
    w.flow.decide({ runId: source.id, expectedRevision: blocked.revision, stepId: 'first', answer: 'no' }); await a.auto.tick();
    expect(a.auto.snapshot().events).toHaveLength(1); expect(a.auto.snapshot().events[0]!.status).toBe('cancelled');
    expect(() => a.auto.startEvent(event.id, 'owner')).toThrow('stale');
  });
  it('pins automatic approval and preserves failed recovery events outside generic retry/start', async () => {
    const w = world(), a = automatic(w), rule = a.enable(); await a.auto.tick(); const source = a.auto.startEvent(a.auto.snapshot().events[0]!.id, 'owner');
    const input = { ...w.restart(source), automationRule: { id: rule.id, revision: rule.revision } };
    const mutation = vi.spyOn(w.flow, 'restart').mockImplementationOnce(() => { throw new Error('Fixture commit failure'); });
    expect(() => a.auto.restart(input)).toThrow('Fixture commit failure'); mutation.mockRestore();
    const recoveryEvent = a.auto.snapshot().events.find(event => event.sourceKey.startsWith('restart:'))!;
    a.auto.control({ expectedRevision: a.auto.snapshot().revision, paused: false }); await a.auto.tick();
    expect(a.auto.snapshot().events.find(event => event.id === recoveryEvent.id)?.status).toBe('blocked');
    expect(() => a.auto.startEvent(recoveryEvent.id, 'owner')).toThrow('exact user-approved restart');
    const next = a.auto.restart(input); expect(next.restartOf?.runId).toBe(source.id); expect(a.auto.restart(input).id).toBe(next.id);
    expect(new FlowAutomationService(a.options).snapshot().storageError).toBeUndefined();
  });
  it('rejects changed automation approval revisions and input targets before cancelling the source', async () => {
    const w = world(), a = automatic(w), rule = a.enable(); await a.auto.tick(); const source = a.auto.startEvent(a.auto.snapshot().events[0]!.id, 'owner');
    const input = { ...w.restart(source), automationRule: { id: rule.id, revision: rule.revision } }; a.enable();
    expect(() => a.auto.restart(input)).toThrow('configuration changed');
    const latest = a.auto.snapshot().rules[0]!, changed = a.auto.propose({ expectedRevision: latest.revision, config: { ...latest.config, inputs: { workspace: '/different-fixture' } } }, 'owner'); a.auto.decide({ id: changed.id, expectedRevision: changed.revision, answer: 'yes' });
    expect(() => a.auto.restart({ ...input, automationRule: { id: changed.id, revision: changed.revision } })).toThrow('unchanged scope and inputs');
    expect(w.flow.status(source.id, 'owner').status).toBe('active');
  });
  it('repairs the exact recovery event after the flow commit succeeds but its ledger commit fails', async () => {
    const w = world(), a = automatic(w), rule = a.enable(); await a.auto.tick(); const source = a.auto.startEvent(a.auto.snapshot().events[0]!.id, 'owner');
    const input = { ...w.restart(source), automationRule: { id: rule.id, revision: rule.revision } }, rename = fs.renameSync;
    const failing = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === a.options.file && w.flow.snapshot().runs.length > 1) throw new Error('Fixture event commit failure'); return rename(from, to); });
    expect(() => a.auto.restart(input)).toThrow('commit failure'); failing.mockRestore();
    const next = w.flow.snapshot().runs.find(run => run.restartOf)!; expect(next).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(a.options.file, 'utf8')).events.find((event: { subjectKey: string }) => event.subjectKey === next.subjectKey).status).toBe('blocked');
    const restored = new FlowAutomationService(a.options);
    // Relaunch repairs from durable identities without access to the old modal or its original revision payload.
    expect(restored.snapshot().events.find(event => event.subjectKey === next.subjectKey)).toMatchObject({ status: 'started', runId: next.id });
    expect(restored.restart(input).id).toBe(next.id); expect(restored.snapshot().events.find(event => event.subjectKey === next.subjectKey)).toMatchObject({ status: 'started', runId: next.id });
    expect(w.flow.snapshot().runs).toHaveLength(2);
  });
  it('never revives a recovery event cancelled by a replaced automatic configuration', async () => {
    const w = world(), a = automatic(w), rule = a.enable(); await a.auto.tick(); const source = a.auto.startEvent(a.auto.snapshot().events[0]!.id, 'owner');
    const input = { ...w.restart(source), automationRule: { id: rule.id, revision: rule.revision } }, rename = fs.renameSync;
    const failing = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === a.options.file && w.flow.snapshot().runs.length > 1) throw new Error('Fixture event commit failure'); return rename(from, to); });
    expect(() => a.auto.restart(input)).toThrow('commit failure'); failing.mockRestore();
    const restored = new FlowAutomationService(a.options), next = w.flow.snapshot().runs.find(run => run.restartOf)!;
    // Replace before any snapshot/tick repairs the uncommitted event; replacement explicitly cancels it.
    restored.propose({ config: rule.config, expectedRevision: rule.revision }, 'owner');
    expect(restored.snapshot().events.find(event => event.subjectKey === next.subjectKey)?.status).toBe('cancelled');
    await restored.tick(); expect(restored.snapshot().events.find(event => event.subjectKey === next.subjectKey)?.status).toBe('cancelled');
  });
  it('never reuses a work item identifier in a different organization with the same project name', async () => {
    const w = world(), item = { key: 'fixture-item', title: 'Synthetic item', inputs: { 'work-item-id': '123', 'work-item-revision': '1', 'work-item-url': new URL('/fixture-org-a/Project/_workitems/edit/123', 'https://dev.azure.com').href } };
    const auto = new FlowAutomationService({ file: path.join(w.dir, 'devops-auto.json'), flow: () => w.flow, now: w.options.now, detect: async () => ({ cursor: {}, items: [item], summary: 'Fixture' }), dispatch: async () => true });
    const config = { flowId: 'fixture', flowVersion: 1, trigger: { kind: 'devops' as const, everyMinutes: 1, organization: 'fixture-org-a', project: 'Project', areaPath: 'Team', workItemType: 'Issue', states: ['Ready'], includeExisting: true }, scope: { project: 'Project', areaPath: 'Team' }, inputs: { workspace: w.dir }, priority: 'normal' as const };
    const first = auto.propose({ config, expectedRevision: 0 }, 'owner'); auto.decide({ id: first.id, expectedRevision: first.revision, answer: 'yes' }); await auto.tick();
    const source = auto.startEvent(auto.snapshot().events[0]!.id, 'owner'), changed = auto.propose({ config: { ...config, trigger: { ...config.trigger, organization: 'fixture-org-b' } }, expectedRevision: first.revision }, 'owner');
    auto.decide({ id: changed.id, expectedRevision: changed.revision, answer: 'yes' });
    expect(() => auto.restart({ ...w.restart(source), automationRule: { id: changed.id, revision: changed.revision } })).toThrow('different organization');
    expect(w.flow.status(source.id, 'owner').status).toBe('active'); expect(w.flow.snapshot().runs).toHaveLength(1);
  });
});

describe('worker interruption races', () => {
  function host() {
    const w = world(), rows = [{ id: 'owner', isOrchestrator: true, state: 'idle' }, { id: 'worker', state: 'running', run: { runId: 'worker-run', taskVersion: 1, scope: { brainRoot: w.dir, projectRoot: w.dir } } }] as ChatSummary[];
    const stopChat = vi.fn(async () => {}), send = vi.fn(async () => {}), runtime = createFlowRuntime({ userData: path.join(w.dir, 'runtime'), brainRoot: () => w.dir, chats: () => rows, changed: () => {}, stopChat, send });
    const flow = runtime.service(); flow.propose({ definition: definition(), expectedRevision: 0 }); flow.decideDefinition({ id: 'fixture', expectedRevision: 1, answer: 'yes' });
    const start = flow.start({ flowId: 'fixture', flowVersion: 1, subjectKey: 'runtime-task', inputs: { workspace: w.dir }, scope: {} }, 'owner');
    const run = flow.bindAgent(start.id, start.revision, 'first', { chatId: 'worker', chatRunId: 'worker-run', taskVersion: 1 }, 'owner');
    const target = flow.snapshot().versions[0]!, input: FlowRestart = { runId: run.id, expectedRevision: run.revision, mode: 'from-start', targetVersion: target.version, targetDigest: target.digest, acknowledgeEffects: true };
    return { runtime, flow, rows, stopChat, send, run, input };
  }
  it('cancels and interrupts only the exact bound task, with late completion unable to resume it', async () => {
    const h = host(); const proposal = await h.runtime.proposeCancel({ runId: h.run.id, expectedRevision: h.run.revision }, 'owner');
    expect(h.stopChat).not.toHaveBeenCalled();
    const cancelled = await h.runtime.decideCancel({ runId: h.run.id, expectedRevision: proposal.revision, answer: 'yes' });
    expect(cancelled.status).toBe('cancelled'); expect(h.stopChat).toHaveBeenCalledWith('worker'); expect(h.runtime.reportReady('worker')).toBe(false);
    h.rows[1]!.run!.taskVersion = 2; await h.runtime.cancel({ runId: cancelled.id, expectedRevision: cancelled.revision }); expect(h.stopChat).toHaveBeenCalledTimes(1);
  });
  it('creates no successor when worker interruption fails', async () => {
    const h = host(); h.stopChat.mockRejectedValue(new Error('Fixture interruption failure'));
    await expect(h.runtime.restart(h.input)).rejects.toThrow('interruption failure'); expect(h.flow.snapshot().runs).toHaveLength(1); expect(h.flow.status(h.run.id, 'owner').status).toBe('active');
  });
  it('revalidates source revision after interruption and never publishes the successor while waiting', async () => {
    const h = host(); let release!: () => void; h.stopChat.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = h.runtime.restart(h.input); expect(h.flow.snapshot().runs).toHaveLength(1);
    h.flow.proposeCancel({ runId: h.run.id, expectedRevision: h.run.revision }, 'owner'); release();
    await expect(pending).rejects.toThrow('changed'); expect(h.flow.snapshot().runs).toHaveLength(1);
  });
  it('retries a failed cancellation interruption from durable state before releasing the reservation', async () => {
    const h = host(); h.stopChat.mockRejectedValueOnce(new Error('Fixture stop failed'));
    await expect(h.runtime.cancel({ runId: h.run.id, expectedRevision: h.run.revision })).rejects.toThrow('stop failed');
    expect(h.flow.status(h.run.id, 'owner').cancellation?.interruption).toBe('pending');
    await h.runtime.tick(); expect(h.flow.status(h.run.id, 'owner').cancellation?.interruption).toBe('confirmed');
    expect(h.stopChat).toHaveBeenCalledTimes(2);
  });
  it('wakes a ready successor when the owner becomes idle and retries failed delivery without starting duplicates', async () => {
    const h = host(); h.rows[0]!.state = 'running'; const next = await h.runtime.restart(h.input); expect(h.send).not.toHaveBeenCalled();
    h.rows[0]!.state = 'idle'; h.send.mockRejectedValueOnce(new Error('Fixture send failed')); await h.runtime.tick(); await Promise.resolve();
    expect(h.send).toHaveBeenCalledWith('owner', expect.stringContaining(next.id)); await h.runtime.tick(); expect(h.send).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000); await h.runtime.tick(); expect(h.send).toHaveBeenCalledTimes(2); expect(h.flow.snapshot().runs).toHaveLength(2);
  });
  it('keeps Other feedback pending while the owner is busy and acknowledges successful delivery once', async () => {
    const h = host(), proposal = await h.runtime.proposeCancel({ runId: h.run.id, expectedRevision: h.run.revision }, 'owner'); h.rows[0]!.state = 'running';
    await h.runtime.decideCancel({ runId: proposal.id, expectedRevision: proposal.revision, answer: 'other', feedback: 'Inspect the fixture first' });
    expect(h.flow.status(h.run.id, 'owner').recoveryFeedback?.message).toBe('Inspect the fixture first'); expect(h.send).not.toHaveBeenCalled();
    h.rows[0]!.state = 'idle'; await h.runtime.tick(); await Promise.resolve();
    expect(h.send).toHaveBeenCalledWith('owner', expect.stringContaining('Inspect the fixture first')); expect(h.flow.status(h.run.id, 'owner').recoveryFeedback).toMatchObject({ message: 'Inspect the fixture first', deliveredAt: expect.any(Number) });
    await h.runtime.tick(); expect(h.send).toHaveBeenCalledTimes(1); expect(h.stopChat).not.toHaveBeenCalled();
  });
});
