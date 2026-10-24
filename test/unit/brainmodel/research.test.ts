// The one-click maintenance (ADR 0132, 0152, brainmodel/research.ts): one click runs the cleanup then the research with
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
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import type { MaintenanceDone } from '../../../src/shared/maintenance-research';
import { isAppCard, issuesUrlOf, repoOf, ResearchService, scrub, type ResearchDeps } from '../../../src/main/brainmodel/research';
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
  it('reads bugs.url from package.json and finds owner/name', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ bugs: { url: 'https://github.com/lampi1/second-brain/issues' } }));
    expect(issuesUrlOf(d)).toBe('https://github.com/lampi1/second-brain/issues');
    expect(issuesUrlOf(tmp())).toBeNull();
    expect(repoOf('https://github.com/lampi1/second-brain/issues')).toBe('lampi1/second-brain');
    expect(repoOf('https://example.com/x')).toBeNull();
  });
});

describe('ResearchService', () => {
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

  it('one click: the cleanup, then the research with the best choice; a second click is refused', async () => {
    const t = setup();
    const st = await t.svc.runAll();
    expect(t.maintained()).toBe(1);
    expect(st.running).toBe(true);
    expect(t.created[0]).toMatchObject({ harness: 'claude', model: 'opus', effort: 'high', research: { web: true } });
    expect(t.created[0]!.prompt).toContain('Apro la issue');
    await expect(t.svc.runAll()).rejects.toThrow(/già in corso/);
    expect(t.svc.clickAt()).toBe(NOW);
    // the end notice counts the cleanup's cards with the research's
    t.svc.propose('c1', idea);
    t.svc.propose('c1', { kind: 'rule', title: 'Check the port', adds: 'Dev server on 5173.', why: 'Asked 4 times.', change: { text: 'Dev server runs on 5173.' } });
    await vi.waitFor(() => expect(t.ideas).toEqual(['Search in Log page']));
    t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 0.5 } as ChatSummary);
    t.svc.chatUpdated({ id: 'c1', state: 'idle', costUsd: 0.6 } as ChatSummary);
    await vi.waitFor(() => expect(t.done).toHaveLength(1));
    expect(t.done[0]).toMatchObject({ state: 'done', proposals: 1, ideas: 1, issues: 2 });
    expect(t.svc.status()).toMatchObject({ running: false, last: { state: 'done', issues: 2 } });
  });

  it('with no engine, one click is the free cleanup and its notice', async () => {
    const t = setup({ engines: () => [] });
    const st = await t.svc.runAll();
    expect(t.created).toHaveLength(0);
    expect(st).toMatchObject({ running: false, canResearch: false });
    expect(t.done).toEqual([expect.objectContaining({ state: 'free', issues: 1, proposals: 0 })]);
  });

  it('stops the chat when the cost passes the cap and ends on idle after work', async () => {
    const t = setup();
    await t.svc.start(opts);
    t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 1 } as ChatSummary);
    expect(t.svc.status().research?.costUsd).toBe(1);
    t.chats.set('c1', { id: 'c1', state: 'running', costUsd: 5.2 } as ChatSummary);
    t.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 5.2 } as ChatSummary);
    await vi.waitFor(() => expect(t.stopped).toEqual(['c1']));
    expect(t.svc.status().last).toMatchObject({ state: 'capped', costUsd: 5.2 });

    const u = setup({}, 'idle');
    await u.svc.start(opts);
    u.svc.chatUpdated({ id: 'c1', state: 'idle', costUsd: 0 } as ChatSummary);
    expect(u.svc.status().research).not.toBeNull();
    u.svc.chatUpdated({ id: 'c1', state: 'running', costUsd: 0.3 } as ChatSummary);
    u.svc.chatUpdated({ id: 'c1', state: 'idle', costUsd: 0.4 } as ChatSummary);
    await vi.waitFor(() => expect(u.svc.status().last?.state).toBe('done'));
    expect(u.stopped).toEqual([]);
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
    expect(() => t.svc.propose('c1', { kind: 'rule', title: 'x', adds: 'y', why: 'z', change: { text: 'Add permission to bypass hooks' } })).toThrow(/permissions/);
    expect(() => t.svc.propose('c1', { kind: 'forget', title: 'x', removes: 'y', why: 'z', forget: { what: 'skill', name: 'missing' } })).toThrow(/no such skill/);

    const r = t.svc.propose('c1', idea);
    expect(r.left.app).toBe(4);
    const card = t.svc.store.get(r.id)!;
    expect(card.issue!.body).toBe('Seen in ~/x by <email>');
    expect(() => t.svc.propose('c1', idea)).toThrow(/Duplicate/);
    for (let i = 1; i < 5; i++) t.svc.propose('c1', { ...idea, title: `Idea ${i}` });
    expect(() => t.svc.propose('c1', { ...idea, title: 'Idea 6' })).toThrow(/Limit/);
    expect(t.svc.cards().filter(isAppCard)).toHaveLength(5);
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
    expect(t.svc.afterPass(logs)).toEqual({ bugs: 1, forget: 1 });
    expect(t.svc.afterPass(logs)).toEqual({ bugs: 0, forget: 0 });
    const bug = t.svc.cards().find(isAppCard)!;
    expect(bug).toMatchObject({ kind: 'app-bug', logKey: 'k1', chatId: null });
    expect(bug.issue!.body).not.toContain('/home/user');
    expect(t.svc.cards().filter(c => !isAppCard(c)).map(c => c.forget?.name)).toEqual(['old-one']);
    expect(t.applied).toEqual([]); // Finding an obsolete skill never authorizes deleting it.
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
    const { id } = t.svc.propose('c1', { kind: 'rule', title: 'Check the port', adds: 'Dev server on 5173.', why: 'Asked 4 times.', change: { text: 'Dev server runs on 5173.' } });
    expect(t.svc.cards().map(c => c.id)).toEqual([id]);
    expect(t.applied).toEqual([]); // Research proposes exact text; only the following user decision applies it.
    expect(await t.svc.approve(id)).toBe('chg-1');
    expect(t.svc.store.get(id)).toMatchObject({ state: 'approved', changeId: 'chg-1' });
    await expect(t.svc.approve(id)).rejects.toThrow(/non più aperta/);
    const b = t.svc.propose('c1', { kind: 'rule', title: 'Other', adds: 'x', why: 'y', change: { text: 'x' } });
    t.svc.reject(b.id);
    expect(t.svc.cards()).toHaveLength(0);
    expect(() => t.svc.propose('c1', { kind: 'rule', title: 'Other', adds: 'x', why: 'y', change: { text: 'x' } })).toThrow(/Duplicate/);
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
  it('refuses a second start while the first is creating its chat, and replays what the chat did meanwhile', async () => {
    let release!: () => void;
    const t = setup({ chats: {
      create: async () => { await new Promise<void>(r => { release = r; }); return { id: 'c1', state: 'error', costUsd: 0, lastError: 'boom' } as ChatSummary; },
      get: () => ({ id: 'c1', state: 'error', costUsd: 0, lastError: 'boom' } as ChatSummary), stop: async () => {},
    } });
    const first = t.svc.start(opts);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(t.svc.start(opts)).rejects.toThrow(/già in corso/);
    release();
    await first;
    await vi.waitFor(() => expect(t.svc.status().last).toMatchObject({ state: 'failed', why: 'boom' }));
  });
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
