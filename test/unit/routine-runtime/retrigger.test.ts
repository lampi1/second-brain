// Retrigger tags and entries (ADR 0323): `trigger.retriggerTags` starts an item again after its run ended, once per
// tag (the new run takes the tag off the work item through the write adapter, logged in its events and report), and
// `routine.entries` choose the step a run starts from by the work item's tags. The dedup still holds without the tag,
// an active run blocks a restart, a tag whose removal failed never starts a second run, and a package without the two
// options runs exactly as before. Real runtime and trigger loop, fake DevOps and engine: no network, no CLI.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRoutineRuntime, createTriggerLoop, readRun, type RoutinePackage, type RoutineTrigger, type RunRecord } from '../../../packages/routine-runtime/src/index';
import { main, parseArgs } from '../../../packages/routine-runtime/src/cli';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir, type Script } from './fakes';

const TRIGGER: RoutineTrigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true, includeTags: ['ai-fixable'] };
const ENTRIES = [{ name: 'retest', when: { tag: 'ai-retest' }, startStep: 'report' }];
/** the detector's answer for item 42: every poll sees it (a subject already started is skipped by the loop) */
const detect = async (): Promise<FlowDetectionResult> => ({ items: [{ key: 'k', title: '#42 Login fails', inputs: { 'work-item-id': '42' } }], cursor: { 42: '3' }, summary: '1 item.' });

function setup(over: { trigger?: Partial<RoutineTrigger>; entries?: RoutinePackage['routine']['entries']; script?: Script; active?: () => number } = {}) {
  const root = tempDir(), devops = fakeDevOps();
  devops.addItem({ id: 42, fields: { 'System.Title': 'Login fails', 'System.State': 'New', 'System.Tags': 'ai-fixable' } });
  const trigger = { ...TRIGGER, ...over.trigger };
  const pkg = routinePackage({ trigger, ...(over.entries ? { entries: over.entries } : {}) });
  const engine = scriptedEngine(over.script ?? (r => done(`${r.stepId} ok`)));
  const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine, devops: { authorization: devops.authorization, request: devops.request } });
  const finished: Promise<RunRecord>[] = [];
  const loop = createTriggerLoop({
    routineId: pkg.routine.id, trigger, store: runtime.store, detect,
    start: async (workItem, inputs, how) => { const handle = await runtime.startItemFor(workItem, { inputs, ...how }); finished.push(handle.finished); return handle; },
    ...(trigger.retriggerTags?.length ? { tags: (ids: number[]) => runtime.itemTags(ids), settle: (runId: string) => runtime.settleRetrigger(runId) } : {}),
    ...(over.active ? { active: over.active } : {}),
  });
  const tag = (tags: string) => { devops.items.get(42)!.fields['System.Tags'] = tags; };
  const tagsNow = () => String(devops.items.get(42)!.fields['System.Tags'] ?? '');
  /** one poll, then every run it started runs to its end */
  const poll = async () => { const result = await loop.tick(); await Promise.all(finished); return result; };
  return { root, devops, engine, runtime, loop, poll, tag, tagsNow, finished };
}
const RETRIGGER = { trigger: { retriggerTags: ['ai-retest'] } };

