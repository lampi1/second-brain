// Stop hook: auto-commit {{BRAIN_NAME}} (local git, no remote) when the turn left changes. Never pushes, never blocks:
// every path ends with exit 0. .gitignore keeps secrets/outputs out; a sensitive-looking path aborts the commit.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 8000 });

try {
  const status = git('status', '--porcelain', '-uall');
  const lines = (status.stdout || '').split('\n').filter(Boolean);
  if (status.status !== 0 || lines.length === 0) process.exit(0);

  const paths = lines.map(l => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
  const sensitive = paths.filter(p => /(^|\/)(\.env[^/]*|[^/]*\.env|credentials\.md)$|\.{{BRAIN_NAME}}\.env/i.test(p));
  if (sensitive.length) {
    console.error(`{{BRAIN_NAME}} auto-commit skipped: sensitive path(s) not ignored: ${sensitive.join(', ')}`);
    process.exit(0);
  }

  const shown = paths.slice(0, 4).join(', ');
  const message = `auto: ${shown}${paths.length > 4 ? ` (+${paths.length - 4})` : ''}`;
  if (git('add', '-A').status !== 0) process.exit(0);
  git('commit', '-q', '-m', message);
} catch {
  // never fail the turn
}
process.exit(0);
