// setup-hooks: the last step of `npm run setup` (ADR 0061). In a git checkout it turns the guard hooks on for this repo
// only (`git config --local core.hooksPath .githooks`: pre-commit and pre-push run tools/guard/scan.mjs), then prints
// the guard status and the optional per-PC config as commands. It never sets those values itself: the deny list path
// and the public e-mail are the user's. Outside a git checkout (a downloaded zip) it only says so: nothing to guard.
// Used by package.json "setup"; guard-lib.mjs is tested in test/unit/guard-commit-hook.test.ts.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOOKS_PATH, OPTIONAL_CONFIG, git, guardStatus, statusLines } from './guard-lib.mjs';

export function setupHooks(root) {
  const inside = git(['rev-parse', '--is-inside-work-tree'], root);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') { console.log('guard: not a git checkout, hooks not installed'); return 0; }
  const r = git(['config', '--local', 'core.hooksPath', HOOKS_PATH], root);
  if (r.status !== 0) { console.error(`guard: could not set core.hooksPath (${r.stderr.trim()}); set it by hand: git config core.hooksPath ${HOOKS_PATH}`); return 1; }
  const s = guardStatus(root);
  for (const l of statusLines(s)) console.log(l);
  if (s.deny === 'unset' || s.email === 'unset') {
    console.log('\nOptional, on a PC that commits to this repo (run them yourself, in this folder):');
    for (const l of OPTIONAL_CONFIG) console.log(`  ${l}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(setupHooks(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
}
