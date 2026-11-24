// A writing child in another repository than its parent's (#460, ADR 0345; src/main/agents/worktrees.ts
// DelegateWorktrees.prepare and delegation-integration.ts): its isolated worktree is made in the repository of its own
// folder, only that checkout must be clean (the parent's folder may be dirty, or no repository at all), and its changes
// are staged there, never in the parent's repository. In the parent's own repository nothing changes: a dirty parent
// checkout still blocks. Git is a scripted fake (no process, no checkout, no clock), as in
// worktree-continuation.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';

type Tree = { head: string; branch: string; common: string; dirty?: boolean };
const git = vi.hoisted(() => ({ trees: new Map<string, { head: string; branch: string; common: string; dirty?: boolean }>(), added: [] as { from: string; root: string }[] }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof ChildProcess>(),
  execFile: (_file: string, args: string[], _options: unknown, done: (error: (Error & { code?: number }) | null, stdout: string) => void) => {
    const at = args.indexOf('-C'), cwd = args[at + 1]!;
    const rest = args.slice(at + 2); while (rest[0] === '-c') rest.splice(0, 2);
    const root = [...git.trees.keys()].filter(r => cwd === r || cwd.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
    const tree = root ? git.trees.get(root) : undefined;
    const ok = (out = '') => queueMicrotask(() => done(null, out));
    const fail = (code: number) => queueMicrotask(() => done(Object.assign(new Error(`git exit ${code}`), { code }), ''));
    switch (rest[0]) {
      case 'config': fail(1); break; // no filter, include or merge driver configured
      case 'rev-parse': if (tree) ok(`${root}\n${tree.common}\n${tree.head}\n`); else fail(128); break;
      case 'status': ok(tree?.dirty ? ' M src/a.ts\n' : ''); break;
      case 'symbolic-ref': ok(`${tree!.branch}\n`); break;
      case 'merge-base': ok(); break;
      case 'worktree': { // add -b <branch> <root> <head> | add --detach <root> <head>
        const detached = rest[2] === '--detach', made = detached ? rest[3]! : rest[4]!;
        git.trees.set(made, { branch: detached ? '' : rest[3]!, head: detached ? rest[4]! : rest[5]!, common: tree!.common });
        git.added.push({ from: root!, root: made }); ok(); break;
      }
      case 'diff': ok(rest.includes('--cached') ? '' : 'a patch'); break;
      case 'apply': ok(); break;
      case 'write-tree': ok(`${'e'.repeat(40)}\n`); break;
      default: fail(129);
    }
    return { stdin: { on() {}, end() {} } };
  },
}));
const { DelegateWorktrees } = await import('../../../src/main/agents/worktrees');
const { stageDelegatedChangesMany } = await import('../../../src/main/agents/delegation-integration');

const roots: string[] = [];
afterEach(() => { git.trees.clear(); git.added.length = 0; for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };

function world() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-other-repo-'))); roots.push(root);
  const mine = path.join(root, 'mine'), other = path.join(root, 'other'), plain = path.join(root, 'plain');
  for (const d of [mine, other, plain]) fs.mkdirSync(d);
  git.trees.set(mine, { head: A, branch: 'main', common: path.join(mine, '.git') });
  git.trees.set(other, { head: B, branch: 'main', common: path.join(other, '.git') });
  const parent = (cwd: string) => ({ id: 'parent', cwd, run: { runId: 'parent-run', taskVersion: 1 } }) as ChatSummary;
  return { mine, other, plain, parent, tree: (p: string): Tree => git.trees.get(p)! };
}

