// Host-driven routine steps: canonical receipts advance work without a coordinator turn; launch stays bound and scoped.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowStep } from '../../src/shared/flows';
import { createFlowRuntime, type FlowRuntime, type FlowWorkerRequest } from '../../src/main/flows/runtime';
const worlds: { root: string; runtime: FlowRuntime }[] = [];
afterEach(() => { for (const world of worlds.splice(0)) { world.runtime.stop(); fs.rmSync(world.root, { recursive: true, force: true }); } });
const step = (id: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, title: id, kind: 'agent', instructions: `Perform ${id} using the fixture.`, inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['proof'], timeoutMs: 600000, maxAttempts: 2, effect: 'read-only', role: 'artisan', ...extra });
function world(steps = [step('first'), step('second')], sealed = false) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'host-flow-')), rows = [{ id: 'owner', isOrchestrator: true, state: 'idle' }] as ChatSummary[];
  let current: string | null = root, count = 0;
  const create = vi.fn(async (request: FlowWorkerRequest): Promise<ChatSummary> => {
    const id = `worker-${++count}`, chat = { id, state: 'idle', run: { runId: `${id}-run`, taskVersion: 1, agentId: request.roleId, ...(request.reviewOf ? { reviewOf: request.reviewOf } : {}), scope: { brainRoot: root, projectRoot: request.workspace } }, route: { agent: { tier: request.tier, modelFrom: 'tier' } } } as ChatSummary;
    if (request.packageDigest) { chat.routinePackage = request.packageDigest; chat.routinePromptHash = createHash('sha256').update(request.agentPrompt!).digest('hex'); chat.harness = request.engine as ChatSummary['harness']; chat.model = request.model!; chat.effort = request.effort ?? null; chat.run!.tier = request.tier; delete chat.route; }
    rows.push(chat); return chat;
  });
  const sendWorker = vi.fn(async (id: string, _prompt: string, authorize: () => void, _onFailure: (error: unknown) => void) => { authorize(); rows.find(row => row.id === id)!.state = 'running'; });
  const discardWorker = vi.fn(async (id: string) => { rows.find(row => row.id === id)!.closedAt = Date.now(); });
  const stopChat = vi.fn(async (id: string) => { rows.find(row => row.id === id)!.state = 'idle'; }), send = vi.fn(async () => {});
  const runtime = createFlowRuntime({ userData: path.join(root, 'data'), brainRoot: () => current, chats: () => rows, changed: () => {}, createWorker: create, sendWorker, discardWorker, stopChat, send });
  worlds.push({ root, runtime }); const flow = runtime.service();
  flow.propose({ expectedRevision: 0, definition: { id: 'fixture', title: 'Fixture', description: 'Synthetic routine.', aliases: [], scope: {}, steps, ...(sealed ? { package: { schema: 1 as const, assets: [], outputs: [], requiredOps: [] } } : {}) } }); flow.decideDefinition({ id: 'fixture', expectedRevision: 1, answer: 'yes' });
  const start = (subjectKey = 'fixture-task') => flow.start({ flowId: 'fixture', flowVersion: 1, subjectKey, scope: {}, inputs: { workspace: root } }, 'owner');
  const report = (id: string, modify: (value: NonNullable<ChatSummary['run']>['report']) => void = () => {}) => {
    const chat = rows.find(row => row.id === id)!; chat.state = 'idle';
    chat.run!.report = { at: 42, via: 'agent_report', outcome: 'done', verified: 'yes', blocking: 0, summary: 'Fixture complete', ...(chat.run!.reviewOf ? { verdict: 'success' } : {}), canonical: { runId: chat.run!.runId, taskVersion: 1, outcome: 'done', doneWhen: [{ criterion: 'proof', met: true, evidence: 'Fixture result' }] } } as NonNullable<ChatSummary['run']>['report'];
    modify(chat.run!.report); expect(runtime.reportReady(id)).toBe(true);
  };
  return { root, runtime, flow, rows, create, sendWorker, discardWorker, stopChat, send, start, report, switchBrain: (value: string | null) => { current = value; } };
}
describe('host routine engine', () => {
  it('binds before the first turn, consumes canonical evidence, and launches the next step without waking the owner', async () => {
    const w = world(), source = w.start();
    w.sendWorker.mockImplementation(async (id, _prompt, authorize) => { const run = w.flow.status(source.id, 'owner'); expect(run.steps[run.currentStep]).toMatchObject({ status: 'running', chatId: id }); authorize(); w.rows.find(row => row.id === id)!.state = 'running'; });
    await Promise.all([w.runtime.tick(), w.runtime.tick()]); expect(w.create).toHaveBeenCalledTimes(1); expect(w.sendWorker).toHaveBeenCalledTimes(1);
    expect(w.sendWorker.mock.calls[0]![1]).toContain('Required evidence labels: ["proof"]');
    w.report('worker-1'); await w.runtime.tick();
    const run = w.flow.status(source.id, 'owner'); expect(run.currentStep).toBe(1); expect(run.steps[0]!.receipt?.reportId).toBe('worker-1-run:42'); expect(run.steps[1]!.chatId).toBe('worker-2'); expect(w.create).toHaveBeenCalledTimes(2); expect(w.send).not.toHaveBeenCalled();
    expect(w.sendWorker.mock.calls[1]![1]).toContain('Fixture result'); expect(w.sendWorker.mock.calls[1]![1]).toContain('fixture-task'); expect(w.sendWorker.mock.calls[1]![1]).toContain('worker-1-run:42');
    w.report('worker-2'); await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').status).toBe('completed');
  });
  // ADR 0155: a failed step heals by itself while attempts remain (a fresh chat, the failure in its prompt); only the
  // last failure stops the run and reaches the owner
  it.each(['partial', 'blocked', 'missing', 'prefix', 'stale'] as const)('retries a %s canonical report once with its diagnostics, then stops for the user', async kind => {
    const w = world(), source = w.start(); await w.runtime.tick();
    const bad = (report: NonNullable<ChatSummary['run']>['report']) => { if (kind === 'partial' || kind === 'blocked') report!.outcome = kind; if (kind === 'missing') report!.canonical!.doneWhen[0]!.evidence = ''; if (kind === 'prefix') report!.canonical!.doneWhen[0]!.criterion = 'proof: unrelated'; if (kind === 'stale') report!.canonical!.taskVersion = 2; };
    w.report('worker-1', bad); await w.runtime.tick();
    expect(w.create).toHaveBeenCalledTimes(2); expect(w.send).not.toHaveBeenCalled();
    const healed = w.flow.status(source.id, 'owner'); expect(healed.heal?.[0]).toMatchObject({ stepId: 'first', action: 'retry', attempt: 2 }); expect(healed.heal?.[0]?.reason).toContain('worker-1-run:42');
    expect(w.sendWorker.mock.calls[1]![1]).toContain('This is a new attempt'); expect(w.sendWorker.mock.calls[1]![1]).toContain('worker-1-run:42');
    w.report('worker-2', bad); await w.runtime.tick(); const run = w.flow.status(source.id, 'owner');
    expect(run.status).toBe('blocked'); expect(run.steps[0]!.reason).toContain('worker-2-run:42'); expect(run.steps[0]!.receipt).toBeUndefined(); expect(w.send).toHaveBeenCalledWith('owner', expect.stringContaining('fermo')); await w.runtime.tick(); expect(w.create).toHaveBeenCalledTimes(2);
  });
  it('sends work back to the step a failed check names, with the failure as that step\'s feedback', async () => {
    const w = world([step('fix', { maxAttempts: 3 }), step('verify', { role: 'sentinel', reviewOf: 'fix', onFail: { goto: 'fix' }, maxAttempts: 3 })]), source = w.start();
    await w.runtime.tick(); w.report('worker-1'); await w.runtime.tick();
    w.report('worker-2', report => { report!.outcome = 'blocked'; }); await w.runtime.tick();
    const run = w.flow.status(source.id, 'owner');
    expect(run.currentStep).toBe(0); expect(run.heal?.at(-1)).toMatchObject({ stepId: 'verify', action: 'goto', to: 'fix' }); expect(w.create).toHaveBeenCalledTimes(3);
    expect(w.sendWorker.mock.calls[2]![1]).toContain('Il passaggio verify è fallito e ha rimandato qui il lavoro'); expect(w.send).not.toHaveBeenCalled();
  });
  it('waits for native approval and binds an independent Sentinel review to the exact preceding run', async () => {
    const w = world([step('first'), { id: 'gate', title: 'Gate', kind: 'approval', instructions: 'Confirm', inputs: [], evidence: [], timeoutMs: 1000, maxAttempts: 1, effect: 'read-only' }, step('review', { role: 'sentinel', tier: 'mid', reviewOf: 'first' })]), source = w.start();
    await w.runtime.tick(); w.report('worker-1'); await w.runtime.tick(); const waiting = w.flow.status(source.id, 'owner'); expect(waiting.status).toBe('approval'); expect(w.create).toHaveBeenCalledTimes(1);
    await w.runtime.decide({ runId: source.id, expectedRevision: waiting.revision, stepId: 'gate', answer: 'yes' });
    expect(w.create.mock.calls[1]![0]).toMatchObject({ roleId: 'sentinel', tier: 'mid', reviewOf: 'worker-1-run' });
    w.report('worker-2'); await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').status).toBe('completed');
  });
  it.each([{ effect: 'external-write' as const }, { effect: 'production' as const }])('does not auto-launch an unsupported action %j', async extra => {
    const w = world([step('first', extra)]), source = w.start(); await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').status).toBe('blocked'); expect(w.create).not.toHaveBeenCalled();
  });
  it('runs a step without a role as the role its effect implies (read-only: Scout), without waking anyone', async () => {
    const w = world([step('first', { role: undefined })]), source = w.start(); await w.runtime.tick();
    expect(w.create).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'scout' })); expect(w.flow.status(source.id, 'owner').steps[0]!.status).toBe('running'); expect(w.send).not.toHaveBeenCalled();
  });
  it('launches without any open Orchestrator and passes the step\'s engine and model pick', async () => {
    const w = world([step('first', { engine: 'codex', model: 'gpt-5-codex', effort: 'high' })]); w.rows.splice(0, 1);
    const source = w.start(); await w.runtime.tick();
    expect(w.create).toHaveBeenCalledWith(expect.objectContaining({ engine: 'codex', model: 'gpt-5-codex', effort: 'high' })); expect(w.flow.status(source.id, 'owner').steps[0]!.status).toBe('running');
  });
  it('starts nothing new while a run is paused and continues on resume', async () => {
    const w = world([step('first')]), source = w.start(); const paused = w.runtime.pauseRun(source.id, source.revision, true); await w.runtime.tick();
    expect(w.create).not.toHaveBeenCalled(); w.runtime.pauseRun(source.id, paused.revision, false); await w.runtime.tick(); expect(w.create).toHaveBeenCalledTimes(1);
  });
  it('blocks an unusable workspace explicitly before creating a worker', async () => {
    const w = world([step('first')]), source = w.flow.start({ flowId: 'fixture', flowVersion: 1, subjectKey: 'relative-workspace', scope: {}, inputs: { workspace: '.' } }, 'owner'); await w.runtime.tick();
    expect(w.flow.status(source.id, 'owner').steps[0]!.reason).toContain('cartella di lavoro'); expect(w.create).not.toHaveBeenCalled();
  });
  it('preserves the two-worker limit across concurrent routine pumps', async () => {
    const w = world([step('first')]); w.start('one'); w.start('two'); w.start('three'); await Promise.all([w.runtime.tick(), w.runtime.tick()]);
    expect(w.create).toHaveBeenCalledTimes(2); expect(w.flow.snapshot().runs.filter(r => r.steps[0]!.status === 'running')).toHaveLength(2); expect(w.flow.snapshot().runs.filter(r => r.steps[0]!.status === 'ready')).toHaveLength(1);
  });
  it('discards a freshly-created worker when cancellation wins before binding', async () => {
    const w = world(); let release!: () => void, entered!: () => void; const creating = new Promise<void>(resolve => { entered = resolve; }); const original = w.create.getMockImplementation()!;
    w.create.mockImplementation(async request => { await new Promise<void>(done => { release = done; entered(); }); return original(request); });
    const source = w.start(), ticking = w.runtime.tick(); await creating;
    await w.runtime.cancel({ runId: source.id, expectedRevision: source.revision }); release(); await ticking;
    expect(w.sendWorker).not.toHaveBeenCalled(); expect(w.discardWorker).toHaveBeenCalledWith('worker-1'); expect(w.flow.status(source.id, 'owner').status).toBe('cancelled');
  });
  it('rechecks the final submission after queued cancellation and never sends a first turn', async () => {
    const w = world(); let submit!: () => void; w.sendWorker.mockImplementation(async (_id, _prompt, authorize) => { submit = authorize; });
    const source = w.start(); await w.runtime.tick(); const bound = w.flow.status(source.id, 'owner'); await w.runtime.cancel({ runId: source.id, expectedRevision: bound.revision });
    expect(() => submit()).toThrow(/changed/); expect(w.flow.status(source.id, 'owner').status).toBe('cancelled'); expect(w.create).toHaveBeenCalledTimes(1);
  });
  it('records delayed queue failures immediately and notifies an unchanged blocker only once', async () => {
    const w = world([step('first', { maxAttempts: 1 })]); let failed!: (error: unknown) => void;
    w.sendWorker.mockImplementation(async (_id, _prompt, _authorize, onFailure) => { failed = onFailure; });
    const source = w.start(); await w.runtime.tick(); failed(new Error('Synthetic queued delivery failure')); await w.runtime.tick(); await Promise.resolve();
    expect(w.flow.status(source.id, 'owner').steps[0]!.reason).toContain('Synthetic queued delivery failure'); expect(w.send).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000); await w.runtime.tick(); expect(w.send).toHaveBeenCalledTimes(1); clock.mockRestore();
    failed(new Error('Duplicate delivery callback')); expect(w.flow.status(source.id, 'owner').steps[0]!.reason).toContain('Synthetic queued delivery failure');
  });
});

