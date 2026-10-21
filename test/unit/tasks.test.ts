// Task page logic (src/main/tasks/model.ts) and service (service.ts) with the script's results faked: parsing of
// devops-me.mjs --json / --prs --json (defensive: https links only), news merge and unread, feed events (one summary
// when many, a first read never floods), the --full details (description, comments, test cases) kept by id, the az
// login error, the timer only when turned on, read marks kept on disk.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { causeOf, errorOf, feedFor, scriptStderr, mergeNews, newsLine, parseNewsRun, parsePrsRun, windowDays, type StoredNews } from '../../src/main/tasks/model';
import { TaskService, type TaskDeps } from '../../src/main/tasks/service';
import { demoDevopsRun } from '../../src/main/tasks/demo';
import type { RunResult } from '../../src/main/brain/node';
import type { TasksState } from '../../src/shared/contract';

const NOW = Date.parse('2026-10-11T10:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const news = (key: string, minAgo = 10, kind: StoredNews['kind'] = 'mention'): StoredNews => ({ key, at: iso(minAgo), kind, who: 'Giulia', title: `Titolo ${key}`, url: `https://dev.azure.com/x/${key}` });

describe('task model', () => {
  it('parses the script JSON, dropping rows without an https link, a title or a known kind', () => {
    const r = parseNewsRun(JSON.stringify({
      news: [news('a'), { ...news('b'), url: 'javascript:alert(1)' }, { ...news('c'), kind: 'weird' }, { ...news('d'), at: 'nope' }],
      assigned: [{ id: 1, title: 'Uno', url: 'https://dev.azure.com/x/1', state: 'Active', priority: 2 }, { id: 2, title: 'Due', url: 'file:///c:/x' }],
      urgent: 'not an array',
    }));
    expect(r.news.map(n => n.key)).toEqual(['a']);
    expect(r.assigned.map(w => w.id)).toEqual([1]);
    expect(r.urgent).toEqual([]);
    expect(() => parseNewsRun('{"hello":1}')).toThrow(/non riconosciuta/);
    expect(() => parseNewsRun('az: error')).toThrow();
  });

  it('parses PRs with reviewers, build (only with an https link) and linked work items', () => {
    const { prs } = parsePrsRun(JSON.stringify({ prs: [
      { id: 5, title: 'PR', url: 'https://dev.azure.com/x/pr/5', autoComplete: true, draft: false, reviewers: [{ name: 'A', vote: 10, label: 'approvata', required: true }, { vote: 5 }],
        build: { result: 'failed', status: 'completed', number: '1', url: 'https://dev.azure.com/x/b/1' }, workItems: [{ id: 9, title: 'Bug', url: 'https://dev.azure.com/x/9' }] },
      { id: 6, title: 'Senza build', url: 'https://dev.azure.com/x/pr/6', build: { result: 'ok', url: 'http://evil' } },
    ] }));
    expect(prs[0]).toMatchObject({ id: 5, autoComplete: true, reviewers: [{ name: 'A', vote: 10, required: true }], build: { result: 'failed' }, workItems: [{ id: 9 }] });
    expect(prs[1]!.build).toBeNull();
  });

  it('--full: keeps the details by work item id, the whole comment text and the PR last comment; drops broken rows', () => {
    const run = parseNewsRun(JSON.stringify({
      news: [{ ...news('a'), body: 'Riga uno\nRiga due' }], assigned: [],
      details: {
        42: { description: 'Passi', stateSince: '2026-10-01T10:00:00Z', comments: [{ who: 'Anna Neri', at: '2026-10-07T09:58:26Z', text: 'retest ok' }, { who: 'x', at: 'nope', text: 'y' }],
          tests: [{ id: 7, title: 'TC 7', outcome: 'Failed', url: 'https://dev.azure.com/x/7' }, { id: 8, title: 'TC 8', url: 'javascript:x' }] },
        abc: { description: 'not an id' }, 43: 'not an object',
      },
    }));
    expect(run.news[0]!.body).toBe('Riga uno\nRiga due');
    expect(Object.keys(run.details)).toEqual(['42']);
    expect(run.details['42']).toEqual({ description: 'Passi', stateSince: '2026-10-01T10:00:00Z', createdAt: null,
      comments: [{ who: 'Anna Neri', mine: false, at: '2026-10-07T09:58:26Z', text: 'retest ok' }], tests: [{ id: 7, title: 'TC 7', outcome: 'Failed', url: 'https://dev.azure.com/x/7' }] });
    const { prs, details } = parsePrsRun(JSON.stringify({ prs: [{ id: 5, title: 'PR', url: 'https://dev.azure.com/x/pr/5', activeThreads: 2,
      lastComment: { who: 'Paolo', at: '2026-10-07T09:58:26Z', text: 'ok per me', url: 'https://dev.azure.com/x/pr/5?discussionId=3' } },
    { id: 6, title: 'PR', url: 'https://dev.azure.com/x/pr/6', lastComment: { who: 'G', at: '2026-10-07T09:58:26Z', text: 't', url: 'http://evil' } }] }));
    expect(prs[0]).toMatchObject({ activeThreads: 2, lastComment: { who: 'Paolo', text: 'ok per me', mine: false } });
    expect(prs[1]!.lastComment).toBeUndefined();
    expect(details).toEqual({});
  });

  it('asks for 3 days the first time, then the days since the last good read (1..14)', () => {
    expect(windowDays(null, NOW)).toBe(3);
    expect(windowDays(NOW - 3600e3, NOW)).toBe(1);
    expect(windowDays(NOW - 2.5 * 864e5, NOW)).toBe(3);
    expect(windowDays(NOW - 60 * 864e5, NOW)).toBe(14);
  });

  it('merges by key: overlapping windows add nothing twice, old news fall off after 14 days', () => {
    const first = mergeNews([], [news('a'), news('b')], NOW);
    expect(first.added.map(n => n.key)).toEqual(['a', 'b']);
    const again = mergeNews(first.all, [news('b'), news('c', 1)], NOW);
    expect(again.added.map(n => n.key)).toEqual(['c']);
    expect(again.all.map(n => n.key)).toEqual(['c', 'a', 'b']);
    expect(mergeNews([news('old', 15 * 24 * 60)], [], NOW).all).toEqual([]);
    // a vote on an old PR carries the PR's date: still news while the script reports it
    expect(mergeNews([], [news('vote', 20 * 24 * 60, 'vote')], NOW).added.map(n => n.key)).toEqual(['vote']);
  });

  it('feed: one event per new unread news up to 3, else one summary; read ones never', () => {
    expect(feedFor([news('a')], new Set(['a']))).toEqual([]);
    const two = feedFor([news('a'), news('b', 5, 'build')], new Set());
    expect(two).toHaveLength(2);
    expect(two[0]).toMatchObject({ kind: 'task', title: 'Giulia ti menziona: Titolo a' });
    expect(two[0]!.detail).toContain('https://dev.azure.com/x/a');
    const many = feedFor(['a', 'b', 'c', 'd'].map(k => news(k)), new Set());
    expect(many).toEqual([expect.objectContaining({ kind: 'task', title: '4 novità su DevOps' })]);
    expect(newsLine({ kind: 'build', who: null })).toBe('Build fallita sulla tua PR');
  });

  it('maps an expired az login (exit 2 or Azure wording) to the command to run', () => {
    expect(errorOf({ stdout: '', stderr: 'DevOps: az login scaduto', code: 2 }, 'Lettura')).toMatchObject({ kind: 'login', command: 'az login' });
    expect(errorOf({ stdout: '', stderr: 'AADSTS700082: The refresh token has expired', code: 1 }, 'Lettura')).toMatchObject({ kind: 'login' });
    expect(errorOf({ stdout: '', stderr: "'az' is not recognized as an internal command", code: 2 }, 'Lettura').kind).toBe('failed'); // the script exits 2 here too
    expect(errorOf({ stdout: '', stderr: '\n  HTTP 500 on wiql\nstack', code: 1 }, 'Lettura delle PR')).toEqual({ kind: 'failed', message: 'Lettura delle PR non riuscita: HTTP 500 on wiql' });
  });

  it('Node\'s own warnings never hide the script\'s error, in the log cause nor on the page (#149)', () => {
    const stderr = '(node:31900) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities\n(Use `electron --trace-deprecation ...` to show where the warning was created)\nnode:internal/modules/run_main:1\nError: boom\n    at main (devops-me.mjs:10:3)';
    const r = { stdout: '', stderr, code: 1 };
    expect(scriptStderr(stderr)).not.toContain('DEP0190');
    expect(causeOf(r)).toContain('Error: boom');
    expect(causeOf({ stdout: '', stderr: `${'x'.repeat(400)}\nError: boom`, code: 1 })).toMatch(/Error: boom$/);
    expect(causeOf({ stdout: '', stderr: '', code: 3 })).toBe('code 3');
    expect(errorOf(r, 'Lettura delle novità').message).not.toContain('DEP0190');
  });
});

describe('TaskService', () => {
  afterEach(() => { vi.useRealTimers(); });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tasks-'));
  const ok = (o: unknown): RunResult => ({ stdout: JSON.stringify(o), stderr: '', code: 0 });

  function make(opts: { run?: TaskDeps['run']; enabled?: boolean; everyMin?: number; dir?: string; locate?: TaskDeps['locate']; now?: () => number } = {}) {
    const states: TasksState[] = [];
    const feed: unknown[][] = [];
    const calls: string[][] = [];
    const settings = { enabled: opts.enabled ?? false, everyMin: opts.everyMin ?? 30, sound: true };
    const dir = opts.dir ?? tmp();
    const run: TaskDeps['run'] = opts.run ?? (async (_s, args) => (args.includes('--prs') ? ok({ prs: [] }) : ok({ news: [news('a'), news('b')], assigned: [], urgent: [], oldReviews: [] })));
    const svc = new TaskService({
      file: path.join(dir, 'tasks.json'), brainRoot: () => dir, settings: () => settings, locate: opts.locate ?? (() => 'devops-me.mjs'),
      run: async (s, a, c, t) => { calls.push(a); return run(s, a, c, t); },
      emit: s => states.push(s), feed: e => feed.push(e), now: opts.now ?? (() => NOW),
    });
    return { svc, states, feed, calls, settings, dir };
  }

  it('reads with the script (news then PRs), keeps the state on disk, marks read', async () => {
    const t = make();
    const s = await t.svc.refresh();
    expect(t.calls).toEqual([['--json', '--full', '--days', '3'], ['--prs', '--json', '--full']]);
    expect(s).toMatchObject({ unread: 2, error: null, at: NOW, enabled: false, nextAt: null, running: false });
    expect(t.states.at(-1)!.running).toBe(false);
    expect(t.feed).toEqual([[expect.objectContaining({ title: '2 novità su DevOps' })]]); // a first read: one line, never a flood
    expect(t.svc.markRead(['a']).unread).toBe(1);
    const again = make({ dir: t.dir });                    // a new start reads tasks.json
    expect(again.svc.get()).toMatchObject({ at: NOW, unread: 1 });
    expect(again.svc.markRead().unread).toBe(0);
    t.svc.shutdown(); again.svc.shutdown();
  });

  it('a devops.json from before the rename to Task (ADR 0079) is moved to tasks.json once, its read kept', async () => {
    const t = make();
    await t.svc.refresh();
    t.svc.markRead(['a']);
    t.svc.shutdown();
    fs.renameSync(path.join(t.dir, 'tasks.json'), path.join(t.dir, 'devops.json'));
    const again = make({ dir: t.dir });
    expect(again.svc.get()).toMatchObject({ at: NOW, unread: 1 });
    expect(fs.existsSync(path.join(t.dir, 'devops.json'))).toBe(false);
    expect(fs.existsSync(path.join(t.dir, 'tasks.json'))).toBe(true);
    again.svc.shutdown();
  });

  it('a mark read survives a rename refused for a moment (Windows: antivirus or indexer holding tasks.json)', async () => {
    const t = make();
    await t.svc.refresh();
    const real = fs.renameSync;
    let refused = 0;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (refused < 2) { refused++; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); }
      return real(a, b);
    });
    t.svc.markRead(['a']);
    spy.mockImplementation(() => { throw Object.assign(new Error('EBUSY: resource busy, rename'), { code: 'EBUSY' }); });
    t.svc.markRead(['b']);                                 // refused every time: the file is written directly
    spy.mockRestore();
    expect(refused).toBe(2);
    expect(make({ dir: t.dir }).svc.get()).toMatchObject({ unread: 0 });
    t.svc.shutdown();
  });

  it('second read: only the news never seen go to the feed (a mention as an alert, ADR 0029)', async () => {
    let n = 0;
    const t = make({ run: async (_s, a) => (a.includes('--prs') ? ok({ prs: [] }) : ok({ news: n++ ? [news('a'), news('c', 1)] : [news('a')], assigned: [] })) });
    await t.svc.refresh();
    t.feed.length = 0;
    await t.svc.refresh();
    expect(t.feed).toEqual([[expect.objectContaining({ kind: 'task-alert', title: 'Giulia ti menziona: Titolo c' })]]);
    t.svc.shutdown();
  });

  it('an expired login shows the command and keeps the last good data', async () => {
    let fail = false;
    const t = make({ run: async (_s, a) => (fail ? { stdout: '', stderr: 'az login scaduto: lancia az login', code: 2 } : a.includes('--prs') ? ok({ prs: [] }) : ok({ news: [news('a')], assigned: [] })) });
    await t.svc.refresh();
    fail = true;
    const s = await t.svc.refresh();
    expect(s.error).toMatchObject({ kind: 'login', command: 'az login' });
    expect(s.news.map(x => x.key)).toEqual(['a']);
    await t.svc.refresh();                                 // still expired: the feed is told once
    expect(t.feed.filter(e => (e as { title: string }[])[0]!.title === 'DevOps: accesso scaduto')).toHaveLength(1);
    t.svc.shutdown();
  });

  it('a hand-edited tasks.json with broken rows never breaks the start', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ lastOk: NOW, news: [null, news('a'), { key: 1 }], read: [3, 'a'], assigned: [null], prs: [{ id: 1 }] }));
    const t = make({ dir });
    expect(t.svc.get()).toMatchObject({ unread: 0, assigned: [], prs: [] });
    expect(t.svc.get().news.map(n => n.key)).toEqual(['a']);
    t.svc.shutdown();
  });

  it('a tasks.json from before "reviews" gets them from its old reviews at start', () => {
    const dir = tmp();
    const ref = { id: 79, title: 'R', repo: 'r', project: 'p', author: 'A', createdAt: new Date(NOW).toISOString(), url: 'https://dev.azure.com/x/p/_git/r/pullrequest/79' };
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ lastOk: NOW, news: [], read: [], assigned: [], oldReviews: [ref], prs: [] }));
    const t = make({ dir });
    expect(t.svc.get().reviews.map(p => p.id)).toEqual([79]);
    t.svc.shutdown();
  });

  it('without the script in the brain it says so and runs nothing', async () => {
    const t = make({ locate: () => null });
    const s = await t.svc.refresh();
    expect(s.error?.kind).toBe('script');
    expect(t.calls).toEqual([]);
    t.svc.shutdown();
  });

  it('one read at a time: a second refresh joins the running one', async () => {
    const t = make();
    const [a, b] = [t.svc.refresh(), t.svc.refresh()];
    expect(a).toBe(b);
    await a;
    expect(t.calls).toHaveLength(2);
    t.svc.shutdown();
  });

  it('no timer while off; when on, reads after a short delay and then every N minutes', async () => {
    vi.useFakeTimers();
    let clock = NOW;
    const t = make({ now: () => clock });
    t.svc.schedule();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(t.calls).toEqual([]);
    t.settings.enabled = true; t.settings.everyMin = 15;
    t.svc.schedule();
    expect(t.svc.get().nextAt).toBe(NOW + 5000);
    clock += 5000; await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls).toHaveLength(2);
    expect(t.svc.get().nextAt).toBe(clock + 15 * 60_000);
    t.settings.enabled = false;
    t.svc.schedule();
    expect(t.svc.get().nextAt).toBeNull();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(t.calls).toHaveLength(2);
    t.svc.shutdown();
  });

  it('the demo runner gives data the service accepts', async () => {
    const demo = demoDevopsRun(() => NOW);
    const t = make({ run: (s, a) => demo(s, a) });
    const s = await t.svc.refresh();
    expect(s.error).toBeNull();
    expect(s.news.length).toBeGreaterThan(3);
    expect(s.prs[0]!.reviewers.length).toBeGreaterThan(0);
    expect(s.details['4711']!.comments.length).toBeGreaterThan(0);  // the demo has --full details too
    expect(s.news.find(n => n.kind === 'mention')!.body).toBeTruthy();
    expect(t.feed.flat()).not.toContainEqual(expect.objectContaining({ kind: 'task-alert' })); // first read: baseline
    await t.svc.refresh();                                 // the demo's second read brings a new mention: one alert
    expect(t.feed.flat().filter(e => (e as { kind: string }).kind === 'task-alert')).toEqual([expect.objectContaining({ title: 'Marco ti menziona: Promemoria SMS inviati due volte' })]);
    t.svc.shutdown();
  });
});
