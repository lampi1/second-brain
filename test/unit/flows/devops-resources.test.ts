// New routine operations stay behind explicit grant categories and durable run ownership; all HTTP is mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HostPushPreconditionError, type HostPush } from '../../../src/main/flows/git-push';
import { DevOpsRevisions } from '../../../src/main/flows/devops-revisions';
import { DevOpsWriter } from '../../../src/main/flows/devops-writer';
import type { DevOpsWriteGrant } from '../../../src/shared/flow-automation';
const dirs: string[] = [], guid = '11111111-2222-3333-4444-555555555555';
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
function setup(ops: DevOpsWriteGrant['ops']) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'routine-resources-')); dirs.push(root);
  const calls: { method: string; url: string; body: unknown }[] = [];
  let revoked = false, fail = false, draft = true;
  const authorize = vi.fn(() => { if (revoked) throw new Error('Grant revoked'); });
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; calls.push({ method: init.method!, url, body });
    if (fail && init.method !== 'GET') throw new Error('Lost remote response');
    let result: unknown = {};
    if (url.includes('/_apis/wit/workitems/')) result = { id: Number(url.match(/workitems\/(\d+)/)![1]), rev: 4, fields: { 'System.TeamProject': 'Example', 'System.Tags': '' } };
    if (url.includes('/repositories/') && !url.includes('/pullrequests')) result = { id: guid, project: { id: guid, name: 'Example' } };
    if (url.includes('/pullrequests') && !url.includes('/threads')) result = { pullRequestId: 8, repository: { id: guid, project: { id: guid, name: 'Example' } }, sourceRefName: 'refs/heads/fix', targetRefName: 'refs/heads/main', status: 'active', isDraft: draft };
    if (url.includes('/attachments?')) result = { id: guid, url: `https://dev.azure.com/contoso/Example/_apis/wit/attachments/${guid}` };
    if (url.includes('/comments?') || url.includes('/threads?')) result = { id: 10 };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const grant: DevOpsWriteGrant = { organization: 'contoso', projects: ['Example'], ops, fields: [], mentions: [guid] };
  const writer = new DevOpsWriter({ file: path.join(root, 'ledger.json'), request, token: async () => 'mock-credential' });
  const context = { runId: 'run-a', workItemId: 42, grant, evidenceRoot: root, authorize };
  return { writer, context, root, calls, request, set: (v: { revoked?: boolean; fail?: boolean; draft?: boolean }) => { revoked = v.revoked ?? revoked; fail = v.fail ?? fail; draft = v.draft ?? draft; } };
}
const pr = { op: 'create-pr', project: 'Example', repositoryId: guid, sourceRef: 'refs/heads/fix', targetRef: 'refs/heads/main', title: 'Fix sample', text: 'Evidence verified.' };
it('creates one draft and limits comment/publish/abandon operations to the run-owned PR', async () => {
  const s = setup(['pr-create', 'pr-comment', 'pr-publish', 'pr-abandon']);
  await expect(s.writer.execute(s.context, { op: 'publish-pr', pullRequestId: 8 })).rejects.toThrow('created by this run');
  expect(await s.writer.execute(s.context, pr)).toMatchObject({ pullRequestId: 8, isDraft: true });
  expect(await s.writer.execute(s.context, pr)).toMatchObject({ pullRequestId: 8 }); expect(s.calls.filter(c => c.method === 'POST' && c.url.includes('/pullrequests?'))).toHaveLength(1);
  await expect(s.writer.execute({ ...s.context, runId: 'other-run' }, { op: 'pr-comment', pullRequestId: 8, text: 'x' })).rejects.toThrow('created by this run');
  await expect(s.writer.execute(s.context, { op: 'pr-comment', pullRequestId: 8, text: 'Verified.' })).resolves.toMatchObject({ threadId: 10 });
  await expect(s.writer.execute(s.context, { op: 'publish-pr', pullRequestId: 8 })).resolves.toMatchObject({ status: 'published' });
  s.set({ draft: false }); await expect(s.writer.execute(s.context, { op: 'abandon-pr', pullRequestId: 8 })).resolves.toMatchObject({ skipped: 'Published PR retained for human review' });
});
it('requires every new category, including rich formatting even when Markdown renders unchanged', async () => {
  const s = setup(['pr-create']);
  await expect(s.writer.execute(s.context, { ...pr, text: '[bug](https://dev.azure.com/contoso/Example/_workitems/edit/42)' })).rejects.toThrow('rich-comments');
  for (const request of [{ op: 'upload-image', filename: 'before.png' }, { op: 'relate-work-item', relatedWorkItemId: 43 }, { op: 'pr-comment', pullRequestId: 8, text: 'x' }, { op: 'publish-pr', pullRequestId: 8 }, { op: 'abandon-pr', pullRequestId: 8 }, { op: 'deploy-test', targetId: 'test-a', buildId: 1 }]) await expect(s.writer.execute(s.context, request)).rejects.toThrow('not enabled');
  expect(s.calls.some(c => c.method !== 'GET')).toBe(false);
});
it('uploads only own evidence, records ownership and renders it only for the same run', async () => {
  const s = setup(['attachments', 'comment', 'rich-comments']);
  fs.writeFileSync(path.join(s.root, 'before.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64'));
  expect(await s.writer.execute(s.context, { op: 'upload-image', filename: 'before.png' })).toMatchObject({ attachmentId: guid });
  await s.writer.execute(s.context, { op: 'comment', text: `![BEFORE](attachment:${guid})` }); expect(JSON.stringify(s.calls.at(-1)!.body)).toContain('<img');
  await expect(s.writer.execute({ ...s.context, runId: 'other' }, { op: 'comment', text: `![BEFORE](attachment:${guid})` })).rejects.toThrow('uploaded by this run');
});
it('does not trust an agent-authored mention milestone', async () => {
  const s = setup(['comment']);
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Hi', mentions: [guid], mentionReason: 'final' })).rejects.toThrow('only on intake');
  expect(s.calls).toHaveLength(0);
});
it('retains ambiguous effects across writer restarts and refuses duplicated writes', async () => {
  const s = setup(['comment']); s.set({ fail: true });
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Once' })).rejects.toThrow('outcome unknown');
  const restarted = new DevOpsWriter({ file: path.join(s.root, 'ledger.json'), request: s.request, token: async () => 'mock-credential' }); s.set({ fail: false });
  await expect(restarted.execute(s.context, { op: 'comment', text: 'Once' })).rejects.toThrow('unknown outcome');
  await expect(restarted.execute(s.context, { op: 'comment', text: 'Different' })).rejects.toThrow('unknown outcome');
  expect(s.calls.filter(c => c.method === 'POST')).toHaveLength(1);
  expect(restarted.operationsFor('run-a')[0]).toMatchObject({ state: 'pending', op: 'comment' });
});
it('checks revoked authority before a queued/cached request can act', async () => {
  const s = setup(['comment']); await s.writer.execute(s.context, { op: 'comment', text: 'Once' }); const count = s.calls.length; s.set({ revoked: true });
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Once' })).rejects.toThrow('revoked'); expect(s.calls).toHaveLength(count);
});

