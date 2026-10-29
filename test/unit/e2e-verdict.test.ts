// scripts/e2e-verdict.mjs and scripts/e2e-baseline.mjs (ADR 0198): an e2e run read against test/e2e/known-red.json.
// A fixture Playwright JSON report (test/fixtures/e2e-report/parallel.json) checks the three verdicts: «nuovi rossi»
// fail the run, «rossi noti» pass it, «nuovi verdi» are suggested for removal; the baseline rewrite; the seeded
// baseline's shape; and that scripts/e2e.mjs still runs every test (no skip, no grep-invert, no quarantine).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs script without types
import * as verdictMod from '../../scripts/e2e-verdict.mjs';
// @ts-expect-error plain .mjs script without types
import * as baselineMod from '../../scripts/e2e-baseline.mjs';

interface Row { file: string; title: string; project: string; status: 'passed' | 'failed' | 'flaky' | 'skipped'; error: string }
interface Entry { file: string; title: string; since: string; group: string; reason?: string }
interface Verdict { newRed: Row[]; knownRed: Row[]; newGreen: Row[]; missing: Entry[]; passed: number; flaky: Row[] }
const { collectResults, classify, verdictCode, formatVerdict, loadReports, readBaseline, specName } = verdictMod as {
  collectResults: (r: unknown) => Row[];
  classify: (r: Row[], b: Entry[]) => Verdict;
  verdictCode: (code: number, report: unknown, v: Verdict) => number;
  formatVerdict: (v: Verdict, label?: string, o?: { showMissing?: boolean }) => string;
  loadReports: (files: string[]) => { report: { errors: unknown[] } | null; results: Row[] };
  readBaseline: (file?: string) => Entry[];
  specName: (f: string) => string;
};
const { updateBaseline } = baselineMod as { updateBaseline: (b: Entry[], r: Row[], o: { today: string; dropMissing?: boolean }) => { tests: Entry[]; verdict: Verdict } };

const root = path.join(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'test', 'fixtures', 'e2e-report', 'parallel.json');
const report = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const base: Entry[] = [
  { file: 'settings.spec.ts', title: 'known red that still fails', since: '2026-10-21', group: 'group-A' },
  { file: 'settings.spec.ts', title: 'known red that now passes', since: '2026-10-21', group: 'group-A' },
  { file: 'browser.spec.ts', title: 'internal browser over MCP › known flaky', since: '2026-10-21', group: 'group-C' },
  { file: 'gone.spec.ts', title: 'a renamed test', since: '2026-10-21', group: 'group-B' },
];

describe('collectResults', () => {
  it('reads one row per test with its describe titles, a plain status and the first error line', () => {
    const rows = collectResults(report);
    expect(rows).toHaveLength(6);
    expect(rows.find(r => r.title === 'internal browser over MCP › a new red')).toMatchObject({ file: 'browser.spec.ts', status: 'failed', error: 'Test timeout of 60000ms exceeded.' });
    expect(rows.find(r => r.title === 'known red that still fails')?.error).toBe('Error: element(s) not found');
    expect(rows.map(r => r.status).sort()).toEqual(['failed', 'failed', 'flaky', 'passed', 'passed', 'skipped']);
  });
  it('names a spec by its file name whatever the path form', () => {
    expect(specName('test/e2e/ui.spec.ts')).toBe('ui.spec.ts');
    expect(specName('test\\e2e\\ui.spec.ts')).toBe('ui.spec.ts');
  });
});

