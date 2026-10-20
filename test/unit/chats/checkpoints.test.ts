// Per-turn checkpoints (chats/checkpoints.ts, ADR 0103) on a real git repository: a snapshot records tracked and
// untracked files without touching the user's index, HEAD or branches; restore puts changed and deleted files back,
// removes the files created since, and leaves ignored files alone; with the turn's end recorded, a file changed again
// since is left as it is; a nested repository is skipped; names are literal; a backup ref holds the state before the
// undo; a folder outside git gives no checkpoint.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterTree, prune, repoRoot, restore, snapshot } from '../../../src/main/chats/checkpoints';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cp-'))); roots.push(d); return d; };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });
const write = (dir: string, f: string, s: string) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };

function repo(): string {
  const d = tmp();
  git(d, 'init', '-q', '-b', 'main');
  write(d, '.gitignore', 'dist/\n');
  write(d, 'a.txt', 'a1');
  write(d, 'b.txt', 'b1');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'init');
  return d;
}

describe('checkpoints', () => {
  it('records the files before a turn and puts them back, without touching index, HEAD or branches', async () => {
    const d = repo();
    write(d, 'a.txt', 'a2 (uncommitted, before the turn)');
    write(d, 'notes.md', 'untracked before the turn');
    git(d, 'add', 'a.txt');
    const head = git(d, 'rev-parse', 'HEAD'), staged = git(d, 'diff', '--cached', '--name-only');
    const cp = await snapshot(path.join(d), 'refs/sb/checkpoints/c_x/1');
    expect(path.resolve(cp!.root)).toBe(d);
    expect(git(d, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(d, 'diff', '--cached', '--name-only')).toBe(staged);
    expect(git(d, 'branch', '--list')).toContain('main');
    // the turn: edits, deletes, creates, builds
    write(d, 'a.txt', 'a3 by the agent');
    fs.rmSync(path.join(d, 'b.txt'));
    write(d, 'src/new.ts', 'created by the agent');
    write(d, 'dist/out.js', 'ignored build');
    const out = await restore(cp!, 'refs/sb/undo/c_x/1');
    expect(out.removed).toEqual(['src/new.ts']);
    expect(git(d, 'show', 'refs/sb/undo/c_x/1:src/new.ts')).toBe('created by the agent');
    expect(out.restored.sort()).toEqual(['a.txt', 'b.txt']);
    expect(fs.readFileSync(path.join(d, 'a.txt'), 'utf8')).toBe('a2 (uncommitted, before the turn)');
    expect(fs.readFileSync(path.join(d, 'b.txt'), 'utf8')).toBe('b1');
    expect(fs.readFileSync(path.join(d, 'notes.md'), 'utf8')).toBe('untracked before the turn');
    expect(fs.existsSync(path.join(d, 'src/new.ts'))).toBe(false);
    expect(fs.existsSync(path.join(d, 'dist/out.js'))).toBe(true);
    expect(git(d, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('after the turn ended, only its own changes go back: a later edit, a nested repository and odd names', async () => {
    const d = repo();
    // a name git would read as a pattern ([ab] matches a.md), legal on Windows too
    write(d, 'a.md', 'kept');
    const cp = await snapshot(d, 'refs/sb/checkpoints/c_z/1');
    // the turn
    write(d, 'a.txt', 'by the turn');
    write(d, 'b.txt', 'by the turn, then the user');
    write(d, '[ab].md', 'literal name');
    const nested = path.join(d, 'vendor/lib');
    fs.mkdirSync(nested, { recursive: true });
    git(nested, 'init', '-q'); write(nested, 'f.txt', 'f'); git(nested, 'add', '-A'); git(nested, 'commit', '-q', '-m', 'n');
    cp!.after = (await afterTree(d))!;
    // after the turn: the user edits b.txt and writes a file of their own
    write(d, 'b.txt', 'the user\'s edit');
    write(d, 'mine.txt', 'the user\'s file');
    const out = await restore(cp!, 'refs/sb/undo/c_z/1');
    expect(fs.readFileSync(path.join(d, 'a.txt'), 'utf8')).toBe('a1');
    expect(fs.readFileSync(path.join(d, 'b.txt'), 'utf8')).toBe('the user\'s edit');
    expect(fs.existsSync(path.join(d, '[ab].md'))).toBe(false);
    expect(fs.readFileSync(path.join(d, 'a.md'), 'utf8')).toBe('kept');
    expect(fs.existsSync(path.join(d, 'mine.txt'))).toBe(true);
    expect(fs.existsSync(path.join(nested, 'f.txt'))).toBe(true);
    expect(out.skipped.sort()).toEqual(['b.txt', 'vendor/lib']);
    expect(out.removed).toEqual(['[ab].md']);
  });

  it('a folder outside git has none; old refs are pruned', async () => {
    expect(await repoRoot(tmp())).toBeNull();
    expect(await snapshot(tmp(), 'refs/sb/checkpoints/c/1')).toBeNull();
    const d = repo();
    for (let i = 0; i < 4; i++) await snapshot(d, `refs/sb/checkpoints/c_y/${i}`);
    await prune(d, 'refs/sb/checkpoints/c_y/', 2);
    expect(git(d, 'for-each-ref', '--format=%(refname)', 'refs/sb/checkpoints/c_y/').trim().split('\n')).toHaveLength(2);
  });
});

describe('ChatManager: a checkpoint before each turn, «Annulla l\'ultimo turno»', () => {
  it('records the files before a work chat\'s turn, puts them back on undo, and tells the chat with its next message', async () => {
    const { ChatManager } = await import('../../../src/main/chats/manager');
    const crypto = await import('node:crypto');
    const d = repo(), sent: string[] = [];
    const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, checkpoints: () => true, sessionFactory: (_h, o: { sessionId?: string | null }, s) => ({
      harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); write(d, 'a.txt', `changed by turn ${sent.length}`); },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
    try {
      const c = await m.create({ harness: 'anthropic', cwd: d, prompt: 'fai X' });
      expect(m.list().find(x => x.id === c.id)?.checkpointAt).toBeTypeOf('number');
      expect(fs.readFileSync(path.join(d, 'a.txt'), 'utf8')).toBe('changed by turn 1');
      await new Promise(r => setTimeout(r, 0));
      expect(await m.undoTurn(c.id)).toEqual({ restored: 1, removed: 0 });
      expect(fs.readFileSync(path.join(d, 'a.txt'), 'utf8')).toBe('a1');
      expect(m.items(c.id).some(i => i.kind === 'system' && /annullato|undone/i.test(i.text))).toBe(true);
      await expect(m.undoTurn(c.id)).rejects.toThrow(/Niente da annullare/);
      await m.send(c.id, 'riprova');
      expect(sent.at(-1)).toMatch(/annullato il tuo ultimo turno[\s\S]*riprova$/);
      const orch = await m.create({ harness: 'anthropic', cwd: d, orchestrator: true, prompt: 'ciao' });
      expect(m.list().find(x => x.id === orch.id)?.checkpointAt).toBeUndefined();
    } finally { await m.shutdown(); }
  });
});
