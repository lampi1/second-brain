// The pool over its limit (#380): never refused, trimmed by the next cleanup. Every slot at work is the pool doing its
// job (info); a free slot that could not be reused is the one worth a warning. A fake git session, temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const logs = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock('../../../src/main/log', () => ({ log: { warn: logs.warn, info: logs.info, error: vi.fn(), debug: vi.fn() }, errText: (e: unknown) => String(e) }));
import { WorktreePool } from '../../../src/main/agents/worktree-pool';
import type { GitSession } from '../../../src/main/agents/worktrees';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); vi.clearAllMocks(); });
const HEAD = 'a'.repeat(40);

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pool-'))); dirs.push(base);
  const repo = path.join(base, 'repo'), common = path.join(repo, '.git');
  fs.mkdirSync(common, { recursive: true });
  // a slot that rev-parse places in another repository cannot be reused
  const foreign = new Set<string>();
  const session = { git: async (cwd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args.includes('--show-toplevel')) return { exit: 0, out: `${cwd}\n${foreign.has(cwd) ? path.join(base, 'other.git') : common}\n${HEAD}` };
    return { exit: 0, out: '' };
  } } as unknown as GitSession;
  const pool = new WorktreePool({ limits: () => ({ perRepo: 1, total: 20, diskGb: 50 }), inUse: () => false, knownCwds: () => [] });
  return { pool, session, foreign, source: { root: repo, common, head: HEAD } };
}

it('over the limit with every slot at work: info, no warning', async () => {
  const f = fixture();
  await f.pool.take(f.source, f.session);
  await f.pool.take(f.source, f.session); // the first is still leased
  expect(logs.warn).not.toHaveBeenCalled();
  expect(logs.info).toHaveBeenCalledWith('agents', 'worktree pool above its limit while every slot is at work', expect.anything());
});

it('over the limit because a free slot could not be reused: a warning', async () => {
  const f = fixture();
  const first = await f.pool.take(f.source, f.session);
  f.pool.release(first.root);
  f.foreign.add(first.root);
  await f.pool.take(f.source, f.session);
  expect(logs.warn).toHaveBeenCalledWith('agents', 'worktree pool above its limit: free slots not reusable', expect.objectContaining({ data: expect.objectContaining({ notReusable: 1 }) }));
});
