// Runs the ADR 0368 measurements (scripts/bench-main-stalls.entry.ts): bundles the entry with esbuild into a temp file
// and runs it with this Node (node:sqlite, real git in a temp folder). Why: before/after numbers for the main-process
// stalls (the coordination journal read every minute, the writes of each auto-permitted permission) and the pre-turn
// checkpoint, reproducible on any PC. Never part of the suite; run it by hand, not under load (rule 7).
//   node scripts/bench-main-stalls.mjs            (BENCH_ROWS=66689 by default)
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bench-build-')), 'bench.mjs');
await build({ entryPoints: [path.join(root, 'scripts', 'bench-main-stalls.entry.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
const r = spawnSync(process.execPath, ['--no-warnings', out], { stdio: 'inherit', env: { ...process.env, SB_TEST: '1' } });
fs.rmSync(path.dirname(out), { recursive: true, force: true });
process.exit(r.status ?? 1);
