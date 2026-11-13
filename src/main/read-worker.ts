// Read-only worker entry bundled beside main. Receives explicit requests only, with no scheduler or routine imports.
import { parentPort } from 'node:worker_threads';
import { runsOf, withRuns, type ReadMessage, type ReadRequest } from './read-protocol';
import type { AgentRun } from '../shared/agents';
import { readBrainView } from './brainmodel/view';
import { estimatesState } from './agents/run-estimates';
import type { IntervalCache } from './brainmodel/evidence';
const intervals: IntervalCache = new Map();
/** per kind of read, the runs last sent with a key (read-work.ts): a `cached` request of that kind reads these */
const runs = new Map<ReadRequest['op'], { key: string; list: AgentRun[] }>();
parentPort!.on('message', ({ id, request, runsKey, runsJson, cached }: ReadMessage) => {
  const op = request.op;
  try {
    if (cached) {
      // the main process forgets what it sent when this fails: the next read sends the runs again (read-work.ts)
      const held = runs.get(op);
      if (!held || held.key !== runsKey) throw new Error('Read worker runs out of date');
      request = withRuns(request, held.list);
    } else if (runsKey !== undefined) {
      if (runsJson !== undefined) request = withRuns(request, JSON.parse(runsJson) as AgentRun[]);
      runs.set(op, { key: runsKey, list: runsOf(request) });
    }
    const value = request.op === 'brain' ? readBrainView(request.input, undefined, intervals)
      : estimatesState(request.runs, request.runIds, request.now);
    parentPort!.postMessage({ id, op, value });
  } catch (e) { runs.delete(op); parentPort!.postMessage({ id, op, error: e instanceof Error ? e.message : String(e) }); }
});
