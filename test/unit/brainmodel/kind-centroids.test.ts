// The kind of work by examples (ADR 0197): the pure nearest-centroid classifier (src/main/brainmodel/kind-centroids.ts)
// on synthetic unit vectors (split by run id, centroids only from kinds with enough examples, the «altro» threshold
// calibrated apart from the test, the confusion matrix), and the service (kind-model.ts): the word rule's labels on
// verified runs only, no model → no card numbers, embeddings cached by run id, the word rule as fallback.
import { describe, expect, it } from 'vitest';
import { ALTRO, MIN_PER_KIND, bucketOf, calibrate, centroids, evaluate, nearest, partOf, predict, trainAndTest, type Example } from '../../../src/main/brainmodel/kind-centroids';
import { KindModel, labelled } from '../../../src/main/brainmodel/kind-model';
import type { AgentRun } from '../../../src/shared/agents';

const unit = (...xs: number[]) => { const v = Float32Array.from(xs); const n = Math.hypot(...xs); return v.map(x => x / n); };
// deterministic jitter around an axis
const near = (axis: number, i: number) => { const v = [0.05 * Math.sin(i), 0.05 * Math.cos(i), 0.05 * Math.sin(2 * i), 0.05 * Math.cos(3 * i)]; v[axis] = 1; return unit(...v); };
const ex = (id: string, kind: string, vec: Float32Array): Example => ({ id, kind, vec });

describe('kind-centroids', () => {
  it('splits by run id, stably, about 20/20/60', () => {
    expect(bucketOf('r_000000000001')).toBe(bucketOf('r_000000000001'));
    const parts = Array.from({ length: 2000 }, (_, i) => partOf(`r_${i}`));
    const share = (p: string) => parts.filter(x => x === p).length / parts.length;
    expect(share('test')).toBeGreaterThan(0.15); expect(share('test')).toBeLessThan(0.25);
    expect(share('train')).toBeGreaterThan(0.53); expect(share('train')).toBeLessThan(0.67);
  });

  it('a centroid only for kinds with MIN_PER_KIND examples, never for «altro»', () => {
    const xs = [...Array.from({ length: MIN_PER_KIND }, (_, i) => ex(`a${i}`, 'bug-fix', near(0, i))), ...Array.from({ length: MIN_PER_KIND - 1 }, (_, i) => ex(`b${i}`, 'review', near(1, i))),
      ...Array.from({ length: 9 }, (_, i) => ex(`c${i}`, ALTRO, near(2, i)))];
    expect([...centroids(xs).keys()]).toEqual(['bug-fix']);
    expect(nearest(near(0, 99), centroids(xs))!.kind).toBe('bug-fix');
  });

  it('calibrates the threshold so far-away requests are «altro»', () => {
    const cs = centroids([...Array.from({ length: 6 }, (_, i) => ex(`a${i}`, 'bug-fix', near(0, i))), ...Array.from({ length: 6 }, (_, i) => ex(`b${i}`, 'review', near(1, i)))]);
    const cal = [ex('x1', 'bug-fix', near(0, 50)), ex('x2', 'review', near(1, 51)), ex('x3', ALTRO, near(2, 52)), ex('x4', ALTRO, near(3, 53))];
    const th = calibrate(cal, cs)!;
    expect(th).toBeGreaterThan(0.2);
    expect(predict(near(2, 60), cs, th)).toBe(ALTRO);
    expect(predict(near(0, 61), cs, th)).toBe('bug-fix');
  });

  it('the confusion matrix: rows the label (a kind with no centroid is «altro»), columns the prediction', () => {
    const cs = centroids([...Array.from({ length: 5 }, (_, i) => ex(`a${i}`, 'bug-fix', near(0, i))), ...Array.from({ length: 5 }, (_, i) => ex(`b${i}`, 'review', near(1, i)))]);
    const e = evaluate([ex('t1', 'bug-fix', near(0, 70)), ex('t2', 'review', near(0, 71)), ex('t3', ALTRO, near(1, 72)), ex('t4', 'writing', near(2, 73))], cs, 0.5);
    expect(e.labels).toEqual(['bug-fix', 'review', ALTRO]);
    expect(e.matrix).toEqual([[1, 0, 0], [1, 0, 0], [0, 1, 1]]);
    expect(e).toMatchObject({ n: 4, agree: 2, altroProposed: { n: 1, of: 1 } });
  });

  it('trains and tests end to end; null with one kind', () => {
    const xs = [...Array.from({ length: 40 }, (_, i) => ex(`r_a${i}`, 'bug-fix', near(0, i))), ...Array.from({ length: 40 }, (_, i) => ex(`r_b${i}`, 'review', near(1, i))),
      ...Array.from({ length: 20 }, (_, i) => ex(`r_c${i}`, ALTRO, near(2, i)))];
    const r = trainAndTest(xs)!;
    expect(r.test.n).toBeGreaterThan(5);
    expect(r.test.agree / r.test.n).toBeGreaterThan(0.9);
    expect(trainAndTest(xs.filter(x => x.kind !== 'review'))).toBeNull();
  });
});

const NOW = Date.UTC(2026, 9, 29, 12);
let seq = 0;
const run = (goal: string, over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${String(++seq).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: 'artisan', version: 1, goal,
  startedBy: 'user', startedAt: NOW - 7200_000 + seq, endedAt: NOW - 3600_000 + seq, endReason: 'completed', outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' },
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.1, tokens: null, ...over });

describe('KindModel', () => {
  // a fake embedder: fix words → axis 0, review words → axis 1, anything else → axis 2
  const axis = (t: string) => (/correggi|bug|fix/i.test(t) ? 0 : /rivedi|review/i.test(t) ? 1 : 2);
  const runs = [...Array.from({ length: 30 }, (_, i) => run(`Correggi il bug ${i} del login`)), ...Array.from({ length: 30 }, (_, i) => run(`Rivedi la PR ${i}`)),
    ...Array.from({ length: 10 }, (_, i) => run(`Che tempo fa a Roma ${i}`)), run('Correggi il bug non verificato', { outcome: undefined })];

  it('learns only from runs with a verified outcome, labelled by the word rule', () => {
    const xs = labelled(runs);
    expect(xs).toHaveLength(70);
    expect(new Set(xs.map(x => x.kind))).toEqual(new Set(['bug-fix', 'review', 'altro']));
  });

  it('no local model: says so, no numbers; then trains, tests and classifies; embeddings cached by run id', async () => {
    let ready = false, embedded = 0;
    const m = new KindModel({ runs: () => runs, ready: () => ready, pause: async () => {},
      embed: async texts => { embedded += texts.length; return texts.map((t, i) => near(axis(t), i)); } });
    expect(await m.state()).toMatchObject({ state: 'no-model', examples: 70, test: null });
    expect((await m.classify('Correggi il crash')).by).toBe('words');
    ready = true;
    const card = await m.state(true);
    expect(card.state).toBe('ready');
    expect(card.kinds).toEqual(['bug-fix', 'review']);
    expect(card.test!.agree / card.test!.n).toBeGreaterThan(0.9);
    expect(embedded).toBe(70);
    expect(await m.classify('Please fix the export')).toEqual({ kind: 'bug-fix', by: 'examples' });
    expect((await m.classify('Che ore sono')).kind).toBe('altro');
    await m.state(true);
    expect(embedded).toBe(70 + 2); // only the two classify calls: the examples came from the cache
  });
});