describe('a writing child in another repository', () => {
  it('gets its worktree in that repository, whatever the state of its parent\'s folder', async () => {
    const w = world(), service = new DelegateWorktrees();
    // the parent's own checkout has pending edits: they are not the child's baseline, so they do not block
    w.tree(w.mine).dirty = true;
    const made = await service.prepare(w.parent(w.mine), { cwd: w.other } as NewChat, writer); made.bind!('child');
    expect(git.added).toEqual([{ from: w.other, root: made.cwd }]);
    expect(git.trees.get(made.cwd)).toMatchObject({ head: B, common: path.join(w.other, '.git') });
    expect(service.allocation(w.parent(w.mine), { id: 'child', parentId: 'parent', cwd: made.cwd } as ChatSummary)).toMatchObject({ common: path.join(w.other, '.git'), base: B, sourceRoot: w.other });
    // a parent whose folder is no repository at all (a Strategist started in a plain folder)
    const fromPlain = await service.prepare(w.parent(w.plain), { cwd: w.other } as NewChat, writer);
    expect(git.trees.get(fromPlain.cwd)).toMatchObject({ head: B });
  });

  it('still needs a clean committed baseline there, and a child that only reads needs no git at all', async () => {
    const w = world(), service = new DelegateWorktrees();
    w.tree(w.other).dirty = true;
    await expect(service.prepare(w.parent(w.mine), { cwd: w.other } as NewChat, writer)).rejects.toThrow(/uncommitted or untracked changes.*src\/a\.ts/);
    await expect(service.prepare(w.parent(w.mine), { cwd: w.plain } as NewChat, writer)).rejects.toThrow(/requires a Git repository/);
    expect(await service.prepare(w.parent(w.mine), { cwd: w.plain } as NewChat, { tools: { allow: ['read'] }, ceiling: null })).toMatchObject({ cwd: w.plain });
    expect(git.added).toEqual([]);
  });

  it('in the parent\'s own repository nothing changes: its dirty checkout blocks, and no other checkout is recorded', async () => {
    const w = world(), service = new DelegateWorktrees();
    const sibling = path.join(path.dirname(w.mine), 'mine-wt'); fs.mkdirSync(sibling);
    git.trees.set(sibling, { head: A, branch: 'feature', common: path.join(w.mine, '.git') });
    const made = await service.prepare(w.parent(w.mine), { cwd: sibling } as NewChat, writer); made.bind!('child');
    expect(service.allocation(w.parent(w.mine), { id: 'child', parentId: 'parent', cwd: made.cwd } as ChatSummary)).not.toHaveProperty('sourceRoot');
    w.tree(w.mine).dirty = true;
    await expect(service.prepare(w.parent(w.mine), { cwd: sibling } as NewChat, writer)).rejects.toThrow(/uncommitted or untracked changes/);
  });

  it('is staged in its own repository, one repository per call', async () => {
    const w = world(), service = new DelegateWorktrees(), parent = w.parent(w.mine);
    const done = (id: string, cwd: string) => ({ id, parentId: 'parent', cwd, state: 'idle', delegation: { role: 'artisan', goal: 'g', doneWhen: ['d'], at: 1, result: { outcome: 'done', summary: 's', at: 2 } } }) as unknown as ChatSummary;
    const there = await service.prepare(parent, { cwd: w.other } as NewChat, writer); there.bind!('there');
    const here = await service.prepare(parent, { cwd: w.mine } as NewChat, writer); here.bind!('here');
    w.tree(there.cwd).head = C; w.tree(here.cwd).head = C; // each child committed its work
    const owned = (id: string, cwd: string) => ({ owned: service.allocation(parent, done(id, cwd)), child: done(id, cwd) });
    git.added.length = 0;
    // the parent's own checkout is dirty meanwhile: the other repository's staging does not read it
    w.tree(w.mine).dirty = true;
    const staged = await stageDelegatedChangesMany([owned('there', there.cwd)], parent);
    expect(staged).toMatchObject({ status: 'staged', parentHead: B, appliedChildIds: ['there'], parentUnchanged: true });
    expect(git.added).toEqual([{ from: w.other, root: staged.cwd }]);
    w.tree(w.mine).dirty = false;
    expect(await stageDelegatedChangesMany([owned('there', there.cwd), owned('here', here.cwd)], parent)).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/different repositories.*a call of its own/) });
    // the parent's own child is staged in the parent's repository, as before
    git.added.length = 0;
    expect(await stageDelegatedChangesMany([owned('here', here.cwd)], parent)).toMatchObject({ status: 'staged', parentHead: A });
    expect(git.added.map(a => a.from)).toEqual([w.mine]);
  });
});
