// The shared routine runtime end to end with fakes (ADR 0175): the run folder it writes, the single-work-item start,
// resume of a killed run from the failed step under the attempt fence, the live events, and secret masking in every
// run file. No CLI, no network.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRoutineRuntime, createRunStore, createMasker, listRuns, progressFrom, readRun, type EngineStepRequest } from '../../../packages/routine-runtime/src/index';
import { done, fakeDevOps, folderText, routinePackage, scriptedEngine, tempDir } from './fakes';

const paths = (root: string) => ({ runsRoot: path.join(root, 'runs'), workspace: (id: string) => path.join(root, 'ws', id) });

describe('routine runtime: run folder and single work item', () => {
  it('writes run.json, the step folders, events and report.md, and targets only the started work item', async () => {
    const root = tempDir(), devops = fakeDevOps();
    devops.addItem({ id: 42, fields: { 'System.Title': 'Login button broken', 'System.State': 'New', 'System.WorkItemType': 'Bug', 'Microsoft.VSTS.TCM.ReproSteps': '<p>Click <b>Login</b></p>' } });
    devops.addItem({ id: 43, fields: { 'System.Title': 'Another item' } });
    const engine = scriptedEngine(r => r.stepId === 'report' ? done('reported', [{ op: 'comment', text: 'Fixed.' }, { op: 'state', state: 'Resolved' }]) : done(`${r.stepId} ok`));
    const runtime = createRoutineRuntime({ pkg: routinePackage(), paths: paths(root), engine, devops: { authorization: devops.authorization, request: devops.request } });

    const handle = runtime.startItem(42);
    const run = await handle.finished;
    expect(run.status).toBe('done');
    expect(run.workItem).toBe(42);

    const folder = readRun(path.join(root, 'runs', handle.runId));
    expect(folder.steps.map(s => path.basename(s.dir))).toEqual(['01-analyse', '02-fix', '03-report']);
    for (const s of folder.steps) {
      expect(s.prompt).toContain('## How to finish this step');
      expect(fs.existsSync(s.transcript)).toBe(true);
      expect(s.result).toMatchObject({ outcome: 'done' });
      expect(s.evidence.map(f => path.basename(f))).toEqual(['notes.md']);
      expect(s.screenshots.map(f => path.basename(f))).toEqual([`${s.record.id}.png`]);
    }
    expect(folder.report).toContain('Status: **done**');
    expect(folder.report).toContain('DevOps: comment; state → Resolved');
    expect(listRuns(path.join(root, 'runs')).map(r => r.runId)).toEqual([handle.runId]);

    // the work item reached the steps: placeholder, prompt context, env
    const first = engine.requests[0]!;
    expect(first.prompt).toContain('Analyse work item 42.');
    expect(first.prompt).toContain('Work item 42: Login button broken');
    expect(first.prompt).toContain('Click Login');
    expect(first.env?.ROUTINE_WORK_ITEM).toBe('42');

    // DevOps writes went to item 42 only
    const writes = devops.writes();
    expect(writes).toHaveLength(2);
    for (const w of writes) expect(w.url).toMatch(/\/workItems\/42[/?]/i);
    expect(devops.items.get(42)!.fields['System.State']).toBe('Resolved');
    expect(devops.items.get(43)!.rev).toBe(1);
    expect(devops.comments.get(42)![0]!.text).toContain(`routine run ${handle.runId}`);

    // live progress
    const events = runtime.store.events(handle.runId);
    expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['run-start', 'step-start', 'action', 'screenshot', 'step-end', 'write', 'run-end']));
    const progress = progressFrom(events);
    expect(progress).toMatchObject({ status: 'done', step: { n: 3, total: 3, title: 'Report' } });
    expect(progress.shots).toHaveLength(1);
    expect(progress.lastAction).toContain('Bash: echo working on report');
  });

  it('refuses a non-positive work item', () => {
    const root = tempDir();
    const runtime = createRoutineRuntime({ pkg: routinePackage(), paths: paths(root), engine: scriptedEngine(() => done('x')) });
    expect(() => runtime.startItem(0)).toThrow(/positive/);
  });
});

describe('routine runtime: resume', () => {

  it('a step that failed resumes at that step, not from the start', async () => {
    const root = tempDir();
    const pkg = routinePackage({ devops: undefined, inputs: [], steps: [
      { id: 'one', title: 'One', prompt: 'p', maxAttempts: 1 }, { id: 'two', title: 'Two', prompt: 'p', maxAttempts: 1 },
    ] });
    const failing = scriptedEngine(r => r.stepId === 'two' ? 'no-result' : done('one ok'));
    const a = createRoutineRuntime({ pkg, paths: paths(root), engine: failing });
    const handle = a.start();
    const failed = await handle.finished;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('step two');
    const fixed = scriptedEngine(() => done('two ok'));
    const resumed = await createRoutineRuntime({ pkg, paths: paths(root), engine: fixed }).resume(handle.runId).finished;
    expect(resumed.status).toBe('done');
    expect(fixed.requests.map(r => r.stepId)).toEqual(['two']);
  });
});

describe('routine runtime: secrets', () => {
  it('masks every planted secret as *** in every file of the run folder', async () => {
    const root = tempDir(), devops = fakeDevOps();
    devops.addItem({ id: 7, fields: { 'System.Title': 'Item' } });
    const sitePassword = `site-${Math.random().toString(36).slice(2)}-pw`, pat = `pat${Math.random().toString(36).slice(2)}xyz`, dbPassword = `db-${Math.random().toString(36).slice(2)}-pw`;
    const pkg = routinePackage({ testDbs: [{ id: 'qa', server: 'qa-sql.test.local', database: 'AirTest' }] }, {
      credentials: [{ loginUrl: 'https://air.test.local/login', user: 'qa', password: sitePassword }],
      secrets: { devopsPat: pat, testDbs: { qa: { user: 'reader', password: dbPassword } } },
    });
    const leaks = (r: EngineStepRequest) => done(`used ${sitePassword} and ${pat} and ${dbPassword}`, r.stepId === 'report' ? [{ op: 'comment', text: `login ${sitePassword}` }] : undefined);
    const engine = scriptedEngine(leaks, { leak: `${sitePassword} ${pat} ${dbPassword}` });
    const runtime = createRoutineRuntime({ pkg, paths: paths(root), engine, devops: { authorization: devops.authorization, request: devops.request } });
    const handle = runtime.startItem(7);
    await handle.finished;
    const files = folderText(path.join(root, 'runs'));
    expect(files.length).toBeGreaterThan(10);
    for (const { file, text } of files) for (const secret of [sitePassword, pat, dbPassword]) expect(text.includes(secret), `${file} leaks a secret`).toBe(false);
    expect(files.find(f => f.file.endsWith('notes.md'))!.text).toContain('***');
    expect(files.find(f => f.file.endsWith('events.jsonl'))!.text).toContain('***');
    // and what went to DevOps is masked too
    expect(devops.comments.get(7)![0]!.text).not.toContain(sitePassword);
  });

  it('the run store masks events it appends', () => {
    const root = tempDir(), store = createRunStore(root, createMasker(['s3cr3t-value']));
    fs.mkdirSync(path.join(root, 'r1'), { recursive: true });
    store.appendEvent('r1', { type: 'action', at: 1, n: 1, text: 'typed s3cr3t-value' });
    expect(fs.readFileSync(path.join(root, 'r1', 'events.jsonl'), 'utf8')).not.toContain('s3cr3t-value');
  });
});
