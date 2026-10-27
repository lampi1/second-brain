// User attestations clear only selected uncertainty, retain audit, and never replay an absent remote effect.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DevOpsWriter, ReconciledWrite } from '../../../src/main/flows/devops-writer';
import { DevOpsRevisions } from '../../../src/main/flows/devops-revisions';
import type { DevOpsWriteGrant } from '../../../src/shared/flow-automation';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-')); roots.push(root);
  const file = path.join(root, 'ledger.json'), revisions = new DevOpsRevisions(path.join(root, 'revisions.json'));
  const requests = [0, 1, 2, 3].map(n => ({ op: 'comment', text: `Fixture ${n}` }));
  const ids = requests.map(r => createHash('sha256').update(JSON.stringify(['run', r])).digest('hex'));
  const operations = Object.fromEntries(ids.map((id, i) => [id, { runId: 'run', state: 'pending', op: 'comment', at: i + 1 }]));
  fs.writeFileSync(file, JSON.stringify({ schema: 1, runs: {}, operations }));
  ids.forEach(id => revisions.pending('contoso', 42, id));
  const grant: DevOpsWriteGrant = { organization: 'contoso', projects: ['Example'], ops: ['comment'], fields: [] };
  const context = { runId: 'run', workItemId: 42, grant, authorize: vi.fn() }, request = vi.fn(), options = { file, revisions, request };
  const writer = new DevOpsWriter(options);
  return { writer, options, context, request, requests, ids, revisions, file, decide: (id: string, outcome = 'reverted' as 'reverted' | 'not-done' | 'done') => ({ id, outcome, note: 'Verified in DevOps; effect removed manually.' }) };
}
it('reconciles four exact operations, retains evidence on reload and releases the item fence without network calls', async () => {
  const s = setup(); await expect(s.revisions.externalRevision('contoso', 42, 0, 7, vi.fn())).rejects.toThrow('uncertain');
  await s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: s.ids.map(id => s.decide(id)) });
  const loaded = new DevOpsWriter(s.options).reconciliationView('run');
  expect(loaded.operations).toHaveLength(4); expect(loaded.operations.every(o => o.state === 'reconciled' && o.reconciliation?.by === 'user')).toBe(true);
  expect(s.request).not.toHaveBeenCalled(); expect(await s.revisions.externalRevision('contoso', 42, 0, 7, vi.fn())).toBe(7);
});
it('does not clear unselected operations, accepts explicit pre-refusal correction and repairs interrupted local fence cleanup', async () => {
  const s = setup(); const data = JSON.parse(fs.readFileSync(s.file, 'utf8')); data.operations[s.ids[0]!].state = 'not-done'; fs.writeFileSync(s.file, JSON.stringify(data));
  const done = vi.spyOn(s.revisions, 'done').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
  await expect(s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: [s.decide(s.ids[0]!)] })).rejects.toThrow('disk');
  done.mockRestore(); const loaded = new DevOpsWriter(s.options).reconciliationView('run');
  expect(loaded.operations.filter(o => o.state === 'pending')).toHaveLength(3);
  expect(JSON.stringify(JSON.parse(fs.readFileSync(s.file, 'utf8')).operations[s.ids[0]!])).toContain('reverted');
  await expect(s.revisions.externalRevision('contoso', 42, 0, 7, vi.fn())).rejects.toThrow('uncertain');
});
it('rejects stale, foreign, duplicate, unverified and deployment operations atomically', async () => {
  const s = setup(), digest = s.writer.reconciliationView('run').digest;
  for (const decisions of [[s.decide('foreign')], [s.decide(s.ids[0]!), s.decide(s.ids[0]!)], [{ ...s.decide(s.ids[0]!), note: '' }], [{ ...s.decide(s.ids[0]!), organization: 'other' }]]) await expect(s.writer.reconcile(s.context, { digest, decisions })).rejects.toThrow();
  await expect(s.writer.reconcile(s.context, { digest: 'stale', decisions: [s.decide(s.ids[0]!)] })).rejects.toThrow('cambiate');
  const data = JSON.parse(fs.readFileSync(s.file, 'utf8')); data.operations[s.ids[0]!].op = 'deploy-test'; fs.writeFileSync(s.file, JSON.stringify(data));
  await expect(s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: [s.decide(s.ids[0]!)] })).rejects.toThrow('release');
  expect(s.writer.reconciliationView('run').operations.every(o => o.state === 'pending')).toBe(true);
});
it.each(['not-done', 'reverted', 'done'] as const)('never turns user resolution %s into a successful remote replay', async outcome => {
  const s = setup(); await s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: [s.decide(s.ids[0]!, outcome)] });
  await expect(s.writer.execute(s.context, s.requests[0])).rejects.toBeInstanceOf(ReconciledWrite);
  expect(s.request).not.toHaveBeenCalled();
});
it('reauthorizes queued reconciliation and retains every fence on refusal', async () => {
  const s = setup(); s.context.authorize.mockImplementation(() => { throw new Error('brain changed'); });
  await expect(s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: s.ids.map(id => s.decide(id)) })).rejects.toThrow('brain changed');
  expect(s.writer.reconciliationView('run').operations.every(o => o.state === 'pending')).toBe(true);
});

