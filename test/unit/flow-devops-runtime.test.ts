// Runtime path of the DevOps write adapter (ADR 0145): only the chat bound to a running granted adapter step writes,
// and the host derives run, work item and grant; other chats and withdrawn grants are refused before any request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowRuntime } from '../../src/main/flows/runtime';
import { devopsWriteTools } from '../../src/main/flows/devops-write-tool';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const config: FlowAutomationConfig = { flowId: 'fix', flowVersion: 1, scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: { workspace: '/project' }, priority: 'normal',
  trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'ProjectA', areaPath: 'Team', workItemType: 'Bug', states: ['New'], includeExisting: true },
  devopsWrite: { organization: 'contoso', projects: ['ProjectA'], ops: ['comment'], fields: [] } };

async function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dw-')); folders.push(folder);
  const brain = path.join(folder, 'brain'); fs.mkdirSync(brain);
  const rows = [{ id: 'o', isOrchestrator: true, state: 'idle' }] as ChatSummary[];
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'GET' ? { id: 42, rev: 1, fields: { 'System.TeamProject': 'ProjectA' } } : { id: 5 }), { status: 200 }));
  const detect = vi.fn(async () => ({ cursor: { revision: '1' }, summary: 'Read only', items: [{ key: '42', title: 'Bug 42', inputs: { 'work-item-id': '42' } }] }));
  const runtime = createFlowRuntime({ userData: folder, brainRoot: () => brain, chats: () => rows, changed: () => {}, send: vi.fn(async () => {}), detect, devopsWrite: { token: async () => 'token-value', request } });
  const flow = runtime.service(), auto = runtime.automation();
  flow.propose({ expectedRevision: 0, definition: { id: 'fix', title: 'Fix', description: 'Fixture', aliases: [], scope: { project: 'ProjectA', areaPath: 'Team' }, steps: [
    { id: 'write', title: 'Write', kind: 'agent', instructions: 'Comment', inputs: ['workspace', 'work-item-id'], workspaceInput: 'workspace', evidence: [], effect: 'external-write', adapter: 'devops-write', maxAttempts: 1, timeoutMs: 600000 }] } });
  flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  const rule = auto.propose({ config, expectedRevision: 0 }, 'o'); auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' });
  await auto.tick(); const run = auto.startEvent(auto.snapshot().events[0]!.id, 'o');
  rows.push({ id: 'worker', state: 'running', run: { runId: 'wr', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  rows.push({ id: 'intruder', state: 'running', run: { runId: 'ir', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  flow.bindAgent(run.id, run.revision, 'write', runtime.resolveBinding('worker', 'o', brain)!, 'o');
  return { runtime, auto, rule, request };
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
