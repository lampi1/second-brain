// New routine operations stay behind explicit grant categories and durable run ownership; all HTTP is mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DevOpsWriter } from '../../../src/main/flows/devops-writer';
import type { DevOpsWriteGrant } from '../../../src/shared/flow-automation';
const dirs: string[] = [], guid = '11111111-2222-3333-4444-555555555555';
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
function setup(ops: DevOpsWriteGrant['ops']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-resources-')); dirs.push(root);
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
  await expect(s.writer.execute(s.context, { op: 'comment', text: 'Once' })).rejects.toThrow('Lost');
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
