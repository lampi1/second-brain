// A continued writing child (manager-continuity.ts → ChatManager.create → DelegateWorktrees.prepare with continuationOf;
// only prepare is driven here) keeps its predecessor's pinned base, so the delta it integrates is the whole chain's (src/main/agents/worktrees.ts). Since ADR 0360 it goes on in the same
// worktree: no second copy; a branch left or a base rewritten is refused when its changes are staged. Git is a scripted fake: no process,
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
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };

describe('continued writing child', () => {
  it('goes on in its predecessor\'s worktree with its base, and hands it on', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-continuation-'))); roots.push(root);
    const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
    git.common = path.join(repo, '.git'); git.trees.set(repo, { head: A, branch: 'main' });
    const parent = { id: 'parent', cwd: repo, run: { runId: 'parent-run', taskVersion: 1 } } as ChatSummary;
    const child = (cwd: string, id: string) => ({ id, parentId: parent.id, cwd }) as ChatSummary;
    const service = new DelegateWorktrees();

    const first = await service.prepare(parent, { cwd: repo, place: 'copy' } as NewChat, writer); first.bind!('original');
    const original: Tree = git.trees.get(first.cwd)!;
    original.head = B; git.parents.set(B, A); // the predecessor commits B on its branch
    const next = await service.prepare(parent, { cwd: first.cwd, place: 'copy' } as NewChat, writer, 'original'); next.bind!('successor');
    // the successor goes on in the same worktree, on top of B; its delta is counted from the predecessor's base A
    expect(next.cwd).toBe(first.cwd);
    expect(git.trees.get(next.cwd)).toMatchObject({ head: B });
    expect(service.allocation(parent, child(next.cwd, 'successor')).base).toBe(A);
    // the worktree is the successor's now, never the original's
    expect(() => service.allocation(parent, child(next.cwd, 'original'))).toThrow(/No host-owned isolated worktree/);
    const third = await service.prepare(parent, { cwd: next.cwd } as NewChat, writer, 'successor'); third.bind!('third');
    expect(third.cwd).toBe(first.cwd);
    expect(service.allocation(parent, child(third.cwd, 'third')).base).toBe(A);
    // a chat that is not its predecessor gets no right on it: it works there in place, with nothing to integrate
    const stranger = await service.prepare(parent, { cwd: next.cwd } as NewChat, writer, 'someone-else');
    expect(stranger).toMatchObject({ cwd: next.cwd });
    expect(stranger.bind).toBeUndefined();
  });
});
