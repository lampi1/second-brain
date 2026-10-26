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
