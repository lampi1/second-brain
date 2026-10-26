// Runtime path of the DevOps write adapter (ADR 0145): only the chat bound to a running granted adapter step writes,
// and the host derives run, work item and grant; other chats and withdrawn grants are refused before any request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

async function setup(sealed = false, environment = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dw-')); folders.push(folder);
  const brain = path.join(folder, 'brain'); fs.mkdirSync(brain);
  const rows = [{ id: 'o', isOrchestrator: true, state: 'idle' }] as ChatSummary[];
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'GET' ? { id: 42, rev: 1, fields: { 'System.TeamProject': 'ProjectA' } } : { id: 5 }), { status: 200 }));
  const detect = vi.fn(async () => ({ cursor: { revision: '1' }, summary: 'Read only', items: [{ key: '42', title: 'Bug 42', inputs: { 'work-item-id': '42' } }] }));
  const stopChat = vi.fn(async (id: string) => { const row = rows.find(r => r.id === id); if (row) row.state = 'idle'; });
  const runtime = createFlowRuntime({ userData: folder, brainRoot: () => brain, chats: () => rows, changed: () => {}, stopChat, send: vi.fn(async () => {}), detect, devopsWrite: { token: async () => 'token-value', request } });
  const flow = runtime.service(), auto = runtime.automation();
  flow.propose({ expectedRevision: 0, definition: { id: 'fix', title: 'Fix', description: 'Fixture', aliases: [], scope: { project: 'ProjectA', areaPath: 'Team' }, steps: [
    { id: 'write', title: 'Write', kind: 'agent', instructions: 'Comment', inputs: ['workspace', 'work-item-id'], workspaceInput: 'workspace', evidence: [], ...(environment ? { testEnvironment: 'test-fixture' } : {}), effect: 'external-write', adapter: 'devops-write', maxAttempts: 1, timeoutMs: 600000, ...(sealed ? { role: 'scout' as const, tier: 'mid' as const, engine: 'claude', model: 'sonnet', agentPrompt: 'Frozen evidence contract' } : {}) }], ...(sealed ? { package: { schema: 1 as const, assets: [], outputs: [], requiredOps: ['comment'] } } : {}) } });
  flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  const configured = structuredClone(config);
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
  return { runtime, auto, rule, request, rows, run, flow, stopChat, folder };
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