it.each([401, 403, 412])('records a first HTTP %i refusal as not-done, clears attribution and permits retry', async status => {
  const s = setup(['test-plans']), revisions = new DevOpsRevisions(path.join(s.root, 'revisions.json'));
  let refused = true;
  const request = vi.fn(async () => refused ? new Response('sensitive provider body', { status }) : Response.json({ id: 21, rootSuite: { id: 22 } }));
  const writer = new DevOpsWriter({ file: path.join(s.root, 'ledger.json'), revisions, request, token: async () => 'mock-credential' });
  const input = { op: 'create-test-plan', project: 'Example', name: 'Regression' };
  const failure = await writer.execute(s.context, input).catch(error => error as Error);
  expect(failure.message).toContain('DevOps write not done:'); expect(failure.message).toContain(`HTTP ${status}`);
  expect(writer.operationsFor(s.context.runId)).toEqual([expect.objectContaining({ state: 'not-done', reason: expect.stringContaining(`HTTP ${status}`) })]);
  await expect(revisions.externalRevision('contoso', 42, 1, 2, async () => ({}))).resolves.toBe(2);
  expect(fs.readFileSync(path.join(s.root, 'ledger.json'), 'utf8')).not.toMatch(/sensitive provider body|mock-credential/);
  refused = false;
  const restored = new DevOpsWriter({ file: path.join(s.root, 'ledger.json'), revisions, request, token: async () => 'mock-credential' });
  await expect(restored.execute(s.context, input)).resolves.toMatchObject({ planId: 21 });
  expect(request).toHaveBeenCalledTimes(2);
});
it('does not forget an earlier successful mutation when a later request returns 403', async () => {
  const s = setup(['test-plans']);
  // Seed only the owned plan; the following logical operation creates a case before its linking request is denied.
  fs.writeFileSync(path.join(s.root, 'ledger.json'), JSON.stringify({ schema: 1, runs: { 'run-a': { plans: [{ project: 'Example', id: 21, rootSuiteId: 22 }], suites: [], testCases: [] } } }));
  const request = vi.fn(async (url: string, init: RequestInit) => init.method === 'GET' ? Response.json({ id: 42, rev: 2, fields: { 'System.TeamProject': 'Example' } }) : url.includes('$Test%20Case') ? Response.json({ id: 50 }) : new Response('', { status: 403 }));
  const writer = new DevOpsWriter({ file: path.join(s.root, 'ledger.json'), request, token: async () => 'mock-credential' });
  const input = { op: 'create-test-case', project: 'Example', planId: 21, suiteId: 22, title: 'Case', steps: [] };
  const failure = await writer.execute(s.context, input).catch(error => error as Error);
  expect(failure.message).toContain('outcome unknown'); expect(failure.message).toContain('HTTP 403');
  expect(writer.operationsFor('run-a')[0]).toMatchObject({ state: 'pending' });
  await expect(writer.execute(s.context, input)).rejects.toThrow('unknown outcome');
});
it('records local push preconditions as not-done without poisoning later writes', async () => {
  const s = setup(['git-push', 'comment']);
  s.context.grant.pushTargets = [{ project: 'Example', repositoryId: guid, workspaceInput: 'workspace' }];
  s.request.mockImplementation(async (url: string) => Response.json(url.includes('/refs?') ? { value: [] } : url.includes('/repositories/') ? { id: guid, project: { name: 'Example' } } : url.includes('/comments?') ? { id: 7 } : { id: 42, rev: 1, fields: { 'System.TeamProject': 'Example' } }));
  let refused = true;
  const push = vi.fn(async (p: HostPush) => {
    if (refused) throw new HostPushPreconditionError('Local push precondition');
    p.beforePush();
    return { branch: `refs/heads/fix/routine-${guid}`, commit: 'a'.repeat(40) };
  });
  const writer = new DevOpsWriter({ file: path.join(s.root, 'ledger.json'), request: s.request, token: async () => 'mock-credential', push });
  const context = { ...s.context, runId: guid, workspace: s.root, workspaceInput: 'workspace' };
  await expect(writer.execute(context, { op: 'push-branch', project: 'Example', repositoryId: guid })).rejects.toThrow('Local push precondition');
  expect(writer.operationsFor(guid)[0]).toMatchObject({ state: 'not-done', reason: 'Local push precondition' });
  await expect(writer.execute(context, { op: 'comment', text: 'Blocked before sending' })).resolves.toMatchObject({ commentId: 7 });
  refused = false;
  await expect(writer.execute(context, { op: 'push-branch', project: 'Example', repositoryId: guid })).resolves.toMatchObject({ commit: 'a'.repeat(40) });
});

