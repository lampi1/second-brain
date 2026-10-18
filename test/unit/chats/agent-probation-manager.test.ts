// A7b on chats: an agentless chat runs as Generale with its tags (skills, app, repo), Claude's Skill tool joins the skills
// while the run is open, a run end judges its agent's probation (keep/retire + feed), and metrics filter by tag.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, repoOf, startTags, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import type { FeedInput } from '../../../src/main/services';
import { GENERAL_AGENT_ID, type AgentModelChoice } from '../../../src/shared/agents';
import type { NewChat } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-probation-chats-')); roots.push(dir); return dir; };
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [{ id: 'known-model', name: 'Known model' }], installed: null, authenticated: null }];

function fixture(extra: Partial<ChatManagerOptions> = {}) {
  const dir = tmp(), work = path.join(dir, 'work', 'my-repo');
  fs.mkdirSync(path.join(work, '.git'), { recursive: true });
  fs.mkdirSync(path.join(work, 'src', 'deep'), { recursive: true });
  // reloaded after a test writes a probation agent into the file: the manager reaches it through this holder
  const box = { catalog: new AgentCatalogService({ userData: dir, models, approvedRoots: () => [dir] }) };
  const catalog: Pick<AgentCatalogService, 'list' | 'keep' | 'retire'> = { list: () => box.catalog.list(), keep: (...a) => box.catalog.keep(...a), retire: (...a) => box.catalog.retire(...a) };
  const feed: FeedInput[] = [];
  const sinks = new Map<string, SessionSink>();
  let last!: SessionSink;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, probationEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') },
    resolveAgent: req => box.catalog.resolve(req), probation: { catalog, publish: events => feed.push(...events) }, ...extra, sessionFactory: (_h, _o, s) => {
      last = s;
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send() {},
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  const create = async (req: Partial<NewChat> = {}) => {
    const c = await m.create({ harness: 'claude', cwd: path.join(work, 'src', 'deep'), prompt: 'Sistema il bug', ...req });
    sinks.set(c.id, last);
    return c;
  };
  const run = (id: string) => m.list().find(x => x.id === id)?.run;
  return { m, dir, work, box, get catalog() { return box.catalog; }, feed, create, run, sink: (id: string) => sinks.get(id)! };
}
/** An agent in probation, written as A7 creates it: explicit policy within the default, launched inside an approved root. */
function probationAgent(f: ReturnType<typeof fixture>, name = 'Specialista'): string {
  const p = f.box.catalog.save({ name, purpose: 'p', instructions: 'i', engine: 'claude', model: 'known-model', avatar: { kind: 'symbol', value: 'search' }, tools: { allow: ['read'] }, permissionCeiling: 'default' });
  const file = path.join(f.dir, 'agents.v2.json'), body = JSON.parse(fs.readFileSync(file, 'utf8')) as { profiles: Record<string, unknown>[] };
  const stored = body.profiles.find(x => x.id === p.id)!;
  stored.probation = { since: Date.now() - 1000, requestItemId: 'u_task' }; stored.userLocked = false; stored.lastEditedBy = 'orchestrator';
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  f.box.catalog = new AgentCatalogService({ userData: f.dir, models, approvedRoots: () => [f.dir] });
  return p.id;
}

describe('Generale runs and tags', () => {
  it('a manual chat with no agent is a Generale run, tagged with its repo, skills and app', async () => {
    const f = fixture();
    const c = await f.create({ skills: ['review', 'review', 'ship'], app: '  crm  ' });
    expect(c.agent).toMatchObject({ id: GENERAL_AGENT_ID, name: 'Generale', source: 'catalog' });
    expect(f.run(c.id)).toMatchObject({ agentId: GENERAL_AGENT_ID, version: 1, startedBy: 'user', tags: { skills: ['review', 'ship'], app: 'crm', repo: 'my-repo' } });
    const plain = await f.create({ cwd: f.dir });
    expect(f.run(plain.id)!.tags).toEqual({ skills: [], app: null, repo: null });
  });

  it('refuses bad skills or app before anything starts', async () => {
    const f = fixture();
    await expect(f.create({ skills: ['Not Valid'] })).rejects.toThrow(/Skill non valide/);
    await expect(f.create({ skills: Array.from({ length: 17 }, (_, i) => `s${i}`) })).rejects.toThrow(/Al massimo 16/);
    await expect(f.create({ app: 'x'.repeat(41) })).rejects.toThrow(/App non valida/);
    await expect(f.create({ app: 'a\u0007b' })).rejects.toThrow(/App non valida/);
    expect(f.m.list()).toHaveLength(0);
    expect(startTags({ app: '' })).toEqual({ skills: [], app: null });
  });

  it('Claude’s Skill tool joins the open run’s skills, once; nothing after the end', async () => {
    const f = fixture();
    const c = await f.create();
    const tool = (id: string, input: unknown) => f.sink(c.id).item({ kind: 'tool', id, at: Date.now(), name: 'Skill', summary: 's', input, status: 'ok' }, false);
    tool('t1', { skill: 'superpowers:Brainstorming' });
    tool('t2', { command: 'brainstorming' });
    tool('t3', { skill: 'bad skill!' });
    expect(f.run(c.id)!.tags!.skills).toEqual(['brainstorming']);
    expect(JSON.parse(fs.readFileSync(path.join(f.dir, 'agent-runs.json'), 'utf8')).runs[0].tags.skills).toEqual(['brainstorming']);
    f.m.markRun(c.id, 'success');
    tool('t4', { skill: 'late' });
    expect(f.run(c.id)!.tags!.skills).toEqual(['brainstorming']);
  });

  it('runMetrics passes the skill, app and repo filters through', async () => {
    const f = fixture();
    const a = await f.create({ app: 'crm', skills: ['ship'] }), b = await f.create({ cwd: f.dir });
    f.m.markRun(a.id, 'success'); f.m.markRun(b.id, 'success');
    const ended = (o: Parameters<ChatManager['runMetrics']>[0]) => f.m.runMetrics(o).find(x => x.agentId === GENERAL_AGENT_ID)?.versions[0]?.ended ?? 0;
    expect(ended({})).toBe(2);
    expect(ended({ app: 'crm' })).toBe(1);
    expect(ended({ skill: 'ship' })).toBe(1);
    expect(ended({ repo: 'my-repo' })).toBe(1);
    expect(ended({ repo: 'other' })).toBe(0);
  });

  it('repoOf names the git top-level folder by walking up, and null outside a repo', () => {
    const f = fixture();
    expect(repoOf(path.join(f.work, 'src', 'deep'))).toBe('my-repo');
    expect(repoOf(f.work)).toBe('my-repo');
    expect(repoOf(f.dir)).toBeNull();
  });
});

describe('launch of an Orchestrator-edited agent', () => {
  it('refuses a definition without explicit policy, or a folder outside the approved roots, before anything starts', async () => {
    const f = fixture();
    const id = probationAgent(f);
    await expect(f.create({ agentId: id, cwd: path.dirname(f.dir) })).rejects.toThrow(/approved/);
    const file = path.join(f.dir, 'agents.v2.json'), body = JSON.parse(fs.readFileSync(file, 'utf8')) as { profiles: Record<string, unknown>[] };
    delete body.profiles.find(x => x.id === id)!.tools;
    fs.writeFileSync(file, JSON.stringify(body, null, 2));
    f.box.catalog = new AgentCatalogService({ userData: f.dir, models, approvedRoots: () => [f.dir] });
    await expect(f.create({ agentId: id })).rejects.toThrow(/explicit tools/);
    expect(f.m.list()).toHaveLength(0);
  });
});

describe('probation on run end', () => {
  it('evaluates a human verdict immediately even after the run ended', async () => {
    const f = fixture();
    const id = probationAgent(f);
    const c = await f.create({ agentId: id });
    f.m.markRun(c.id, 'unknown');
    expect(f.catalog.list().profiles.find(p => p.id === id)!.probation).toBeDefined();
    f.m.markRun(c.id, 'success');
    expect(f.catalog.list().profiles.find(p => p.id === id)!.probation).toBeUndefined();
    expect(f.feed).toHaveLength(1);
  });
  it('a success with Brother’s verdict keeps the agent: probation removed, quiet feed event', async () => {
    const f = fixture();
    const id = probationAgent(f);
    const c = await f.create({ agentId: id });
    expect(f.run(c.id)!.agentId).toBe(id);
    f.m.markRun(c.id, 'success');
    expect(f.catalog.list().profiles.find(p => p.id === id)!.probation).toBeUndefined();
    expect(f.feed).toEqual([expect.objectContaining({ kind: 'agent-kept', title: 'Agente «Specialista» tenuto' })]);
  });

  it('a confirmed fail retires the agent with a Restore action', async () => {
    const f = fixture();
    const id = probationAgent(f);
    const c = await f.create({ agentId: id });
    const before = f.catalog.list().archived.map(p => p.id);
    f.m.markRun(c.id, 'fail');
    expect(f.catalog.list().archived.map(p => p.id)).toEqual([...before, id]);
    expect(f.feed).toEqual([expect.objectContaining({ kind: 'agent-retired', action: { kind: 'agent-restore', agentId: id } })]);
    // already retired: a second pass does nothing
    f.m.probationTick();
    expect(f.feed).toHaveLength(1);
  });

  it('a run of another agent does not judge it, and an agent kept by Brother is never judged', async () => {
    const f = fixture();
    const id = probationAgent(f);
    const c = await f.create();
    f.m.markRun(c.id, 'fail');
    expect(f.catalog.list().profiles.find(p => p.id === id)!.probation).toBeDefined();
    f.catalog.keep(id);
    const d = await f.create({ agentId: id });
    f.m.markRun(d.id, 'fail');
    expect(f.catalog.list().profiles.find(p => p.id === id)).toMatchObject({ status: 'active', probation: { keptBy: 'brother' } });
    expect(f.feed).toEqual([]);
  });
});