describe('classify', () => {
  const v = classify(collectResults(report), base);
  it('sorts new reds, known reds, new greens; flaky stays known; skipped is ignored', () => {
    expect(v.newRed.map(r => r.title)).toEqual(['internal browser over MCP › a new red']);
    expect(v.knownRed.map(r => r.title)).toEqual(['known red that still fails']);
    expect(v.newGreen.map(r => r.title)).toEqual(['known red that now passes']);
    expect(v.flaky.map(r => r.title)).toEqual(['internal browser over MCP › known flaky']);
    expect(v.missing.map(e => e.file)).toEqual(['gone.spec.ts']);
    expect(v.passed).toBe(3);
  });
  it('a test failed in any project counts as failed', () => {
    const rows: Row[] = [
      { file: 'a.spec.ts', title: 't', project: 'parallel', status: 'passed', error: '' },
      { file: 'a.spec.ts', title: 't', project: 'exclusive', status: 'failed', error: 'x' },
    ];
    expect(classify(rows, []).newRed).toHaveLength(1);
  });
  it('the summary names the three verdicts in Italian with the remediation', () => {
    const text = formatVerdict(v, 'e2e parallel', { showMissing: true });
    expect(text).toContain('1 nuovi rossi, 1 rossi noti, 1 nuovi verdi');
    expect(text).toContain('the check FAILS');
    expect(text).toContain('scripts/e2e-baseline.mjs --update');
    expect(text).toContain('gone.spec.ts › a renamed test');
    expect(formatVerdict(v)).not.toContain('gone.spec.ts');
  });
});

describe('verdictCode', () => {
  const rows = collectResults(report);
  it('a new red keeps the failure', () => {
    expect(verdictCode(1, report, classify(rows, base))).toBe(1);
  });
  it('only known reds pass the run', () => {
    const onlyKnown = rows.filter(r => r.title !== 'internal browser over MCP › a new red');
    expect(verdictCode(1, report, classify(onlyKnown, base))).toBe(0);
  });
  it('a global error or a failure with no failed test keeps Playwright\'s code', () => {
    const onlyKnown = classify(rows.filter(r => !r.title.includes('a new red')), base);
    expect(verdictCode(1, { errors: [{ message: 'global setup failed' }] }, onlyKnown)).toBe(1);
    expect(verdictCode(1, { errors: [] }, classify([], base))).toBe(1);
    expect(verdictCode(1, null, onlyKnown)).toBe(1);
    expect(verdictCode(0, report, classify(rows, base))).toBe(0);
  });
  it('loadReports merges the reports that exist and skips the absent ones', () => {
    const { report: r, results } = loadReports([fixture, path.join(root, 'test', 'fixtures', 'e2e-report', 'absent.json')]);
    expect(r?.errors).toEqual([]);
    expect(results).toHaveLength(6);
    expect(loadReports([]).report).toBeNull();
  });
});

describe('updateBaseline', () => {
  const rows = collectResults(report);
  it('adds new reds, keeps known reds, flaky and unrun entries, drops the new greens', () => {
    const { tests } = updateBaseline(base, rows, { today: '2026-10-29' });
    const titles = tests.map(t => `${t.file} › ${t.title}`);
    expect(titles).toEqual([
      'browser.spec.ts › internal browser over MCP › a new red',
      'browser.spec.ts › internal browser over MCP › known flaky',
      'gone.spec.ts › a renamed test',
      'settings.spec.ts › known red that still fails',
    ]);
    expect(tests[0]).toMatchObject({ since: '2026-10-29', group: 'new', reason: 'Test timeout of 60000ms exceeded.' });
    expect(tests[3]).toMatchObject({ since: '2026-10-21', group: 'group-A' });
  });
  it('--drop-missing drops the entries the run did not include', () => {
    const { tests } = updateBaseline(base, rows, { today: '2026-10-29', dropMissing: true });
    expect(tests.some(t => t.file === 'gone.spec.ts')).toBe(false);
  });
});

describe('test/e2e/known-red.json and scripts/e2e.mjs', () => {
  it('the seeded baseline has unique, complete entries naming existing spec files', () => {
    const tests = readBaseline();
    expect(tests.length).toBeGreaterThanOrEqual(90);
    const keys = new Set(tests.map(t => `${t.file} › ${t.title}`));
    expect(keys.size).toBe(tests.length);
    for (const t of tests) {
      expect(t.file).toMatch(/^[\w.-]+\.spec\.ts$/);
      expect(t.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.group).toBeTruthy();
      expect(t.title.trim()).toBe(t.title);
    }
  });
  it('the runner still runs every test: it never skips, filters out or quarantines a baseline test', () => {
    const code = fs.readFileSync(path.join(root, 'scripts', 'e2e.mjs'), 'utf8').split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toMatch(/grep-invert|\.skip|quarantine|testIgnore/);
    expect(code).toContain('verdictCode(');
  });
});