const sealedStep = (id: string, extra: Partial<FlowStep> = {}) => step(id, { agentPrompt: 'Use only the approved evidence contract.', tier: 'mid', engine: 'claude', model: 'sonnet', effort: 'high', maxAttempts: 1, ...extra });
it('a sealed worker without route metadata binds by its host tier, advances and stops at approval', async () => {
  const w = world([sealedStep('first'), sealedStep('second'), step('consent', { kind: 'approval', role: undefined })], true), source = w.start();
  await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').steps[0]!.status).toBe('running');
  expect(w.runtime.resolveBinding('worker-1', 'owner', w.root)?.launched?.tier).toBe('mid');
  w.report('worker-1'); await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').steps[1]!.chatId).toBe('worker-2');
  w.report('worker-2'); await w.runtime.tick(); expect(w.flow.status(source.id, 'owner').status).toBe('approval'); expect(w.create).toHaveBeenCalledTimes(2);
  const dossier = w.runtime.dossier(source.id, 'owner'); expect(dossier.report.version.definition.package).toBeDefined(); expect(dossier.report.run.trace!.length).toBeGreaterThan(3);
});
it('rejects manual package binding and a post-bind frozen prompt identity change', async () => {
  const w = world([sealedStep('first')], true), source = w.start();
  expect(() => w.flow.bindAgent(source.id, source.revision, 'first', { chatId: 'ordinary', chatRunId: 'ordinary-run', taskVersion: 1, launched: { roleId: 'artisan', tier: 'mid' } }, 'owner')).toThrow('Frozen routine');
  await w.runtime.tick(); w.rows.find(c => c.id === 'worker-1')!.routinePromptHash = '0'.repeat(64);
  w.report('worker-1'); await w.runtime.tick(); const blocked = w.flow.status(source.id, 'owner');
  expect(blocked.status).toBe('blocked'); expect(blocked.steps[0]!.receipt).toBeUndefined(); expect(w.create).toHaveBeenCalledTimes(1);
});

it('cancels the exact still-running task even after its package identity drifts', async () => {
  const w = world([sealedStep('first')], true), source = w.start(); await w.runtime.tick();
  w.rows.find(c => c.id === 'worker-1')!.model = 'changed-model';
  const live = w.flow.status(source.id, 'owner'); await w.runtime.cancel({ runId: live.id, expectedRevision: live.revision });
  expect(w.stopChat).toHaveBeenCalledWith('worker-1'); expect(w.flow.status(source.id, 'owner').cancellation?.interruption).toBe('confirmed');
});
