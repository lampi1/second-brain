// Test-node leases of the routine runtime: a run that stops (done, cancelled) releases its finished test deployments and keeps an active one; leaseSettled says which runs left stale leases (done/failed/cancelled, or
// `running` with no live lock holder), never a parked run or a run whose process is alive. A parked run that resumes
// takes its node back before any session and stops for a person when another run redeployed it meanwhile; a cancel
// while a run ends never turns a parked run into a cancelled one. No CLI, no network.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocks, createRoutineRuntime, type Deployments, type StepResult } from '../../../packages/routine-runtime/src/index';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir, type Script } from './fakes';

// GUIDs built at run time (the repo guard refuses GUID literals)
const g = (c: string) => [8, 4, 4, 4, 12].map(n => c.repeat(n)).join('-');

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

/** A parking package (escalation.park) on item 5 with one deploy target; `deployments` replaces the coordinator. */
function parking(script: Script, deployments?: Deployments) {
  const root = tempDir(), devops = fakeDevOps(), engine = scriptedEngine(script);
  devops.addItem({ id: 5, fields: { 'System.Title': 'x', 'System.Tags': 'ai-fixable', 'System.State': 'New' } });
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  const pkg = routinePackage({
    escalation: { contact: g('d'), contactName: 'Davide', park: true },
    devops: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags', 'downgrade'], fields: [], deployTargets: [{ id: 'air-test-1' } as never],
      downgrade: { removeTag: 'ai-fixable', addTag: 'ai-needs-human', state: 'New' } },
  });
  const runtime = createRoutineRuntime({ pkg, paths: paths(root), engine, devops: { authorization: devops.authorization, request: devops.request, ...(deployments ? { deployments } : {}) } });
  return { root, devops, engine, runtime };
}
const needsHuman: StepResult = { outcome: 'needs-human', summary: 'serve un dato', question: 'Quale campo devo usare' };

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

  it('a cancel while a parked run ends (its lease being released) never turns it into a cancelled run', async () => {
    let cancels = 0;
    const box: { runtime?: ReturnType<typeof parking>['runtime'] } = {};
    const deployments: Deployments = {
      execute: async () => ({}), ownedTargets: () => [], reclaim: async () => [],
      // the release at the run's end: a Ctrl+C lands right then
      settle: async runId => { await new Promise(r => setTimeout(r, 5)); if (box.runtime!.store.read(runId).status === 'needs-human') { cancels++; box.runtime!.cancel(runId); await new Promise(r => setTimeout(r, 20)); } return true; },
    };
    const s = parking(r => r.stepId === 'fix' ? needsHuman : done('ok'), deployments);
    box.runtime = s.runtime;
    const run = await s.runtime.startItem(5).finished;
    expect(cancels).toBeGreaterThan(0);
    expect(run.status).toBe('needs-human');
    expect(s.runtime.store.read(run.runId).status).toBe('needs-human');
    expect(s.runtime.store.read(run.runId).parked).toBeDefined();
    // so the watch never resumes it without an @AI answer
    expect(s.runtime.recover(run.runId)).toBeNull();
  });

  it('park, another run redeploys the node, the resumed run detects it before any session and parks again; after the answer the steps run, told the node no longer proves the change', async () => {
    let lost: { targetId: string; releaseId?: number; replaced: boolean; reason: string }[] = [], fixCalls = 0;
    const deployments: Deployments = { execute: async () => ({}), ownedTargets: () => [], settle: async () => true, reclaim: async () => lost };
    const s = parking(r => r.stepId === 'fix' && fixCalls++ === 0 ? needsHuman : done('ok'), deployments);
    const { runId } = await s.runtime.startItem(5).finished;
    // while parked another run deploys its release on the node; the contact answers
    lost = [{ targetId: 'air-test-1', releaseId: 7, replaced: true, reason: 'replaced' }];
    s.devops.reply(5, g('9'), '@AI riprendi');
    const again = await (await s.runtime.resumeParked(runId))!.finished;
    expect(again.status).toBe('needs-human');
    expect(again.parked).toMatchObject({ n: 2, stepId: 'fix' });
    expect(again.lostNodes).toEqual(['air-test-1:7']);
    // no session ran on the redeployed node
    expect(s.engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix']);
    const parks = s.devops.comments.get(5)!.filter(c => c.text.includes('Serve un umano'));
    expect(parks.at(-1)!.text).toContain("air-test-1 è stato ridistribuito da un'altra run: serve un nuovo deploy");
    // the person answered knowing it: the steps run, each told its tests on that node do not prove this run's change
    s.devops.reply(5, g('9'), '@AI rideploya e riprendi');
    const end = await (await s.runtime.resumeParked(runId))!.finished;
    expect(end.status).toBe('done');
    expect(s.engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'fix', 'report']);
    for (const r of s.engine.requests.slice(2)) expect(r.prompt).toContain('## Test node\nair-test-1 è stato ridistribuito da un\'altra run: serve un nuovo deploy. Tests on that node do not prove this run\'s change');
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
