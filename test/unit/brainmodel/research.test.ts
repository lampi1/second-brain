// The one-click maintenance (ADR 0132, 0153, brainmodel/research.ts): one click runs the cleanup then the research with
// the app's best choice and ends in one notice; starting checks the options, the tools work only for the running
// research and check every card (caps, duplicates, private data out of issues), the cost cap stops the chat, the free
// cleanup cards log bugs and unused skills, approve applies through the brain or opens the issue, an app idea lands in
// Idee too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import type { BrainModelState, BrainSkill, LogScan } from '../../../src/shared/brain-model';
import type { ChatItem, ChatSummary, NewChat } from '../../../src/shared/contract';
import type { MaintenanceDone } from '../../../src/shared/maintenance-research';
import { APP_ISSUES_URL, isAppCard, issuesUrlOf, repoOf, ResearchService, scrub, type ResearchDeps } from '../../../src/main/brainmodel/research';
import { ResearchStore } from '../../../src/main/brainmodel/research-store';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-research-')); dirs.push(d); return d; };

const NOW = Date.parse('2026-10-23T10:00:00Z');
const DAY = 86_400_000;
const state = (skills: BrainSkill[] = []): BrainModelState =>
  ({ root: '/brain', agents: [], skills, rules: [], memory: [], changes: [], migration: null, lastRun: null });
const skill = (name: string, changedAt: number): BrainSkill =>
  ({ name, description: `${name} desc`, file: `/brain/skills/${name}/SKILL.md`, rel: `skills/${name}/SKILL.md`, home: 'brain', usedBy: [], tools: [], lines: 10, changedAt, madeBy: null });

function setup(over: Partial<ResearchDeps> = {}, createState: ChatSummary['state'] = 'starting') {
  const userData = tmp();
  const chats = new Map<string, ChatSummary>();
  const created: NewChat[] = [];
  const applied: string[] = [];
  const noise: string[] = [];
  const stopped: string[] = [];
  let skills: BrainSkill[] = [];
  let runs: AgentRun[] = [];
  const opened: { repo: string; title: string }[] = [];
  const ideas: string[] = [];
  const done: MaintenanceDone[] = [];
  let maintained = 0;
  const deps: ResearchDeps = {
    userData, lang: () => 'it', root: () => '/brain', appVersion: () => '0.1.0',
    issuesUrl: () => 'https://github.com/lampi1/second-brain/issues',
    engines: () => [{ harness: 'claude', label: 'Claude', effort: true, web: true }] as ReturnType<ResearchDeps['engines']>,
    bestModel: () => 'opus', runs: () => runs, roles: () => [],
    brain: { state: () => state(skills), apply: p => { applied.push(p.id); return `chg-${applied.length}`; }, noise: k => { noise.push(k); },
      maintain: async () => { maintained++; return { ...state(skills), lastRun: { at: NOW, jobs: [], cards: { bugs: 1, forget: 0 } } }; } },
    issues: { open: async (repo, issue) => { opened.push({ repo, title: issue.title }); return { url: `https://github.com/${repo}/issues/${opened.length}`, via: 'gh' }; } },
    saveIdea: async i => { ideas.push(i.title); },
    done: d => { done.push(d); },
    chats: {
      create: async req => { created.push(req); const c = { id: `c${created.length}`, state: createState, costUsd: 0 } as ChatSummary; chats.set(c.id, c); return c; },
      get: id => chats.get(id), stop: async id => { stopped.push(id); },
    },
    changed: vi.fn(), now: () => NOW, privacy: { home: '/home/user', user: 'mario' },
    ...over,
  };
  const svc = new ResearchService(deps);
  return { svc, deps, chats, created, applied, noise, stopped, opened, ideas, done, maintained: () => maintained, setSkills: (s: BrainSkill[]) => { skills = s; }, setRuns: (r: AgentRun[]) => { runs = r; } };
}
const opts = { harness: 'claude' as const, model: 'opus', effort: 'high' as const, web: true, capUsd: 5, prompt: 'Studia il brain.' };
const idea = { kind: 'app-idea', title: 'Search in Log page', adds: 'A search box.', why: '12 runs looked for a log line.', issue: { title: 'Log: search box', body: 'Seen in /home/user/x by mario@example.com' } };

