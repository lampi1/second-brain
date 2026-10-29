// Read-only worker entry bundled beside main. Receives explicit requests only, with no scheduler or routine imports.
import { parentPort } from 'node:worker_threads';
import { runsOf, withRuns, type ReadMessage } from './read-protocol';
import type { AgentRun } from '../shared/agents';
import { readBrainView } from './brainmodel/view';
import { estimatesState } from './agents/run-estimates';
import type { IntervalCache } from './brainmodel/evidence';
const intervals: IntervalCache = new Map();
/** the runs last sent with a key (read-work.ts): a `cached` request reads these */
let runs: { key: string; list: AgentRun[] } | null = null;
parentPort!.on('message', ({ id, request, runsKey, cached }: ReadMessage) => {
  try {
    if (cached) {
      // the main process forgets what it sent when this fails: the next read sends the runs again (read-work.ts)
      if (!runs || runs.key !== runsKey) throw new Error('Read worker runs out of date');
      request = withRuns(request, runs.list);
    } else if (runsKey !== undefined) runs = { key: runsKey, list: runsOf(request) };
    const value = request.op === 'brain' ? readBrainView(request.input, undefined, intervals)
      : estimatesState(request.runs, request.runIds, request.now);
    parentPort!.postMessage({ id, value });
  } catch (e) { parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) }); }
});
