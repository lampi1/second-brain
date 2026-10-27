// The review→fix loop of the routine runtime: a step with `loop` that finishes with `sendBack` sends the run back to
// an earlier step; every step of the loop runs again in its own round folder, the target's prompt carries the
// findings, a `loop` event feeds the live progress, the package's limit turns more findings into needs-human, and a
// run killed inside a round resumes in that round. No CLI, no network.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRoutineRuntime, parseRoutineDefinition, progressFrom, type StepResult } from '../../../packages/routine-runtime/src/index';
import { done, routinePackage, scriptedEngine, tempDir } from './fakes';

const paths = (root: string) => ({ runsRoot: path.join(root, 'runs'), workspace: (id: string) => path.join(root, 'ws', id) });
const pkg = (max?: number) => routinePackage({
  devops: undefined, inputs: [],
  steps: [
    { id: 'analyse', title: 'Analyse', prompt: 'Analyse.' },
    { id: 'fix', title: 'Fix', prompt: 'Fix it.' },
    { id: 'review', title: 'Review', prompt: 'Review the fix.', loop: { to: 'fix', ...(max ? { max } : {}) } },
  ],
});
const sendBack = (reason: string): StepResult => ({ outcome: 'done', summary: 'findings', sendBack: { reason } });
const folders = (root: string, runId: string) => fs.readdirSync(path.join(root, 'runs', runId, 'steps')).sort();

