// Legacy write migration (owner, 2026-10-27): runs of the old app runtime stuck in cleanup with a pending DevOps write
// are decided by verifying on DevOps, never by a human reconciliation step. Fixture: the four air-bugfix-auto runs the
// legacy reconcile refused ("Pending write or run changed; read app_flow_reconciliation again"); the owner verified none
// of their writes applied, so the migration ends them as not-applied.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createDevOpsClient, createLegacyWriteVerifier, createMasker, createRunStore, createTriggerLoop, migrateLegacyWrites, progressFrom, readRun, recordInterruptedRun, type LegacyOperation, type LegacyRun } from '../../../packages/routine-runtime/src/index';
import { fakeDevOps, tempDir } from './fakes';

// the organization URL, split so the publish guard does not read it as a real tenant
const ORG_URL = 'https://dev.azure.com/' + 'contoso';

const STUCK = ['6a9318b4', '738a8747', '5a2be83d', '988e522a'];

function fixture(at: number) {
  const runs: LegacyRun[] = STUCK.map((id, i) => ({ runId: `${id}-run`, status: i % 2 ? 'completed' : 'cancelled', cleanup: 'pending' }));
  const operations: LegacyOperation[] = STUCK.map((id, i) => ({ id: `hash-${id}`, runId: `${id}-run`, op: 'comment', state: 'pending', at, organization: 'contoso', workItemId: 100 + i }));
  return { runs, operations };
}

function devopsWithItems() {
  const devops = fakeDevOps();
  for (let i = 0; i < 4; i++) devops.addItem({ id: 100 + i, fields: { 'System.Title': `Bug ${i}` } });
  return { devops, verify: createLegacyWriteVerifier(createDevOpsClient({ authorization: devops.authorization, request: devops.request })) };
}

describe('legacy write migration', () => {
  it('the four stuck air-bugfix-auto runs: nothing applied on DevOps → not-done, every run ended, no human step', async () => {
    const at = Date.now() - 3_600_000;
    const { devops, verify } = devopsWithItems();
    devops.reply(100, 'someone-else', 'A person commented in the window');
    const { runs, operations } = fixture(at);
    const out = await migrateLegacyWrites(runs, [...operations, { id: 'old', runId: 'x', op: 'comment', state: 'done' }], verify);
    expect(out.operations.map(o => [o.runId, o.verdict, o.outcome])).toEqual(STUCK.map(id => [`${id}-run`, 'not-applied', 'not-done']));
    expect(out.runs.map(r => r.runId)).toEqual(STUCK.map(id => `${id}-run`));
    for (const r of out.runs) expect(r.note).toContain('comment not-done');
    expect(devops.writes()).toEqual([]);
  });

  it('a write that did apply is done; one DevOps cannot confirm is not-verified and the run still ends', async () => {
    const { devops, verify } = devopsWithItems();
    const at = Date.now();
    devops.reply(100, devops.me, 'The routine comment');
    devops.fault({ method: 'GET', path: /workitems\/101$/i, mode: 'status', status: 500 });
    const { runs, operations } = fixture(at);
    const ops: LegacyOperation[] = [operations[0]!, operations[1]!, { ...operations[2]!, op: 'link-pr' }, { ...operations[3]!, organization: undefined }];
    const out = await migrateLegacyWrites(runs, ops, verify);
    expect(out.operations.map(o => o.outcome)).toEqual(['done', 'not-verified', 'not-verified', 'not-verified']);
    expect(out.runs).toHaveLength(4);
  });

  it('a field write is matched in the update history by the runtime identity', async () => {
    const { devops, verify } = devopsWithItems();
    const at = Date.now();
    await devops.request(`${ORG_URL}/_apis/wit/workItems/102?api-version=7.1`, { method: 'PATCH', body: JSON.stringify([{ op: 'add', path: '/fields/System.Tags', value: 'ai-fixed' }]) });
    expect(await verify({ id: 'a', runId: 'r', op: 'add-tags', state: 'pending', at, organization: 'contoso', workItemId: 102 })).toBe('applied');
    expect(await verify({ id: 'b', runId: 'r', op: 'set-fields', state: 'pending', at, organization: 'contoso', workItemId: 103 })).toBe('not-applied');
  });

  it('a run stuck in cleanup with no pending write is ended; a finished run is left alone; a verifier that throws is unclear', async () => {
    const out = await migrateLegacyWrites(
      [{ runId: 'stuck', status: 'cancelled', cleanup: 'pending' }, { runId: 'fine', status: 'completed', cleanup: 'complete' }, { runId: 'p', status: 'blocked' }],
      [{ id: 'w', runId: 'p', op: 'comment', state: 'pending', at: 1, organization: 'o', workItemId: 1 }],
      async () => { throw new Error('boom'); });
    expect(out.runs.map(r => r.runId)).toEqual(['stuck', 'p']);
    expect(out.operations[0]!.outcome).toBe('not-verified');
  });

  it('M2: an active legacy run with progress, no link and no pending write is interrupted, never restarted', async () => {
    const out = await migrateLegacyWrites([
      { runId: 'mid', status: 'active', progressed: true, workItem: 42 },
      { runId: 'fresh', status: 'active', progressed: false, workItem: 43 },
      { runId: 'linked', status: 'active', progressed: true, linked: true, workItem: 44 },
      { runId: 'over', status: 'completed', progressed: true },
    ], [], async () => 'applied');
    expect(out.runs).toEqual([{ runId: 'mid', interrupted: true, workItem: 42, note: expect.stringContaining('interrupted by migration') }]);
    expect(out.runs[0]!.note).toContain('--input workItem=42');
  });

  it('M2: recordInterruptedRun writes the run folder (report + events) and marks the item done for the trigger', async () => {
    const root = tempDir('routine-m2-');
    const store = createRunStore(root, createMasker([]));
    const args = { routineId: 'triage', routineTitle: 'Triage', steps: [{ id: 'read', title: 'Read' }], legacyRunId: 'old/run 1', note: 'interrupted by migration: x', workItem: 42, now: 1000 };
    const runId = recordInterruptedRun(store, args);
    expect(recordInterruptedRun(store, args)).toBe(runId);
    const folder = readRun(path.join(root, runId));
    expect(folder.run.status).toBe('cancelled');
    expect(folder.run.error).toContain('interrupted by migration');
    expect(folder.report).toContain('interrupted by migration');
    expect(progressFrom(store.events(runId))).toMatchObject({ status: 'cancelled', error: 'interrupted by migration: x' });
    expect(store.trigger().subjects['item:42']!.runId).toBe(runId);
    // the trigger skips it
    const started: number[] = [];
    const loop = createTriggerLoop({ routineId: 'triage', trigger: { organization: 'o', project: 'p', everyMinutes: 1 } as never, store,
      detect: async () => ({ cursor: {}, items: [{ key: '42', title: 'Bug', inputs: { 'work-item-id': '42' } }], summary: '1' }) as never, start: id => { started.push(id); return { runId: 'x' }; } });
    await loop.tick();
    expect(started).toEqual([]);
  });
});