it.each([401, 403])('preserves a previous ambiguous cleanup when its retry is refused with HTTP %i', async status => {
  const s = setup(['pr-create', 'pr-abandon', 'comment']); await s.writer.execute(s.context, pr);
  s.set({ fail: true });
  await expect(s.writer.execute(s.context, { op: 'abandon-pr', pullRequestId: 8 })).rejects.toThrow();
  s.set({ fail: false }); s.request.mockImplementationOnce(async () => new Response('', { status }));
  await expect(s.writer.execute(s.context, { op: 'abandon-pr', pullRequestId: 8 })).rejects.toThrow('outcome unknown');
  expect(s.writer.operationsFor('run-a').find(op => op.op === 'abandon-pr')!.state).toBe('pending');
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Do not send' })).rejects.toThrow('unknown outcome');
});
it('settles an ambiguous abandon only after the live PR confirms it is already abandoned', async () => {
  const s = setup(['pr-create', 'pr-abandon', 'comment']); await s.writer.execute(s.context, pr);
  s.set({ fail: true }); await expect(s.writer.execute(s.context, { op: 'abandon-pr', pullRequestId: 8 })).rejects.toThrow();
  s.set({ fail: false });
  s.request.mockImplementationOnce(async () => Response.json({ pullRequestId: 8, repository: { id: guid, project: { id: guid, name: 'Example' } }, sourceRefName: 'refs/heads/fix', targetRefName: 'refs/heads/main', status: 'abandoned', isDraft: true }));
  await expect(s.writer.execute(s.context, { op: 'abandon-pr', pullRequestId: 8 })).resolves.toMatchObject({ status: 'abandoned' });
  expect(s.writer.operationsFor('run-a').find(op => op.op === 'abandon-pr')!.state).toBe('done');
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Confirmed' })).resolves.toMatchObject({ commentId: 10 });
});