describe('review→fix loop', () => {
  it('findings send the run back to the fix step, in a new round folder with the findings in its prompt', async () => {
    const root = tempDir();
    let reviews = 0;
    const engine = scriptedEngine(r => r.stepId === 'review' && ++reviews === 1 ? sendBack('null check missing in Save') : done(`${r.stepId} ok`));
    const runtime = createRoutineRuntime({ pkg: pkg(), paths: paths(root), engine });
    const handle = runtime.start();
    const run = await handle.finished;

    expect(run.status).toBe('done');
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'review', 'fix', 'review']);
    expect(folders(root, handle.runId)).toEqual(['01-analyse', '02-fix', '02-fix.r2', '03-review', '03-review.r2']);
    // each round kept its own result and screenshots
    expect(JSON.parse(fs.readFileSync(path.join(root, 'runs', handle.runId, 'steps', '03-review', 'step-result.json'), 'utf8'))).toMatchObject({ sendBack: { reason: 'null check missing in Save' } });
    expect(fs.existsSync(path.join(root, 'runs', handle.runId, 'steps', '02-fix.r2', 'screenshots', 'fix.png'))).toBe(true);

    const fix2 = engine.requests[3]!;
    expect(fix2.stepDir).toMatch(/02-fix\.r2$/);
    expect(fix2.prompt).toContain('## Sent back by Review (round 2)');
    expect(fix2.prompt).toContain('null check missing in Save');
    expect(engine.requests[4]!.prompt).toContain('## Round 2');
    // only a step with `loop` is told how to send back
    expect(engine.requests[2]!.prompt).toContain('sendBack');
    expect(engine.requests[1]!.prompt).not.toContain('sendBack');

    expect(run.steps.map(s => [s.id, s.round ?? 1, s.status])).toEqual([['analyse', 1, 'done'], ['fix', 2, 'done'], ['review', 2, 'done']]);
    expect(run.steps.find(s => s.id === 'review')!.loops).toBe(1);
    const events = runtime.store.events(handle.runId);
    expect(events.filter(e => e.type === 'loop')).toEqual([expect.objectContaining({ from: 'review', to: 'fix', round: 2, reason: 'null check missing in Save' })]);
    // the live progress went back to running on the loop and still ended done
    const loopAt = events.findIndex(e => e.type === 'loop');
    expect(progressFrom(events.slice(0, loopAt + 1))).toMatchObject({ status: 'running', lastAction: expect.stringContaining('review → fix (giro 2)') });
    expect(progressFrom(events).status).toBe('done');
  });

  it('past the package\'s limit the step becomes needs-human: no further round', async () => {
    const root = tempDir();
    const engine = scriptedEngine(r => r.stepId === 'review' ? sendBack('still broken') : done(`${r.stepId} ok`));
    const runtime = createRoutineRuntime({ pkg: pkg(2), paths: paths(root), engine });
    const handle = runtime.start();
    const run = await handle.finished;

    expect(run.status).toBe('needs-human');
    expect(run.error).toMatch(/after 2 round\(s\) back to Fix there are still findings: still broken/);
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'review', 'fix', 'review', 'fix', 'review']);
    expect(folders(root, handle.runId)).toEqual(['01-analyse', '02-fix', '02-fix.r2', '02-fix.r3', '03-review', '03-review.r2', '03-review.r3']);
    expect(run.steps.find(s => s.id === 'review')).toMatchObject({ status: 'needs-human', loops: 2, round: 3 });
    expect(runtime.store.events(handle.runId).filter(e => e.type === 'loop')).toHaveLength(2);
  });

  it('a step without `loop` that returns sendBack just finishes: nothing goes back', async () => {
    const root = tempDir();
    const engine = scriptedEngine(r => r.stepId === 'fix' ? sendBack('ignored') : done(`${r.stepId} ok`));
    const run = await createRoutineRuntime({ pkg: pkg(), paths: paths(root), engine }).start().finished;
    expect(run.status).toBe('done');
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'review']);
  });

  it('a run killed inside round 2 resumes in round 2, at the step it was in', async () => {
    const root = tempDir();
    let release: ((r: StepResult) => void) | undefined, reviews = 0;
    const first = scriptedEngine(r => {
      if (r.stepId === 'review' && ++reviews === 1) return sendBack('typo in label');
      if (r.stepId === 'fix' && /\.r2$/.test(r.stepDir)) return new Promise<StepResult>(resolve => { release = resolve; });
      return done(`${r.stepId} ok`);
    });
    const a = createRoutineRuntime({ pkg: pkg(), paths: paths(root), engine: first });
    const handle = a.start();
    for (let i = 0; i < 200 && !release; i++) await new Promise(r => setTimeout(r, 5));
    expect(release).toBeDefined();
    expect(a.store.read(handle.runId).steps.map(s => [s.id, s.round ?? 1, s.status])).toEqual([['analyse', 1, 'done'], ['fix', 2, 'running'], ['review', 2, 'pending']]);

    const second = scriptedEngine(r => done(`${r.stepId} resumed`));
    const b = createRoutineRuntime({ pkg: pkg(), paths: paths(root), engine: second });
    const resumed = await b.resume(handle.runId).finished;
    expect(resumed.status).toBe('done');
    expect(second.requests.map(r => [r.stepId, path.basename(r.stepDir)])).toEqual([['fix', '02-fix.r2'], ['review', '03-review.r2']]);
    expect(second.requests[0]!.prompt).toContain('typo in label');
    expect(resumed.steps.find(s => s.id === 'review')!.loops).toBe(1);
    release!(done('late'));
    await handle.finished;
    expect(b.store.read(handle.runId).steps.find(s => s.id === 'fix')!.summary).toBe('fix resumed');
  });

  it('the package format accepts a loop only towards an earlier step', () => {
    const def = (loop: unknown) => ({ id: 'r', title: 'R', steps: [{ id: 'fix', title: 'Fix', prompt: 'p' }, { id: 'review', title: 'Review', prompt: 'p', loop }] });
    expect(parseRoutineDefinition(def({ to: 'fix', max: 3 })).steps[1]!.loop).toEqual({ to: 'fix', max: 3 });
    expect(() => parseRoutineDefinition(def({ to: 'review' }))).toThrow(/loop/);
    expect(() => parseRoutineDefinition(def({ to: 'nope' }))).toThrow(/loop/);
    expect(() => parseRoutineDefinition(def({ to: 'fix', max: 0 }))).toThrow(/max/);
  });
});
