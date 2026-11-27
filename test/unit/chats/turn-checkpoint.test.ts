// The pre-turn checkpoint's cheap check (ADR 0368, checkpoints.ts turnCheckpoint): a working tree that matches HEAD
// costs one `git status` and HEAD itself is the checkpoint (its ref written in the background); a changed tree, or a
// repository with no commit yet, takes the full snapshot. git is mocked (execFile), never run (rule 7).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcess from 'node:child_process';

const calls: string[][] = [];
let status = '';
vi.mock('node:child_process', async orig => {
  const real = await orig<typeof ChildProcess>();
  const execFile = (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = args.slice(2); // after -C <cwd>
    calls.push(a);
    const out = a[0] === 'status' ? status
      : a[0] === 'rev-parse' && a.includes('--show-toplevel') ? '/repo\n'
      : a[0] === 'rev-parse' && a.includes('--git-path') ? '/repo/.git/index\n'
      : a[0] === 'rev-parse' ? `${'a'.repeat(40)}\n`
      : a[0] === 'write-tree' ? `${'t'.repeat(40)}\n` : a[0] === 'commit-tree' ? `${'c'.repeat(40)}\n` : '';
    queueMicrotask(() => cb(null, out, ''));
  };
  return { ...real, execFile };
});
const { parseStatus, turnCheckpoint } = await import('../../../src/main/chats/checkpoints');

const HEAD = 'b'.repeat(40);
beforeEach(() => { calls.length = 0; });

describe('parseStatus', () => {
  it('reads HEAD and whether anything differs from it', () => {
    expect(parseStatus(`# branch.oid ${HEAD}\0# branch.head main\0`)).toEqual({ head: HEAD, changed: false });
    expect(parseStatus(`# branch.oid ${HEAD}\0# branch.head main\0? new.txt\0`)).toEqual({ head: HEAD, changed: true });
    expect(parseStatus(`# branch.oid ${HEAD}\u{0}1 .M N... 100644 100644 100644 ${HEAD} ${HEAD} a.ts\0`).changed).toBe(true);
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toEqual({ head: null, changed: false });
  });
});

describe('turnCheckpoint', () => {
  it('a tree that matches HEAD: one git status, HEAD is the checkpoint, no add or write-tree', async () => {
    status = `# branch.oid ${HEAD}\0# branch.head main\0`;
    const cp = await turnCheckpoint('/repo/sub', 'refs/sb/checkpoints/c/1', '/repo');
    expect(cp).toMatchObject({ commit: HEAD, root: '/repo' });
    await new Promise(r => setImmediate(r)); // the background ref
    expect(calls.map(c => c[0])).toEqual(['status', 'update-ref']);
    expect(calls[1]).toEqual(['update-ref', 'refs/sb/checkpoints/c/1', HEAD]);
  });
  it('a changed tree takes the full snapshot, with the known root (no second rev-parse of it)', async () => {
    status = `# branch.oid ${HEAD}\0? new.txt\0`;
    const cp = await turnCheckpoint('/repo', 'refs/sb/checkpoints/c/2', '/repo');
    expect(cp?.commit).toBe('c'.repeat(40));
    const names = calls.map(c => c[0]);
    expect(names).toContain('add');
    expect(names).toContain('write-tree');
    expect(calls.some(c => c.includes('--show-toplevel'))).toBe(false);
  });
  it('no commit yet: the full snapshot too', async () => {
    status = '# branch.oid (initial)\0';
    await turnCheckpoint('/repo', 'refs/sb/checkpoints/c/3');
    expect(calls.map(c => c[0])).toContain('add');
  });
});
