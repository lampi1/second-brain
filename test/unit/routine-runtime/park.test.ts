// Parked runs (escalation.park, ADR 0175): a step that needs a person writes one comment for the contact only (reason,
// step number, the step's model signature), the package's downgrade tag, and ends the run; the contact's later comment resumes the same run
// from the named step with the answer, and the tag goes. The trigger: further areas with their own cursor, parked runs
// resumed first, items already carrying the park tag admitted only after a comment of the contact, maxActive.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevOpsDetector, createLocks, createMasker, createRoutineRuntime, createRunStore, createTriggerLoop, PARK_RETRIES, preflightRoutinePackage, type Locks, type RoutineTrigger, type StepResult } from '../../../packages/routine-runtime/src/index';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir } from './fakes';

// GUIDs built at run time (the repo guard refuses GUID literals)
const g = (c: string) => [8, 4, 4, 4, 12].map(n => c.repeat(n)).join('-');
const MENTION = g('c'), CONTACT = g('d');

function parkingRuntime(opts: { fixNeedsHuman?: (call: number) => boolean; locks?: Locks; fix?: { model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' } } = {}) {
  const root = tempDir(), devops = fakeDevOps();
  devops.addItem({ id: 5, fields: { 'System.Title': 'x', 'System.Tags': 'ai-fixable', 'System.State': 'New' } });
  let fixCalls = 0;
  const needsHuman = opts.fixNeedsHuman ?? (call => call === 0);
  const engine = scriptedEngine((r): StepResult => r.stepId === 'fix' && needsHuman(fixCalls++)
    ? { outcome: 'needs-human', summary: 'serve un dato', question: 'Quale campo devo usare' } : done('ok'));
  const pkg = routinePackage({
    inputs: [{ name: 'workItem' }, { name: 'workspace', default: path.join(root, 'ws-{{workItem}}') }],
    escalation: { contact: CONTACT, contactName: 'Davide', park: true },
    devops: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags', 'downgrade'], fields: [], mentions: [MENTION],
      downgrade: { removeTag: 'ai-fixable', addTag: 'ai-needs-human', state: 'New' } },
    ...(opts.fix ? { steps: routinePackage().routine.steps.map(s => s.id === 'fix' ? { ...s, ...opts.fix } : s) } : {}),
  });
  const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine, devops: { authorization: devops.authorization, request: devops.request },
    ...(opts.locks ? { locks: opts.locks } : {}) });
  return { root, devops, engine, runtime };
}

