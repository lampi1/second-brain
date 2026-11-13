// `node scripts/e2e-baseline.mjs --update [report.json ...] [--drop-missing]`: rewrites test/e2e/known-red.json, the
// baseline of the e2e tests already red on main (ADR 0198), from Playwright JSON reports (default: the two that
// scripts/e2e.mjs wrote to test-results/e2e-report). Every failed test is in the new baseline (kept entries keep their
// since/group/reason; new ones get today's date and group "new"); a baseline test that passed cleanly leaves it (a flaky one stays); one the
// reports did not run stays unless --drop-missing (a filtered run must not empty the baseline). Without --update it
// only prints the verdict. Run it on main after a full e2e run, never to hide a red of a branch. Uses
// scripts/e2e-verdict.mjs; its pure part, updateBaseline(), is unit-tested in test/unit/e2e-verdict.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASELINE, REPORT_DIR, classify, collectResults, formatVerdict, keyOf, readBaseline } from './e2e-verdict.mjs';

/** The new baseline entries from the old ones and a run's results; today = YYYY-MM-DD. */
export function updateBaseline(baseline, results, { today, dropMissing = false }) {
  const v = classify(results, baseline);
  const old = new Map(baseline.map(e => [keyOf(e.file, e.title), e]));
  const missing = new Set(v.missing.map(e => keyOf(e.file, e.title)));
  const next = [];
  const flaky = new Set(v.flaky.map(r => keyOf(r.file, r.title)));
  // kept: not run (unless dropMissing), or flaky (still red at times)
  for (const e of baseline) {
    const k = keyOf(e.file, e.title);
    if ((!dropMissing && missing.has(k)) || flaky.has(k)) next.push(e);
  }
  for (const r of [...v.knownRed, ...v.newRed]) {
    const prev = old.get(keyOf(r.file, r.title));
    next.push(prev ?? { file: r.file, title: r.title, since: today, group: 'new', reason: r.error || 'failed on main' });
  }
  next.sort((a, b) => keyOf(a.file, a.title).localeCompare(keyOf(b.file, b.title)));
  return { tests: next, verdict: v };
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const dropMissing = args.includes('--drop-missing');
  const files = args.filter(a => !a.startsWith('--'));
  const reports = (files.length ? files.map(f => path.resolve(f)) : ['parallel', 'exclusive'].map(p => path.join(REPORT_DIR, `${p}.json`)))
    .filter(f => fs.existsSync(f));
  if (!reports.length) {
    console.log('e2e-baseline: no JSON report found. Run the e2e first (`npm run test:e2e` writes test-results/e2e-report/*.json) or name the report files.');
    process.exit(1);
  }
  const results = reports.flatMap(f => collectResults(JSON.parse(fs.readFileSync(f, 'utf8'))));
  const baseline = readBaseline();
  const today = new Date().toISOString().slice(0, 10);
  const { tests, verdict } = updateBaseline(baseline, results, { today, dropMissing });
  console.log(formatVerdict(verdict, `reports ${reports.map(f => path.basename(f)).join(', ')}`));
  if (!update) { console.log('\n(read only: pass --update to rewrite test/e2e/known-red.json)'); return; }
  const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  fs.writeFileSync(BASELINE, JSON.stringify({ ...prev, updated: today, tests }, null, 2) + '\n');
  console.log(`\nknown-red.json: ${baseline.length} → ${tests.length} tests (${verdict.newGreen.length} removed, ${verdict.newRed.length} added, ${verdict.missing.length} not in the reports ${dropMissing ? 'dropped' : 'kept'})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
