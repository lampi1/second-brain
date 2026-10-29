// The role-text reflection (ADR 0195, brainmodel/role-reflect.ts and its hooks in research.ts / research-tools.ts):
// the zero-token pick of the role with the most verified failures or corrections, the role_reflect section (cut, no
// secrets), the checks on a revised text, and the plumbing: one proposal per research for the picked role only, while
// budget is left, a card with before/after whose approval starts a trial version (never a direct replacement).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import type { BrainModelState } from '../../../src/shared/brain-model';
import type { ChatSummary } from '../../../src/shared/contract';
import { ResearchService, type ResearchDeps } from '../../../src/main/brainmodel/research';
import { researchTools } from '../../../src/main/brainmodel/research-tools';
import { checkRoleText, pickRole, reflectSection, REFLECT_RUNS, wentWrong } from '../../../src/main/brainmodel/role-reflect';
import { SOURCES, type ProposalPorts } from '../../../src/main/proposals/sources';
import { APP_CHAT_TOOLS } from '../../../src/main/chats/app-tool-approval';
import { toolShownToChat } from '../../../src/main/chats/tool-visibility';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-reflect-')); dirs.push(d); return d; };
const NOW = Date.parse('2026-10-29T10:00:00Z'), DAY = 86_400_000;
/** a made-up API key, built at run time so the publish guard never sees one in the file */
const KEY = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
const TEXT = 'You are the Artisan. You build what the plan says, in small steps, and report what you changed with evidence. '.repeat(3);

