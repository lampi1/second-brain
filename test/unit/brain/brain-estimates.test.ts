// The brain's estimates table (src/main/brain/brain-estimates.ts): title → area and kind with the table's own rules,
// the grouping that measured best, the measured error carried to the chat, the app ledger kept without a table, and the
// refresh that runs the brain's estimates.mjs (a fake one here) once per burst of turns.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BrainEstimates, REFRESH_DELAY, areaOf, kindOf, lookup, predictionLine, withBrain, type BrainTable } from '../../../src/main/brain/brain-estimates';
import type { EstimateResult } from '../../../src/shared/contract';
import { plainNode, tmpDir, until } from './helpers';

const g = (n: number, mid: number) => ({ n, min: { low: mid / 2, mid, high: mid * 2 }, usd: { low: 1, mid: 2, high: 4 } });
const table = (order: string[]): BrainTable => ({
  updated: '2026-10-13T10:00:00Z',
  best: { name: 'x', order, errMin: 70, errUsd: 15, tested: 120 },
  groups: { 'area+tipo:Alfa|fix': g(9, 85), 'tipo:fix': g(18, 79), 'area:Alfa': g(12, 70), tutte: g(222, 45) },
  kinds: [['qa', '\\b(qa|retest)\\b', 'i'], ['fix', '\\b(fix\\w*|bug\\w*)\\b', 'i']],
});
const ledgerResult: EstimateResult = { kind: 'fix', estimate: { usdLow: 1, usdHigh: 3, minLow: null, minHigh: null }, basis: { count: 7, scope: 'kind', label: 'da 7 lavori simili' } };

