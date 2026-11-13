// Runs the e2e suite (ADR 0042): first the "parallel" project with N workers, then the "exclusive" one (specs that need
// the machine to themselves, playwright.config.ts EXCLUSIVE), one at a time; both always run, the exit code is the worst.
// N = SB_E2E_WORKERS, else autoWorkers(): from the logical cores, the CPU busy right now and the free memory (an app
// instance takes about 0.5 GB). Clears test-results/shots once (each project keeps its own outputDir). Arguments go to
// Playwright as they are (spec paths, --repeat-each, --grep); `--json <dir>` writes one JSON report per project there
// (the timings ADR 0042 measured); `--only parallel|exclusive` runs one project, `--keep-shots` leaves the shots (the
// full check runs the two projects as two calls). A filter that matches no test at all fails, as plain Playwright
// does ("No tests found"), though each project alone may be empty. Every project writes its JSON report (to the --json
// dir, else test-results/e2e-report) and its verdict is read against test/e2e/known-red.json (ADR 0198,
// scripts/e2e-verdict.mjs): only «nuovi rossi» fail the run, «rossi noti» are listed, «nuovi verdi» are suggested for
// removal; every test still runs (nothing skipped). `--raw` keeps Playwright's own exit code. Used by package.json
// "test:e2e" and scripts/check.mjs; autoWorkers() is unit-tested in test/unit/e2e-workers.test.ts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPORT_DIR, classify, formatVerdict, loadReports, readBaseline, verdictCode } from './e2e-verdict.mjs';

/** Workers for this machine: cores/4 (at most 4); half (rounded up) when the CPU is over 60% busy, 1 over 90%; never more than
 *  the free memory allows (0.6 GB each). busy: 0..1. */
export function autoWorkers({ cores, busy, freeGb }) {
  let n = Math.min(4, Math.max(1, Math.floor(cores / 4)));
  if (busy >= 0.9) n = 1;
  else if (busy >= 0.6) n = Math.max(1, Math.ceil(n / 2));
  return Math.max(1, Math.min(n, Math.floor(freeGb / 0.6)));
}

/** The share of CPU time busy over `ms` across all cores (0..1). */
export function cpuBusy(ms = 1500) {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const b = snap();
  const total = b.total - a.total;
  return total > 0 ? 1 - (b.idle - a.idle) / total : 0;
}

/** The workers to use now: SB_E2E_WORKERS when set, else measured; with the reason, for the log. */
export function pickWorkers(env = process.env) {
  const set = Number(env.SB_E2E_WORKERS);
  if (Number.isInteger(set) && set > 0) return { n: set, why: 'SB_E2E_WORKERS' };
  const m = { cores: os.cpus().length, busy: cpuBusy(), freeGb: os.freemem() / 2 ** 30 };
  return { n: autoWorkers(m), why: `${m.cores} cores, CPU ${Math.round(m.busy * 100)}% busy, ${m.freeGb.toFixed(1)} GB free` };
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(repo);
  const args = process.argv.slice(2);
  const j = args.indexOf('--json');
  const jsonDir = j >= 0 ? path.resolve(args.splice(j, 2)[1]) : REPORT_DIR;
  fs.mkdirSync(jsonDir, { recursive: true });
  const rw = args.indexOf('--raw');
  const raw = rw >= 0 && args.splice(rw, 1).length > 0;
  const o = args.indexOf('--only');
  const only = o >= 0 ? args.splice(o, 2)[1] : null;
  const k = args.indexOf('--keep-shots');
  if (k >= 0) args.splice(k, 1); else fs.rmSync(path.join(repo, 'test-results', 'shots'), { recursive: true, force: true });
  const cli = path.join(repo, 'node_modules', '@playwright', 'test', 'cli.js');
  if (args.some(a => !a.startsWith('-'))) {
    const list = spawnSync(process.execPath, [cli, 'test', '--list', ...(only ? [`--project=${only}`] : []), ...args], { encoding: 'utf8' });
    const total = Number(/Total: (\d+) tests?/.exec(list.stdout ?? '')?.[1] ?? 0);
    if (!total) { console.log(`e2e: no test matches ${args.join(' ')}`); process.exit(1); }
  }
  const { n, why } = pickWorkers();
  let worst = 0;
  for (const [project, workers] of [['parallel', n], ['exclusive', 1]].filter(([p]) => !only || p === only)) {
    console.log(`\n> e2e ${project}: ${workers} worker${workers > 1 ? 's' : ''}${project === 'parallel' ? ` (${why})` : ''}`);
    const json = path.join(jsonDir, `${project}.json`);
    fs.rmSync(json, { force: true }); // a stale report of an earlier run must not be read as this one
    const env = { ...process.env, SB_E2E_WORKERS: String(workers), SB_E2E_JSON: json };
    const r = spawnSync(process.execPath, [cli, 'test', `--project=${project}`, '--pass-with-no-tests', ...args], { stdio: 'inherit', env });
    let code = r.status ?? 1;
    if (!raw) {
      const { report, results } = loadReports([json]);
      if (report) {
        const v = classify(results, readBaseline());
        console.log(formatVerdict(v, `e2e ${project}`));
        code = verdictCode(code, report, v);
      } else if (code !== 0) console.log(`e2e ${project}: no JSON report at ${json}; Playwright's exit code stands`);
    }
    worst = Math.max(worst, code);
  }
  process.exit(worst);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
