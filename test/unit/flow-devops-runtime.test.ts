// Runtime path of the DevOps write adapter (ADR 0145): only the chat bound to a running granted adapter step writes,
// and the host derives run, work item and grant; other chats and withdrawn grants are refused before any request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { DevOpsWriter, ReconciledWrite } from '../../src/main/flows/devops-writer';
import { TestDeploymentCoordinator } from '../../src/main/flows/test-deployment';
import { createFlowRuntime } from '../../src/main/flows/runtime';
import { devopsWriteTools } from '../../src/main/flows/devops-write-tool';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';

const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const config: FlowAutomationConfig = { flowId: 'fix', flowVersion: 1, scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: { workspace: '/project' }, priority: 'normal',
  trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'ProjectA', areaPath: 'Team', workItemType: 'Bug', states: ['New'], includeExisting: true },
  devopsWrite: { organization: 'contoso', projects: ['ProjectA'], ops: ['comment'], fields: [] } };

async function setup(sealed = false, environment = false, browser = false, analysis = false, history = false, autonomous = false, attempts = 1) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dw-')); folders.push(folder);
  const brain = path.join(folder, 'brain'); fs.mkdirSync(brain);
  const rows = [{ id: 'o', isOrchestrator: true, state: 'idle' }] as ChatSummary[];
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'GET' ? { id: 42, rev: 1, fields: { 'System.TeamProject': 'ProjectA' } } : { id: 5 }), { status: 200 }));
  const detect = vi.fn(async () => ({ cursor: { revision: '1' }, summary: 'Read only', items: [{ key: '42', title: 'Bug 42', inputs: { 'work-item-id': '42' } }] }));
  const stopChat = vi.fn(async (id: string) => { const row = rows.find(r => r.id === id); if (row) row.state = 'idle'; });
  const createWorker = vi.fn(async () => { const worker = { id: 'recovery-worker', state: 'idle', run: { runId: 'recovery-task', agentId: 'artisan', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary; rows.push(worker); return worker; });
  const sendWorker = vi.fn(async () => {});
  const runtime = createFlowRuntime({ ...(autonomous ? { createWorker, sendWorker } : {}), userData: folder, brainRoot: () => brain, chats: () => rows, changed: () => {}, stopChat, send: vi.fn(async () => {}), detect, devopsWrite: { token: async () => 'token-value', request } });
  const flow = runtime.service(), auto = runtime.automation();
  flow.propose({ expectedRevision: 0, definition: { id: 'fix', title: 'Fix', description: 'Fixture', aliases: [], scope: { project: 'ProjectA', areaPath: 'Team' }, steps: [
    { id: 'write', title: 'Write', kind: 'agent', instructions: 'Comment', inputs: ['workspace', 'work-item-id'], workspaceInput: 'workspace', evidence: [], ...(environment ? { testEnvironment: 'test-fixture' } : {}), effect: 'external-write', ...(browser ? { writeVia: 'browser' as const, browserTargets: ['https://qa.example.com'] } : { adapter: 'devops-write' as const, ...(analysis ? { mentionReason: 'analysis' as const } : {}) }), maxAttempts: attempts, timeoutMs: 600000, ...(sealed ? { role: 'scout' as const, tier: 'mid' as const, engine: 'claude', model: 'sonnet', agentPrompt: 'Frozen evidence contract' } : {}) }], ...(sealed ? { package: { schema: 1 as const, assets: [], outputs: [], requiredOps: ['comment'], ...(history ? { history: true as const } : {}) } } : {}) } });
  flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  const configured = structuredClone(config); if (autonomous) configured.inputs.workspace = brain;
  if (environment) {
    const guid = '11111111-2222-3333-4444-555555555555';
    configured.devopsWrite!.ops.push('test-environment');
    configured.devopsWrite!.deployTargets = [{ id: 'test-fixture', organization: 'contoso', project: 'ProjectA', projectId: guid, releaseDefinitionId: 4, definitionRevision: 2, definitionSha256: 'a'.repeat(64), environmentId: 9, environmentName: 'Test', queueId: 7, artifactAlias: '_app', buildDefinitionId: 6, repositoryId: guid, confirmedTest: true, deploymentGroupId: 2, poolId: 3, agentId: 4, machineId: 5, machineName: 'test', computerName: 'test' }];
  }
  const rule = auto.propose({ config: configured, expectedRevision: 0 }, 'o'); auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' });
  await auto.tick(); const run = auto.startEvent(auto.snapshot().events[0]!.id, 'o');
  rows.push({ id: 'worker', state: 'running', run: { runId: 'wr', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  rows.push({ id: 'intruder', state: 'running', run: { runId: 'ir', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  if (sealed) Object.assign(rows[1]!, { routinePackage: run.definitionDigest, routinePromptHash: createHash('sha256').update('Frozen evidence contract').digest('hex'), harness: 'claude', model: 'sonnet', run: { ...rows[1]!.run, agentId: 'scout', tier: 'mid' } });
  flow.bindAgent(run.id, run.revision, 'write', runtime.resolveBinding('worker', 'o', brain)!, 'o');
  return { runtime, auto, rule, request, rows, run, flow, stopChat, folder, createWorker, sendWorker };
}

describe('DevOps write runtime', () => {
  it('writes for the bound chat through the MCP tool, using the run work item', async () => {
    const { runtime, request } = await setup();
    const tool = devopsWriteTools((id, req, sig) => runtime.devopsWrite(id, req, sig))[0]!;
    const out = JSON.parse(await tool.run({ op: 'comment', text: 'Fixed' }, { params: { chatId: 'worker' } } as never) as string);
    expect(out).toEqual({ workItemId: 42, commentId: 5 });
    expect(request.mock.calls.at(-1)![0]).toContain('/contoso/ProjectA/_apis/wit/workItems/42/comments');
    await expect(tool.run({ op: 'comment', text: 'x' }, { params: {} } as never)).rejects.toThrow('own endpoint');
  });
  it('refuses other chats and a withdrawn grant before any request', async () => {
    const { runtime, auto, rule, request } = await setup();
    await expect(runtime.devopsWrite('intruder', { op: 'comment', text: 'x' })).rejects.toThrow('adapter');
    await expect(runtime.devopsWrite('o', { op: 'comment', text: 'x' })).rejects.toThrow('not running');
    auto.propose({ config, expectedRevision: auto.snapshot().rules.find(r => r.id === rule.id)!.revision }, 'o');
    await expect(runtime.devopsWrite('worker', { op: 'comment', text: 'x' })).rejects.toThrow('not enabled');
    expect(request).not.toHaveBeenCalled();
  });
});

it('one uncertain deployment settlement is visible and does not reject the scheduler tick', async () => {
  const { runtime, flow, run } = await setup(true);
  vi.spyOn(TestDeploymentCoordinator.prototype, 'ownedTargets').mockImplementation(id => id === run.id ? ['unknown-target'] : []);
  const bound = flow.status(run.id, 'o');
  await expect(runtime.cancel({ runId: run.id, expectedRevision: bound.revision })).resolves.toMatchObject({ status: 'cancelled' });
  await expect(runtime.tick()).resolves.toBeUndefined();
  const terminal = flow.status(run.id, 'o'); expect(terminal.settlementError).toContain('not enabled');
  expect(runtime.dossier(run.id, 'o').report.coverage.unresolved).toContain(terminal.settlementError);
  runtime.stop();
});
it('rechecks a changed sealed model after initial admission and sends no remote request', async () => {
  const { runtime, rows, request } = await setup(true);
  // The writer queues execution before authorize; drift after initial admission must be refused there too.
  const pending = runtime.devopsWrite('worker', { op: 'comment', text: 'Do not send' }); rows[1]!.model = 'changed';
  await expect(pending).rejects.toThrow('Frozen routine'); expect(request).not.toHaveBeenCalled(); runtime.stop();
});
it('interrupts a waiting environment worker before releasing its lease on cancellation', async () => {
  const s = await setup(false, true); s.rows[1]!.state = 'waiting';
  const reconcile = vi.spyOn(TestDeploymentCoordinator.prototype, 'reconcileSteps').mockImplementation(async () => { expect(s.rows[1]!.state).toBe('idle'); expect(s.stopChat).toHaveBeenCalledWith('worker'); });
  await s.runtime.cancel({ runId: s.run.id, expectedRevision: s.flow.status(s.run.id, 'o').revision }); await s.runtime.tick();
  expect(reconcile).toHaveBeenCalled(); s.runtime.stop();
});
it('retains environment ownership if a waiting worker does not stop', async () => {
  const s = await setup(false, true); s.rows[1]!.state = 'waiting'; s.stopChat.mockImplementation(async () => {});
  const reconcile = vi.spyOn(TestDeploymentCoordinator.prototype, 'reconcileSteps');
  await s.runtime.cancel({ runId: s.run.id, expectedRevision: s.flow.status(s.run.id, 'o').revision }); await s.runtime.tick();
  expect(s.stopChat).toHaveBeenCalledWith('worker'); expect(reconcile).not.toHaveBeenCalled(); s.runtime.stop();
});
it('exposes read-only PR status only through the same bound-step and grant checks', async () => {
  const { runtime, request } = await setup();
  const tool = devopsWriteTools((id, req, sig) => runtime.devopsWrite(id, req, sig)).find(t => t.name === 'flow_pr_build_status')!;
  expect(tool.annotations?.readOnlyHint).toBe(true);
  await expect(tool.run({ targetId: 'test' }, { params: { chatId: 'intruder' } } as never)).rejects.toThrow('adapter');
  await expect(tool.run({ targetId: 'test' }, { params: { chatId: 'worker' } } as never)).rejects.toThrow('not enabled');
  await expect(tool.run({ targetId: 'test', op: 'deploy-test' }, { params: { chatId: 'worker' } } as never)).rejects.toThrow();
  await expect(tool.run({ targetId: 'test' }, { params: {} } as never)).rejects.toThrow('own endpoint');
  expect(request).not.toHaveBeenCalled(); runtime.stop();
});

it('browser report journal revision does not invalidate the test-environment verification', async () => {
  const s = await setup(false, true, true);
  vi.spyOn(TestDeploymentCoordinator.prototype, 'verifyStepSnapshot').mockImplementation(() => {});
  vi.spyOn(DevOpsWriter.prototype, 'execute').mockImplementation(async (scope) => { scope.authorize!(); return { snapshot:'fixture' }; });
  s.rows[1]!.state = 'idle'; s.rows[1]!.run!.report = { at:42, via:'agent_report', outcome:'done', verified:'yes', blocking:0, summary:'Browser done', canonical:{ runId:'wr', taskVersion:1, outcome:'done', doneWhen:[{criterion:'proof',met:true,evidence:'read-back verified'}], browserWrite:{outcome:'done',evidence:['read-back verified']} } } as NonNullable<ChatSummary['run']>['report'];
  await s.runtime.tick(); expect(s.flow.status(s.run.id,'o').steps[0]?.reason).toBeUndefined(); expect(s.flow.status(s.run.id,'o').status).toBe('completed');
  expect(s.flow.status(s.run.id,'o').browserWrites?.[0]?.outcome).toBe('done'); s.runtime.stop();
});

it('derives analysis mention authority from the approved step, never from request fields', async () => {
  const run = vi.spyOn(DevOpsWriter.prototype, 'execute').mockResolvedValue({ commentId: 5 });
  const allowed = await setup(false, false, false, true);
  await allowed.runtime.devopsWrite('worker', { op: 'comment', text: 'Analysis', mentionReason: 'analysis' });
  expect(run.mock.calls.at(-1)?.[0].mentionReason).toBe('analysis'); allowed.runtime.stop();
  const denied = await setup(); await denied.runtime.devopsWrite('worker', { op: 'comment', text: 'Analysis', mentionReason: 'analysis' });
  expect(run.mock.calls.at(-1)?.[0].mentionReason).toBeUndefined(); denied.runtime.stop();
});

it('allows local reconciliation only after cancellation and refuses a stale run revision', async () => {
  const s = await setup(); const runId = s.run.id;
  expect(s.runtime.writeReconciliation(runId).canReconcile).toBe(false);
  await expect(s.runtime.reconcileWrites({ runId, expectedRevision: s.flow.status(runId, 'o').revision, digest: 'x', decisions: [] })).rejects.toThrow('bloccata');
  await s.runtime.cancel({ runId, expectedRevision: s.flow.status(runId, 'o').revision });
  const view = s.runtime.writeReconciliation(runId); expect(view.canReconcile).toBe(true);
  await expect(s.runtime.reconcileWrites({ runId, expectedRevision: view.revision - 1, digest: view.digest, decisions: [] })).rejects.toThrow('cambiata');
  expect(s.request).not.toHaveBeenCalled(); s.runtime.stop();
});

it('records user-reconciled history without pretending an absent comment was delivered', async () => {
  vi.spyOn(DevOpsWriter.prototype, 'execute').mockRejectedValue(new ReconciledWrite('reverted'));
  const s = await setup(true, false, false, false, true);
  await s.runtime.tick(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const run = s.flow.status(s.run.id, 'o');
  expect(run.history?.[0]?.status).toBe('reconciled'); expect(run.history?.[0]?.reason).toContain('reverted');
  s.runtime.stop();
  const reloaded = createFlowRuntime({ userData: s.folder, brainRoot: () => path.join(s.folder, 'brain'), chats: () => [], changed: () => {} });
  expect(reloaded.service().snapshot().storageError).toBeUndefined(); expect(reloaded.service().snapshot().runs[0]?.history?.[0]?.status).toBe('reconciled'); reloaded.stop();
});

it('reconciles a blocked legacy write without cancelling the run', async () => {
  const s = await setup(); s.request.mockImplementation(async (_url, init) => { if (init.method === 'GET') return new Response(JSON.stringify({ id: 42, rev: 1, fields: { 'System.TeamProject': 'ProjectA' } })); throw new Error('connection lost'); });
  await expect(s.runtime.devopsWrite('worker', { op: 'comment', text: 'Unknown comment' })).rejects.toThrow('unknown');
  const run = s.flow.status(s.run.id, 'o'); s.flow.blockStep(run.id, run.revision, 'write', 'Unknown write');
  const view = s.runtime.writeReconciliation(run.id);
  expect(view.canReconcile).toBe(true); expect(view.operations[0]?.eligible).toBe(true);
  await s.runtime.reconcileWrites({ runId: run.id, expectedRevision: view.revision, digest: view.digest, decisions: [{ id: view.operations[0]!.id, outcome: 'not-done', note: 'Verified the work item history' }] });
  expect(s.stopChat).toHaveBeenCalledWith('worker');
  expect(s.runtime.writeReconciliation(run.id).operations[0]?.state).toBe('reconciled'); s.runtime.stop();
});

async function blockedWrite(autonomous = false, attempts = 1) {
  const s = await setup(false, false, false, false, false, autonomous, attempts);
  s.request.mockImplementation(async (_url, init) => { if (init.method === 'GET') return new Response(JSON.stringify({ id: 42, rev: 1, fields: { 'System.TeamProject': 'ProjectA' } })); throw new Error('connection lost'); });
  await expect(s.runtime.devopsWrite('worker', { op: 'comment', text: 'Verified example' })).rejects.toThrow('unknown');
  const run = s.flow.status(s.run.id, 'o'); s.flow.blockStep(run.id, run.revision, 'write', 'Unknown write');
  const view = s.runtime.writeReconciliation(run.id);
  return { ...s, input: { runId: run.id, expectedRevision: view.revision, op: view.operations[0]!.op, requestHash: view.operations[0]!.id, outcome: 'not-applied' as const, evidence: 'Verified in work item history: no comment exists.' } };
}
it('proposes a durable exact outcome without changing the ledger, No leaves the run blocked', async () => {
  const s = await blockedWrite();
  await expect(s.runtime.proposeReconcile(s.input, 'intruder')).rejects.toThrow('another Orchestrator');
  await expect(s.runtime.proposeReconcile({ ...s.input, op: 'link-pr' }, 'o')).rejects.toThrow('changed');
  const proposed = await s.runtime.proposeReconcile(s.input, 'o');
  expect(proposed.pendingReconciliation).toMatchObject({ requestHash: s.input.requestHash, outcome: 'not-applied' });
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); expect(s.stopChat).not.toHaveBeenCalled();
  const loaded = createFlowRuntime({ userData: s.folder, brainRoot: () => path.join(s.folder, 'brain'), chats: () => [], changed: () => {} });
  expect(loaded.service().snapshot().storageError).toBeUndefined(); expect(loaded.service().snapshot().runs[0]?.pendingReconciliation).toEqual(proposed.pendingReconciliation); loaded.stop();
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'no' });
  expect(result.status).toBe('blocked'); expect(result.pendingReconciliation).toBeUndefined(); expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); s.runtime.stop();
});
it.each(['applied', 'not-applied'] as const)('Yes to %s retains run identity and authorizes exactly one recovery attempt, even at the old limit', async outcome => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile({ ...s.input, outcome }, 'o');
  const beforeCalls = s.request.mock.calls.length;
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' });
  expect(result.id).toBe(s.run.id); expect(result.status).toBe('active'); expect(result.steps[0]).toMatchObject({ status: 'ready', attempts: 1, reconciliationAttempts: 1 });
  expect(result.heal?.at(-1)?.reason).toContain(s.input.requestHash); expect(result.pendingReconciliation).toBeUndefined();
  expect(s.request).toHaveBeenCalledTimes(beforeCalls); expect(s.stopChat).toHaveBeenCalledWith('worker');
  await expect(s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' })).rejects.toThrow('changed');
  s.runtime.stop();
  const loaded = createFlowRuntime({ userData: s.folder, brainRoot: () => path.join(s.folder, 'brain'), chats: () => [], changed: () => {} });
  expect(loaded.service().snapshot().storageError).toBeUndefined(); expect(loaded.service().snapshot().runs[0]?.steps[0]?.reconciliationAttempts).toBe(1); loaded.stop();
});
it('does not save or resume while the exact worker is still active', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o'); s.stopChat.mockImplementation(async () => {});
  await expect(s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' })).rejects.toThrow('arresto');
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); expect(s.flow.status(s.run.id, 'o').status).toBe('blocked'); s.runtime.stop();
});
it('records the confirmation but does not resume under a withdrawn grant', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  s.auto.propose({ config, expectedRevision: s.auto.snapshot().rules.find(r => r.id === s.rule.id)!.revision }, 'o');
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' });
  expect(result.status).toBe('blocked'); expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('reconciled'); s.runtime.stop();
});

it('Yes opens and binds a fresh worker automatically without an Orchestrator hand-off', async () => {
  const s = await blockedWrite(true), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' });
  expect(result.steps[0]?.reason).toBeUndefined();
  expect(result.steps[0]).toMatchObject({ status: 'running', chatId: 'recovery-worker', attempts: 2 });
  expect(s.createWorker).toHaveBeenCalledTimes(1); expect(s.sendWorker).toHaveBeenCalledTimes(1);
  expect(result.id).toBe(s.run.id); s.runtime.stop();
});
it('rechecks worker quiescence after a crash following durable confirmation', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  const input = { runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' as const };
  const finish = vi.spyOn(s.flow, 'finishReconciliation').mockImplementationOnce(() => { throw new Error('crash after journal'); });
  await expect(s.runtime.decideReconcile(input)).rejects.toThrow('crash after journal'); finish.mockRestore();
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('reconciled');
  s.rows[1]!.state = 'running'; s.stopChat.mockImplementationOnce(async () => {});
  await expect(s.runtime.decideReconcile(input)).rejects.toThrow('still active');
  expect(s.flow.status(s.run.id, 'o').status).toBe('blocked');
  const result = await s.runtime.decideReconcile(input); expect(result.status).toBe('active'); expect(s.rows[1]!.state).toBe('idle'); s.runtime.stop();
});

it('No keeps a pending write blocked even with automatic attempts remaining', async () => {
  const s = await blockedWrite(true, 2), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  await s.runtime.tick();
  await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'no' });
  await s.runtime.tick();
  expect(s.flow.status(s.run.id, 'o')).toMatchObject({ status: 'blocked', steps: [{ decisionPending: false, attempts: 1 }] });
  expect(s.createWorker).not.toHaveBeenCalled(); expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); s.runtime.stop();
});
it('does not resume while a second uncertain write remains unresolved', async () => {
  const s = await blockedWrite(true, 2);
  const file = path.join(s.folder, 'flows', s.flow.snapshot().contextKey, 'devops-ledger.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.operations['c'.repeat(64)] = { runId: s.run.id, state: 'pending', op: 'comment', at: Date.now() }; fs.writeFileSync(file, JSON.stringify(data));
  const proposed = await s.runtime.proposeReconcile(s.input, 'o');
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' }); await s.runtime.tick();
  expect(result.status).toBe('blocked'); expect(s.createWorker).not.toHaveBeenCalled(); expect(s.runtime.writeReconciliation(s.run.id).operations.some(o => o.state === 'pending')).toBe(true); s.runtime.stop();
});
it('stops an ended assignment whose actual worker is still executing', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o'); s.rows[1]!.run!.endedAt = Date.now();
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' });
  expect(s.stopChat).toHaveBeenCalledWith('worker'); expect(s.rows[1]!.state).toBe('idle'); expect(result.status).toBe('active'); s.runtime.stop();
});
it('resumes when the worker chat was restored closed after a restart, its run never ended', async () => {
  // After an app restart a chat is restored with state 'closed' (no engine process, no closedAt) and its run stays
  // open: stopping it is a no-op, so waiting for it to go idle would keep the recovery pending forever.
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  s.rows[1]!.state = 'closed'; s.stopChat.mockImplementation(async () => {});
  const result = await s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' });
  expect(result.status).toBe('active'); expect(result.steps[0]).toMatchObject({ status: 'ready', reconciliationAttempts: 1 });
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('reconciled'); s.runtime.stop();
});
it('still refuses a restored closed worker that keeps queued work', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  s.rows[1]!.state = 'closed'; s.rows[1]!.queued = { kind: 'turn', position: 1, since: Date.now(), cpu: 80, freeRam: 30 }; s.stopChat.mockImplementation(async () => {});
  await expect(s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' })).rejects.toThrow('still active');
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); s.runtime.stop();
});
it('refuses reconciliation while an ended idle assignment retains queued work', async () => {
  const s = await blockedWrite(), proposed = await s.runtime.proposeReconcile(s.input, 'o');
  s.rows[1]!.run!.endedAt = Date.now(); s.rows[1]!.state = 'idle'; s.rows[1]!.queued = { kind: 'turn', position: 1, since: Date.now(), cpu: 80, freeRam: 30 };
  await expect(s.runtime.decideReconcile({ runId: s.run.id, expectedRevision: proposed.revision, answer: 'yes' })).rejects.toThrow('still active');
  expect(s.runtime.writeReconciliation(s.run.id).operations[0]?.state).toBe('pending'); s.runtime.stop();
});