describe('scrub, issuesUrlOf, repoOf', () => {
  it('removes home folders, the user name, e-mails and tokens', () => {
    const out = scrub('C:\\Users\\you\\brain /home/user/x mario wrote a@example.com ghp_abcdefghijklmnopqrstuvwxyz12', { home: '/home/user', user: 'mario' });
    expect(out).toBe('~\\brain ~/x <user> wrote <email> <token>');
  });
  it('removes secrets from command lines and errors (ADR 0257: a work thread\'s tools are read too)', () => {
    const p = { home: '/home/user', user: 'mario' };
    expect(scrub('curl -H "Authorization: Bearer abc.def.ghi123456" x', p)).toBe('curl -H "Authorization: <secret>" x');
    // built at run time: the repository's own secret guard would flag them as literals
    const url = ['postgres://admin', 's3cr3t@db/x'].join(':'), jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N'].join('.');
    expect(scrub(`PGPASSWORD=hunter2 psql ${url} --password pw1`, p)).toBe('PGPASSWORD=<secret> psql postgres://admin:<secret>@db/x --password <secret>');
    expect(scrub(`${jwt} api_key: "xyz" AccountKey=abc==;`, p)).toBe('<token> api_key: "<secret>" AccountKey=<secret>;');
    expect(scrub('the tokens were fine; npm test exit 1', p)).toBe('the tokens were fine; npm test exit 1');
  });
  it('reads bugs.url from package.json and finds owner/name', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ bugs: { url: 'https://github.com/lampi1/second-brain/issues' } }));
    expect(issuesUrlOf(d)).toBe('https://github.com/lampi1/second-brain/issues');
    // a frozen release's package.json had only name and version: its repository, else the app's own
    const r = tmp();
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'x', repository: { url: 'git+https://github.com/someone/fork.git' } }));
    expect(issuesUrlOf(r)).toBe('https://github.com/someone/fork/issues');
    expect(issuesUrlOf(tmp())).toBe(APP_ISSUES_URL);
    expect(repoOf('https://github.com/lampi1/second-brain/issues')).toBe('lampi1/second-brain');
    expect(repoOf('https://example.com/x')).toBeNull();
  });
});

