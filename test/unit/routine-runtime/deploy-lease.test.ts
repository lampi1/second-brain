// Test-node leases of the routine runtime: a run that stops (done, cancelled) releases its finished test deployments
// and keeps an active one; leaseSettled says which runs left stale leases (done/failed/cancelled, or `running` with no
// live lock holder), never a parked run or a run whose process is alive. No CLI, no network.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocks, createRoutineRuntime } from '../../../packages/routine-runtime/src/index';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir, type Script } from './fakes';

const paths = (root: string) => ({ runsRoot: path.join(root, 'runs'), workspace: (id: string) => path.join(root, 'ws', id) });
const stateFile = (root: string) => path.join(root, 'runs', 'test-deployments.json');
type Saved = { deployments: { runId: string; state: string; released?: boolean }[] };
const saved = (root: string) => JSON.parse(fs.readFileSync(stateFile(root), 'utf8')) as Saved;
/** the ledger as an older runtime left it: deployments of this run and of another one, none released */
const seed = (root: string, runId: string, own: string) => fs.writeFileSync(stateFile(root), JSON.stringify({ schema: 1, deployments: [
  { runId, target: { id: 'air-test-1' }, buildId: 1, commit: 'c', state: own, releaseId: 7, token: 't' },
  { runId: 'other-run', target: { id: 'air-test-1' }, buildId: 2, commit: 'c', state: 'queued', releaseId: 8, token: 't' },
] }));

function setup(script: Script, locks?: ReturnType<typeof createLocks>) {
  const root = tempDir(), devops = fakeDevOps();
  devops.addItem({ id: 42, fields: { 'System.Title': 'Bug', 'System.State': 'New' } });
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  const runtime = createRoutineRuntime({ pkg: routinePackage(), paths: paths(root), engine: scriptedEngine(script), devops: { authorization: devops.authorization, request: devops.request }, ...(locks ? { locks } : {}) });
  return { root, runtime };
}

describe('test deployment leases', () => {
  it('a done run releases its finished deployment; another run\'s active one is untouched', async () => {
    let root = '';
    const s = setup(r => { if (r.stepId === 'analyse') seed(root, r.runId, 'succeeded'); return done('ok'); });
    root = s.root;
    const run = await s.runtime.startItem(42).finished;
    expect(run.status).toBe('done');
    const d = saved(root).deployments;
    expect(d.find(x => x.runId === run.runId)?.released).toBe(true);
    expect(d.find(x => x.runId === 'other-run')?.released).toBeFalsy();
  });

  it('a done run with an active or uncertain deployment keeps its lease', async () => {
    let root = '';
    const s = setup(r => { if (r.stepId === 'analyse') seed(root, r.runId, 'queued'); return done('ok'); });
    root = s.root;
    const run = await s.runtime.startItem(42).finished;
    expect(run.status).toBe('done');
    expect(saved(root).deployments.find(x => x.runId === run.runId)?.released).toBeFalsy();
  });

  it('a cancelled run (Ctrl+C) releases its finished deployment', async () => {
    let root = '';
    const s = setup(async r => {
      if (r.stepId !== 'fix') return done('ok');
      seed(root, r.runId, 'failed');
      setTimeout(() => s.runtime.cancel(r.runId), 10);
      await new Promise(resolve => r.signal.addEventListener('abort', resolve, { once: true }));
      return 'no-result';
    });
    root = s.root;
    const run = await s.runtime.startItem(42).finished;
    expect(run.status).toBe('cancelled');
    expect(saved(root).deployments.find(x => x.runId === run.runId)?.released).toBe(true);
  });

  it('leaseSettled: done yes; parked no; running only when no live process holds its locks', async () => {
    const lockDir = tempDir(), OTHER = 4242;
    const locks = createLocks(lockDir, { alive: pid => pid === OTHER });
    const s = setup(() => done('ok'), locks);
    const run = await s.runtime.startItem(42).finished;
    expect(s.runtime.leaseSettled(run.runId)).toBe(true);
    const file = path.join(s.root, 'runs', run.runId, 'run.json');
    const as = (status: string) => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), status }));
    as('needs-human');
    expect(s.runtime.leaseSettled(run.runId)).toBe(false);
    as('waiting-human');
    expect(s.runtime.leaseSettled(run.runId)).toBe(false);
    // `running` but its process is gone (Ctrl+C on a killed terminal): no live holder of its work item lock
    as('running');
    expect(s.runtime.leaseSettled(run.runId)).toBe(true);
    // `running` and a live process holds its work item
    expect(createLocks(lockDir, { pid: OTHER, alive: pid => pid === OTHER }).acquire('item-contoso-42', run.runId)).toBeTruthy();
    expect(s.runtime.leaseSettled(run.runId)).toBe(false);
    // no lock folder: no liveness signal, a `running` run is never settled
    const bare = setup(() => done('ok'));
    const other = await bare.runtime.startItem(42).finished;
    const otherFile = path.join(bare.root, 'runs', other.runId, 'run.json');
    fs.writeFileSync(otherFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(otherFile, 'utf8')), status: 'running' }));
    expect(bare.runtime.leaseSettled(other.runId)).toBe(false);
    expect(bare.runtime.leaseSettled('no-such-run')).toBe(false);
  });
});
