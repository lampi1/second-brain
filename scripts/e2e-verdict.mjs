// Reads an e2e run against the baseline of the tests already red on main (test/e2e/known-red.json, ADR 0198): every
// test still runs, nothing is skipped or quarantined; only the verdict changes. A failed test not in the baseline is a
// «nuovo rosso» (the run fails); a failed test in it is a «rosso noto» (listed, the run passes); a baseline test that
// passed is a «nuovo verde» (suggest removing it from the baseline). Input: Playwright's JSON reporter output. Used by
// scripts/e2e.mjs (the verdict of each project), scripts/check.mjs (the summary of both) and scripts/e2e-baseline.mjs
// (rewrites the baseline); unit-tested in test/unit/e2e-verdict.test.ts with fixture reports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = path.join(repo, 'test', 'e2e', 'known-red.json');
/** where scripts/e2e.mjs writes one JSON report per project when no --json dir is given */
export const REPORT_DIR = path.join(repo, 'test-results', 'e2e-report');

/** The spec file as the baseline names it: its name under test/e2e (the specs are flat there). */
export function specName(file) {
  return String(file ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
}

/** The stable key of a test: spec file + its titles (describe blocks and the test, joined by " › "); no line numbers. */
export const keyOf = (file, title) => `${specName(file)} › ${title}`;

/**
 * The tests of a Playwright JSON report, one row per test and project: { file, title, project, status, error }.
 * status: 'passed' (expected), 'failed' (unexpected: failed or timed out), 'flaky' (failed then passed), 'skipped'.
 */
export function collectResults(report) {
  const rows = [];
  const walk = (suite, titles) => {
    // the top suites are the files: their title is the file name, not part of the test's title
    const own = suite.title && titles !== null ? [...titles, suite.title] : (titles ?? []);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const status = t.status === 'expected' ? 'passed' : t.status === 'unexpected' ? 'failed' : t.status === 'flaky' ? 'flaky' : 'skipped';
        const last = (t.results ?? []).at(-1);
        const error = String(last?.error?.message ?? last?.errors?.[0]?.message ?? '').split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200);
        rows.push({ file: specName(spec.file ?? suite.file), title: [...own, spec.title].join(' › '), project: t.projectName ?? '', status, error });
      }
    }
    for (const child of suite.suites ?? []) walk(child, own);
  };
  for (const top of report?.suites ?? []) walk(top, null);
  return rows;
}

/** The baseline file's entries ({ file, title, since, group, reason }); an absent file is an empty baseline. */
export function readBaseline(file = BASELINE) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(data.tests) ? data.tests : [];
}

/**
 * Sorts a run's results against the baseline. A test that runs in more than one project counts as failed when any
 * project failed it. Returns { newRed, knownRed, newGreen, missing, passed, flaky } (rows; missing = baseline entries
 * the run did not include, e.g. a filtered run).
 */
export function classify(results, baseline) {
  const known = new Map(baseline.map(e => [keyOf(e.file, e.title), e]));
  const byKey = new Map();
  for (const r of results) {
    if (r.status === 'skipped') continue;
    const k = keyOf(r.file, r.title);
    const prev = byKey.get(k);
    const rank = { failed: 3, flaky: 2, passed: 1 };
    if (!prev || rank[r.status] > rank[prev.status]) byKey.set(k, r);
  }
  const out = { newRed: [], knownRed: [], newGreen: [], missing: [], passed: 0, flaky: [] };
  for (const [k, r] of byKey) {
    const entry = known.get(k);
    if (r.status === 'failed') (entry ? out.knownRed : out.newRed).push({ ...r, ...(entry ? { since: entry.since, group: entry.group } : {}) });
    else {
      out.passed++;
      if (r.status === 'flaky') out.flaky.push(r);
      // a flaky baseline test is still red at times: only a clean pass suggests removing it
      if (entry && r.status === 'passed') out.newGreen.push({ ...r, since: entry.since, group: entry.group });
    }
  }
  for (const [k, e] of known) if (!byKey.has(k)) out.missing.push(e);
  return out;
}

/** The exit code the run deserves: 0 when Playwright passed, or when it failed only on known reds (and had no global error). */
export function verdictCode(playwrightCode, report, verdict) {
  if (playwrightCode === 0) return 0;
  if (!report || (report.errors ?? []).length) return playwrightCode || 1;
  return verdict.newRed.length === 0 && verdict.knownRed.length > 0 ? 0 : playwrightCode || 1;
}

/** The human summary (Italian labels, as the owner reads them; the rest English like every log). showMissing: the run
 *  was complete (both projects), so baseline entries it did not include are renamed or deleted tests. */
export function formatVerdict(v, label = 'e2e', { showMissing = false } = {}) {
  const line = r => `  - ${r.file} › ${r.title}${r.project ? ` [${r.project}]` : ''}${r.error ? `\n      ${r.error}` : ''}`;
  const out = [`\n> ${label} verdict against test/e2e/known-red.json: ${v.passed} passed, ${v.newRed.length} nuovi rossi, ${v.knownRed.length} rossi noti, ${v.newGreen.length} nuovi verdi`];
  if (v.newRed.length) out.push(`\nnuovi rossi (${v.newRed.length}): failed and not in the baseline, the check FAILS`, ...v.newRed.map(line),
    'hint: fix them; if one is red on main too (not by this change), add it with `node scripts/e2e-baseline.mjs --update` after a run on main');
  if (v.knownRed.length) out.push(`\nrossi noti (${v.knownRed.length}): failed, already red on main (the check passes)`,
    ...v.knownRed.map(r => `  - ${r.file} › ${r.title} (since ${r.since ?? '?'}, ${r.group ?? '?'})`));
  if (v.newGreen.length) out.push(`\nnuovi verdi (${v.newGreen.length}): in the baseline but passed; remove them (\`node scripts/e2e-baseline.mjs --update\`)`,
    ...v.newGreen.map(r => `  - ${r.file} › ${r.title}`));
  if (showMissing && v.missing.length) out.push(`\nnot in this run (${v.missing.length}): baseline entries no test has today (renamed or deleted); \`node scripts/e2e-baseline.mjs --update --drop-missing\` drops them`,
    ...v.missing.map(e => `  - ${e.file} › ${e.title}`));
  if (v.flaky.length) out.push(`\nflaky (${v.flaky.length}): passed on a retry`, ...v.flaky.map(r => `  - ${r.file} › ${r.title}`));
  return out.join('\n');
}

/** Reads the JSON reports that exist among `files`; returns { report, results } merged (null report when none). */
export function loadReports(files) {
  const reports = files.filter(f => fs.existsSync(f)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  if (!reports.length) return { report: null, results: [] };
  return { report: { errors: reports.flatMap(r => r.errors ?? []) }, results: reports.flatMap(collectResults) };
}