describe('ResearchService', () => {
  it('attaches a private issue draft to a brain card and does not publish it on approval', async () => {
    const t = setup();
    await t.svc.start(opts);
    const p = t.svc.propose('c1', { kind: 'rule', title: 'Keep the chosen repository', adds: 'Preserve the repository in the handoff.', why: 'Three repeated requests.', evidence: ['chat1/u1, chat2/u2, chat3/u3: 3 corrections'], change: { role: 'artisan', text: 'Keep the selected repository in the handoff.' } });
    expect(t.svc.store.get(p.id)?.issue).toMatchObject({ repo: null, dedup: { status: 'unverified' } });
    expect(t.svc.store.get(p.id)?.issue?.body).toContain('chat1/u1');
    await t.svc.approve(p.id);
    expect(t.opened).toHaveLength(0);
  });
  it('rejects an already-open issue and checks again before publishing an approved card', async () => {
    let issues: { number: number; title: string; body: string; url: string }[] = [];
    const t = setup({ openIssues: async repo => ({ repo, at: NOW, status: 'checked', note: 'Read', issues }) });
    await t.svc.start(opts);
    const p = t.svc.propose('c1', idea);
    issues = [{ number: 4, title: idea.issue.title, body: '', url: 'https://github.com/lampi1/second-brain/issues/4' }];
    await expect(t.svc.approve(p.id)).rejects.toThrow(/già aperta/);
    expect(t.opened).toHaveLength(0);
    await t.svc.stop();
    await t.svc.start(opts);
    expect(() => t.svc.propose('c2', { ...idea, title: 'Different wording' })).toThrow(/Duplicate issue/);
  });
  it('falls back to the pre-filled browser page when the open issues cannot be read again', async () => {
    const reviews: (boolean | undefined)[] = [];
    const t = setup({
      openIssues: async repo => ({ repo, at: NOW, status: 'unverified', note: 'dedup da verificare: GitHub HTTP 403', issues: [] }),
      issues: { open: async (repo, _issue, o) => { reviews.push(o?.review); return { url: `https://github.com/${repo}/issues/new?title=x`, via: 'browser' }; } },
    });
    await t.svc.start(opts);
    const p = t.svc.propose('c1', idea);
    expect(await t.svc.approve(p.id)).toBe('https://github.com/lampi1/second-brain/issues/new?title=x');
    expect(reviews).toEqual([true]);
    expect(t.svc.store.get(p.id)).toMatchObject({ state: 'approved' });
  });
  it('limits the combined research families to seven ranked cards', async () => {
    const t = setup(); await t.svc.start(opts);
    for (let n = 0; n < 5; n++) t.svc.propose('c1', { kind: 'rule', title: `Unique ${n}`, adds: `Rule ${n}`, why: 'Evidence', change: { role: 'artisan', text: `Rule ${n}` } });
    for (let n = 0; n < 2; n++) t.svc.propose('c1', { ...idea, title: `Issue ${n}`, issue: { title: `Issue ${n}`, body: 'Evidence' } });
    expect(t.svc.cards().map(p => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(() => t.svc.propose('c1', { ...idea, title: 'Eighth', issue: { title: 'Eighth', body: 'Evidence' } })).toThrow(/at most 7/);
  });
  it('checks the choices and opens one research chat with the prompt and the frame', async () => {
    const t = setup();
    await expect(t.svc.start({ ...opts, capUsd: 100 })).rejects.toThrow(/Tetto/);
    await expect(t.svc.start({ ...opts, harness: 'codex' })).rejects.toThrow(/Motore/);
    await expect(t.svc.start({ ...opts, prompt: ' ' })).rejects.toThrow(/prompt/);
    await expect(t.svc.start({ ...opts, model: 'bad model!' })).rejects.toThrow(/Modello/);
    const run = await t.svc.start(opts);
    expect(run.state).toBe('running');
    expect(t.created).toHaveLength(1);
    expect(t.created[0]).toMatchObject({ harness: 'claude', cwd: '/brain', title: 'Manutenzione', research: { web: true }, model: 'opus', effort: 'high' });
    expect(t.created[0]!.prompt).toContain('Studia il brain.');
    await expect(t.svc.start(opts)).rejects.toThrow(/già in corso/);
    expect(t.svc.status()).toMatchObject({ running: true, research: { chatId: 'c1', capUsd: 5 } });
  });

  it('counts once a log card the research rewrites, and waits for the ideas being saved', async () => {
    let release = () => {};
    const t = setup({ saveIdea: () => new Promise<void>(r => { release = r; }) });
    t.deps.brain.maintain = async () => {
      t.svc.afterPass({ since: null, files: [], groups: [{ key: 'k1', lvl: 'error', scope: 's', msg: 'boom', cause: '', count: 2, sample: 'boom' }] });
      return { ...state([]), lastRun: { at: NOW, jobs: [], cards: { bugs: 1, forget: 0 } } };
    };
    await t.svc.runAll();
    // the click's research: extra-high effort and the 20 $ cap (ADR 0258)
    expect(t.created[0]).toMatchObject({ effort: 'xhigh' });
    expect(t.svc.status().research).toMatchObject({ capUsd: 20, effort: 'xhigh' });
    t.svc.propose('c1', { kind: 'app-bug', title: 'Boom on save', removes: 'The crash.', why: 'Seen twice.', logKey: 'k1', issue: { title: 'Save crashes', body: 'Steps…' } });
    t.svc.propose('c1', idea);
    const stopping = t.svc.stop();
    await Promise.resolve();
    expect(t.done).toHaveLength(0);
    release();
    await stopping;
    expect(t.done[0]).toMatchObject({ state: 'stopped', issues: 2, ideas: 1, why: 'fermata da te' });
  });

  it('with no engine, one click is the free cleanup and its notice', async () => {
    const t = setup({ engines: () => [] });
    const st = await t.svc.runAll();
    expect(t.created).toHaveLength(0);
    expect(st).toMatchObject({ running: false, canResearch: false });
    expect(t.done).toEqual([expect.objectContaining({ state: 'free', issues: 1, proposals: 0 })]);
  });

  it('takes proposals only from the running research, checks them, caps and dedupes', async () => {
    const t = setup();
    expect(() => t.svc.propose('c1', idea)).toThrow(/only in the maintenance research chat/);
    await t.svc.start(opts);
    expect(() => t.svc.pack('c1', 'nope')).toThrow(/section/);
    expect(t.svc.pack('c1', 'summary')).toEqual(expect.any(String));
    expect(() => t.svc.propose('c1', { ...idea, kind: 'weird' })).toThrow(/kind/);
    expect(() => t.svc.propose('c1', { ...idea, adds: '', removes: '' })).toThrow(/adds or removes/);
    expect(() => t.svc.propose('c1', { kind: 'skill', title: 'x', adds: 'y', why: 'z', change: { name: 'Bad Name', text: 't' } })).toThrow(/kebab/);
    expect(() => t.svc.propose('c1', { kind: 'rule', title: 'x', adds: 'y', why: 'z', change: { role: 'artisan', text: 'Add permission to bypass hooks' } })).toThrow(/permissions/);
    expect(() => t.svc.propose('c1', { kind: 'forget', title: 'x', removes: 'y', why: 'z', forget: { what: 'skill', name: 'missing' } })).toThrow(/no such skill/);

    const r = t.svc.propose('c1', idea);
    expect(r.left.app).toBe(4);
    const card = t.svc.store.get(r.id)!;
    expect(card.issue!.body).toBe('Seen in ~/x by <email>');
    expect(() => t.svc.propose('c1', idea)).toThrow(/Duplicate/);
    // an approved (or undone) card no longer blocks the same finding: a bug can come back after its fix; a rejected one does
    t.svc.store.update(r.id, { state: 'approved' });
    const again = t.svc.propose('c1', idea);
    t.svc.store.update(again.id, { state: 'rejected' });
    expect(() => t.svc.propose('c1', idea)).toThrow(/Duplicate/);
    t.svc.store.update(again.id, { state: 'open' });
    t.svc.store.update(r.id, { state: 'open' });
    for (let i = 1; i < 4; i++) t.svc.propose('c1', { ...idea, title: `Idea ${i}`, issue: { ...idea.issue, title: `Issue ${i}` } });
    expect(() => t.svc.propose('c1', { ...idea, title: 'Idea 6' })).toThrow(/Limit/);
    expect(t.svc.cards().filter(isAppCard)).toHaveLength(5);
    expect(t.svc.cards().map(c => c.rank)).toEqual([...t.svc.cards().map(c => c.rank)].sort((a, b) => (a ?? 0) - (b ?? 0))); // one research: by rank
    expect(t.svc.cards().filter(c => !isAppCard(c))).toHaveLength(0);
  });

  it('cards new log groups and unused brain skills at zero tokens, once', () => {
    const t = setup();
    t.setSkills([skill('old-one', NOW - 120 * DAY), skill('fresh', NOW - 5 * DAY)]);
    t.setRuns([{ runId: 'r1', agentId: 'builder', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY, tags: { skills: [] } } as unknown as AgentRun]);
    const logs: LogScan = { since: null, files: [], groups: [
      { key: 'k1', lvl: 'warn', scope: 'chat', msg: 'pid died', cause: 'code 1', count: 3, sample: 'pid 3 died in /home/user/app' },
      { key: 'k2', lvl: 'warn', scope: 'chat', msg: 'known', cause: '', count: 9, sample: 'x', known: true },
    ] };
    expect(t.svc.afterPass(logs)).toEqual({ bugs: 1, forget: 1, lint: 0, reverts: 0 });
    expect(t.svc.afterPass(logs)).toEqual({ bugs: 0, forget: 0, lint: 0, reverts: 0 });
    const bug = t.svc.cards().find(isAppCard)!;
    expect(bug).toMatchObject({ kind: 'app-bug', logKey: 'k1', chatId: null });
    expect(bug.issue!.body).not.toContain('/home/user');
    // the issue in the user's language; no raw log line on the card (it is in the issue)
    expect(bug.issue!.body).toContain('Riga di esempio');
    expect(bug.evidence).toEqual([]);
    expect(t.svc.cards().filter(c => !isAppCard(c)).map(c => c.forget?.name)).toEqual(['old-one']);
    expect(t.applied).toEqual([]); // Finding an obsolete skill never authorizes deleting it.
  });

  it('makes no bug card for a user who turned the last issue cards down; an idea is still taken (owner, 2026-11-13)', async () => {
    const t = setup();
    const no = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, card: `research:${i}`, at: NOW - DAY + i, source: 'research', group: 'issue', ask: 'research', title: 't', applied: false, reversible: false, evidence: false, size: 10, decision: 'reject', by: 'user' }));
    fs.writeFileSync(path.join(t.deps.userData, 'proposal-decisions.json'), JSON.stringify({ entries: no }));
    const logs: LogScan = { since: null, files: [], groups: [{ key: 'k1', lvl: 'error', scope: 's', msg: 'boom', cause: '', count: 4, sample: 'boom' }] };
    expect(t.svc.afterPass(logs)).toMatchObject({ bugs: 0 });
    await t.svc.start(opts);
    expect(t.created[0]!.prompt).toContain('propose NO app-bug');
    expect(() => t.svc.propose('c1', { kind: 'app-bug', title: 'Boom on save', removes: 'The crash.', why: 'Seen twice.', evidence: ['log k1 ×4'], issue: { title: 'Save crashes', body: 'Steps…' } })).toThrow(/turned down the last issue cards/);
    expect(t.svc.propose('c1', { kind: 'app-idea', title: 'A calmer save', adds: 'An autosave.', why: 'Seen twice.', evidence: ['chat c9'], issue: { title: 'Autosave', body: 'Context…' } }).id).toBeTruthy();
    // with the answers gone the cards are made again
    fs.rmSync(path.join(t.deps.userData, 'proposal-decisions.json'));
    expect(t.svc.afterPass(logs)).toMatchObject({ bugs: 1 });
  });

  it('lets a research rewrite the log step\'s card of the same group', async () => {
    const t = setup();
    t.svc.afterPass({ since: null, files: [], groups: [{ key: 'k1', lvl: 'error', scope: 's', msg: 'boom', cause: '', count: 2, sample: 'boom' }] });
    await t.svc.start(opts);
    const r = t.svc.propose('c1', { kind: 'app-bug', title: 'Boom on save', removes: 'The crash.', why: 'Seen twice.', logKey: 'k1', issue: { title: 'Save crashes', body: 'Steps…' } });
    const items = t.svc.cards();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: r.id, title: 'Boom on save', chatId: 'c1', logKey: 'k1' });
  });

  it('approves through the brain, rejects, and refuses a decided card', async () => {
    const t = setup();
    await t.svc.start(opts);
    const { id } = t.svc.propose('c1', { kind: 'rule', title: 'Check the port', adds: 'Dev server on 5173.', why: 'Asked 4 times.', change: { role: 'artisan', text: 'Dev server runs on 5173.' } });
    expect(t.svc.cards().map(c => c.id)).toEqual([id]);
    expect(t.applied).toEqual([]); // Research proposes exact text; only the following user decision applies it.
    expect(await t.svc.approve(id)).toBe('chg-1');
    expect(t.svc.store.get(id)).toMatchObject({ state: 'approved', changeId: 'chg-1' });
    await expect(t.svc.approve(id)).rejects.toThrow(/non più aperta/);
    const b = t.svc.propose('c1', { kind: 'rule', title: 'Other', adds: 'x', why: 'y', change: { role: 'artisan', text: 'x' } });
    t.svc.reject(b.id);
    expect(t.svc.cards()).toHaveLength(0);
    expect(() => t.svc.propose('c1', { kind: 'rule', title: 'Other', adds: 'x', why: 'y', change: { role: 'artisan', text: 'x' } })).toThrow(/Duplicate/);
  });

  it('opens an approved app card\'s issue at once, never the brain', async () => {
    const t = setup();
    await t.svc.start(opts);
    const a = t.svc.propose('c1', { ...idea, issue: { title: 'Log: search box', body: 'b', labels: ['enhancement'] } });
    expect(t.opened).toEqual([]);
    expect(await t.svc.approve(a.id)).toBe('https://github.com/lampi1/second-brain/issues/1');
    expect(t.opened).toEqual([{ repo: 'lampi1/second-brain', title: 'Log: search box' }]);
    expect(t.svc.store.get(a.id)).toMatchObject({ state: 'approved', issueUrl: 'https://github.com/lampi1/second-brain/issues/1' });
    expect(t.applied).toEqual([]);
    // no known repository: the card cannot be approved
    const u = setup({ issuesUrl: () => null });
    await u.svc.start(opts);
    const x = u.svc.propose('c1', idea);
    expect(u.svc.repo()).toBeNull();
    await expect(u.svc.approve(x.id)).rejects.toThrow(/Repository/);
    expect(u.svc.store.get(x.id)!.state).toBe('open');
  });

  it('rejects a log bug and marks its log group known', async () => {
    const t = setup();
    t.svc.afterPass({ since: null, files: [], groups: [{ key: 'k9', lvl: 'warn', scope: 's', msg: 'm', cause: '', count: 1, sample: 'm' }] });
    const id = t.svc.cards()[0]!.id;
    t.svc.reject(id);
    expect(t.svc.cards()).toHaveLength(0);
    expect(t.noise).toEqual(['k9']);
    expect(() => t.svc.reject(id)).toThrow(/non più aperta/);
  });
});