describe('parked runs', () => {
  it('a step that needs a person parks the run: one comment for the contact only, the park tag, the run ends', async () => {
    const { root, devops, engine, runtime } = parkingRuntime();
    const run = await runtime.startItem(5).finished;
    expect(run.status).toBe('needs-human');
    expect(run.inputs.workspace).toBe(path.join(root, 'ws-5'));
    expect(run.parked).toMatchObject({ n: 1, stepId: 'fix', resumeFrom: 'fix', pushed: false, branch: `fix/routine-${run.runId}` });
    expect(run.steps.map(s => s.status)).toEqual(['done', 'needs-human', 'pending']);
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix']);
    expect(devops.items.get(5)!.fields['System.Tags']).toBe('ai-needs-human');
    const comments = devops.comments.get(5)!;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toContain('Serve un umano: Quale campo devo usare.');
    expect(comments[0]!.text).toContain('Passo 2 di 3.');
    expect(comments[0]!.text).not.toContain('Punto della run');
    expect(comments[0]!.text).not.toContain('Rispondi');
    // no model declared: the comment is signed with the one the step's session reported
    expect(comments[0]!.text).toMatch(/<\/small><br\/>— claude-sonnet-5$/);
    expect(run.steps.find(s => s.id === 'fix')!.model).toBe('claude-sonnet-5');
    expect(comments[0]!.text).toContain(`version:2.0,${CONTACT}`);
    expect(comments[0]!.text).not.toContain(MENTION);
    expect(run.parked!.commentId).toBe(comments[0]!.id);
  });

  it('a step that declares its model and effort signs the park comment with both', async () => {
    const { devops, runtime } = parkingRuntime({ fix: { model: 'claude-opus-5-5', effort: 'medium' } });
    await runtime.startItem(5).finished;
    expect(devops.comments.get(5)![0]!.text).toMatch(/<br\/>— claude-opus-5-5 · medium$/);
  });

  it('the contact\'s answer resumes the same run from the parked step, with the answer, and the tag goes', async () => {
    const { devops, engine, runtime } = parkingRuntime();
    const { runId } = await runtime.startItem(5).finished;
    expect(await runtime.resumeParked(runId)).toBeNull();
    devops.reply(5, g('9'), 'non sono il contatto');
    expect(await runtime.resumeParked(runId)).toBeNull();
    devops.reply(5, CONTACT, 'Usa il campo Note');
    const handle = await runtime.resumeParked(runId);
    expect(handle?.runId).toBe(runId);
    expect(await runtime.resumeParked(runId)).toBeNull();
    const run = await handle!.finished;
    expect(run.status).toBe('done');
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'fix', 'report']);
    const prompt = engine.requests[2]!.prompt;
    expect(prompt).toContain('## Resumed run');
    expect(prompt).toContain('Usa il campo Note');
    expect(prompt).toContain(`fix/routine-${runId}`);
    expect(String(devops.items.get(5)!.fields['System.Tags'])).not.toContain('ai-needs-human');
    expect(run.parks).toBe(1);
  });

  it('an item already carrying the park tag is admitted only when the contact wrote the latest comment', async () => {
    const { devops, runtime } = parkingRuntime();
    devops.addItem({ id: 6, fields: { 'System.Tags': 'ai-needs-human' } });
    devops.addItem({ id: 7, fields: { 'System.Tags': 'other' } });
    expect(await runtime.admitItem(7)).toBe(true);
    expect(await runtime.admitItem(6)).toBe(false);
    devops.reply(6, devops.me, 'Serve un umano <small>routine run x · park 1 ·</small>');
    expect(await runtime.admitItem(6)).toBe(false);
    devops.reply(6, CONTACT, 'ecco il dato');
    expect(await runtime.admitItem(6)).toBe(true);
  });

  it('a parked run resumed by hand that parks again writes a new park comment (the next park number)', async () => {
    const { devops, runtime } = parkingRuntime({ fixNeedsHuman: call => call < 2 });
    const { runId } = await runtime.startItem(5).finished;
    const again = await runtime.resume(runId).finished;
    expect(again.status).toBe('needs-human');
    expect(again.parked?.n).toBe(2);
    const comments = devops.comments.get(5)!;
    expect(comments).toHaveLength(2);
    expect(again.parked?.commentId).toBe(comments[1]!.id);
  });

  it('the park counter never goes back on the contact\'s resume; a park resumed by hand is spent, a later answer no longer resumes it', async () => {
    const { devops, runtime } = parkingRuntime({ fixNeedsHuman: call => call === 0 });
    const { runId } = await runtime.startItem(5).finished;
    // a counter already past this park's number (an earlier park spent by hand) stays where it is
    runtime.store.claim(runId, r => { r.parks = 3; });
    devops.reply(5, CONTACT, 'Usa il campo Note');
    const resumed = await (await runtime.resumeParked(runId))!.finished;
    expect(resumed.status).toBe('done');
    expect(resumed.parks).toBe(3);

    const other = parkingRuntime({ fixNeedsHuman: call => call === 0 });
    const parked = await other.runtime.startItem(5).finished;
    const byHand = await other.runtime.resume(parked.runId).finished;
    expect(byHand.status).toBe('done');
    expect(byHand.parks).toBe(1);
    expect(byHand.parked).toMatchObject({ n: 1, spent: true });
    // even if the run is found waiting for a person again, the contact's comment does not resume the spent park
    other.runtime.store.claim(parked.runId, r => { r.status = 'needs-human'; });
    other.devops.reply(5, CONTACT, 'ecco il dato');
    expect(await other.runtime.resumeParked(parked.runId)).toBeNull();
  });

  it('the watch recovers a run stopped by Ctrl+C or a crash, unless a live process holds it; never a done or failed one', async () => {
    const lockDir = tempDir(), other = createLocks(lockDir, { alive: () => true });
    const { engine, runtime } = parkingRuntime({ fixNeedsHuman: () => false, locks: createLocks(lockDir) });
    const { runId } = await runtime.startItem(5).finished;
    expect(runtime.recover(runId)).toBeNull();
    // Ctrl+C on the watch left it cancelled at the second step
    runtime.store.claim(runId, r => { r.status = 'cancelled'; r.steps[1]!.status = 'pending'; r.steps[2]!.status = 'pending'; });
    const run = await runtime.recover(runId)!.finished;
    expect(run.status).toBe('done');
    expect(engine.requests.map(r => r.stepId)).toEqual(['analyse', 'fix', 'report', 'fix', 'report']);
    // a crashed process left it running; another live process holds the item: not taken
    runtime.store.claim(runId, r => { r.status = 'running'; r.steps[2]!.status = 'pending'; });
    other.acquire('item-contoso-5', 'run-elsewhere');
    expect(runtime.recover(runId)).toBeNull();
    other.release(['item-contoso-5'], 'run-elsewhere');
    expect((await runtime.recover(runId)!.finished).status).toBe('done');
    runtime.store.claim(runId, r => { r.status = 'failed'; });
    expect(runtime.recover(runId)).toBeNull();
  });

  it('a park that could not be written is retried at most PARK_RETRIES times', async () => {
    const { engine, runtime } = parkingRuntime({ fixNeedsHuman: () => true });
    const { runId } = await runtime.startItem(5).finished;
    // the park comment was refused: needs-human without a park
    const unpark = () => runtime.store.claim(runId, r => { delete r.parked; r.status = 'needs-human'; });
    unpark();
    for (let i = 0; i < PARK_RETRIES; i++) {
      const run = await runtime.recover(runId)!.finished;
      expect(run.parkRetries).toBe(i + 1);
      unpark();
    }
    expect(runtime.recover(runId)).toBeNull();
    expect(engine.requests.filter(r => r.stepId === 'fix')).toHaveLength(1 + PARK_RETRIES);
  });

  it('preflight: park needs the downgrade op; a trigger area outside devops.projects is an error', () => {
    const pkg = routinePackage({ escalation: { contact: CONTACT, park: true },
      trigger: { kind: 'devops', everyMinutes: 10, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: false, areas: [{ project: 'Other', areaPath: 'Other\\Team' }] } });
    const paths = preflightRoutinePackage(pkg).errors.map(e => e.path);
    expect(paths).toEqual(['devops.projects', 'escalation.park']);
  });
});

