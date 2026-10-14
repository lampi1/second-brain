// `npm run check`, the full check of main (ADR 0027, run in parallel since ADR 0042): notes the commit, builds, then runs
// typecheck, lint and the unit tests (one after the other, output held until each ends) side by side with the parallel
// e2e project (scripts/e2e.mjs, one worker less than the machine allows); then, alone, the unit tests that start real
// processes (scripts/process-units.mjs finds them by a rule: their deadlines miss beside three Electron instances),
// then the exclusive e2e specs (they time things: nothing else may load the machine). A red step never stops
// the others: one run shows every failure, the summary lists them. Green, it records the commit through
// scripts/check-pass.mjs. Used by package.json "check" (and so by `npm run promote`).
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickWorkers } from './e2e.mjs';
import { processUnits } from './process-units.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (pkg, file) => path.join(repo, 'node_modules', pkg, file);
const fail = (label, code) => { console.log(`\ncheck failed at ${label}`); process.exit(code || 1); };

function step(label, args) {
  console.log(`\n> ${label}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) fail(label, r.status);
}

/** Runs a node script with its output kept until it ends (so it does not interleave with the e2e). */
function held(label, args) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => {
      console.log(`\n> ${label} (${Math.round((Date.now() - t0) / 1000)} s, ${code === 0 ? 'ok' : 'FAILED'})\n${code === 0 ? out.split('\n').slice(-6).join('\n') : out}`);
      resolve(code ?? 1);
    });
  });
}

async function main() {
  process.chdir(repo);
  const failed = [];
  const note = (label, code) => { if (code !== 0) failed.push(label); };

  step('start', ['scripts/check-pass.mjs', '--start']);
  step('build', ['scripts/build.mjs']);
  const { n, why } = pickWorkers();
  const workers = process.env.SB_E2E_WORKERS ? n : Math.max(1, n - 1);
  console.log(`\n> e2e with ${workers} worker${workers > 1 ? 's' : ''} (${why}) beside typecheck, lint and unit`);
  const e2e = spawn(process.execPath, ['scripts/e2e.mjs', '--only', 'parallel'], { stdio: 'inherit', env: { ...process.env, SB_E2E_WORKERS: String(workers) } });
  const e2eDone = new Promise(r => e2e.on('close', code => r(code ?? 1)));

  const vitest = bin('vitest', 'vitest.mjs');
  const units = processUnits();
  for (const [label, args] of [
    ['typecheck', [bin('typescript', 'bin/tsc'), '-p', 'tsconfig.json', '--noEmit']],
    ['lint', [bin('eslint', 'bin/eslint.js'), '.']],
    ['unit', [vitest, 'run', ...units.flatMap(f => ['--exclude', f])]],
  ]) note(label, await held(label, args));
  note('e2e (parallel)', await e2eDone);

  console.log(`\n> unit with real processes (alone, ${units.length} files)`);
  note('unit (processes)', spawnSync(process.execPath, [vitest, 'run', ...units], { stdio: 'inherit' }).status ?? 1);
  console.log('\n> e2e exclusive (alone)');
  note('e2e (exclusive)', spawnSync(process.execPath, ['scripts/e2e.mjs', '--only', 'exclusive', '--keep-shots'], { stdio: 'inherit' }).status ?? 1);
  if (failed.length) fail(failed.join(', '), 1);
  step('record', ['scripts/check-pass.mjs']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