describe('ResearchService guards', () => {
  it('closes a research the app was closed during', async () => {
    const t = setup();
    await t.svc.start(opts);
    const again = new ResearchService(t.deps);
    expect(again.status().running).toBe(false);
    expect(again.store.runs().at(-1)).toMatchObject({ state: 'stopped', why: expect.stringMatching(/app chiusa/) });
  });
  it('removes the brain\'s folder from the issues wherever it is', async () => {
    const t = setup({ root: () => 'D:\\Clienti\\Acme\\brain' });
    await t.svc.start(opts);
    const r = t.svc.propose('c1', { ...idea, issue: { title: 'x', body: 'see D:/Clienti/Acme/brain/rules/a.md and D:\\Clienti\\Acme\\brain\\x' } });
    expect(t.svc.store.get(r.id)!.issue!.body).toBe('see <brain>/rules/a.md and <brain>\\x');
  });
});

describe('the lint, «riuscito se…» and revert cards (ADR 0194)', () => {
  const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  it('a brain change carries its criterion in words; the research cannot propose the app\'s own lint and revert kinds', async () => {
    const t = setup();
    await t.svc.start(opts);
    const a = t.svc.propose('c1', { kind: 'skill', title: 'Note di rilascio', adds: 'x', why: 'y', change: { name: 'note-rilascio', text: 't' } });
    expect(t.svc.store.get(a.id)!.success).toEqual({ metric: 'skill-used', skill: 'note-rilascio', n: 3, text: 'Riuscito se la skill «note-rilascio» viene usata almeno 3 volte nella settimana dopo.' });
    const b = t.svc.propose('c1', { kind: 'rule', title: 'Test prima', adds: 'x', why: 'y', change: { role: 'artisan', text: 't' }, success: { metric: 'more-verified', role: 'artisan' } });
    expect(t.svc.store.get(b.id)!.success).toMatchObject({ metric: 'more-verified', role: 'artisan' });
    expect(() => t.svc.propose('c1', { kind: 'rule', title: 'z', adds: 'x', why: 'y', change: { role: 'artisan', text: 't' }, success: { metric: 'vibes' } })).toThrow(/success.metric/);
    expect(() => t.svc.propose('c1', { kind: 'lint', title: 'z', adds: 'x', why: 'y' })).toThrow(/kind/);
    expect(t.svc.store.get(t.svc.propose('c1', idea).id)!.success).toBeUndefined();
  });
  it('the free cleanup cards the lint once, asks the human question, and dismisses a card whose problem is gone', () => {
    const root = fs.realpathSync(tmp());
    put(root, 'hub.md', '# Hub\n\n- [[a]]\n- [[b]]\n- [[c]]\n');
    put(root, 'a.md', 'Con [[b]].\n'); put(root, 'b.md', 'Con [[a]].\n'); put(root, 'c.md', 'Con [[a]].\n');
    put(root, 'docs/x.md', 'x\n');
    put(root, 'memory/records.json', JSON.stringify([{ memoryId: 'm1', scope: { roleId: 'artisan' }, subject: 'release', predicate: 'note', value: 'Le note sono in `docs/old.md`', sourceEventId: 'e', sourceRunId: 'r',
      observedAt: '2026-10-01T00:00:00Z', validFrom: '2026-10-01T00:00:00Z', validTo: null, status: 'confirmed', supersedes: null }]));
    const t = setup({ root: () => root });
    const logs: LogScan = { since: null, files: [], groups: [] };
    expect(t.svc.afterPass(logs)).toMatchObject({ lint: 2 }); // the stale fact and the orphan docs/x.md
    const cards = t.svc.cards().filter(c => c.kind === 'lint');
    const stale = cards.find(c => c.lint?.check === 'stale-fact')!;
    expect(stale.title).toBe('Il file citato non c\'è più: tolgo il fatto');
    expect(stale.removes).toBe('Le note sono in `docs/old.md`');
    expect(cards.find(c => c.lint?.check === 'orphan')!.title).toBe('Nessuna nota rimanda a «x»: la aggiungo all\'indice');
    expect(t.svc.afterPass(logs)).toMatchObject({ lint: 0 }); // never twice
    t.svc.reject(stale.id);
    // fixed by hand: the open card goes away; a rejected one is never asked again
    put(root, 'hub.md', '# Hub\n\n- [[a]]\n- [[b]]\n- [[c]]\n- [x](docs/x.md)\n');
    expect(t.svc.afterPass(logs)).toMatchObject({ lint: 0 });
    expect(t.svc.cards().filter(c => c.kind === 'lint')).toEqual([]);
  });
  it('a change that got worse becomes one «lo annullo?» card with the numbers, approved through the brain', async () => {
    const worse = { changeId: 'chg-x', kind: 'rule' as const, summary: 'Regola: test prima', criterion: { metric: 'fewer-corrections' as const }, check: { at: NOW, before: 0.5, after: 1.5, nBefore: 4, nAfter: 5, verdict: 'worse' as const } };
    const t = setup();
    t.deps.brain.outcomes = () => [worse];
    expect(t.svc.afterPass({ since: null, files: [], groups: [] })).toMatchObject({ reverts: 1 });
    expect(t.svc.outcomes()).toBe(0); // one card per change
    const c = t.svc.cards().find(x => x.kind === 'revert')!;
    expect(c.title).toBe('Questo cambio non ha aiutato: lo annullo («Regola: test prima»)');
    expect(c.why).toBe('Correzioni per lavoro: prima 0,5 (4 lavori), dopo 1,5 (5 lavori).');
    await t.svc.approve(c.id);
    expect(t.applied).toEqual([c.id]);
  });
  it('a pass that throws in its outcome check leaves no cleanup budget behind for the hourly check', () => {
    const worse = (id: string) => ({ changeId: id, kind: 'rule' as const, summary: `Regola ${id}`, criterion: { metric: 'fewer-corrections' as const }, check: { at: NOW, before: 0.5, after: 1.5, nBefore: 4, nAfter: 5, verdict: 'worse' as const } });
    const t = setup();
    t.deps.brain.outcomes = () => { throw new Error('brain unreadable'); };
    expect(() => t.svc.afterPass({ since: null, files: [], groups: [] })).toThrow('brain unreadable');
    // the hourly check outside a pass is not ranked against a budget left over from the failed pass
    t.deps.brain.outcomes = () => [worse('a'), worse('b')];
    expect(t.svc.outcomes()).toBe(2);
    expect(t.svc.cards().filter(c => c.kind === 'revert').every(c => c.rank === undefined)).toBe(true);
  });
});