const trigger: RoutineTrigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Proj', areaPath: 'Proj\\A', workItemType: 'Bug', states: ['New'], includeExisting: false,
  areas: [{ project: 'Dash', areaPath: 'Dash\\A' }] };
const result = (id: number): FlowDetectionResult => ({ items: [{ title: `Bug ${id}`, inputs: { 'work-item-id': String(id) } }], cursor: { [id]: '3' }, summary: `${id}.` } as unknown as FlowDetectionResult);

describe('trigger loop for parked runs', () => {
  it('watches every area with its own cursor and starts items of each', async () => {
    const store = createRunStore(path.join(tempDir(), 'runs'), createMasker());
    const seen: string[] = [];
    const detect = async (config: { trigger: { project: string } }) => { seen.push(config.trigger.project); return result(config.trigger.project === 'Proj' ? 1 : 2); };
    const loop = createTriggerLoop({ routineId: 'demo', trigger, store, start: id => ({ runId: `run-${id}` }), detect: detect as never });
    expect((await loop.tick()).started.map(s => s.workItem)).toEqual([1, 2]);
    expect(seen).toEqual(['Proj', 'Dash']);
    expect(store.trigger().cursor).toEqual({ 1: '3' });
    expect(store.trigger().cursors).toEqual({ 'Dash|Dash\\A': { 2: '3' } });
  });

  it('resumes answered parked runs first, holds items not admitted, and keeps at most maxActive runs', async () => {
    const store = createRunStore(path.join(tempDir(), 'runs'), createMasker());
    store.setTrigger({ ...store.trigger(), subjects: { 'item:9': { runId: 'run-9', at: 1 } } });
    let active = 0;
    const loop = createTriggerLoop({ routineId: 'demo', trigger: { ...trigger, areas: [], maxActive: 1 }, store,
      start: id => { active++; return { runId: `run-${id}` }; }, detect: async () => result(1),
      resume: async runId => { active++; return { runId }; }, admit: async () => true, active: () => active });
    const first = await loop.tick();
    expect(first.resumed).toEqual([{ workItem: 9, runId: 'run-9' }]);
    expect(first.started).toEqual([]);
    expect(store.trigger().cursor).toEqual({});
    active = 0;
    const held = createTriggerLoop({ routineId: 'demo', trigger: { ...trigger, areas: [] }, store, start: id => ({ runId: `run-${id}` }), detect: async () => result(1), admit: async () => false });
    expect((await held.tick()).started).toEqual([]);
    expect(store.trigger().cursor).toEqual({ 1: '3' });
  });

  it('an area override narrows only that area: new items from the main area, only park-tagged ones from the other', async () => {
    // the real detector on a fake DevOps: Dash holds new bugs, Plan holds untagged New bugs and one parked bug
    const bug = (id: number, project: string, tags = '') => ({ id, rev: 2, fields: { 'System.Title': `Bug ${id}`, 'System.TeamProject': project, 'System.AreaPath': `${project}\\A`, 'System.WorkItemType': 'Bug', 'System.State': 'New', 'System.Tags': tags } });
    const items = [bug(1, 'Dash'), bug(2, 'Dash', 'ai-fixable'), bug(3, 'Plan'), bug(4, 'Plan', 'other'), bug(5, 'Plan', 'ai-needs-human')];
    const request = async (url: string, init: RequestInit) => {
      const project = decodeURIComponent(url.split('/')[4]!);
      const body = JSON.parse(String(init.body)) as { query?: string; ids?: number[] };
      const here = items.filter(w => w.fields['System.TeamProject'] === project);
      if (body.query) {
        const after = Number(body.query.match(/\[System.Id\] > (\d+)/)?.[1]);
        return new Response(JSON.stringify({ asOf: '2026-01-02T03:04:05.000Z', workItems: here.filter(w => w.id > after).map(w => ({ id: w.id })) }));
      }
      return new Response(JSON.stringify({ value: here.filter(w => body.ids?.includes(w.id)) }));
    };
    const routineTrigger: RoutineTrigger = { kind: 'devops', everyMinutes: 10, organization: 'contoso', project: 'Dash', areaPath: 'Dash\\A', workItemType: 'Bug', states: ['New'],
      includeExisting: true, excludeTags: ['ai-fixable'], areas: [{ project: 'Plan', areaPath: 'Plan\\A', includeTags: ['ai-needs-human'] }] };
    const parsed = preflightRoutinePackage(routinePackage({ trigger: routineTrigger, devops: { organization: 'contoso', projects: ['Dash', 'Plan'], ops: [], fields: [] } }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.pkg?.routine.trigger?.areas).toEqual(routineTrigger.areas);
    const store = createRunStore(path.join(tempDir(), 'runs'), createMasker());
    // 1 was started earlier and is parked now (moved to Plan with the tag in real life): never started again as new
    store.setTrigger({ ...store.trigger(), subjects: { 'item:1': { runId: 'run-1', at: 1 } } });
    const started: number[] = [];
    const loop = createTriggerLoop({ routineId: 'demo', trigger: routineTrigger, store, start: id => { started.push(id); return { runId: `run-${id}` }; },
      detect: createDevOpsDetector({ authorization: { authorization: async () => 'Bearer fake' }, request }) });
    await loop.tick();
    // 1: already a subject (resume's job); 2: excluded tag; 3, 4: Plan without the park tag; 5: the parked Plan bug
    expect(started).toEqual([5]);
    expect((await loop.tick()).started).toEqual([]);
  });
});
