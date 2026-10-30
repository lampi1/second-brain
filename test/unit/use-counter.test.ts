// The usage counter (ADR 0202, src/main/use-counter.ts): batches are checked, summed per local day and key in app.db,
// kept 90 days, reported for the last 14 days the busiest first, and summarised for the Orchestrator; without a database
// it counts in memory; the demo starts from two fake weeks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAppDbs } from '../../src/main/app-db';
import { KEEP_DAYS, MAX_KEYS, MAX_N, UseCounter, cleanCounts, demoUseCounts, localDay } from '../../src/main/use-counter';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-use-')); dirs.push(d); return d; };
afterEach(() => { closeAppDbs(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const DAY = 864e5;
const NOON = new Date(2026, 9, 30, 12).getTime();

describe('the batch', () => {
  it('keeps known key shapes and whole counts only, bounded', () => {
    const c = cleanCounts({ counts: { 'page:costi': 2, 'page:andamento/uso': 1.7, 'action:discuss': 1, 'action:Bad Name': 1, 'other:x': 1, 'page:x': 0, 'page:y': -3, 'page:z': 'x', 'page:big': 1e9 } });
    expect([...c]).toEqual([['page:costi', 2], ['page:andamento/uso', 1], ['action:discuss', 1], ['page:big', MAX_N]]);
    expect(cleanCounts(null).size).toBe(0);
    expect(cleanCounts({ counts: 'x' }).size).toBe(0);
    const many = Object.fromEntries(Array.from({ length: MAX_KEYS + 50 }, (_, i) => [`page:p${i}`, 1]));
    expect(cleanCounts({ counts: many }).size).toBe(MAX_KEYS);
  });
  it('names the user\'s local day', () => {
    expect(localDay(NOON)).toBe('2026-10-30');
  });
});

describe('the counter in app.db', () => {
  it('sums per day and key, reports 14 days the busiest first, and survives a reopen', () => {
    const dir = tmp();
    let now = NOON - 3 * DAY;
    const c = new UseCounter();
    c.init({ userData: dir, now: () => now });
    c.add({ counts: { 'page:costi': 1, 'action:discuss': 2 } });
    now = NOON;
    c.add({ counts: { 'page:costi': 3 } });
    c.add({ counts: { 'page:costi': 1, 'page:task': 1 } });
    c.close();
    const again = new UseCounter();
    again.init({ userData: dir, now: () => now });
    const r = again.report();
    expect(r).toMatchObject({ from: '2026-10-17', to: '2026-10-30', days: 14, total: 8, since: '2026-10-27' });
    expect(r.rows).toEqual([
      { key: 'page:costi', n: 5, days: 2, last: '2026-10-30' },
      { key: 'action:discuss', n: 2, days: 1, last: '2026-10-27' },
      { key: 'page:task', n: 1, days: 1, last: '2026-10-30' },
    ]);
    expect(r.byDay).toHaveLength(14);
    expect(r.byDay.at(-1)).toEqual({ day: '2026-10-30', n: 5 });
    expect(r.byDay.find(d => d.day === '2026-10-27')?.n).toBe(3);
    expect(fs.existsSync(path.join(dir, 'app.db'))).toBe(true);
    again.close();
  });
  it('keeps 90 days: older rows go at the first write of a day', () => {
    const dir = tmp();
    let now = NOON - (KEEP_DAYS + 5) * DAY;
    const c = new UseCounter();
    c.init({ userData: dir, now: () => now });
    c.add({ counts: { 'page:vecchia': 1 } });
    now = NOON;
    c.add({ counts: { 'page:nuova': 1 } });
    expect(c.report(KEEP_DAYS).rows.map(x => x.key)).toEqual(['page:nuova']);
    expect(c.report().since).toBe('2026-10-30');
    c.close();
  });
  it('summarises for the Orchestrator: the most used, the period, where to look; nothing when empty', () => {
    const c = new UseCounter();
    c.init({ userData: tmp(), now: () => NOON });
    expect(c.summary()).toMatch(/No use counted in the last 14 days/);
    c.add({ counts: { 'page:memoria/proposte': 4, 'action:new-request': 2 } });
    const s = c.summary();
    expect(s).toContain('page memoria/proposte 4× on 1 d');
    expect(s).toContain('action new-request 2×');
    expect(s).toContain('andamento/uso');
    c.close();
  });
});

describe('without a database', () => {
  it('counts in memory (the demo, or a database that would not open) and the demo has two weeks', () => {
    const c = new UseCounter();
    c.init({ userData: null, now: () => NOON, seed: demoUseCounts(NOON) });
    const r = c.report();
    expect(r.total).toBeGreaterThan(100);
    expect(r.rows[0]?.key).toBe('page:home');
    expect(r.byDay.filter(d => d.n > 0).length).toBe(14);
    c.add({ counts: { 'page:uso-nuovo': 1 } });
    expect(c.report().rows.some(x => x.key === 'page:uso-nuovo')).toBe(true);
  });
  it('falls back to memory when app.db cannot be created', () => {
    const file = path.join(tmp(), 'not-a-dir');
    fs.writeFileSync(file, 'x'); // userData is a file: app.db cannot be created under it
    const c = new UseCounter();
    c.init({ userData: file, now: () => NOON });
    c.add({ counts: { 'page:task': 2 } });
    expect(c.report().rows).toEqual([{ key: 'page:task', n: 2, days: 1, last: '2026-10-30' }]);
  });
});
