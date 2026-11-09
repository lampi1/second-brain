// src/main/chats/worktree-hold.ts: the auto-close holds a finished chat that left unsaved git work (#357). Git is a
// fake (rules.md §7: no real git in unit tests); the clock is injected.
import { describe, expect, it } from 'vitest';
import { RECHECK_MS, WorktreeHold, type GitRun } from '../../../src/main/chats/worktree-hold';

const ok = (out = ''): GitRun => ({ exit: 0, out });
function repo(o: { status?: string; ahead?: string; remote?: string; fail?: boolean; notRepo?: boolean } = {}) {
  const calls: string[][] = [];
  const git = async (_cwd: string, args: string[]): Promise<GitRun> => {
    calls.push(args);
    if (args[0] === 'rev-parse') return o.notRepo ? { exit: 128, out: '' } : ok('/w');
    if (o.fail) return { exit: null, out: '', error: 'spawn git ENOENT' };
    if (args[0] === 'remote') return ok(o.remote ?? 'origin\n');
    if (args[0] === 'status') return ok(o.status ?? '');
    if (args[0] === 'rev-list') return ok(o.ahead ?? '0\n');
    return ok();
  };
  return { git, calls };
}
const chat = (stamp = 's1') => ({ id: 'c1', cwd: '/repos/.second-brain-delegate-abc123', stamp });
const settle = () => new Promise(r => setTimeout(r, 0));

describe('WorktreeHold', () => {
  it('checks only app worktrees and chats with a git checkpoint', () => {
    expect(WorktreeHold.checked({ cwd: '/repos/.second-brain-delegate-abc123' })).toBe(true);
    expect(WorktreeHold.checked({ cwd: '/repos/app', checkpointAt: 5 })).toBe(true);
    expect(WorktreeHold.checked({ cwd: '/repos/app' })).toBe(false);
    expect(new WorktreeHold({ git: repo().git }).state({ id: 'x', cwd: '/repos/app', stamp: 'a' })).toBe('none');
  });

  it('holds a chat with an uncommitted change, and one with a commit on no remote', async () => {
    const dirty = new WorktreeHold({ git: repo({ status: ' M src/a.ts\n?? new.txt\n' }).git });
    expect(dirty.state(chat())).toBe('checking');
    await settle();
    expect(dirty.state(chat())).toBe('unsaved');
    expect(dirty.detail('c1')).toBe('2 file non salvati');
    const ahead = new WorktreeHold({ git: repo({ ahead: '3\n' }).git });
    expect((await ahead.check(chat())).state).toBe('unsaved');
  });

  it('lets a clean and pushed worktree close, and a repository without remote or a folder that is no repository', async () => {
    expect((await new WorktreeHold({ git: repo().git }).check(chat())).state).toBe('clean');
    expect((await new WorktreeHold({ git: repo({ remote: '', status: ' M notes.md' }).git }).check(chat())).state).toBe('clean');
    expect((await new WorktreeHold({ git: repo({ notRepo: true }).git }).check(chat())).state).toBe('clean');
  });

  it('fails closed when git fails', async () => {
    expect((await new WorktreeHold({ git: repo({ fail: true }).git }).check(chat())).state).toBe('failed');
  });

  it('releases a held chat once the work is committed and pushed elsewhere (checked again after RECHECK_MS)', async () => {
    let now = 0, status = ' M a.ts\n';
    const changed: string[] = [];
    const h = new WorktreeHold({ now: () => now, changed: id => changed.push(id), git: async (_c, args) => args[0] === 'status' ? ok(status) : args[0] === 'remote' ? ok('origin') : args[0] === 'rev-list' ? ok('0') : ok('/w') });
    h.state(chat()); await settle();
    expect(h.state(chat())).toBe('unsaved');
    status = '';
    now += RECHECK_MS - 1; expect(h.state(chat())).toBe('unsaved'); await settle();
    now += 1; expect(h.state(chat())).toBe('unsaved'); await settle();
    expect(h.state(chat())).toBe('clean');
    expect(changed).toEqual(['c1', 'c1']);
  });

  it('checks again after a new turn (a new stamp)', async () => {
    const r = repo();
    const h = new WorktreeHold({ git: r.git });
    h.state(chat('s1')); await settle();
    const n = r.calls.length;
    expect(h.state(chat('s1'))).toBe('clean');
    expect(r.calls.length).toBe(n);
    expect(h.state(chat('s2'))).toBe('checking');
    await settle();
    expect(r.calls.length).toBeGreaterThan(n);
  });
});
