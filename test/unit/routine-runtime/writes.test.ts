// DevOps writes never block a run (owner, 2026-10-27): an unknown outcome is verified on DevOps for that exact effect.
// Applied but the response was lost → done, no duplicate; not applied → one retry; unclear → "not verified", the run
// goes on. Also the crash case: a ledger entry left in "writing" is verified before anything is sent again.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevOpsClient, createMasker, createRoutineRuntime, createRunStore, executeWrites, type RunRecord, type StepWrite } from '../../../packages/routine-runtime/src/index';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir } from './fakes';

const grant = { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags'] as const, fields: ['Custom.Notes'] };

function setup() {
  const root = tempDir(), devops = fakeDevOps(), masker = createMasker();
  devops.addItem({ id: 9, fields: { 'System.State': 'New', 'System.Tags': 'ai-fixable' } });
  const store = createRunStore(root, masker), now = Date.now();
  const run: RunRecord = { schema: 1, runId: 'run-1', routineId: 'demo', routineTitle: 'Demo', status: 'running', attempt: 0, inputs: {}, workItem: 9, createdAt: now, updatedAt: now, steps: [] };
  store.create(run); store.claim('run-1');
  const client = createDevOpsClient({ authorization: devops.authorization, request: devops.request });
  const context = { runId: 'run-1', attempt: 1, stepId: 'report', workItem: 9, grant: { ...grant, ops: [...grant.ops] }, client, store, masker };
  return { devops, store, context, exec: (writes: StepWrite[]) => executeWrites(context, writes) };
}
const posts = (d: ReturnType<typeof fakeDevOps>) => d.calls.filter(c => c.method === 'POST').length;
const patches = (d: ReturnType<typeof fakeDevOps>) => d.calls.filter(c => c.method === 'PATCH').length;

describe('executeWrites: verify then decide', () => {
  it('a comment that applied but timed out is done, never posted twice', async () => {
    const { devops, exec } = setup();
    devops.fault({ method: 'POST', path: /comments$/, mode: 'lost' });
    const out = await exec([{ op: 'comment', text: 'Fixed.' }]);
    expect(out).toEqual({ done: ['comment (verified on DevOps)'], notVerified: [], failed: [] });
    expect(devops.comments.get(9)).toHaveLength(1);
    expect(posts(devops)).toBe(1);
  });

  it('a state change that applied but timed out is done, never patched twice', async () => {
    const { devops, exec } = setup();
    devops.fault({ method: 'PATCH', path: /workitems\/9$/i, mode: 'lost' });
    const out = await exec([{ op: 'state', state: 'Resolved' }]);
    expect(out.done).toEqual(['state → Resolved (verified on DevOps)']);
    expect(patches(devops)).toBe(1);
    expect(devops.items.get(9)!.rev).toBe(2);
  });

  it('a write that did not apply is retried once and done', async () => {
    const { devops, exec } = setup();
    devops.fault({ method: 'POST', path: /comments$/, mode: 'drop' });
    devops.fault({ method: 'PATCH', path: /workitems\/9$/i, mode: 'drop' });
    const out = await exec([{ op: 'comment', text: 'Fixed.' }, { op: 'tags', add: ['ai-fixed'], remove: ['ai-fixable'] }]);
    expect(out.done).toEqual(['comment (after one retry)', 'tags +ai-fixed -ai-fixable (after one retry)']);
    expect(devops.comments.get(9)).toHaveLength(1);
    expect(posts(devops)).toBe(2);
    expect(devops.items.get(9)!.fields['System.Tags']).toBe('ai-fixed');
  });

  it('a retry that also times out without effect ends as not verified, without throwing', async () => {
    const { devops, exec } = setup();
    devops.fault({ method: 'POST', path: /comments$/, mode: 'drop', times: 2 });
    const out = await exec([{ op: 'comment', text: 'Fixed.' }, { op: 'state', state: 'Resolved' }]);
    expect(out.notVerified).toEqual(['comment']);
    expect(out.done).toEqual(['state → Resolved']);
    expect(posts(devops)).toBe(2);
  });

  it('when DevOps cannot be read back the write is "not verified" and the next writes still run', async () => {
    const { devops, exec, store } = setup();
    devops.fault({ method: 'POST', path: /comments$/, mode: 'drop' });
    devops.fault({ method: 'GET', path: /comments$/, mode: 'drop' });
    const out = await exec([{ op: 'comment', text: 'Fixed.' }, { op: 'state', state: 'Resolved' }]);
    expect(out).toEqual({ done: ['state → Resolved'], notVerified: ['comment'], failed: [] });
    expect(Object.values(store.ledger('run-1')).map(e => e.state).sort()).toEqual(['done', 'not-verified']);
  });

  it('DevOps refusing a write (4xx) is reported as failed, not retried, not thrown', async () => {
    const { devops, exec } = setup();
    devops.fault({ method: 'PATCH', path: /workitems\/9$/i, mode: 'status', status: 400 });
    const out = await exec([{ op: 'state', state: 'Nope' }]);
    expect(out.failed).toEqual(['state → Nope: DevOps: PATCH failed (HTTP 400): fault']);
    expect(patches(devops)).toBe(1);
  });

  it('a refused write keeps DevOps\'s reason in the ledger and reports it again on a later pass', async () => {
    const { devops, exec, store } = setup();
    devops.fault({ method: 'PATCH', path: /workitems\/9$/i, mode: 'status', status: 400 });
    await exec([{ op: 'state', state: 'Nope' }]);
    expect(Object.values(store.ledger('run-1'))[0]).toMatchObject({ state: 'failed', error: 'DevOps: PATCH failed (HTTP 400): fault' });
    const again = await exec([{ op: 'state', state: 'Nope' }]);
    expect(again.failed).toEqual(['state → Nope: DevOps: PATCH failed (HTTP 400): fault']);
    expect(patches(devops)).toBe(1);
  });

  it('moves the item to another project of the package with area and iteration in ONE patch', async () => {
    const { devops, context } = setup();
    const move = { 'System.TeamProject': 'Planning', 'System.AreaPath': 'Planning\\OrisDent Air', 'System.IterationPath': 'Planning\\2026\\Sprint 20' };
    const moving = { ...context, grant: { ...context.grant, projects: ['Proj', 'Planning'], fields: ['System.TeamProject', 'System.AreaPath', 'System.IterationPath'] } };
    const out = await executeWrites(moving, [{ op: 'fields', fields: move }]);
    expect(out).toEqual({ done: ['fields System.TeamProject, System.AreaPath, System.IterationPath'], notVerified: [], failed: [] });
    expect(patches(devops)).toBe(1);
    expect(devops.items.get(9)).toMatchObject({ project: 'Planning', fields: { 'System.AreaPath': move['System.AreaPath'], 'System.IterationPath': move['System.IterationPath'] } });
  });

  it('after a project move, a later comment of the same step goes to the new project', async () => {
    const { devops, context } = setup();
    const moving = { ...context, grant: { ...context.grant, projects: ['Proj', 'Planning'], fields: ['System.TeamProject', 'System.AreaPath'] } };
    const out = await executeWrites(moving, [{ op: 'fields', fields: { 'System.TeamProject': 'Planning', 'System.AreaPath': 'Planning\\OrisDent Air' } }, { op: 'comment', text: 'x' }]);
    expect(out.done).toEqual(['fields System.TeamProject, System.AreaPath', 'comment']);
    expect(devops.calls.filter(c => c.method === 'POST').map(c => new URL(c.url).pathname)).toEqual(['/contoso/Planning/_apis/wit/workItems/9/comments']);
  });

  it('refuses a move to a project outside the package\'s devops.projects, before sending anything', async () => {
    const { devops, context } = setup();
    const moving = { ...context, grant: { ...context.grant, fields: ['System.TeamProject'] } };
    await expect(executeWrites(moving, [{ op: 'fields', fields: { 'System.TeamProject': 'Elsewhere' } }])).rejects.toThrow(/project Elsewhere is not in the package's devops.projects/);
    expect(devops.writes()).toEqual([]);
  });

  it('after a crash mid-write (ledger "writing") it verifies before sending: present → done, nothing sent', async () => {
    const { devops, exec, store, context } = setup();
    const write: StepWrite = { op: 'comment', text: 'Fixed.' };
    // first process: the POST applied, then the process died before the ledger said "done"
    devops.fault({ method: 'POST', path: /comments$/, mode: 'lost' });
    devops.fault({ method: 'GET', path: /comments$/, mode: 'drop' });
    await exec([write]);
    const key = Object.keys(store.ledger('run-1'))[0]!;
    store.setLedger('run-1', 1, key, { ...store.ledger('run-1')[key]!, state: 'writing' });
    const before = posts(devops);
    const out = await executeWrites(context, [write]);
    expect(out.done).toEqual(['comment (verified on DevOps)']);
    expect(posts(devops)).toBe(before);
    expect(devops.comments.get(9)).toHaveLength(1);
  });

  it('a write the package does not allow is refused (the step retries with the reason)', async () => {
    const { exec } = setup();
    await expect(exec([{ op: 'fields', fields: { 'System.Title': 'x' } }])).rejects.toThrow(/devops\.fields/);
  });
});

describe('runtime: an unverified write never blocks the run', () => {
  it('the run ends done; report and events say "not verified"', async () => {
    const root = tempDir(), devops = fakeDevOps();
    devops.addItem({ id: 5, fields: { 'System.Title': 'x' } });
    devops.fault({ method: 'POST', path: /comments$/, mode: 'drop', times: 5 });
    devops.fault({ method: 'GET', path: /comments$/, mode: 'drop', times: 5 });
    const engine = scriptedEngine(r => done('ok', r.stepId === 'fix' ? [{ op: 'comment', text: 'Fixed.' }] : undefined));
    const runtime = createRoutineRuntime({ pkg: routinePackage(), paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine, devops: { authorization: devops.authorization, request: devops.request } });
    const handle = runtime.startItem(5);
    const run = await handle.finished;
    expect(run.status).toBe('done');
    expect(run.steps.find(s => s.id === 'fix')!.notVerified).toEqual(['comment']);
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'report']);
    const report = runtime.store.events(handle.runId);
    expect(report.some(e => e.type === 'write' && e.status === 'not-verified')).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path.join(root, 'runs', handle.runId, 'report.md'), 'utf8')).toContain('DevOps not verified (the run went on): comment');
  });
});
