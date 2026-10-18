// Product-owned lint, leases and optional local brain commits. Never pushes or stages a user's unrelated changes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicWrite, locked, read, confined } from './storage';
import { fixedSize } from './guards';
import { topicMap } from './topics';
import type { RuleContext } from './types';

export function lint(ctx: RuleContext): { fixedChars: number; issues: string[]; map: string } {
  const fixedChars = fixedSize(ctx), issues: string[] = [];
  if (fixedChars > ctx.config.fixedBudget) issues.push(`Fixed context exceeds ${ctx.config.fixedBudget}.`);
  if (read(ctx.root, 'now.md').split('\n').some(l => l.startsWith('- ') && l.length > ctx.config.nowLineLimit)) issues.push('An open thread exceeds the line limit.');
  return { fixedChars, issues, map: topicMap(ctx) };
}
export function lease(root: string, name: string, owner: string, token?: string): string {
  if (!/^[a-z0-9-]{1,80}$/i.test(name) || !/^[\w.-]{1,100}$/.test(owner)) throw new Error('Invalid lease name or owner.');
  const file = `lease-${name}.json`;
  return locked(root, file, () => {
    const previous = read(root, file);
    if (previous) {
      const held = JSON.parse(previous) as { owner: string; token: string };
      if (held.owner !== owner || held.token !== token) throw new Error('Lease is held; release it with its owner token.');
      fs.unlinkSync(confined(root, file)); return '';
    }
    if (token) throw new Error('Cannot release a missing lease.');
    const id = randomUUID();
    atomicWrite(root, file, JSON.stringify({ owner, token: id, at: Date.now() })); return id;
  });
}
export function autoCommit(ctx: RuleContext): void {
  if (!ctx.config.autoCommit) return;
  const git = (...args: string[]) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    const r = spawnSync('git', ['-C', ctx.root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 8000, env });
    if (r.status !== 0) throw new Error('Local brain git operation failed. Check the brain repository and git hooks.');
    return r.stdout.trim();
  };
  if (path.resolve(git('rev-parse', '--show-toplevel')) !== path.resolve(ctx.root)) throw new Error('Auto-commit requires a standalone brain repository.');
  if (git('remote')) throw new Error('Auto-commit is limited to a local brain without remotes.');
  if (git('diff', '--cached', '--name-only')) throw new Error('Auto-commit refuses an already staged index.');
  // Only these validated writer outputs; no add -A, no code, config, untracked credentials or arbitrary filenames.
  const files = ['now.md', 'ai-errors.md'].filter(f => fs.existsSync(confined(ctx.root, f)));
  if (!files.length || !git('status', '--porcelain', '--', ...files)) return;
  for (const file of files) if (/\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i.test(read(ctx.root, file))) throw new Error('Auto-commit refused credential-looking memory; redact it first.');
  git('add', '--', ...files);
  git('commit', '-m', 'chore(brain): update validated memory', '--', ...files);
}