describe('trigger.retriggerTags', () => {
  it('without the tag the dedup still blocks a second start', async () => {
    const t = setup(RETRIGGER);
    expect((await t.poll()).started).toHaveLength(1);
    const again = await t.poll();
    expect(again.started).toEqual([]);
    expect(again.retriggered).toBeUndefined();
    expect(t.engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'report']);
  });

  it('with the tag the item starts again once: the tag is taken off and logged, a second poll starts nothing', async () => {
    const t = setup(RETRIGGER);
    const first = (await t.poll()).started[0]!.runId;
    t.tag('ai-fixable; AI-Retest');
    const result = await t.poll();
    expect(result.retriggered).toEqual([{ workItem: 42, runId: result.started[0]!.runId, tags: ['ai-retest'], previousRunId: first }]);
    const second = result.started[0]!.runId;
    expect(second).not.toBe(first);
    // the tag is off the item, the other tags stay
    expect(t.tagsNow()).toBe('ai-fixable');
    const run = t.runtime.store.read(second);
    expect(run).toMatchObject({ status: 'done', workItem: 42, subjectKey: 'item:42', previousRunId: first, entry: 'default', retrigger: { tags: ['ai-retest'], removed: true, tries: 1 } });
    // the removal is in the run history: an event before the first step, a ledger entry, a line of the report
    const events = t.runtime.store.events(second);
    expect(events[0]).toMatchObject({ type: 'run-start', entry: 'default', retriggerTags: ['ai-retest'], previousRunId: first });
    expect(events[1]).toMatchObject({ type: 'write', n: 0, status: 'done', what: 'retrigger tag ai-retest removed from work item 42' });
    expect(events[2]).toMatchObject({ type: 'step-start', id: 'analyse' });
    expect(Object.values(t.runtime.store.ledger(second)).map(e => [e.what, e.state])).toEqual([['tags + -ai-retest', 'done']]);
    expect(readRun(t.runtime.store.runDir(second)).report).toMatch(/Retrigger tag ai-retest: removed from the work item/);
    expect(t.runtime.store.trigger().subjects['item:42']).toMatchObject({ runId: second, previous: [first] });
    // a second poll: the tag is gone, nothing starts
    const third = await t.poll();
    expect(third.started).toEqual([]);
    expect(t.engine.requests).toHaveLength(6);
    expect(t.devops.writes().filter(w => /workitems\/42\?/i.test(w.url) && w.method === 'PATCH')).toHaveLength(1);
  });

  it('a run that is not over blocks the restart; when it ends the tag starts the item again', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const t = setup({ ...RETRIGGER, script: async r => { if (r.stepId === 'fix' && r.runId === firstRun) await gate; return done('ok'); } });
    let firstRun = '';
    firstRun = (await t.loop.tick()).started[0]!.runId;
    t.tag('ai-fixable; ai-retest');
    for (let i = 0; i < 2; i++) expect((await t.loop.tick()).started).toEqual([]);
    expect(t.runtime.store.read(firstRun).status).toBe('running');
    expect(t.tagsNow()).toBe('ai-fixable; ai-retest');
    release();
    await Promise.all(t.finished);
    const result = await t.poll();
    expect(result.retriggered).toMatchObject([{ workItem: 42, previousRunId: firstRun }]);
    expect(t.tagsNow()).toBe('ai-fixable');
  });

  it('a cancelled run is not ended: it is resumed, never replaced', async () => {
    const t = setup(RETRIGGER);
    const first = (await t.poll()).started[0]!.runId;
    t.runtime.store.claim(first, r => { r.status = 'cancelled'; });
    t.tag('ai-fixable; ai-retest');
    expect((await t.poll()).started).toEqual([]);
    expect(t.tagsNow()).toBe('ai-fixable; ai-retest');
  });

  it('failed and needs-human runs are ended: the tag starts them again', async () => {
    for (const outcome of ['failed', 'needs-human'] as const) {
      let calls = 0;
      const t = setup({ ...RETRIGGER, script: () => calls++ < 4 ? { outcome, summary: 'no', ...(outcome === 'needs-human' ? { question: 'which one' } : {}) } : done('ok') });
      const first = (await t.poll()).started[0]!.runId;
      expect(t.runtime.store.read(first).status).toBe(outcome);
      t.tag('ai-fixable; ai-retest');
      expect((await t.poll()).retriggered).toMatchObject([{ previousRunId: first }]);
    }
  });

  it('the caps of a new item hold for a restart (maxActive, maxPerHour)', async () => {
    let active = 0;
    const busy = setup({ trigger: { retriggerTags: ['ai-retest'], maxActive: 1 }, active: () => active });
    await busy.poll();
    busy.tag('ai-fixable; ai-retest');
    active = 1;
    expect(await busy.poll()).toMatchObject({ started: [], skipped: 2 });
    active = 0;
    expect((await busy.poll()).started).toHaveLength(1);

    const capped = setup({ trigger: { retriggerTags: ['ai-retest'], maxPerHour: 1 } });
    await capped.poll();
    capped.tag('ai-fixable; ai-retest');
    expect((await capped.poll()).started).toEqual([]);
    expect(capped.tagsNow()).toBe('ai-fixable; ai-retest');
  });

  it('a tag DevOps refused to remove never starts a second run: the watch tries again, then the item is free', async () => {
    const t = setup(RETRIGGER);
    const first = (await t.poll()).started[0]!.runId;
    t.tag('ai-fixable; ai-retest');
    t.devops.fault({ method: 'PATCH', path: /\/workitems\/42$/i, mode: 'status', status: 400 });
    const second = (await t.poll()).started[0]!.runId;
    // the run went on (a DevOps write never blocks a run) and says the tag is still there
    expect(t.runtime.store.read(second)).toMatchObject({ status: 'done', retrigger: { removed: false, tries: 1 } });
    expect(t.runtime.store.events(second)[1]).toMatchObject({ type: 'write', n: 0, status: 'failed' });
    expect(readRun(t.runtime.store.runDir(second)).report).toMatch(/Retrigger tag ai-retest: not removed yet/);
    expect(t.tagsNow()).toBe('ai-fixable; ai-retest');
    // next poll: the run is over and the tag is on, but it is this run's own tag: removed now, nothing starts
    expect((await t.poll()).started).toEqual([]);
    expect(t.tagsNow()).toBe('ai-fixable');
    expect(t.runtime.store.read(second).retrigger).toMatchObject({ removed: true, tries: 2 });
    expect(readRun(t.runtime.store.runDir(second)).report).toMatch(/Retrigger tag ai-retest: removed from the work item/);
    expect((await t.poll()).started).toEqual([]);
    expect(t.engine.requests).toHaveLength(6);
    // a person sets the tag again: a new restart
    t.tag('ai-fixable; ai-retest');
    expect((await t.poll()).retriggered).toMatchObject([{ previousRunId: second }]);
    expect(t.runtime.store.trigger().subjects['item:42']!.previous).toEqual([first, second]);
  });

  it('a restart cut between its save and its start is settled at the next poll, never doubled', async () => {
    // no run was made: the item is as before, and its tag starts it once
    const cut = setup(RETRIGGER);
    const first = (await cut.poll()).started[0]!.runId;
    cut.tag('ai-fixable; ai-retest');
    const state = cut.runtime.store.trigger();
    cut.runtime.store.setTrigger({ ...state, subjects: { 'item:42': { ...state.subjects['item:42']!, runId: '', restart: { from: first } } } });
    expect((await cut.poll()).retriggered).toMatchObject([{ previousRunId: first }]);
    expect((await cut.poll()).started).toEqual([]);
    expect(cut.engine.requests).toHaveLength(6);

    // the run was made: it is taken as the item's run, nothing new starts
    const made = setup(RETRIGGER);
    const one = (await made.poll()).started[0]!.runId;
    made.tag('ai-fixable; ai-retest');
    const two = await made.runtime.startItemFor(42, { previousRunId: one });
    await two.finished;
    const before = made.runtime.store.trigger();
    made.runtime.store.setTrigger({ ...before, subjects: { 'item:42': { ...before.subjects['item:42']!, runId: '', restart: { from: one } } } });
    expect((await made.poll()).started).toEqual([]);
    expect(made.runtime.store.trigger().subjects['item:42']).toMatchObject({ runId: two.runId, previous: [one] });
    expect(made.runtime.store.trigger().subjects['item:42']!.restart).toBeUndefined();
    expect(made.engine.requests).toHaveLength(6);
  });

  it('an item that could not be started again (its tags unreadable, another run holding it) stays as it was', async () => {
    const t = setup(RETRIGGER);
    const first = (await t.poll()).started[0]!.runId;
    t.tag('ai-fixable; ai-retest');
    const failing = createTriggerLoop({ routineId: 'demo', trigger: { ...TRIGGER, retriggerTags: ['ai-retest'] }, store: t.runtime.store, detect,
      tags: ids => t.runtime.itemTags(ids), start: () => { throw new Error('work item 42 is in use'); } });
    expect(await failing.tick()).toMatchObject({ started: [], skipped: 2 });
    expect(t.runtime.store.trigger().subjects['item:42']).toMatchObject({ runId: first });
    expect(t.runtime.store.trigger().subjects['item:42']!.restart).toBeUndefined();
    // the tags read fails: nothing starts, the poll goes on
    const blind = createTriggerLoop({ routineId: 'demo', trigger: { ...TRIGGER, retriggerTags: ['ai-retest'] }, store: t.runtime.store, detect,
      tags: async () => { throw new Error('offline'); }, start: () => { throw new Error('never'); } });
    expect((await blind.tick()).started).toEqual([]);
  });
});

