// Opening a maintenance card's issue (ADR 0153, brainmodel/issue-open.ts): gh first with the body on stdin, again
// without labels when gh refuses them, else the pre-filled new-issue page in the browser; a long body is cut to fit.
import { describe, expect, it } from 'vitest';
import { newIssueUrl, openIssue } from '../../../src/main/brainmodel/issue-open';

const issue = { title: 'Log: search box', body: 'Context\n\nSteps', labels: ['enhancement'] };

describe('openIssue', () => {
  it('creates it with gh, the body on stdin', async () => {
    const calls: { args: string[]; stdin: string }[] = [];
    const r = await openIssue('lampi1/second-brain', issue, {
      run: async (args, stdin) => { calls.push({ args, stdin }); return 'Creating issue\nhttps://github.com/lampi1/second-brain/issues/42\n'; },
      openUrl: async () => { throw new Error('no browser'); },
    });
    expect(r).toEqual({ url: 'https://github.com/lampi1/second-brain/issues/42', via: 'gh' });
    expect(calls[0]!.args).toEqual(['issue', 'create', '--repo', 'lampi1/second-brain', '--title', 'Log: search box', '--body-file', '-', '--label', 'enhancement']);
    expect(calls[0]!.stdin).toBe('Context\n\nSteps');
  });
  it('tries again without labels, then falls back to the browser', async () => {
    const calls: string[][] = [];
    const ok = await openIssue('lampi1/second-brain', issue, {
      run: async args => { calls.push(args); if (args.includes('--label')) throw new Error('label not found'); return 'https://github.com/lampi1/second-brain/issues/7'; },
      openUrl: async () => {},
    });
    expect(ok.via).toBe('gh');
    expect(calls).toHaveLength(2);
    const opened: string[] = [];
    const r = await openIssue('lampi1/second-brain', issue, { run: async () => { throw new Error('gh: not found'); }, openUrl: async u => { opened.push(u); } });
    expect(r.via).toBe('browser');
    expect(opened).toEqual([r.url]);
    const u = new URL(r.url);
    expect(u.pathname).toBe('/lampi1/second-brain/issues/new');
    expect(u.searchParams.get('title')).toBe('Log: search box');
    expect(u.searchParams.get('body')).toBe('Context\n\nSteps');
    expect(u.searchParams.get('labels')).toBe('enhancement');
  });
  it('refuses a strange repository and cuts a long body to fit the link', async () => {
    await expect(openIssue('a b/c', issue, { run: async () => '', openUrl: async () => {} })).rejects.toThrow(/Repository/);
    const url = newIssueUrl('lampi1/second-brain', { title: 't', body: 'x'.repeat(20_000) });
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(new URL(url).searchParams.get('body')!.endsWith('…')).toBe(true);
  });
});
