// Parked runs (escalation.park, ADR 0175): a step that needs a person writes one comment for the contact only (step
// reached, run branch), the package's downgrade tag, and ends the run; the contact's later comment resumes the same run
// from the named step with the answer, and the tag goes. The trigger: further areas with their own cursor, parked runs
// resumed first, items already carrying the park tag admitted only after a comment of the contact, maxActive.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMasker, createRoutineRuntime, createRunStore, createTriggerLoop, preflightRoutinePackage, type RoutineTrigger, type StepResult } from '../../../packages/routine-runtime/src/index';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { done, fakeDevOps, routinePackage, scriptedEngine, tempDir } from './fakes';

// GUIDs built at run time (the repo guard refuses GUID literals)
const g = (c: string) => [8, 4, 4, 4, 12].map(n => c.repeat(n)).join('-');
const MENTION = g('c'), CONTACT = g('d');

function parkingRuntime() {
  const root = tempDir(), devops = fakeDevOps();
  devops.addItem({ id: 5, fields: { 'System.Title': 'x', 'System.Tags': 'ai-fixable', 'System.State': 'New' } });
  let fixCalls = 0;
  const engine = scriptedEngine((r): StepResult => r.stepId === 'fix' && fixCalls++ === 0
    ? { outcome: 'needs-human', summary: 'serve un dato', question: 'Quale campo devo usare' } : done('ok'));
  const pkg = routinePackage({
    inputs: [{ name: 'workItem' }, { name: 'workspace', default: path.join(root, 'ws-{{workItem}}') }],
    escalation: { contact: CONTACT, contactName: 'Davide', park: true },
    devops: { organization: 'contoso', projects: ['Proj'], ops: ['comment', 'state', 'fields', 'tags', 'downgrade'], fields: [], mentions: [MENTION],
      downgrade: { removeTag: 'ai-fixable', addTag: 'ai-needs-human', state: 'New' } },
  });
  const runtime = createRoutineRuntime({ pkg, paths: { runsRoot: path.join(root, 'runs'), workspace: id => path.join(root, 'ws', id) }, engine, devops: { authorization: devops.authorization, request: devops.request } });
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
    expect(comments[0]!.text).toContain('Serve il tuo aiuto: Quale campo devo usare.');
    expect(comments[0]!.text).toContain('Punto della run: passaggio «Fix» (passo 2 di 3).');
    expect(comments[0]!.text).toContain('dal passaggio «Fix», sullo stesso branch, e toglie il tag ai-needs-human');
    expect(comments[0]!.text).toContain(`version:2.0,${CONTACT}`);
    expect(comments[0]!.text).not.toContain(MENTION);
    expect(run.parked!.commentId).toBe(comments[0]!.id);
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
    devops.reply(6, devops.me, 'Serve il tuo aiuto <small>routine run x · park 1 ·</small>');
    expect(await runtime.admitItem(6)).toBe(false);
    devops.reply(6, CONTACT, 'ecco il dato');
    expect(await runtime.admitItem(6)).toBe(true);
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
});