it('persists only link-pr routing identities before a lost PATCH response', async () => {
  const s = setup(), guid = '11111111-2222-3333-4444-555555555555'; fs.writeFileSync(s.file, JSON.stringify({ schema: 1, runs: {}, operations: {} }));
  s.context.grant.ops = ['pr-links'];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return new Response(JSON.stringify(url.includes('/projects/') ? { id: guid, name: 'Example' } : { id: 42, rev: 1, fields: { 'System.TeamProject': 'Example' } }));
    const pending = s.writer.operationsFor('run')[0]; expect(pending?.request).toEqual({ workItemId: 42, projectId: guid, repositoryId: guid, pullRequestId: 17 }); throw new Error('response lost');
  });
  const writer = new DevOpsWriter({ ...s.options, token: async () => 'secret-token-fixture', request });
  const raw = { op: 'link-pr', projectId: guid, repositoryId: guid, pullRequestId: 17 };
  await expect(writer.execute(s.context, raw)).rejects.toThrow('unknown');
  const op = writer.reconciliationView('run').operations[0]!;
  expect(op.state).toBe('pending'); expect(op.request?.pullRequestId).toBe(17); expect(fs.readFileSync(s.file, 'utf8')).not.toContain('secret-token-fixture');
  await writer.reconcile(s.context, { digest: writer.reconciliationView('run').digest, decisions: [s.decide(op.id, 'done')] });
  request.mockClear(); expect(await writer.execute({ ...s.context, retryReconciled: true }, raw)).toMatchObject({ reconciled: true, applied: true, pullRequestId: 17 }); expect(request).not.toHaveBeenCalled();
});
it('allows a verified not-applied retry while retaining the original user receipt', async () => {
  const s = setup(); await s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: s.ids.map(id => s.decide(id, 'not-done')) });
  const request = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(init.method === 'GET' ? { id: 42, rev: 1, fields: { 'System.TeamProject': 'Example' } } : { id: 99 })));
  const writer = new DevOpsWriter({ ...s.options, token: async () => 'fixture-token', request });
  expect(await writer.execute({ ...s.context, retryReconciled: true }, s.requests[0])).toEqual({ workItemId: 42, commentId: 99 });
  const ops = writer.operationsFor('run'); expect(ops).toHaveLength(5); expect(ops[0]?.state).toBe('reconciled'); expect(ops.at(-1)).toMatchObject({ state: 'done', requestKey: s.ids[0] });
  request.mockClear(); expect(await writer.execute({ ...s.context, retryReconciled: true }, s.requests[0])).toEqual({ workItemId: 42, commentId: 99 }); expect(request).not.toHaveBeenCalled();
});
it('does not reserve the analysis-mention quota for a user-verified absent comment', async () => {
  const s = setup(), raw = { op: 'comment', text: 'Analysis complete', mentionReason: 'analysis', mentions: ['11111111-2222-3333-4444-555555555555'] };
  const key = createHash('sha256').update(JSON.stringify(['run', raw])).digest('hex');
  fs.writeFileSync(s.file, JSON.stringify({ schema: 1, runs: {}, operations: { [key]: { runId: 'run', op: 'comment', state: 'pending', at: 1, mentionReason: 'analysis' } } }));
  s.context.grant.mentions = raw.mentions;
  await s.writer.reconcile(s.context, { digest: s.writer.reconciliationView('run').digest, decisions: [s.decide(key, 'not-done')] });
  const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.includes('/identities?') ? { value: [{ id: raw.mentions[0], providerDisplayName: 'Reviewer' }] } : init.method === 'GET' ? { id: 42, rev: 1, fields: { 'System.TeamProject': 'Example' } } : { id: 99 })));
  const writer = new DevOpsWriter({ ...s.options, token: async () => 'fixture-token', request });
  await expect(writer.execute({ ...s.context, retryReconciled: true, mentionReason: 'analysis' }, raw)).resolves.toMatchObject({ commentId: 99 });
  await expect(writer.execute({ ...s.context, retryReconciled: true, mentionReason: 'analysis' }, { ...raw, text: 'Another analysis' })).rejects.toThrow('Only one');
});
it('keeps relate-pr routing, PR ids and the write scope, so no pending write shows «not recorded»', async () => {
  const s = setup(), guid = '11111111-2222-3333-4444-555555555555'; fs.writeFileSync(s.file, JSON.stringify({ schema: 1, runs: {}, operations: {} }));
  s.context.grant.ops = ['related-links', 'pr-comment'];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'GET') return new Response(JSON.stringify(url.includes('/projects/') ? { id: guid, name: 'Example' } : url.includes('pullrequests') ? { pullRequestId: 17, isDraft: true, status: 'active', repository: { id: guid, project: { id: guid, name: 'Example' } } } : { id: 42, rev: 1, fields: { 'System.TeamProject': 'Example' }, relations: [] }));
    throw new Error('response lost');
  });
  const writer = new DevOpsWriter({ ...s.options, token: async () => 'fixture-token', request });
  await expect(writer.execute(s.context, { op: 'relate-pr', projectId: guid, repositoryId: guid, pullRequestId: 17 })).rejects.toThrow();
  const ops = writer.reconciliationView('run').operations;
  expect(ops.filter(o => o.state === 'pending')).toHaveLength(1); expect(ops[0]?.request?.pullRequestId).toBe(17);
  for (const op of ops.filter(o => o.state === 'pending')) {
    expect(op.request ?? op.target).toBeTruthy();
    expect(op.scope).toEqual({ organization: 'contoso', workItemId: 42 });
  }
});
