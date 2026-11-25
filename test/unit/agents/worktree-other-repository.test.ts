// A child that asked a copy (place copy, ADR 0360) in another repository than its parent's (#460; src/main/agents/
// worktrees.ts DelegateWorktrees.prepare and delegation-integration.ts): its isolated worktree is made in the repository of
// its own folder, only that checkout must be clean (the parent's folder may be dirty, or no repository at all), and its
// changes are staged there, never in the parent's repository. A dirty parent checkout never limits the child. Git is a scripted fake (no process, no checkout, no clock), as in
// worktree-continuation.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';

type Tree = { head: string; branch: string; common: string; dirty?: boolean; killed?: boolean; blocked?: boolean };
const git = vi.hoisted(() => ({ trees: new Map<string, { head: string; branch: string; common: string; dirty?: boolean; killed?: boolean; blocked?: boolean }>(), added: [] as { from: string; root: string }[],
  /** run once when a worktree is added / a tree is written: something changes meanwhile */
  onAdd: undefined as (() => void) | undefined, onTree: undefined as (() => void) | undefined }));
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
      // no filter, include or merge driver configured; `blocked` = an include the host policy refuses
      case 'config': if (tree?.blocked) ok('include.path\0'); else fail(1); break;
      // a killed git (a timeout) has no exit code; «not a repository» is git's 128
      case 'rev-parse': if (tree?.killed) queueMicrotask(() => done(Object.assign(new Error('killed'), { killed: true }), '')); else if (tree) ok(`${root}\n${tree.common}\n${tree.head}\n`); else fail(128); break;
      case 'status': ok(tree?.dirty ? ' M src/a.ts\n' : ''); break;
      case 'symbolic-ref': ok(`${tree!.branch}\n`); break;
      case 'merge-base': ok(); break;
      case 'worktree': { // add -b <branch> <root> <head> | add --detach <root> <head>
        const detached = rest[2] === '--detach', made = detached ? rest[3]! : rest[4]!;
        git.trees.set(made, { branch: detached ? '' : rest[3]!, head: detached ? rest[4]! : rest[5]!, common: tree!.common });
        git.added.push({ from: root!, root: made }); git.onAdd?.(); git.onAdd = undefined; ok(); break;
      }
      case 'diff': ok(rest.includes('--cached') ? '' : 'a patch'); break;
      case 'apply': ok(); break;
      case 'write-tree': git.onTree?.(); git.onTree = undefined; ok(`${'e'.repeat(40)}\n`); break;
      default: fail(129);
    }
    return { stdin: { on() {}, end() {} } };
  },
}));
const { DelegateWorktrees } = await import('../../../src/main/agents/worktrees');
const { stageDelegatedChangesMany } = await import('../../../src/main/agents/delegation-integration');

const roots: string[] = [];
afterEach(() => { git.trees.clear(); git.added.length = 0; git.onAdd = git.onTree = undefined; for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };

function world() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-other-repo-'))); roots.push(root);
  const mine = path.join(root, 'mine'), other = path.join(root, 'other'), plain = path.join(root, 'plain');
  for (const d of [mine, other, plain]) fs.mkdirSync(d);
  git.trees.set(mine, { head: A, branch: 'main', common: path.join(mine, '.git') });
  git.trees.set(other, { head: B, branch: 'main', common: path.join(other, '.git') });
  const parent = (cwd: string) => ({ id: 'parent', cwd, run: { runId: 'parent-run', taskVersion: 1 } }) as ChatSummary;
  return { root, mine, other, plain, parent, tree: (p: string): Tree => git.trees.get(p)! };
}

