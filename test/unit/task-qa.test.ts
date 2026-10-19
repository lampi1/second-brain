// "Test e QA" of the Task page, main side: parsing of the brain's qa-status.mjs --mine --json (defensive: https links
// only, broken rows dropped), the service running it after a good read only when the brain has it, keeping it in
// tasks.json, and a QA failure that keeps the last QA without failing the page's read; the demo data passes.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseQaRun } from '../../src/main/tasks/model';
import { TaskService, type TaskDeps } from '../../src/main/tasks/service';
import { demoDevopsRun } from '../../src/main/tasks/demo';
import type { RunResult } from '../../src/main/brain/node';

const NOW = Date.parse('2026-10-13T10:00:00Z');
const ok = (o: unknown): RunResult => ({ stdout: JSON.stringify(o), stderr: '', code: 0 });
const report = (prId = 7) => ({
  pr: { id: prId, title: 'Fix preventivi', repo: 'Web', project: 'P', author: 'Mario', createdAt: '2026-10-08T09:00:00Z', url: `https://dev.azure.com/x/pr/${prId}` },
  plans: [{ id: 900, name: 'Piano', url: 'https://dev.azure.com/x/plan/900', totals: { total: 2, done: 1, missing: 1, passed: 1, byPerson: [{ name: 'Anna Neri', done: 1, passed: 1 }, { done: 3 }] },
    points: [
      { id: 1, suite: { id: 901, name: 'Suite' }, testCase: { id: 501, title: 'TC01', url: 'https://dev.azure.com/x/501' }, outcome: 'passed', ranBy: 'Anna Neri', ranAt: '2026-10-12T15:23:00Z', tester: 'Carla', bugs: [601, 'x'] },
      { id: 2, suite: { id: 901, name: 'Suite' }, testCase: { id: 502, title: 'TC02', url: 'https://dev.azure.com/x/502' }, outcome: null, ranBy: null, ranAt: 'nope', tester: 'Anna Neri', bugs: [] },
      { id: 3, testCase: { id: 503, title: 'evil', url: 'javascript:alert(1)' } },
    ] }],
  bugs: [{ id: 601, title: 'Conteggio', state: 'Active', open: true, url: 'https://dev.azure.com/x/601', testCases: [501] }, { id: 602, title: 'evil', url: 'http://x' }],
  totals: { total: 2, done: 1, missing: 1, passed: 1, bugs: 1, openBugs: 1, byPerson: [] },
});

describe('QA model', () => {
  it('parses the reports, dropping rows without an https link, numbers sanitized', () => {
    const [r, ...rest] = parseQaRun(JSON.stringify({ reports: [report(), { pr: { id: 8, title: 'x', url: 'file:///c' }, plans: [] }, 'junk'] }));
    expect(rest).toEqual([]);
    expect(r!.pr).toMatchObject({ id: 7, title: 'Fix preventivi' });
    expect(r!.plans[0]!.points.map(p => p.id)).toEqual([1, 2]);
    expect(r!.plans[0]!.points[0]).toMatchObject({ suite: 'Suite', outcome: 'passed', ranBy: 'Anna Neri', bugs: [601] });
    expect(r!.plans[0]!.points[1]!.ranAt).toBeNull();
    expect(r!.plans[0]!.totals).toMatchObject({ total: 2, failed: 0, byPerson: [{ name: 'Anna Neri', done: 1, passed: 1, failed: 0 }] });
    expect(r!.bugs.map(b => b.id)).toEqual([601]);
    expect(r!.totals).toMatchObject({ bugs: 1, openBugs: 1, missing: 1 });
    expect(() => parseQaRun('{"x":1}')).toThrow(/non riconosciuta/);
  });
});

describe('TaskService QA', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-devops-qa-'));
  function make(qaRun: () => RunResult, opts: { dir?: string; locateQa?: TaskDeps['locateQa'] } = {}) {
    const calls: string[][] = [];
    const dir = opts.dir ?? tmp();
    const svc = new TaskService({
      file: path.join(dir, 'tasks.json'), brainRoot: () => dir, settings: () => ({ enabled: false, everyMin: 30, sound: true }),
      locate: () => 'devops-me.mjs', locateQa: opts.locateQa ?? (() => 'qa-status.mjs'),
      run: async (s, a) => { calls.push([s, ...a]); return s === 'qa-status.mjs' ? qaRun() : a.includes('--prs') ? ok({ prs: [] }) : ok({ news: [], assigned: [] }); },
      emit: () => {}, feed: () => {}, now: () => NOW,
    });
    return { svc, calls, dir };
  }

  it('runs qa-status.mjs --mine --json after the read and keeps it on disk', async () => {
    const t = make(() => ok({ reports: [report()] }));
    const s = await t.svc.refresh();
    expect(t.calls.at(-1)).toEqual(['qa-status.mjs', '--mine', '--json']);
    expect(s.qa).toHaveLength(1);
    expect(s.qaError).toBeNull();
    const again = make(() => ok({ reports: [] }), { dir: t.dir });
    expect(again.svc.get().qa[0]!.pr!.title).toBe('Fix preventivi');
    t.svc.shutdown(); again.svc.shutdown();
  });

  it('without the script in the brain: no QA run, no error', async () => {
    const t = make(() => ok({ reports: [report()] }), { locateQa: () => null });
    const s = await t.svc.refresh();
    expect(t.calls.some(c => c[0] === 'qa-status.mjs')).toBe(false);
    expect(s).toMatchObject({ qa: [], qaError: null, error: null });
    t.svc.shutdown();
  });

  it('a QA failure keeps the last QA and the page read stays good', async () => {
    let fail = false;
    const t = make(() => (fail ? { stdout: '', stderr: 'HTTP 500 on testplan', code: 1 } : ok({ reports: [report()] })));
    await t.svc.refresh();
    fail = true;
    const s = await t.svc.refresh();
    expect(s.error).toBeNull();
    expect(s.qaError).toBe('Lettura dei test non riuscita: HTTP 500 on testplan');
    expect(s.qa).toHaveLength(1);
    const garbage = make(() => ({ stdout: 'not json', stderr: '', code: 0 }));
    expect((await garbage.svc.refresh()).qaError).toMatch(/Lettura dei test non riuscita/);
    t.svc.shutdown(); garbage.svc.shutdown();
  });

  it('the demo runner gives QA the service accepts', async () => {
    const demo = demoDevopsRun(() => NOW);
    const dir = tmp();
    const svc = new TaskService({ file: path.join(dir, 'd.json'), brainRoot: () => 'demo', settings: () => ({ enabled: false, everyMin: 30, sound: true }),
      locate: () => 'devops-me.mjs (demo)', locateQa: () => 'qa-status.mjs (demo)', run: (s, a) => demo(s, a), emit: () => {}, feed: () => {}, now: () => NOW });
    const s = await svc.refresh();
    expect(s.qa.length).toBe(2);
    expect(s.qa[0]!.totals).toMatchObject({ total: 6, done: 4, missing: 2, failed: 1, blocked: 1, openBugs: 1 });
    expect(s.qa[0]!.plans[0]!.points.find(p => p.outcome === 'failed')!.bugs).toEqual([5201]);
    svc.shutdown();
  });
});