describe('brain estimates table', () => {
  it('types a title like the brain does', () => {
    const k = table([]).kinds;
    expect(areaOf('Alfa · Fix preventivi', k)).toBe('Alfa');
    expect(areaOf('Pers · App: memoria', k)).toBe('Pers · App');
    expect(areaOf('Regia', k)).toBe('Regia');
    expect(areaOf('Brief mattino', k)).toBe('altro');
    expect(areaOf('Fix · Listino', k)).toBe('altro'); // the label names the kind, not an area
    expect(kindOf('Fix · Failed QA PR', k)).toBe('fix');
    expect(kindOf('Alfa · Fix preventivi', table([]).kinds)).toBe('fix');
    expect(kindOf('Alfa · QA San Donato', table([]).kinds)).toBe('qa');
    expect(kindOf('Alfa · Fix', [['bad', '(', '']])).toBe('altro'); // a broken rule never throws
  });

  it('follows the grouping that measured best', () => {
    expect(lookup(table(['tutte']), 'Alfa · Fix preventivi')?.min.mid).toBe(45);
    expect(lookup(table(['area+tipo', 'tipo', 'area', 'tutte']), 'Alfa · Fix preventivi')?.min.mid).toBe(85);
    expect(lookup(table(['area+tipo', 'tipo', 'area', 'tutte']), 'Beta · Fix x')?.min.mid).toBe(79); // no AT group: kind
    expect(lookup(table(['area', 'tutte']), 'Pers · App: x')?.label).toBe('tutte le chat');
    expect(lookup(null, 'Alfa · Fix')).toBeNull();
    expect(lookup(table(['tipo', 'tutte']), 'Nuova chat')?.min.mid).toBe(45); // placeholder title: no kind
    expect(lookup({ updated: '', groups: {} }, 'Alfa · Fix')).toBeNull();
  });

  it('one estimator: the brain one, error included; "senza dati" with a table but no group; the ledger only without a table', () => {
    expect(withBrain(ledgerResult, null)).toBe(ledgerResult);
    const none = withBrain(ledgerResult, null, true);
    expect(none.estimate).toBeNull();
    expect(none.basis.label).toMatch(/stima senza dati/);
    const r = withBrain(ledgerResult, lookup(table(['tutte']), 'Alfa · Fix'));
    expect(r.estimate).toEqual({ usdLow: 1, usdHigh: 4, minLow: 23, minHigh: 90, from: 'brain', label: 'tutte le chat', errMin: 70, errUsd: 15, usdMid: 2, minMid: 45, cover: 0.5, held: null,
      pred: { policy: 'x', version: '2026-10-13T10:00:00Z', min: { low: 22.5, mid: 45, high: 90 }, usd: { low: 1, mid: 2, high: 4 } } });
    expect(r.basis.count).toBe(222);
    expect(r.kind).toBe('fix');
  });

  it('the 80% range: median × e^±q when the table is calibrated, with how often it held', () => {
    const t = { ...table(['tutte']), best: { ...table(['tutte']).best!, range80: { qMin: Math.log(2), qUsd: Math.log(3), inMin: 0.86, inUsd: 0.65, covered: 140 } } };
    const e = lookup(t, 'Alfa · Fix')!;
    expect(e.cover).toBe(0.8);
    expect(e.min.low).toBeCloseTo(22.5); expect(e.min.high).toBeCloseTo(90); expect(e.min.mid).toBe(45);
    expect(e.usd.low).toBeCloseTo(2 / 3); expect(e.usd.high).toBeCloseTo(6);
    expect(e.held).toEqual({ min: 0.86, usd: 0.65, n: 140 });
    // no calibration (q null): back to p25-p75, said as such
    const raw = lookup({ ...t, best: { ...t.best, range80: { qMin: null, qUsd: null, inMin: null, covered: 0 } } }, 'Alfa · Fix')!;
    expect(raw.cover).toBe(0.5);
    expect(raw.min.low).toBe(22.5);
    expect(raw.held).toBeNull();
  });

  it('records the prediction made before the job ran, never the prompt text', () => {
    const t = table(['area+tipo', 'tutte']);
    const est = withBrain(ledgerResult, lookup(t, 'Alfa · Fix preventivi')).estimate;
    const line = predictionLine({ id: 'claude:abc-1', at: 1000, harness: 'claude', model: 'opus', effort: 'high', title: 'Alfa · Fix preventivi', promptChars: 42, estimate: est }, t)!;
    expect(line).toMatchObject({
      id: 'claude:abc-1', at: 1000, domain: 'estimates',
      item: { harness: 'claude', model: 'opus', effort: 'high', area: 'Alfa', kind: 'fix', promptChars: 42 },
      predicted: { policy: 'x', version: t.updated, cover: 0.5, value: { min: 85, usd: 2 }, low: { min: 42.5, usd: 1 }, high: { min: 170, usd: 4 } },
    });
    expect(JSON.stringify(line)).not.toMatch(/prompt"/);
    // the label is the table the estimate was made on, even if a newer table is current at the first turn end
    const newer = { ...t, updated: '2026-10-13T11:00:00Z', best: { ...t.best!, name: 'y' } };
    expect(predictionLine({ id: 'claude:abc-1', at: 1000, harness: 'claude', model: null, effort: null, title: 'Alfa · Fix preventivi', promptChars: 1, estimate: est }, newer)?.predicted).toMatchObject({ policy: 'x', version: t.updated });
    expect(predictionLine({ id: 'claude:abc', at: 1, harness: 'claude', model: null, effort: null, title: 'x', promptChars: 1, estimate: ledgerResult.estimate }, t)).toBeNull(); // ledger estimate
    expect(predictionLine({ id: 'claude:abc', at: 1, harness: 'claude', model: null, effort: null, title: 'x', promptChars: 1, estimate: est }, null)).toBeNull(); // no table
    expect(predictionLine({ id: 'bad id', at: 1, harness: 'claude', model: null, effort: null, title: 'x', promptChars: 1, estimate: est }, t)).toBeNull();
    expect(predictionLine({ id: 'claude:abc', at: 1, harness: 'claude', model: null, effort: null, title: 'Nuova chat', promptChars: 1, estimate: est }, t)?.item).toMatchObject({ area: 'altro', kind: 'altro' });
  });
});

describe('BrainEstimates', () => {
  afterEach(() => { vi.useRealTimers(); });

  const brain = () => {
    const d = tmpDir();
    fs.mkdirSync(path.join(d, 'ops', 'tools'), { recursive: true });
    fs.mkdirSync(path.join(d, 'ops', 'state'), { recursive: true });
    // a fake estimates.mjs: counts its runs and writes a table
    fs.writeFileSync(path.join(d, 'ops', 'tools', 'estimates.mjs'), [
      "import fs from 'node:fs';",
      "const f = new URL('../state/runs.txt', import.meta.url);",
      "fs.appendFileSync(f, process.argv.slice(2).join(' ') + '\\n');",
      `fs.writeFileSync(new URL('../state/estimates.json', import.meta.url), ${JSON.stringify(JSON.stringify(table(['tutte'])))});`,
    ].join('\n'));
    return d;
  };

  it('reads the table, re-reading only when it changes; none without a brain', () => {
    expect(new BrainEstimates(() => null, plainNode).estimate('Alfa · Fix')).toBeNull();
    const d = brain();
    const b = new BrainEstimates(() => d, plainNode);
    expect(b.estimate('Alfa · Fix')).toBeNull();
    fs.writeFileSync(path.join(d, 'ops', 'state', 'estimates.json'), JSON.stringify(table(['tutte'])));
    expect(b.estimate('Alfa · Fix')?.min.mid).toBe(45);
    expect(b.estimate(undefined)).toBeNull();
    fs.writeFileSync(path.join(d, 'ops', 'state', 'estimates.json'), '{ broken');
    fs.utimesSync(path.join(d, 'ops', 'state', 'estimates.json'), new Date(), new Date(Date.now() + 5000));
    expect(b.estimate('Alfa · Fix')).toBeNull();
  });

  it('refresh runs estimates.mjs --update; a burst of turns schedules one run', async () => {
    const d = brain();
    const b = new BrainEstimates(() => d, plainNode);
    expect(await b.refresh()).toBe(true);
    expect(fs.readFileSync(path.join(d, 'ops', 'state', 'runs.txt'), 'utf8')).toBe('--update\n');
    expect(b.estimate('Alfa · Fix')?.n).toBe(222);
    vi.useFakeTimers();
    b.schedule(); b.schedule(); b.schedule();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(REFRESH_DELAY);
    vi.useRealTimers();
    // the first run was just now: the scheduled one waits the 5-minute gap, never runs twice in a burst
    expect(await until(() => fs.readFileSync(path.join(d, 'ops', 'state', 'runs.txt'), 'utf8').split('\n').length > 2, 300)).toBe(false);
    b.stop();
  });

  it("appends the prediction to the brain's outcomes.jsonl", () => {
    const d = brain();
    const b = new BrainEstimates(() => d, plainNode);
    const p = { id: 'cursor:s1', at: 5, harness: 'cursor' as const, model: null, effort: null, title: 'Alfa · Fix', promptChars: 3, estimate: null };
    expect(b.recordPrediction(p)).toBe(false); // no table yet
    fs.writeFileSync(path.join(d, 'ops', 'state', 'estimates.json'), JSON.stringify(table(['tutte'])));
    const est = withBrain(ledgerResult, b.estimate('Alfa · Fix')).estimate;
    expect(b.recordPrediction({ ...p, estimate: est })).toBe(true);
    const lines = fs.readFileSync(path.join(d, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'cursor:s1', at: 5, domain: 'estimates', predicted: { value: { min: 45, usd: 2 } } });
  });

  it('without the brain script nothing is scheduled', () => {
    const b = new BrainEstimates(() => tmpDir(), plainNode);
    vi.useFakeTimers();
    b.schedule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
