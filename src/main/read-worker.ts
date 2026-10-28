// Read-only worker entry bundled beside main. Receives explicit requests only, with no scheduler or routine imports.
import { parentPort } from 'node:worker_threads';
import type { ReadRequest } from './read-work';
import { readBrainView } from './brainmodel/view';
import { estimatesState } from './agents/run-estimates';
import type { IntervalCache } from './brainmodel/evidence';
const intervals: IntervalCache = new Map();
parentPort!.on('message', ({ id, request }: { id: number; request: ReadRequest }) => {
  try {
    const value = request.op === 'brain' ? readBrainView(request.input, undefined, intervals)
      : estimatesState(request.runs, request.runIds, request.now);
    parentPort!.postMessage({ id, value });
  } catch (e) { parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) }); }
});
