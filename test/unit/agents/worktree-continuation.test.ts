// A continued writing child (manager-continuity.ts → ChatManager.create → DelegateWorktrees.prepare with continuationOf;
// only prepare is driven here) keeps its predecessor's pinned base, so the delta it integrates is the whole chain's, and is refused once the source
// worktree left its branch or rewrote away the base (src/main/agents/worktrees.ts). Git is a scripted fake: no process,
// no checkout, no clock, so the pinning is checked in milliseconds whatever the machine's load (the real-Git version
// took 122 s on a busy PC, docs/agents/rules.md §7).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';

type Tree = { head: string; branch: string };
const git = vi.hoisted(() => ({ trees: new Map<string, { head: string; branch: string }>(), parents: new Map<string, string>(), common: '' }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof ChildProcess>(),
  execFile: (_file: string, args: string[], _options: unknown, done: (error: (Error & { code?: number }) | null, stdout: string) => void) => {
    const at = args.indexOf('-C'), cwd = args[at + 1]!;
    const rest = args.slice(at + 2); while (rest[0] === '-c') rest.splice(0, 2);
    const root = [...git.trees.keys()].filter(r => cwd === r || cwd.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
    const tree = root ? git.trees.get(root) : undefined;
    const ok = (out = '') => queueMicrotask(() => done(null, out));
    const fail = (code: number) => queueMicrotask(() => done(Object.assign(new Error(`git exit ${code}`), { code }), ''));
    const ancestor = (a: string, b: string | undefined): boolean => b !== undefined && (a === b || ancestor(a, git.parents.get(b)));
    switch (rest[0]) {
      case 'config': fail(1); break; // no filter, include or merge driver configured
      case 'rev-parse': if (tree) ok(`${root}\n${git.common}\n${tree.head}\n`); else fail(128); break;
      case 'status': ok(''); break;
      case 'symbolic-ref': ok(`${tree!.branch}\n`); break;
      case 'merge-base': if (ancestor(rest[2]!, rest[3])) ok(); else fail(1); break;
      case 'worktree': git.trees.set(rest[4]!, { branch: rest[3]!, head: rest[5]! }); ok(); break; // add -b <branch> <root> <head>
      default: fail(129);
    }
    return { stdin: null };
  },
}));
const { DelegateWorktrees } = await import('../../../src/main/agents/worktrees');

const roots: string[] = [];
afterEach(() => { git.trees.clear(); git.parents.clear(); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };

describe('continued writing child', () => {
  it('keeps its predecessor\'s base and refuses a source that left its branch or no longer contains that base', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-continuation-'))); roots.push(root);
    const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
    git.common = path.join(repo, '.git'); git.trees.set(repo, { head: A, branch: 'main' });
    const parent = { id: 'parent', cwd: repo, run: { runId: 'parent-run', taskVersion: 1 } } as ChatSummary;
    const child = (cwd: string, id: string) => ({ id, parentId: parent.id, cwd }) as ChatSummary;
    const service = new DelegateWorktrees();

    const first = await service.prepare(parent, { cwd: repo } as NewChat, writer); first.bind!('original');
    const original: Tree = git.trees.get(first.cwd)!;
    original.head = B; git.parents.set(B, A); // the predecessor commits B on its branch
    const next = await service.prepare(parent, { cwd: first.cwd } as NewChat, writer, 'original'); next.bind!('successor');
    // the successor works on top of B, but its delta is counted from the predecessor's base A
    expect(git.trees.get(next.cwd)).toMatchObject({ head: B });
    expect(service.allocation(parent, child(next.cwd, 'successor')).base).toBe(A);

    const again = () => service.prepare(parent, { cwd: next.cwd } as NewChat, writer, 'successor');
    const successor: Tree = git.trees.get(next.cwd)!, branch = successor.branch;
    successor.branch = 'moved';
    await expect(again()).rejects.toThrow(/no longer matches its original/);
    successor.branch = branch; successor.head = C; // same branch, history rewritten without A
    await expect(again()).rejects.toThrow(/no longer matches its original/);
    // restored, the chain goes on: a third child still counts from A
    successor.head = B;
    const third = await again(); third.bind!('third');
    expect(service.allocation(parent, child(third.cwd, 'third')).base).toBe(A);
  });
});
