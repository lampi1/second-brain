// The Orchestrator: one coordinator for work and for the app's own code. Pinned here: the singleton in ChatManager and in
// OrchestratorService (concurrent ensure), the role text on its first message, the tool scope only for the authenticated
// caller, news of every chat reaching it, and the updater's apply staying hard off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { StoredChat } from '../../../src/main/chats/store';
import { ORCHESTRATOR_ROLE } from '../../../src/main/agents/orchestrator-role';
import { OrchestratorService } from '../../../src/main/chats/orchestrator-service';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { ORCHESTRATOR_AGENT_ID } from '../../../src/shared/agents';
import { OrchestratorWake } from '../../../src/main/chats/orchestrator-wake';
import { appControlTools } from '../../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY } from '../../../src/main/brain/routing-demo';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { ChatSummary, RoutingTable } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-orch-')); roots.push(d); return d; };

const row = (p: Partial<StoredChat> & { id: string }): StoredChat => ({
  harness: 'claude', cwd: 'C:/brain', sessionId: null, title: p.id, model: null, effort: null, permissionMode: null, isOrchestrator: false, createdAt: 1, ...p,
});
const summary = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

function fixture(stored?: StoredChat[]) {
  const dir = tmp();
  if (stored) fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: stored }));
  const sent: string[] = [];
  const agents = new AgentCatalogService({ userData: dir, models: () => [{ engine: 'anthropic', label: 'API', enabled: true, trusted: true, effort: false, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
  const m = new ChatManager({ userData: dir, resolveAgent: req => agents.resolve(req), emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, _o, s: SessionSink) => {
    let state = 'idle';
    return { harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, get busy() { return state === 'running'; },
      start() { s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); state = 'idle'; },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return { m, dir, sent, agents, file: () => JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: StoredChat[] } };
}

describe('ChatManager with the Orchestrator', () => {
  it('restores the saved Orchestrator once and a second start changes nothing', async () => {
    const f = fixture([row({ id: 'w1', harness: 'anthropic', title: 'Orchestrator', isOrchestrator: true }), row({ id: 'kid', harness: 'anthropic', createdAt: 4 })]);
    expect(f.m.list().filter(c => c.isOrchestrator).map(c => c.id)).toEqual(['w1']);
    const first = f.file();
    await f.m.shutdown(); managers.splice(managers.indexOf(f.m), 1);
    const again = new ChatManager({ userData: f.dir, emitter: { emit() {} }, coldEveryMs: 0 }); managers.push(again);
    expect(again.list().filter(c => c.isOrchestrator).map(c => c.id)).toEqual(['w1']);
    const roles = (rows: StoredChat[]) => rows.map(c => [c.id, c.title, c.isOrchestrator, c.sessionId]);
    expect(roles(f.file().chats)).toEqual(roles(first.chats));
  });

  it('is a singleton: a second request returns it, an agent cannot create it, concurrent creations share one', async () => {
    const f = fixture(), cwd = tmp();
    const [a, b] = await Promise.all([f.m.create({ harness: 'anthropic', cwd, orchestrator: true }), f.m.create({ harness: 'anthropic', cwd, orchestrator: true })]);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ isOrchestrator: true, title: 'Orchestrator' });
    expect(a).not.toHaveProperty('space');
    await expect(f.m.create({ harness: 'anthropic', cwd, orchestrator: true }, 'agent')).rejects.toThrow(/Only the user/);
    // replacing another chat id does not sneak in a second one
    expect((await f.m.create({ harness: 'anthropic', cwd, orchestrator: true, replaces: 'c_nope' })).id).toBe(a.id);
    expect(f.m.list().filter(c => c.isOrchestrator)).toHaveLength(1);
  });

  it('a replacement takes the role; the old one gives up the name', async () => {
    const f = fixture([row({ id: 'w1', harness: 'anthropic', title: 'Orchestrator', isOrchestrator: true }), row({ id: 'kid', harness: 'anthropic' })]);
    const n = await f.m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, replaces: 'w1' });
    const by = Object.fromEntries(f.m.list().map(c => [c.id, c]));
    expect(by[n.id]).toMatchObject({ isOrchestrator: true, title: 'Orchestrator' });
    expect(by.w1).toMatchObject({ isOrchestrator: false });
    expect(by.w1!.title).not.toBe('Orchestrator');
  });

  it('primes the first message with the Orchestrator role', async () => {
    const f = fixture();
    await f.m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(f.sent[0]!.startsWith('[Role supplied by the app: Orchestrator]')).toBe(true);
    expect(ORCHESTRATOR_ROLE.startsWith('[Role supplied by the app: Orchestrator]')).toBe(true);
    expect(ORCHESTRATOR_ROLE).toMatch(/Updater apply is disabled/);
  });
  it('starts from the edited Orchestrator role and composes its instructions once', async () => {
    const f = fixture(), seed = f.agents.list().profiles.find(p => p.id === ORCHESTRATOR_AGENT_ID)!;
    f.agents.save({ ...seed, instructions: 'My custom coordination brief' }, seed.id);
    const chat = await f.m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(chat.agent?.source).toBe('catalog');
    expect(chat.agent).toMatchObject({ name: seed.name, purpose: seed.purpose, avatar: seed.avatar });
    expect(chat.run).toBeUndefined();
    expect(f.sent[0]!.split('My custom coordination brief')).toHaveLength(2);
    expect(f.sent[0]).toContain('Updater apply is disabled');
    expect(f.file().chats.find(c => c.id === chat.id)?.agentInstructions).toBe('My custom coordination brief');
  });
});

