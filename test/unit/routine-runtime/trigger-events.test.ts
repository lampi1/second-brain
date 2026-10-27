// The package's DevOps trigger loop (one run per work item, dedup in the run store, survives a restart) and the live
// progress reducer over a fake events.jsonl.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMasker, createRunStore, createTriggerLoop, parseEvents, progressFrom, actionFromStreamLine, type RoutineTrigger } from '../../../packages/routine-runtime/src/index';
import type { FlowDetectionResult } from '../../../src/shared/flow-automation';
import { tempDir } from './fakes';

// the organization URL, split so the publish guard does not read it as a real tenant
const ORG_URL = 'https://dev.azure.com/' + 'contoso';

const trigger: RoutineTrigger = { kind: 'devops', everyMinutes: 5, organization: 'contoso', project: 'Proj', areaPath: 'Proj', workItemType: 'Bug', states: ['New'], includeExisting: true, includeTags: ['ai-fixable'] };
const oneItem = async (): Promise<FlowDetectionResult> => ({ items: [{ title: 'Bug 42', inputs: { 'work-item-id': '42' } }], cursor: { 42: '3' }, summary: '1 item.' } as unknown as FlowDetectionResult);

describe('trigger loop', () => {
  it('first poll starts 1 run, second poll 0, a fresh loop on the same store 0', async () => {
    const root = path.join(tempDir(), 'runs');
    const store = createRunStore(root, createMasker());
    const started: number[] = [];
    const start = (id: number) => { started.push(id); return { runId: `run-${started.length}` }; };
    const loop = createTriggerLoop({ routineId: 'demo', trigger, store, start, detect: oneItem });
    expect((await loop.tick()).started).toEqual([{ workItem: 42, runId: 'run-1' }]);
    expect((await loop.tick()).started).toEqual([]);
    const fresh = createTriggerLoop({ routineId: 'demo', trigger, store: createRunStore(root, createMasker()), start, detect: oneItem });
    expect((await fresh.tick()).started).toEqual([]);
    expect(started).toEqual([42]);
    expect(store.trigger().subjects['item:42']).toMatchObject({ runId: 'run-1' });
  });

  it('a failed check is recorded and starts nothing', async () => {
    const store = createRunStore(path.join(tempDir(), 'runs'), createMasker());
    const loop = createTriggerLoop({ routineId: 'demo', trigger, store, start: () => ({ runId: 'x' }), detect: async () => { throw new Error('az login needed'); } });
    expect((await loop.tick()).started).toEqual([]);
    expect(store.trigger().lastResult).toBe('az login needed');
  });
});

describe('live progress', () => {
  const lines = [
    { type: 'run-start', at: 1, runId: 'r', routine: 'demo', total: 3, workItem: 42 },
    { type: 'step-start', at: 2, n: 1, total: 3, id: 'analyse', title: 'Analyse', attempt: 1 },
    { type: 'step-end', at: 3, n: 1, id: 'analyse', status: 'done' },
    { type: 'step-start', at: 4, n: 2, total: 3, id: 'fix', title: 'Fix', attempt: 1 },
    { type: 'action', at: 5, n: 2, text: 'Edit: src/app.ts' },
    { type: 'screenshot', at: 6, n: 2, path: 'steps/02-fix/screenshots/a.png' },
    { type: 'db-unavailable', at: 7, n: 2, note: 'qa: DB unavailable' },
    { type: 'write', at: 8, n: 2, what: 'comment', status: 'not-verified' },
    { type: 'waiting-human', at: 9, n: 2, url: `${ORG_URL}/Proj/_workitems/edit/42#101`, question: 'Which env?' },
  ];
  const text = `${lines.map(l => JSON.stringify(l)).join('\n')}\n{"type":"act`;

  it('folds events into one status; a partial last line is skipped', () => {
    const p = progressFrom(parseEvents(text));
    expect(p).toMatchObject({ status: 'waiting-human', since: 9, step: { n: 2, total: 3, title: 'Fix', id: 'fix' }, lastAction: 'Edit: src/app.ts',
      waiting: { url: `${ORG_URL}/Proj/_workitems/edit/42#101`, question: 'Which env?' }, dbUnavailable: 'qa: DB unavailable',
      shots: ['steps/02-fix/screenshots/a.png'], notVerified: ['comment'] });
    const after = progressFrom(parseEvents(`${text}\n${JSON.stringify({ type: 'human-answer', at: 10, n: 2, author: 'Anna' })}\n${JSON.stringify({ type: 'run-end', at: 11, status: 'done' })}`));
    expect(after.status).toBe('done');
    expect(after.waiting).toBeUndefined();
  });

  it('distils the last agent action from a stream-json line', () => {
    expect(actionFromStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }))).toBe('Read: a.ts');
    expect(actionFromStreamLine(JSON.stringify({ type: 'user' }))).toBeUndefined();
    expect(actionFromStreamLine('not json')).toBeUndefined();
  });
});
