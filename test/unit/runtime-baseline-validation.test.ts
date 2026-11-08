// Exercises the baseline driver's actual replay rejection predicate without launching Electron or a model.
// Report extras use the string-valued shape emitted by replay-engine, including an empty shape.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('rejects string-valued extra replay traffic after completed fixtures', () => {
  const source = readFileSync('scripts/runtime-baseline.mjs', 'utf8');
  const predicate = source.match(/if \((report\.some[^\n]+)\)/)?.[1];
  expect(predicate).toBeDefined();
  const completed = [{ done: true }, { done: true }, { done: true }];
  const rejects = (report: object[]) => runInNewContext(predicate!, { report, sessions: 1 });
  expect(rejects(completed)).toBe(false);
  for (const extra of ['user', 'session/prompt/request', '']) {
    expect(rejects([...completed, { extra }])).toBe(true);
  }
  expect(rejects([...completed, { diverged: 0 }])).toBe(true);
  expect(rejects(completed.slice(1))).toBe(true);
});