describe('OrchestratorService', () => {
  it('get never starts anything; concurrent ensure creates once in the brain folder', async () => {
    const rows: ChatSummary[] = [];
    let release!: () => void;
    const create = vi.fn(async (req: Record<string, unknown>) => {
      await new Promise<void>(r => { release = r; });
      const c = summary({ id: 'o1', isOrchestrator: true, title: String(req.title) });
      rows.push(c); return c;
    });
    const s = new OrchestratorService({ list: () => rows, create } as unknown as Pick<ChatService, 'list' | 'create'>, () => 'C:/brain');
    expect(s.get()).toBeNull();
    const p1 = s.ensure({ harness: 'claude' }), p2 = s.ensure({ harness: 'cursor' });
    release();
    expect((await p1).id).toBe('o1');
    expect((await p2).id).toBe('o1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ cwd: 'C:/brain', orchestrator: true, harness: 'claude' });
    expect(await s.ensure({ harness: 'claude' })).toBe(rows[0]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('ensure routes like a Orchestrator: the row for kind orchestrator gives model and effort, a named model beats it', async () => {
    const table = { version: 1, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: [
      { kind: 'orchestrator', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'high', why: 'Orchestrator: Sonnet', since: '2026-10-17', evidence: 'prova' },
    ] } as RoutingTable;
    const make = () => {
      const made: Record<string, unknown>[] = [];
      const create = async (req: Record<string, unknown>) => { made.push(req); return summary({ id: `o${made.length}`, isOrchestrator: true }); };
      const s = new OrchestratorService({ list: () => [], create } as unknown as Pick<ChatService, 'list' | 'create'>, () => 'C:/brain', {
        route: r => routeChat(r, table, DEMO_REGISTRY, null, 7), engineOn: () => true, agentsMayOpen: () => true,
        orchestratorChats: () => ({ harness: 'claude', claudeModel: 'claude-opus-5-5', cursorModel: '', claudeEffort: 'medium', cursorReasoning: 'medium', cursorFast: false }),
      });
      return { made, s };
    };
    const a = make();
    await a.s.ensure({ harness: 'claude' });
    expect(a.made[0]).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'high', orchestrator: true, title: 'Orchestrator', cwd: 'C:/brain' });
    expect(a.made[0]!.route).toMatchObject({ kind: 'orchestrator', source: 'table' });
    const b = make();
    await b.s.ensure({ harness: 'claude', model: 'claude-opus-5-5' });
    expect(b.made[0]).toMatchObject({ model: 'claude-opus-5-5' });
    expect(b.made[0]!.route).toMatchObject({ kind: 'orchestrator', source: 'override' });
  });

  it('without a brain folder it refuses and creates nothing', async () => {
    const create = vi.fn();
    const s = new OrchestratorService({ list: () => [], create } as unknown as Pick<ChatService, 'list' | 'create'>, () => null);
    await expect(s.ensure({ harness: 'claude' })).rejects.toThrow(/brain/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('app control scope', () => {
  const ROUTED = { routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null, 7) };
  function tools(list: ChatSummary[], caller: string) {
    const made: Record<string, unknown>[] = [];
    const chats = { list: () => list, create: async (req: Record<string, unknown>) => { made.push(req); return summary({ id: `n${made.length}`, title: String(req.title) }); } } as unknown as ChatService;
    const orchestratorChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, orchestratorChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const code = { repo: () => 'C:/repo', inRepo: async (d: string) => d.replace(/\\/g, '/').startsWith('C:/repo') };
    const catalog = new AgentCatalogService({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-orch-roles-')), models: () => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
    const all = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', code,
      agents: () => catalog.list(), resolveRole: req => catalog.resolve(req) }, caller);
    return { made, create: all.find(t => t.name === 'app_create_chat')!, all };
  }
  const orch = summary({ id: 'o', isOrchestrator: true, title: 'Orchestrator' });
  const work = summary({ id: 'w' });

  it('the authenticated Orchestrator creates work chats in the brain folder or the folder it names, never a Orchestrator', async () => {
    const t = tools([orch, work], 'o');
    expect(await t.create.run({ title: 'A', prompt: 'p', roleId: 'artisan' })).toMatchObject({ cwd: 'C:/brain' });
    expect(await t.create.run({ title: 'B', prompt: 'p', roleId: 'artisan', cwd: 'C:/repo' })).toMatchObject({ cwd: 'C:/repo' });
    expect(t.made[1]).toMatchObject({ orchestrator: false });
    await expect(Promise.resolve(t.create.run({ title: 'E', prompt: 'p', roleId: 'artisan', orchestrator: true }))).rejects.toThrow(/Orchestrator/);
    expect(t.made).toHaveLength(2);
  });

  it('derives app-code routing from cwd (ADR 0079: no app space any more)', async () => {
    const t = tools([orch, work], 'o');
    await t.create.run({ title: 'Neutral title', prompt: 'p', roleId: 'artisan', cwd: 'C:/repo' });
    await t.create.run({ title: 'Other', prompt: 'p', roleId: 'artisan', cwd: 'C:/elsewhere' });
    expect(t.made[0]).toMatchObject({ cwd: 'C:/repo', route: { area: 'App' } });
    expect(t.made[1]).toMatchObject({ cwd: 'C:/elsewhere' });
    expect((t.made[1] as { route?: { area?: string } }).route?.area).not.toBe('App');
    for (const created of t.made) expect(created).not.toHaveProperty('space');
    expect(JSON.stringify(t.create.inputSchema)).not.toContain('"space"');
  });

  it('another chat on the same mount gets no union scope', async () => {
    const t = tools([orch, work], 'w');
    expect(await t.create.run({ title: 'B', prompt: 'p', roleId: 'artisan', cwd: 'C:/repo' })).toMatchObject({ cwd: 'C:/repo' });
    expect(t.made).toHaveLength(1);
    expect(t.made[0]).not.toHaveProperty('space');
  });

  it('a new chat may not take the Orchestrator\'s title (its mail box)', async () => {
    const t = tools([orch, work], 'o');
    await expect(Promise.resolve(t.create.run({ title: 'orchestrator', prompt: 'p', roleId: 'artisan' }))).rejects.toThrow(/reserved/);
    expect(t.made).toHaveLength(0);
  });

  it('a generic endpoint never offers the space parameter', () => {
    const t = tools([orch], 'o');
    expect(JSON.stringify(t.create.inputSchema)).not.toContain('"space"');
  });
});

describe('news and mail reach the Orchestrator', () => {
  it('a work chat\'s finished turn wakes the Orchestrator', async () => {
    vi.useFakeTimers();
    try {
      const sent: string[] = [];
      const orchestrator = summary({ id: 'r', isOrchestrator: true, title: 'Orchestrator' });
      const w = new OrchestratorWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => [orchestrator], groupMs: 10, perChatMs: 0, now: () => Date.now() });
      w.observe('chat:updated', summary({ id: 'fix', state: 'running' }));
      w.observe('chat:updated', summary({ id: 'fix', state: 'idle', lastText: 'PR pronta' }));
      await vi.advanceTimersByTimeAsync(20);
      expect(sent.some(t => t.includes('«fix»'))).toBe(true);
      w.stop();
    } finally { vi.useRealTimers(); }
  });
});

describe('updater', () => {
  it('apply stays hard off', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/main/update/wiring.ts'), 'utf8');
    expect(src).toMatch(/const RESTART_LIFECYCLE_VERIFIED = false;/);
  });
});