describe('ResearchStore', () => {
  it('keeps the last click and its end, and drops decided cards after 90 days', () => {
    const d = tmp();
    let now = NOW;
    const s = new ResearchStore(d, () => now);
    s.setClickAt(NOW - 5);
    s.setLastDone({ at: NOW, state: 'done', proposals: 2, ideas: 1, issues: 0, costUsd: 1 });
    const base = { chatId: null, kind: 'rule' as const, title: 't', adds: 'a', removes: '', why: 'w', evidence: [], sources: [], expected: '', risk: '' };
    const a = s.add(base), b = s.add({ ...base, title: 'u' });
    s.update(a.id, { state: 'rejected', decidedAt: now });
    now += 91 * DAY;
    s.update(b.id, { decidedAt: undefined });
    const again = new ResearchStore(d, () => now);
    expect(again.clickAt()).toBe(NOW - 5);
    expect(again.lastDone()).toMatchObject({ state: 'done', proposals: 2 });
    expect(again.all().map(p => p.id)).toEqual([b.id]);
  });
});

// ADR 0257 (Davide, 2026-11-10): skill changes come only from the maintenance, which reads every chat and work thread
// since the previous one and the lines roles noted, and proposes only what is really needed
describe('the research reads the chats since the previous maintenance and the noted lessons', () => {
  const noted = [
    { id: 'l1', at: NOW - DAY, role: 'scout', skill: 'ruolo-scout', text: 'Nei log filtra per il codice di correlazione.', state: 'noted' as const, seen: 3, chatId: 'w1' },
    { id: 'l2', at: NOW - DAY, role: 'artisan', skill: 'report-mensile', text: 'Il report parte dal primo del mese, in /home/user/x.', state: 'noted' as const },
  ];
  const end = async (t: ReturnType<typeof setup>, id: string) => {
    t.svc.chatUpdated({ id, state: 'running', costUsd: 0 } as ChatSummary);
    t.svc.chatUpdated({ id, state: 'idle', costUsd: 0 } as ChatSummary);
    // finish clears the run and marks the lessons before its first await
    expect(t.svc.status().research).toBeNull();
    await Promise.resolve();
  };
  it('lists the chats since the last finished research, gives the lessons by skill, marks them read only when it read them and ended', async () => {
    const since: number[] = [], reviewed: string[][] = [];
    const thread: ChatItem[] = [
      { kind: 'user', id: 'u1', at: NOW, text: 'Trova l\'errore nei log', from: 'Orchestrator' },
      { kind: 'thinking', id: 'k1', at: NOW, text: 'pensiero privato' },
      { kind: 'tool', id: 't1', at: NOW, name: 'Bash', summary: 'grep correlation /home/user/logs', input: {}, status: 'error', output: 'No such file /home/user/logs', exitCode: 2 },
      { kind: 'assistant', id: 'a1', at: NOW, text: 'Ho filtrato per il codice di correlazione.' },
    ];
    const t = setup({
      conversationList: s => { since.push(s); return [{ id: 'w1', title: 'Log del servizio', kind: 'work thread of o1' }, { id: 'o1', title: 'Orchestrator', kind: 'orchestrator' }]; },
      conversationRead: id => (id === 'w1' ? thread : []),
      lessons: { noted: () => noted, reviewed: shown => { reviewed.push(shown.map(l => l.id)); } },
    });
    await t.svc.start(opts);
    expect(since).toEqual([NOW - 30 * DAY]);
    expect(t.created[0]!.prompt).toContain('Skills (the main job of this pass)');
    expect(t.created[0]!.prompt).toContain('Skill-writing standard');
    const conv = t.svc.pack('c1', 'conversations');
    expect(conv).toContain('since the previous maintenance (2026-09-23)');
    expect(conv).toContain('work thread of o1');
    // a work thread is read whole: the brief from the Orchestrator (not the user's word), the failed tool, the answer
    const page = t.svc.pack('c1', 'conversations', 0, 'w1');
    expect(page).toContain('message from');
    expect(page).toContain('(not the user)');
    expect(page).toContain('tool Bash error exit 2');
    expect(page).toContain('No such file');
    expect(page).toContain('Ho filtrato per il codice di correlazione.');
    expect(page).not.toContain('pensiero privato');
    expect(page).not.toContain('/home/user');
    const lessons = t.svc.pack('c1', 'lessons');
    expect(lessons).toContain('"skill":"ruolo-scout"');
    expect(lessons).toContain('"times":3');
    expect(lessons).not.toContain('/home/user');
    expect(lessons.indexOf('ruolo-scout')).toBeLessThan(lessons.indexOf('report-mensile'));
    // stopped by the user: nothing is marked read, the next pass shows the lines again
    await t.svc.stop();
    expect(reviewed).toEqual([]);
    // a pass that ends done without opening the section leaves them waiting
    await t.svc.start(opts);
    expect(since[1]).toBe(NOW - 30 * DAY);
    await end(t, 'c2');
    expect(reviewed).toEqual([]);
    // one that read them and ended done marks them read; the one after looks back to that pass's start
    await t.svc.start(opts);
    expect(since[2]).toBe(NOW);
    t.svc.pack('c3', 'lessons');
    await end(t, 'c3');
    expect(reviewed).toEqual([['l1', 'l2']]);
  });
  it('a capped pass that read the lessons marks them and moves the window; a long chat starts at what is new', async () => {
    const since: number[] = [], reviewed: string[][] = [];
    const items: ChatItem[] = [{ kind: 'user', id: 'old', at: NOW - 60 * DAY, text: 'vecchio' }, { kind: 'user', id: 'new', at: NOW, text: 'nuovo' }];
    const t = setup({
      conversationList: s => { since.push(s); return [{ id: 'o1', title: 'Orchestrator', kind: 'orchestrator' }]; },
      conversationRead: () => items,
      lessons: { noted: () => noted, reviewed: shown => { reviewed.push(shown.map(l => l.id)); } },
    });
    await t.svc.start(opts);
    const page = t.svc.pack('c1', 'conversations', undefined, 'o1');
    expect(page).toContain('this page starts at 1');
    expect(page).not.toContain('vecchio');
    expect(t.svc.pack('c1', 'conversations', 0, 'o1')).toContain('vecchio');
    t.svc.pack('c1', 'lessons');
    t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 999 } as ChatSummary);
    expect(t.svc.status().research).toBeNull();
    expect(reviewed).toEqual([['l1', 'l2']]);
    await Promise.resolve();
    await t.svc.start(opts);
    expect(since).toEqual([NOW - 30 * DAY, NOW]);
  });
  it('without noted lines the section says so', async () => {
    const t = setup({ lessons: { noted: () => [], reviewed: () => { throw new Error('not called'); } } });
    await t.svc.start(opts);
    expect(t.svc.pack('c1', 'lessons')).toBe('No lines noted since the previous maintenance.');
    await end(t, 'c1');
  });
});
