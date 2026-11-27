// The real ports of the Orchestrator's small brain edit (ADR 0370; quick-edit-service.ts holds the logic and is tested
// with fakes of these): the git commit of exactly the edited files in the brain repo, the brain's own read-only lint
// (ops/tools/brain-lint.mjs --json, when the brain has it) and the user's PreToolUse hooks (skills/guard.ts). The commit
// never fights the multi-PC sync: while its lock is held or a git operation is under way it is skipped (the sync commits
// the files in its next cycle), and it carries the app's neutral identity like the sync's own commits (brain/sync.ts).
// Git runs with prompts off. Used by wiring.ts and demo-wiring.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_IDENTITY } from './sync';
import { runNode, type NodeRunner } from './node';
import { checkWrite } from '../skills/guard';
import type { QuickGit, QuickHooks, QuickLint } from './quick-edit-service';

interface Git { code: number; out: string; err: string }
function git(cwd: string, args: string[]): Promise<Git> {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.quotePath=false', ...args], {
      cwd, timeout: 20_000, maxBuffer: 1 << 24, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANG: 'C' },
    }, (err, stdout, stderr) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: String(stdout ?? '').trim(), err: String(stderr ?? '').trim() }));
  });
}
const last = (s: string) => s.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200) ?? '';
const SYNC_LOCK_STALE_MS = 5 * 60_000;

export const brainGit: QuickGit = {
  async commit(root, paths, message) {
    const top = await git(root, ['rev-parse', '--show-toplevel', '--absolute-git-dir']);
    if (top.code !== 0) return { skipped: 'the brain folder is not a git repo' };
    const [topDir = '', gitDir = path.join(root, '.git')] = top.out.split(/\r?\n/);
    // a brain folder inside another repo is not the brain's own repo: nothing is committed there
    const same = (a: string, b: string) => { try { return fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase(); } catch { return false; } };
    if (!same(topDir, root)) return { skipped: 'the brain folder is not the root of its git repo' };
    try { if (Date.now() - fs.statSync(path.join(gitDir, 'sb-sync.lock')).mtimeMs < SYNC_LOCK_STALE_MS) return { skipped: 'the brain sync holds the repo: it commits these files in its next cycle' }; } catch { /* no lock */ }
    for (const f of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) if (fs.existsSync(path.join(gitDir, f))) return { skipped: 'a git operation is under way in the brain folder' };
    const add = await git(root, ['add', '-A', '--', ...paths]);
    if (add.code !== 0) return { skipped: `git add: ${last(add.err)}` };
    const c = await git(root, [...APP_IDENTITY, 'commit', '-q', '-m', message, '--', ...paths]);
    if (c.code !== 0) return { skipped: `git commit: ${last(c.err) || last(c.out) || `code ${c.code}`}` };
    const sha = await git(root, ['rev-parse', 'HEAD']);
    return sha.code === 0 ? { sha: sha.out } : { skipped: 'committed, id not read' };
  },
};

/** The brain's own lint when it has one: its totals and the findings that name the edited files. */
export function brainLint(node: NodeRunner): QuickLint {
  return async (root, files) => {
    const script = path.join(root, 'ops', 'tools', 'brain-lint.mjs');
    if (!fs.existsSync(script)) return null;
    const r = await runNode(node, script, ['--root', root, '--json'], root, 20_000);
    if (r.code !== 0) return null;
    let rep: { fixedTotal?: number; overBudget?: { file: string; lines: number; max: number }[]; duplicates?: { a: string; b: string; text: string }[]; brokenRefs?: string[] };
    try { rep = JSON.parse(r.stdout) as typeof rep; } catch { return null; }
    const mine = (s: string) => files.some(f => s.replace(/\\/g, '/').includes(f));
    const findings = [
      ...(rep.overBudget ?? []).filter(o => mine(o.file)).map(o => `${o.file}: ${o.lines} lines, over its budget of ${o.max}`),
      ...(rep.duplicates ?? []).filter(d => mine(d.a) || mine(d.b)).map(d => `near-duplicate rule ${d.a} ≈ ${d.b}: «${d.text}» (keep one, point from the other)`),
      ...(rep.brokenRefs ?? []).filter(mine).map(b => `broken reference ${b}`),
    ].slice(0, 10);
    return { summary: `brain-lint: fixed context ${rep.fixedTotal ?? '?'} chars, ${rep.duplicates?.length ?? 0} near-duplicates, ${rep.brokenRefs?.length ?? 0} broken references`, findings };
  };
}

/** The user's PreToolUse hooks on this Write (the same limits as a chat's). */
export function brainHooks(home: string): QuickHooks {
  return async (root, file, content) => (await checkWrite({ home, root, filePath: file, content }))?.message ?? null;
}