describe('routine.entries', () => {
  it('a restart takes the entry its tag chooses: only its steps run, with the entry name and the previous run folder', async () => {
    const t = setup({ ...RETRIGGER, entries: ENTRIES });
    const first = (await t.poll()).started[0]!.runId;
    // the first run took the default entry: every step, told so
    expect(t.runtime.store.read(first)).toMatchObject({ entry: 'default', inputs: { entry: 'default', workItem: '42' } });
    expect(t.runtime.store.read(first).previousRunId).toBeUndefined();
    expect(t.engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'report']);
    expect(t.engine.requests[0]!.env).toMatchObject({ ROUTINE_ENTRY: 'default' });
    expect(t.engine.requests[0]!.env?.ROUTINE_PREVIOUS_RUN).toBeUndefined();
    expect(t.engine.requests[0]!.prompt).not.toContain('## Previous run');

    t.tag('ai-fixable; ai-retest');
    const second = (await t.poll()).started[0]!.runId;
    const run = t.runtime.store.read(second), previousDir = t.runtime.store.runDir(first);
    expect(run).toMatchObject({ status: 'done', entry: 'retest', previousRunId: first, inputs: { entry: 'retest', previousRun: previousDir } });
    expect(run.steps.map(s => [s.id, s.attempts])).toEqual([['analyse', 0], ['fix', 0], ['report', 1]]);
    expect(run.steps[0]!.summary).toBe('skipped (entry "retest" starts from step report)');
    const request = t.engine.requests[3]!;
    expect(t.engine.requests).toHaveLength(4);
    expect(request).toMatchObject({ stepId: 'report', env: { ROUTINE_ENTRY: 'retest', ROUTINE_PREVIOUS_RUN: previousDir } });
    expect(request.prompt).toContain('This run entered the routine as "retest" (tag ai-retest on the work item): it starts from step Report');
    expect(request.prompt).toContain(`The previous run of this work item (done) is in ${previousDir}`);
    expect(request.prompt).toContain('- steps/02-fix · Fix (done): fix ok');
    expect(request.prompt).toContain(`- previousRun: ${previousDir}`);
    // the previous run's evidence is where the prompt says
    expect(fs.existsSync(path.join(previousDir, 'steps', '02-fix', 'evidence', 'notes.md'))).toBe(true);
    expect(readRun(t.runtime.store.runDir(second)).report).toMatch(/- Entry: retest\n- Previous run of this work item: /);
  });

  it('a first run of an item already carrying the entry tag takes that entry, and the retrigger tag with it', async () => {
    const t = setup({ ...RETRIGGER, entries: ENTRIES });
    t.tag('ai-fixable; ai-retest');
    const first = (await t.poll()).started[0]!.runId;
    expect(t.runtime.store.read(first)).toMatchObject({ entry: 'retest', retrigger: { removed: true } });
    expect(t.engine.requests.map(r => r.stepId)).toEqual(['report']);
    expect(t.tagsNow()).toBe('ai-fixable');
    expect((await t.poll()).started).toEqual([]);
  });

  it('entries without retrigger tags: the tag chooses the entry and stays on the item', async () => {
    const t = setup({ entries: [{ name: 'quick', when: { tag: 'ai-quick' }, startStep: 'fix' }] });
    t.tag('ai-fixable; ai-quick');
    const first = (await t.poll()).started[0]!.runId;
    expect(t.runtime.store.read(first)).toMatchObject({ entry: 'quick' });
    expect(t.runtime.store.read(first).retrigger).toBeUndefined();
    expect(t.engine.requests.map(r => r.stepId)).toEqual(['fix', 'report']);
    expect(t.tagsNow()).toBe('ai-fixable; ai-quick');
    expect(t.devops.writes().filter(w => w.method !== 'POST' || !/workitemsbatch/i.test(w.url))).toEqual([]);
    expect((await t.poll()).started).toEqual([]);
  });

  it('a run by hand: the tags choose, --entry names one, --from-step wins for the first step, an unknown entry is refused', async () => {
    const t = setup({ ...RETRIGGER, entries: ENTRIES });
    t.tag('ai-retest');
    const byTag = await t.runtime.startFor({ inputs: { workItem: '42' } });
    expect((await byTag.finished)).toMatchObject({ entry: 'retest', retrigger: { removed: true } });
    const named = await t.runtime.startFor({ workItem: 42, entry: 'retest' });
    expect(await named.finished).toMatchObject({ entry: 'retest', previousRunId: byTag.runId });
    expect((await named.finished).retrigger).toBeUndefined();
    const forced = await t.runtime.startFor({ workItem: 42, entry: 'default' });
    expect((await forced.finished).steps.map(s => s.attempts)).toEqual([1, 1, 1]);
    const from = await t.runtime.startFor({ workItem: 42, entry: 'retest', fromStep: 'fix' });
    expect(await from.finished).toMatchObject({ entry: 'retest', steps: [{ attempts: 0, summary: 'skipped (started from step fix)' }, { attempts: 1 }, { attempts: 1 }] });
    await expect(t.runtime.startFor({ workItem: 42, entry: 'nope' })).rejects.toThrow('No entry "nope" in this routine (entries: default, retest)');
    // a work item DevOps does not return starts nothing
    await expect(t.runtime.startFor({ workItem: 999 })).rejects.toThrow(/Work item 999 was not found on DevOps/);
    expect(parseArgs(['run', 'pkg', '--entry', 'retest', '--from-step', 'fix'])).toMatchObject({ entry: 'retest', fromStep: 'fix' });
  });
});

