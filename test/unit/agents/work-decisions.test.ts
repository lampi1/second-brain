// Authenticated decision reads preserve exact host scope and feedback, never revive stale assignments or grants.
import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../../src/shared/contract';
import type { WorkThread } from '../../../src/shared/workflows';
import type { McpTool } from '../../../src/main/mcp/server';
import { workDecisionTools } from '../../../src/main/agents/work-decisions';

const chat = (id: string, patch: Partial<ChatSummary> = {}): ChatSummary => ({ id, run: { runId: `run-${id}`, startedAt: 10, taskVersion: 1 }, ...patch } as ChatSummary);
const thread = (id: string, chatIds: string[]): WorkThread => ({ id, version: 4, stage: 'plan', status: 'active', chatIds,
  approvedProposal: { id: `proposal-${id}`, text: 'Update the selected file' },
  events: [{ at: 20, stage: 'plan', kind: 'approved', text: 'Update the selected file\nUser condition: only the test workspace' }] } as WorkThread);
function fixture() {
  const parent = chat('parent');
  const child = chat('child', { parentId: 'parent', run: { runId: 'run-child', startedAt: 30, parentRunId: 'run-parent', taskVersion: 1 } as ChatSummary['run'] });
  const chats = [parent, child, chat('other')], threads = [thread('own', ['parent']), thread('private', ['other'])];
  const tool = workDecisionTools({ chats: { list: () => chats }, workflows: { list: () => structuredClone(threads) } })[0]!;
  const read = async (id = 'child', args = {}, mount = 'browser-chat') => JSON.parse(await tool.run(args, { mount, params: { chatId: id }, sessionId: '', signal: new AbortController().signal, progress: () => false } as Parameters<McpTool['run']>[1]) as string);
  return { parent, child, chats, threads, read };
}

describe('agent_work_decisions', () => {
  it('reads current parent decisions with their exact scope, identity, version and user conditions', async () => {
    const f = fixture();
    expect(await f.read()).toMatchObject({ source: 'host-recorded-user-decisions', chatId: 'child', runId: 'run-child', taskVersion: 1, permissionsChanged: false,
      threads: [{ id: 'own', version: 4, approvedProposal: { id: 'proposal-own', text: 'Update the selected file' }, decision: { kind: 'approved', text: expect.stringContaining('only the test workspace') } }] });
    expect((await f.read()).threads).toHaveLength(1);
  });
  it('rejects caller-selected scopes and non-worker endpoints', async () => {
    const f = fixture();
    await expect(f.read('child', { chatId: 'other' })).rejects.toThrow(/No arguments/);
    await expect(f.read('child', {}, 'app')).rejects.toThrow(/own endpoint/);
    await expect(f.read('child', {}, 'browser')).rejects.toThrow(/own endpoint/);
    await expect(f.read('child', {}, 'chat')).rejects.toThrow(/own endpoint/);
    await expect(f.read('missing')).rejects.toThrow(/active work assignment/);
    f.child.isOrchestrator = true;
    await expect(f.read()).rejects.toThrow(/active work assignment/);
  });
  it('refreshes the version and drops former approval on reproposal, blocking, or completion', async () => {
    const f = fixture(), row = f.threads[0]!;
    row.version++;
    row.proposal = { id: 'replacement', text: 'Changed target' };
    row.status = 'approval';
    expect((await f.read()).threads[0]).toMatchObject({ version: 5, proposal: { id: 'replacement' } });
    expect((await f.read()).threads[0].approvedProposal).toBeUndefined();
    delete row.proposal;
    row.status = 'blocked';
    expect((await f.read()).threads[0].approvedProposal).toBeUndefined();
    row.status = 'done';
    expect((await f.read()).threads).toEqual([]);
  });
  it('does not inherit decisions through a replaced parent run or a closed ancestor', async () => {
    const f = fixture();
    f.parent.run!.runId = 'new-parent-run';
    expect((await f.read()).threads).toEqual([]);
    f.parent.run!.runId = 'run-parent';
    f.parent.closedAt = 25;
    expect((await f.read()).threads).toEqual([]);
  });
  it('preserves historical user scope across advancement and a later linked root without declaring a current grant', async () => {
    const f = fixture(), row = f.threads[0]!;
    row.stage = 'develop';
    row.version = 5;
    delete row.approvedProposal;
    row.chatIds.push('other');
    f.chats[2]!.run!.startedAt = 40;
    const result = await f.read('other');
    const own = result.threads.find((r: { id: string }) => r.id === 'own');
    expect(own).toMatchObject({ stage: 'develop', version: 5,
      decisionHistory: { currentAuthorization: false, events: [{ stage: 'plan', kind: 'approved', text: expect.stringContaining('only the test workspace') }] } });
    expect(own.approvedProposal).toBeUndefined();
    expect(own.decision).toBeUndefined();
  });
  it('does not apply an old approval to a new assignment in the same linked chat', async () => {
    const f = fixture();
    f.parent.run!.runId = 'new-parent-run';
    f.parent.run!.startedAt = 25;
    f.parent.run!.taskVersion = 2;
    expect(await f.read('parent')).toMatchObject({ runId: 'new-parent-run', taskVersion: 2, threads: [{ id: 'own', version: 4 }] });
    expect((await f.read('parent')).threads[0].approvedProposal).toBeUndefined();
    f.parent.run!.endedAt = 30;
    await expect(f.read('parent')).rejects.toThrow(/active work assignment/);
  });
  it('shows only current assignment plans and terminates cyclic ancestry', async () => {
    const f = fixture();
    f.parent.plan = { phase: 'running', at: 20, clarified: [], steps: [{ title: 'Approved scope', state: 'todo' }] };
    f.parent.run!.plan = { proposals: 1, changes: 0, approvedAt: 20 };
    f.parent.parentId = 'child';
    f.parent.run!.parentRunId = 'run-child';
    expect((await f.read()).plans).toMatchObject([{ chatId: 'parent', runId: 'run-parent', plan: { at: 20 } }]);
    delete f.parent.run!.plan;
    f.parent.plan.at = 40; // plan_update can move a retained plan after reassignment; it is not new consent
    expect((await f.read()).plans).toEqual([]);
    f.parent.plan.at = 1;
    expect((await f.read()).plans).toEqual([]);
  });
});
