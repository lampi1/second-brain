// chunked-json.ts: per-item JSON in slices gives the same text as one JSON.stringify, and lets the event loop run.
import { expect, it } from 'vitest';
import { jsonArray, stringifyEach } from '../../src/main/chunked-json';

it('joins to the same text as JSON.stringify of the array, undefined items included', async () => {
  const items = [{ a: 1, b: [1, 'x'] }, 'two', 3, null, undefined, { nested: { s: 'é"\n' } }];
  expect(jsonArray(await stringifyEach(items))).toBe(JSON.stringify(items));
  expect(jsonArray(await stringifyEach([]))).toBe('[]');
});

it('yields to the event loop between slices', async () => {
  const items = Array.from({ length: 3000 }, (_, i) => ({ i, text: 'x'.repeat(2000) }));
  let ticks = 0;
  const tick = (): void => { ticks++; if (!done) setImmediate(tick); };
  let done = false;
  setImmediate(tick);
  const parts = await stringifyEach(items, 0);
  done = true;
  expect(parts).toHaveLength(items.length);
  expect(ticks).toBeGreaterThan(1);
});
