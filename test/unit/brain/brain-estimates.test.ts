// The brain's own table (src/main/brain/brain-estimates.ts): the refresh that runs the brain's estimates.mjs (a fake one here) once per
// burst of turns. ADR 0053 removed the per-job cost/time estimate this file used to compute for the UI.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BrainEstimates, REFRESH_DELAY, type BrainTable } from '../../../src/main/brain/brain-estimates';
import { areaOf } from '../../../src/main/brain/routing';
import { plainNode, tmpDir, until } from './helpers';

const g = (n: number, mid: number) => ({ n, min: { low: mid / 2, mid, high: mid * 2 }, usd: { low: 1, mid: 2, high: 4 } });
const table = (order: string[]): BrainTable => ({
  updated: '2026-10-13T10:00:00Z',
  best: { name: 'x', order, errMin: 70, errUsd: 15, tested: 120 },
  groups: { 'area+tipo:Alfa|fix': g(9, 85), 'tipo:fix': g(18, 79), 'area:Alfa': g(12, 70), tutte: g(222, 45) },
});

describe('brain estimates table', () => {
  it('a title label is its area, unless it names a kind of work (ADR 0186: the one taxonomy, no brain rules)', () => {
    expect(areaOf('App · Fix preventivi')).toBe('App');
    expect(areaOf('Pers · App: memoria')).toBe('Pers · App');
    expect(areaOf('Orchestrator')).toBe('Orchestrator');
    expect(areaOf('Alfa · Fix preventivi')).toBe('Alfa');
    expect(areaOf('Fix · preventivi')).toBe('altro');
    expect(areaOf('Brief mattino')).toBe('altro');
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
    expect(new BrainEstimates(() => null, plainNode).table()).toBeNull();
    const d = brain();
    const b = new BrainEstimates(() => d, plainNode);
    expect(b.table()).toBeNull();
    fs.writeFileSync(path.join(d, 'ops', 'state', 'estimates.json'), JSON.stringify(table(['tutte'])));
    expect(b.table()?.groups.tutte?.min.mid).toBe(45);
    fs.writeFileSync(path.join(d, 'ops', 'state', 'estimates.json'), '{ broken');
    fs.utimesSync(path.join(d, 'ops', 'state', 'estimates.json'), new Date(), new Date(Date.now() + 5000));
    expect(b.table()).toBeNull();
  });

  it('refresh runs estimates.mjs --update; a burst of turns schedules one run', async () => {
    const d = brain();
    const b = new BrainEstimates(() => d, plainNode);
    expect(await b.refresh()).toBe(true);
    expect(fs.readFileSync(path.join(d, 'ops', 'state', 'runs.txt'), 'utf8')).toBe('--update\n');
    expect(b.table()?.groups.tutte?.n).toBe(222);
    vi.useFakeTimers();
    b.schedule(); b.schedule(); b.schedule();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(REFRESH_DELAY);
    vi.useRealTimers();
    // the first run was just now: the scheduled one waits the 5-minute gap, never runs twice in a burst
    expect(await until(() => fs.readFileSync(path.join(d, 'ops', 'state', 'runs.txt'), 'utf8').split('\n').length > 2, 300)).toBe(false);
    b.stop();
  });

  it('without the brain script nothing is scheduled', () => {
    const b = new BrainEstimates(() => tmpDir(), plainNode);
    vi.useFakeTimers();
    b.schedule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