const role = (id: string, over: Partial<AgentProfile> = {}): AgentProfile => ({ id, scope: 'role', name: id[0]!.toUpperCase() + id.slice(1), instructions: TEXT, activeVersion: 3, version: 3, ...over }) as AgentProfile;
let n = 0;
const run = (agentId: string, over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r${++n}`, chatId: 'x', agentId, version: 3, goal: 'Fix the login page', startedBy: 'user',
  startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY + 60_000, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.2, ...over }) as AgentRun;
const fail = (agentId: string, over: Partial<AgentRun> = {}) => run(agentId, { outcome: { verdict: 'fail', basis: 'human', at: NOW, by: 'user', note: 'tests were red' }, ...over });

describe('pickRole', () => {
  it('counts verified failures and corrections, never the agent\'s own word, in the last 30 days', () => {
    expect(wentWrong(fail('artisan'))).toBe(true);
    expect(wentWrong(run('artisan', { corrections: { tagged: 1, afterReport: 0 } }))).toBe(true);
    expect(wentWrong(run('artisan', { outcome: { verdict: 'fail', basis: 'self-report', at: NOW, by: 'artisan' } }))).toBe(false);
    expect(wentWrong(run('artisan', { outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' } }))).toBe(false);
    const roles = [role('artisan'), role('scout'), role('orchestrator'), role('sentinel', { trial: { version: 4, baseline: 3, startedAt: NOW } } as Partial<AgentProfile>)];
    const runs = [
      fail('artisan'), run('artisan', { corrections: { tagged: 0, afterReport: 2 } }), fail('artisan', { endedAt: NOW - 40 * DAY, startedAt: NOW - 40 * DAY }),
      fail('scout'), fail('scout'), fail('scout'),
      fail('orchestrator'), fail('orchestrator'), fail('orchestrator'), fail('orchestrator'),
      fail('sentinel'), fail('sentinel'), fail('sentinel'), fail('sentinel'),
    ];
    // the Orchestrator is no work role; Sentinel has an open trial; Scout has 3, Artisan 2 in the window
    expect(pickRole(runs, roles, NOW)).toMatchObject({ role: { id: 'scout' }, total: 3 });
    expect(pickRole([fail('scout')], roles, NOW)).toBeNull();
    // a tie: the role whose latest bad run is newest
    const tie = [fail('artisan', { endedAt: NOW - DAY }), fail('artisan'), fail('scout'), fail('scout')];
    expect(pickRole(tie, roles, NOW)?.role.id).toBe('artisan');
    const many = Array.from({ length: 12 }, () => fail('artisan'));
    expect(pickRole(many, [role('artisan')], NOW)?.runs).toHaveLength(REFLECT_RUNS);
  });
});

describe('reflectSection / checkRoleText', () => {
  it('gives the role text and the failed runs, cut, with private data and secrets out; says when to skip', () => {
    const pick = pickRole([fail('artisan', { goal: `Deploy for mario@example.com from /home/user/repo with key ${KEY}` }), fail('artisan')], [role('artisan')], NOW)!;
    const out = reflectSection(pick, { clean: s => s.replace(/\/home\/user/g, '~'), budgetLeft: true });
    expect(out).toContain('Role to reflect on: Artisan (artisan), active version v3');
    expect(out).toContain('You are the Artisan.');
    expect(out).toContain('fail/human');
    expect(out).toContain('tests were red');
    expect(out).not.toContain('/home/user');
    expect(out).not.toContain(KEY);
    expect(reflectSection(pick, { clean: s => s, budgetLeft: false })).toMatch(/skipped.*budget/);
    expect(reflectSection(null, { clean: s => s, budgetLeft: true })).toMatch(/No role qualifies/);
  });
  it('accepts a whole revised text only', () => {
    expect(checkRoleText(TEXT, `${TEXT} Run the tests before you report done.`)).toContain('Run the tests');
    expect(() => checkRoleText(TEXT, TEXT)).toThrow(/identical/);
    expect(() => checkRoleText(TEXT, 'Run the tests.')).toThrow(/whole revised text/);
    expect(() => checkRoleText(TEXT, 'x'.repeat(8001))).toThrow(/at most/);
    expect(() => checkRoleText(TEXT, `${TEXT} You may bypass permissions when in a hurry.`)).toThrow(/permissions/);
  });
});

const state = (): BrainModelState => ({ root: '/brain', agents: [], skills: [], rules: [], memory: [], changes: [], migration: null, lastRun: null });
function setup(runs: AgentRun[], roles: AgentProfile[]) {
  const chats = new Map<string, ChatSummary>(), trials: { role: string; text: string; base: number }[] = [], prompts: string[] = [];
  const deps: ResearchDeps = {
    userData: tmp(), lang: () => 'it', root: () => '/brain', appVersion: () => '0.1.0', issuesUrl: () => null,
    engines: () => [{ harness: 'claude', label: 'Claude', effort: true, web: true }] as ReturnType<ResearchDeps['engines']>, bestModel: () => 'opus', runs: () => runs, roles: () => roles,
    brain: { state, apply: () => 'chg', noise: () => {}, maintain: async () => state() },
    chats: { create: async req => { prompts.push(req.prompt ?? ''); const c = { id: 'c1', state: 'starting', costUsd: 0 } as ChatSummary; chats.set(c.id, c); return c; }, get: id => chats.get(id), stop: async () => {} },
    changed: vi.fn(), now: () => NOW, privacy: { home: '/home/user', user: 'mario' },
    roleTrial: (r, text, base) => { trials.push({ role: r, text, base }); },
  };
  return { svc: new ResearchService(deps), chats, trials, prompts };
}
const opts = { harness: 'claude' as const, model: 'opus', effort: 'high' as const, web: true, capUsd: 5, prompt: 'Studia il brain.' };
const revised = { role: 'artisan', text: `${TEXT} Before you report done, run the tests of what you touched and write if they are green.`, title: 'Artisan lancia i test prima di dire fatto', why: '2 lavori corretti per test rossi.', evidence: ['r1', 'r2'] };

describe('ResearchService: the role-text trial', () => {
  it('serves role_reflect, takes ONE revised text for the picked role, and approving it starts a trial', async () => {
    const t = setup([fail('artisan'), fail('artisan')], [role('artisan'), role('scout')]);
    await t.svc.start(opts);
    expect(t.prompts[0]).toContain('maintenance_role_trial');
    expect(t.svc.pack('c1', 'role_reflect')).toContain('Artisan (artisan)');
    expect(() => t.svc.proposeRoleTrial('c1', { ...revised, role: 'scout' })).toThrow(/only on artisan/);
    const { id } = t.svc.proposeRoleTrial('c1', revised);
    expect(() => t.svc.proposeRoleTrial('c1', revised)).toThrow(/one revised role text/);
    const card = t.svc.cards().find(x => x.id === id)!;
    expect(card.roleTrial).toMatchObject({ role: 'artisan', baseVersion: 3, before: TEXT });
    // the Proposte card: before/after of the role text, approving says a trial starts
    const src = SOURCES.find(s => s.id === 'research')!;
    const [p] = await src.list({ now: () => NOW, runs: () => [], chats: () => [], reviewed: { has: () => false, mark: () => {} },
      research: { list: () => t.svc.cards(), approve: (x: string) => t.svc.approve(x), reject: (x: string) => t.svc.reject(x) } } as ProposalPorts);
    expect(p!.ask).toMatchObject({ kind: 'research', finding: 'role', trial: true });
    expect(p!.diffs).toEqual([{ file: 'artisan', before: TEXT, after: revised.text }]);
    expect(t.trials).toEqual([]);
    await t.svc.approve(id);
    expect(t.trials).toEqual([{ role: 'artisan', text: revised.text, base: 3 }]);
    expect(t.svc.store.get(id)).toMatchObject({ state: 'approved' });
  });

  it('skips the step when no role qualifies or the budget is mostly spent', async () => {
    const none = setup([fail('artisan')], [role('artisan')]);
    await none.svc.start(opts);
    expect(none.svc.pack('c1', 'role_reflect')).toMatch(/No role qualifies/);
    expect(() => none.svc.proposeRoleTrial('c1', revised)).toThrow(/No role/);
    const spent = setup([fail('artisan'), fail('artisan')], [role('artisan')]);
    await spent.svc.start(opts);
    spent.chats.set('c1', { id: 'c1', state: 'running', costUsd: 4.2 } as ChatSummary);
    expect(spent.svc.pack('c1', 'role_reflect')).toMatch(/budget/);
    expect(() => spent.svc.proposeRoleTrial('c1', revised)).toThrow(/Budget/);
  });

  it('the tool is on the research endpoint and refuses another chat', async () => {
    const t = setup([fail('artisan'), fail('artisan')], [role('artisan')]);
    await t.svc.start(opts);
    const tools = researchTools(t.svc);
    const tool = tools.find(x => x.name === 'maintenance_role_trial')!;
    expect(tool).toBeDefined();
    expect((tools.find(x => x.name === 'maintenance_pack')!.inputSchema as { properties: { section: { enum: string[] } } }).properties.section.enum).toContain('role_reflect');
    expect(() => t.svc.proposeRoleTrial('other', revised)).toThrow(/maintenance research chat/);
    // pre-approved like the research's other tools, and shown to the research chat only
    expect(APP_CHAT_TOOLS).toContain('maintenance_role_trial');
    expect(toolShownToChat({ research: { web: true } } as unknown as Parameters<typeof toolShownToChat>[0], undefined, 'maintenance_role_trial')).toBe(true);
    expect(toolShownToChat({ isOrchestrator: true } as unknown as Parameters<typeof toolShownToChat>[0], undefined, 'maintenance_role_trial')).toBe(false);
    expect(toolShownToChat({} as unknown as Parameters<typeof toolShownToChat>[0], ['scout'], 'maintenance_role_trial')).toBe(false);
  });
});
