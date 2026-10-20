// The review pack (agents/review-pack.ts) on a real repository: branch, base, commits since it, changed and untracked
// files and the diff when it is short; per-file reading when it is long; nothing outside a repository or with no change.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewPack } from '../../../src/main/agents/review-pack';

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rp-'))); roots.push(d); return d; };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });

describe('reviewPack', () => {
  it('names the branch, the base, the commits, the files and the diff', async () => {
    const d = tmp();
    git(d, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(d, 'a.ts'), 'export const a = 1;\n');
    git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'init');
    expect(await reviewPack(d)).toBe('');
    git(d, 'checkout', '-q', '-b', 'feat/x');
    fs.writeFileSync(path.join(d, 'a.ts'), 'export const a = 2;\n');
    git(d, 'commit', '-q', '-am', 'feat: a is 2');
    fs.writeFileSync(path.join(d, 'new.ts'), 'x');
    const p = await reviewPack(d);
    expect(p).toContain('Branch feat/x, base main');
    expect(p).toContain('feat: a is 2');
    expect(p).toContain('a.ts');
    expect(p).toContain('Untracked files: new.ts');
    expect(p).toContain('+export const a = 2;');
    expect(await reviewPack(d, 10)).toMatch(/read it per file with `git diff [0-9a-f]+ -- <file>`/);
    expect(await reviewPack(tmp())).toBe('');
  });
});

describe('ChatManager: the pack goes under a Sentinel\'s first message only', () => {
  it('a Sentinel gets it, another role does not', async () => {
    const { ChatManager } = await import('../../../src/main/chats/manager');
    const sent = new Map<string, string[]>();
    const owner = (id: string) => ({ id, name: id, purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' as const, version: 1 });
    const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, reviewPack: async () => '[app · review pack] PACK',
      resolveAgent: req => ({ request: req, owner: owner(String(req.roleId)), instructions: '', policy: null, skills: [], launches: [] }) as never,
      sessionFactory: (_h, o, s) => ({ harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false, start() { s.changed({ state: 'idle' }); },
        send(t: string) { sent.set(o.chatId, [...(sent.get(o.chatId) ?? []), t]); }, close: async () => { s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null }) as never });
    try {
      const s = await m.create({ harness: 'claude', cwd: tmp(), roleId: 'sentinel', prompt: 'verifica' }, 'user');
      const a = await m.create({ harness: 'claude', cwd: tmp(), roleId: 'artisan', prompt: 'fai' }, 'user');
      expect(sent.get(s.id)?.[0]).toMatch(/verifica\n\n\[app · review pack\] PACK$/);
      expect(sent.get(a.id)?.[0]).not.toContain('PACK');
    } finally { await m.shutdown(); }
  });
});