describe('a writing child in another repository', () => {
  it('gets its worktree in that repository, whatever the state of its parent\'s folder', async () => {
    const w = world(), service = new DelegateWorktrees();
    // the parent's own checkout has pending edits: they are not the child's baseline, so they do not block
    w.tree(w.mine).dirty = true;
    const made = await service.prepare(w.parent(w.mine), { cwd: w.other, place: 'copy' } as NewChat, writer); made.bind!('child');
    expect(git.added).toEqual([{ from: w.other, root: made.cwd }]);
    expect(git.trees.get(made.cwd)).toMatchObject({ head: B, common: path.join(w.other, '.git') });
    expect(service.allocation(w.parent(w.mine), { id: 'child', parentId: 'parent', cwd: made.cwd } as ChatSummary)).toMatchObject({ common: path.join(w.other, '.git'), base: B, sourceRoot: w.other });
    // a parent whose folder is no repository at all (a Strategist started in a plain folder)
    const fromPlain = await service.prepare(w.parent(w.plain), { cwd: w.other, place: 'copy' } as NewChat, writer);
    expect(git.trees.get(fromPlain.cwd)).toMatchObject({ head: B });
  });

  it('still needs a clean committed baseline there, and a child that only reads needs no git at all', async () => {
    const w = world(), service = new DelegateWorktrees();
    w.tree(w.other).dirty = true;
    await expect(service.prepare(w.parent(w.mine), { cwd: w.other, place: 'copy' } as NewChat, writer)).rejects.toThrow(/uncommitted or untracked changes.*src\/a\.ts/);
    await expect(service.prepare(w.parent(w.mine), { cwd: w.plain, place: 'copy' } as NewChat, writer)).rejects.toThrow(/requires a Git repository/);
    expect(await service.prepare(w.parent(w.mine), { cwd: w.plain, place: 'copy' } as NewChat, { tools: { allow: ['read'] }, ceiling: null })).toMatchObject({ cwd: w.plain });
    expect(git.added).toEqual([]);
    // its commit moved while the worktree was made: no child starts on a stale baseline
    w.tree(w.other).dirty = false;
    git.onAdd = () => { w.tree(w.other).head = C; };
    await expect(service.prepare(w.parent(w.mine), { cwd: w.other, place: 'copy' } as NewChat, writer)).rejects.toThrow(/changed while preparing isolation/);
  });

  it('a parent repository git could not read is an error, never taken for another repository', async () => {
    const w = world(), service = new DelegateWorktrees();
    const sibling = path.join(w.root, 'mine-wt'); fs.mkdirSync(sibling);
    git.trees.set(sibling, { head: A, branch: 'feature', common: path.join(w.mine, '.git') });
    // the parent's checkout is dirty and its rev-parse is killed (a timeout): the dirty check must not be skipped
    Object.assign(w.tree(w.mine), { dirty: true, killed: true });
    await expect(service.prepare(w.parent(w.mine), { cwd: sibling, place: 'copy' } as NewChat, writer)).rejects.toThrow(/Git could not read the repository at .*mine; no child was started/);
    expect(git.added).toEqual([]);
  });

  it('a parent repository the host policy refuses does not stop a child in another repository', async () => {
    const w = world(), service = new DelegateWorktrees();
    w.tree(w.mine).blocked = true;
    const made = await service.prepare(w.parent(w.mine), { cwd: w.other, place: 'copy' } as NewChat, writer); made.bind!('child');
    expect(service.allocation(w.parent(w.mine), { id: 'child', parentId: 'parent', cwd: made.cwd } as ChatSummary)).toMatchObject({ sourceRoot: w.other });
    // in that refused repository itself nothing starts, with the policy's own reason
    await expect(service.prepare(w.parent(w.mine), { cwd: w.mine, place: 'copy' } as NewChat, writer)).rejects.toThrow(/includes external or conditional files/);
  });

  it('a continued child keeps the checkout its predecessor was branched from, also through a restart', async () => {
    const w = world(), file = path.join(w.root, 'isolation.json'), parent = w.parent(w.mine);
    const service = new DelegateWorktrees(file);
    const first = await service.prepare(parent, { cwd: w.other, place: 'copy' } as NewChat, writer); first.bind!('original');
    // «Riprendi»: the successor's folder is its predecessor's worktree, not the checkout the work came from
    const next = await service.prepare(parent, { cwd: first.cwd, place: 'copy' } as NewChat, writer, 'original'); next.bind!('successor');
    const successor = { id: 'successor', parentId: 'parent', cwd: next.cwd } as ChatSummary;
    expect(next.cwd).toBe(first.cwd); // it goes on in its predecessor's worktree: no second copy
    expect(git.added).toHaveLength(1);
    expect(service.allocation(parent, successor)).toMatchObject({ sourceRoot: w.other, base: B });
    // the record is the host's file: read again by a new instance
    expect(new DelegateWorktrees(file).allocation(parent, successor)).toMatchObject({ sourceRoot: w.other, common: path.join(w.other, '.git') });
  });

  it('in the parent\'s own repository no other checkout is recorded, and the parent\'s dirty checkout never limits the child', async () => {
    const w = world(), service = new DelegateWorktrees();
    const sibling = path.join(path.dirname(w.mine), 'mine-wt'); fs.mkdirSync(sibling);
    git.trees.set(sibling, { head: A, branch: 'feature', common: path.join(w.mine, '.git') });
    const made = await service.prepare(w.parent(w.mine), { cwd: sibling, place: 'copy' } as NewChat, writer); made.bind!('child');
    expect(service.allocation(w.parent(w.mine), { id: 'child', parentId: 'parent', cwd: made.cwd } as ChatSummary)).not.toHaveProperty('sourceRoot');
    w.tree(w.mine).dirty = true;
    const again = await service.prepare(w.parent(w.mine), { cwd: sibling, place: 'copy' } as NewChat, writer);
    expect(git.trees.get(again.cwd)).toMatchObject({ head: A });
    // its own checkout still has to be clean: a copy never leaves pending edits out in silence
    w.tree(sibling).dirty = true;
    await expect(service.prepare(w.parent(w.mine), { cwd: sibling, place: 'copy' } as NewChat, writer)).rejects.toThrow(/uncommitted or untracked changes/);
  });

  it('is staged in its own repository, one repository per call', async () => {
    const w = world(), service = new DelegateWorktrees(), parent = w.parent(w.mine);
    const done = (id: string, cwd: string) => ({ id, parentId: 'parent', cwd, state: 'idle', delegation: { role: 'artisan', goal: 'g', doneWhen: ['d'], at: 1, result: { outcome: 'done', summary: 's', at: 2 } } }) as unknown as ChatSummary;
    const there = await service.prepare(parent, { cwd: w.other, place: 'copy' } as NewChat, writer); there.bind!('there');
    const here = await service.prepare(parent, { cwd: w.mine, place: 'copy' } as NewChat, writer); here.bind!('here');
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
    // a second checkout of that other repository is another baseline: not mixed either
    const second = path.join(w.root, 'other-wt'); fs.mkdirSync(second);
    git.trees.set(second, { head: B, branch: 'feature', common: path.join(w.other, '.git') });
    const fromSecond = await service.prepare(parent, { cwd: second, place: 'copy' } as NewChat, writer); fromSecond.bind!('second');
    w.tree(fromSecond.cwd).head = C;
    expect(await stageDelegatedChangesMany([owned('there', there.cwd), owned('second', fromSecond.cwd)], parent)).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/different repositories/) });
    // the other repository's checkout moved while its children were staged: the result is stale
    git.onTree = () => { w.tree(w.other).head = A; };
    expect(await stageDelegatedChangesMany([owned('there', there.cwd)], parent)).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/children's repository changed during integration/) });
    w.tree(w.other).head = B;
    // the parent's own child is staged in the parent's repository, as before
    git.added.length = 0;
    expect(await stageDelegatedChangesMany([owned('here', here.cwd)], parent)).toMatchObject({ status: 'staged', parentHead: A });
    expect(git.added.map(a => a.from)).toEqual([w.mine]);
  });
});
