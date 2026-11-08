// Deterministic reproduction of an old turn's end read crossing the next turn's checkpoint deadline.
// Real git trees prove that undo must not attribute the later write to the earlier turn; no load or sleep is needed.
import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type * as Checkpoints from '../../../src/main/chats/checkpoints';
import type { Rec } from '../../../src/main/chats/manager-types';
import { tmp } from './helpers';

const endGate = vi.hoisted(() => ({ wait: Promise.resolve() }));
vi.mock('../../../src/main/chats/checkpoints', async original => {
  const real = await original<typeof Checkpoints>();
  return { ...real, afterTree: async (root: string) => { await endGate.wait; return real.afterTree(root); } };
});
const { ManagerCheckpoints } = await import('../../../src/main/chats/manager-checkpoints');
const { restore } = await import('../../../src/main/chats/checkpoints');
afterEach(() => { vi.useRealTimers(); });

it('a deadline releases writes without letting an unfinished older end record claim them', async () => {
  const cwd = tmp('checkpoint-deadline');
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@localhost' },
  });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  const file = path.join(cwd, 'a.ts');
  fs.writeFileSync(file, 'ORIGINAL'); git('add', '.'); git('commit', '-qm', 'init');
  // Exercise the checkpoint layer without launching an engine: only its UI notification is irrelevant here.
  const manager = Object.assign(Object.create(ManagerCheckpoints.prototype) as object, {
    opts: { checkpointDeadlineMs: 3000 }, updated() {},
  }) as unknown as { checkpoint(r: Rec): Promise<void>; recordTurnEnd(r: Rec): void };
  const r = { s: { id: 'deadline', cwd } } as Rec;
  // Freeze the initial snapshot deadline too: real git speed must never decide this regression's outcome.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await manager.checkpoint(r);
  let releaseEnd!: () => void;
  endGate.wait = new Promise<void>(resolve => { releaseEnd = resolve; });
  manager.recordTurnEnd(r);
  const end = r.afterPending;
  expect(end).toBeDefined();
  const next = manager.checkpoint(r);
  await vi.advanceTimersByTimeAsync(3000);
  await next; // the write barrier is now open although the old end read is still pending
  vi.useRealTimers();
  fs.writeFileSync(file, 'TARDI');
  releaseEnd();
  await end;
  await restore(r.checkpoints![0]!, 'refs/sb/undo/deadline');
  expect(fs.readFileSync(file, 'utf8')).toBe('TARDI');
});
