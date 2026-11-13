// What an Impara lesson is made from (ADR 0185, src/main/learn/material.ts): a GitHub PR through gh (view + diff, the
// user's own login, no credential passed), one of the Task page's DevOps PRs through git in its clone (branch against
// target), without a clone the description only and saying so, a pasted text, nothing for a topic; a long diff is cut
// for the prompt and kept whole in its file.
import { describe, expect, it } from 'vitest';
import { cutDiff, gather, githubPr, type Run } from '../../src/main/learn/material';
import type { DevopsPr } from '../../src/shared/contract';

const pr: DevopsPr = { id: 42, title: 'Fix login', repo: 'shop', project: 'P', author: 'me', createdAt: '', url: 'https://dev.azure.com/o/P/_git/shop/pullrequest/42',
  target: 'main', source: 'feature/login', draft: false, autoComplete: false, reviewers: [], build: null, workItems: [] };

describe('githubPr', () => {
  it('reads owner, repo and number from a PR link only', () => {
    expect(githubPr('https://github.com/lampi1/second-brain/pull/251/files')).toEqual({ owner: 'lampi1', repo: 'second-brain', number: 251 });
    expect(githubPr('https://github.com/lampi1/second-brain/issues/3')).toBeNull();
    expect(githubPr('https://evil.example/github.com/a/b/pull/1')).toBeNull();
  });
});

describe('cutDiff', () => {
  it('keeps whole files that fit and names the others', () => {
    const f = (n: string, size: number) => `diff --git a/${n} b/${n}\n${'+x\n'.repeat(size)}`;
    const d = f('a.ts', 10) + f('b.ts', 2000) + f('c.ts', 5);
    const c = cutDiff(d, 500);
    expect(c.cut).toBe(true);
    expect(c.text).toContain('a/a.ts');
    expect(c.text).not.toContain('a/b.ts b/b.ts');
    expect(c.text).toMatch(/b\.ts, c\.ts/);
    expect(cutDiff('small', 500)).toEqual({ text: 'small', cut: false });
  });
});

describe('gather', () => {
  it('a GitHub PR: gh pr view and gh pr diff, nothing else', async () => {
    const calls: string[][] = [];
    const run: Run = async (cmd, args) => { calls.push([cmd, ...args]); return args[1] === 'view' ? JSON.stringify({ number: 7, title: 'T', body: 'B', url: 'https://github.com/a/b/pull/7', files: [{ path: 'x.ts', additions: 1, deletions: 0 }] }) : 'diff --git a/x.ts b/x.ts\n+1'; };
    const m = await gather({ kind: 'pr', ask: '', prUrl: 'https://github.com/a/b/pull/7', depth: 'quick', level: 'new' }, { run, devops: () => ({ prs: [], repoDirs: {} }) });
    expect(calls.map(c => c.slice(0, 3))).toEqual([['gh', 'pr', 'view'], ['gh', 'pr', 'diff']]);
    expect(m.pr).toMatchObject({ provider: 'github', number: 7, repo: 'a/b', title: 'T' });
    expect(m.files['diff.patch']).toContain('+1');
    expect(m.text).toContain('- x.ts (+1 −0)');
    expect(m.cwd).toBeNull();
  });
  it('says what is missing when gh is not there', async () => {
    const run: Run = async () => { throw new Error('spawn gh ENOENT'); };
    await expect(gather({ kind: 'pr', ask: '', prUrl: 'https://github.com/a/b/pull/7', depth: 'quick', level: 'new' }, { run, devops: () => ({ prs: [], repoDirs: {} }) })).rejects.toThrow(/gh auth login/);
  });
  it('a DevOps PR: the branch against its target in the local clone, never a fetch', async () => {
    const calls: string[][] = [];
    const run: Run = async (cmd, args, cwd) => {
      calls.push([cmd, ...args, `@${cwd}`]);
      if (args[0] === 'rev-parse') { if (args.at(-1)!.startsWith('origin/')) return 'abc'; throw new Error('no'); }
      return args[0] === 'diff' && args[1] !== '--stat' ? 'diff --git a/l.ts b/l.ts\n+x' : 'ok';
    };
    const m = await gather({ kind: 'pr', ask: '', prUrl: pr.url, depth: 'quick', level: 'new' }, { run, devops: () => ({ prs: [pr], repoDirs: { shop: '/src/shop' } }) });
    expect(calls.every(c => c[0] === 'git' && c.at(-1) === '@/src/shop')).toBe(true);
    expect(calls.some(c => c.includes('fetch') || c.includes('pull'))).toBe(false);
    expect(calls.find(c => c[1] === 'diff' && c[2] !== '--stat')).toContain('origin/main...origin/feature/login');
    expect(m.cwd).toBe('/src/shop');
    expect(m.pr).toMatchObject({ provider: 'devops', number: 42 });
  });
  it('a DevOps PR with no clone: the description only, said in the material', async () => {
    const m = await gather({ kind: 'pr', ask: '', prUrl: pr.url, depth: 'quick', level: 'new' }, { run: async () => '', devops: () => ({ prs: [pr], repoDirs: {} }) });
    expect(m.text).toMatch(/Nessuna copia locale/);
    expect(m.files['diff.patch']).toBeUndefined();
  });
  it('an unknown link, a pasted text, a topic', async () => {
    const d = { run: async () => '', devops: () => ({ prs: [], repoDirs: {} }) };
    await expect(gather({ kind: 'pr', ask: '', prUrl: 'https://example.com/x', depth: 'quick', level: 'new' }, d)).rejects.toThrow(/non riconosciuta/);
    const t = await gather({ kind: 'text', ask: '', text: 'hello', depth: 'quick', level: 'new' }, d);
    expect(t.files['testo.md']).toBe('hello');
    expect((await gather({ kind: 'topic', ask: 'x', depth: 'quick', level: 'new' }, d)).text).toBe('');
  });
});