describe('a package without entries and retrigger tags', () => {
  it('runs as before: no tags read, no entry input, no tag write, and a tagged ended item never starts again', async () => {
    const t = setup();
    t.tag('ai-fixable; ai-retest');
    const first = (await t.poll()).started[0]!.runId;
    const run = t.runtime.store.read(first);
    expect(run.inputs).toEqual({ workItem: '42' });
    for (const key of ['entry', 'previousRunId', 'retrigger'] as const) expect(run[key]).toBeUndefined();
    expect(Object.keys(t.engine.requests[0]!.env ?? {}).sort()).toEqual(['ROUTINE_RUN_ID', 'ROUTINE_STEP_DIR', 'ROUTINE_WORK_ITEM']);
    expect(t.engine.requests[0]!.prompt).not.toMatch(/## Entry|## Previous run/);
    expect(t.runtime.store.events(first)[0]).toEqual({ type: 'run-start', at: expect.any(Number) as number, runId: first, routine: 'demo', total: 3, workItem: 42 });
    expect(readRun(t.runtime.store.runDir(first)).report).not.toMatch(/Entry|Retrigger|Previous run/);
    for (let i = 0; i < 2; i++) expect((await t.poll()).started).toEqual([]);
    expect(t.devops.calls.some(c => /workitemsbatch/i.test(c.url))).toBe(false);
    expect(t.devops.writes()).toEqual([]);
    expect(t.tagsNow()).toBe('ai-fixable; ai-retest');
    expect(t.runtime.store.trigger().subjects['item:42']).toEqual({ runId: first, at: expect.any(Number) as number, title: '#42 Login fails' });
    // a second run by hand has no previous run either
    const again = await (await t.runtime.startFor({ workItem: 42 })).finished;
    expect(again.inputs).toEqual({ workItem: '42' });
    expect(again.previousRunId).toBeUndefined();
  });
});

describe('routine watch with a retrigger tag', () => {
  const sink = () => { let text = ''; return { write: (s: string) => { text += s; return true; }, get text() { return text; } }; };
  it('starts the ended item again once, from its entry, and says so', async () => {
    const devops = fakeDevOps();
    devops.addItem({ id: 42, fields: { 'System.Title': 'Login fails', 'System.State': 'New', 'System.Tags': 'ai-fixable' } });
    const dir = tempDir('routine-cli-pkg-'), runs = tempDir('routine-cli-watch-');
    fs.writeFileSync(path.join(dir, 'routine.json'), JSON.stringify(routinePackage({ trigger: { ...TRIGGER, retriggerTags: ['ai-retest'] }, entries: ENTRIES })));
    const watch = async () => {
      const stdout = sink(), stderr = sink(), engine = scriptedEngine(r => done(`did ${r.stepId}`));
      const code = await main(['watch', dir, '--runs-dir', runs], { stdout, stderr, env: {}, engine: () => engine, mcp: () => undefined, repaintMs: 10_000, locksDir: tempDir(),
        onInterrupt: () => () => undefined, devops: { authorization: devops.authorization, request: devops.request, detect }, sleep: async () => undefined, maxPolls: 1 });
      return { code, out: stdout.text, err: stderr.text, steps: engine.requests.map(r => r.stepId) };
    };
    const first = await watch();
    expect(first).toMatchObject({ code: 0, steps: ['analyse', 'fix', 'report'] });
    expect(first.out).toMatch(/Work item 42: run \S+ started, entry default/);
    expect((await watch()).steps).toEqual([]);
    devops.items.get(42)!.fields['System.Tags'] = 'ai-fixable; ai-retest';
    const second = await watch();
    expect(second).toMatchObject({ code: 0, steps: ['report'] });
    expect(second.out).toMatch(/Work item 42: run \S+ started again after run \S+ \(retrigger tag\), entry retest/);
    expect(devops.items.get(42)!.fields['System.Tags']).toBe('ai-fixable');
    expect((await watch()).steps).toEqual([]);
    expect(fs.readdirSync(path.join(runs, 'demo')).filter(d => d !== 'trigger.json' && !d.endsWith('.json'))).toHaveLength(2);
  });
});
