// JSON of a long list without one long main-process step: each item is serialized on its own and the loop yields to
// the event loop (setImmediate) every few milliseconds, so input, frames and IPC go on between slices. Why: the agent
// runs (up to 5000, ~7 MB) froze the window 100-400 ms each time they were serialized for agent-runs.json or copied to
// the read worker in one go (#293-#297). Used by agents/runs.ts (deferred save) and read-work.ts (runs for the worker).

/** How long one slice may run before it yields (well under perf.ts STALL_MS). */
export const SLICE_MS = 8;

const yieldNow = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** Every item's JSON.stringify, in order, computed in slices of about `sliceMs`. Each item is serialized whole within
 *  one slice; an item changed between slices is taken as it is when its turn comes. */
export async function stringifyEach(items: readonly unknown[], sliceMs = SLICE_MS): Promise<string[]> {
  const out = new Array<string>(items.length);
  let start = performance.now();
  for (let i = 0; i < items.length; i++) {
    out[i] = JSON.stringify(items[i]) ?? 'null';
    if (performance.now() - start >= sliceMs && i < items.length - 1) { await yieldNow(); start = performance.now(); }
  }
  return out;
}

/** The JSON array of already serialized items: the same text JSON.stringify(array) gives. */
export const jsonArray = (parts: readonly string[]): string => `[${parts.join(',')}]`;
