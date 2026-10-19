// Agent first (ADR 0078, issues #70, #73, #80): app_create_chat without agentId asks the classifier; a worker starts a
// catalog sub-agent linked to its run; the Orchestrator creates a missing agent after the user's panel answer, and a
// refused call does not use up the approval; an agent's "Contesto massimo" is validated, versioned and resolved; legacy
// imports get real guidance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentRunStore } from '../../../src/main/agents/runs';
import { AgentAuthoring, authoringTools } from '../../../src/main/agents/authoring';
import { subagentTools, withinPolicy } from '../../../src/main/agents/subagent-tool';
import type { AgentPolicy } from '../../../src/main/agents/tool-policy';
import { appControlTools } from '../../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import type { AgentDraft, AgentModelChoice, AgentRun } from '../../../src/shared/agents';
import type { AgentClassification } from '../../../src/shared/agent-classifier';
import type { ChatItem, ChatSummary, NewChat } from '../../../src/shared/contract';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { CallCtx } from '../../../src/main/mcp/server';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-first-')); dirs.push(p); return p; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, maxContext: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: [{ id: 'large', name: 'Large' }], installed: null, authenticated: null }];
const draft = (over: Partial<AgentDraft> = {}): AgentDraft => ({ name: 'Fixer', purpose: 'Fix bugs', instructions: 'Reproduce, fix, test.', engine: 'claude', model: 'large',
  avatar: { kind: 'symbol', value: 'bug' }, tools: { allow: ['read'] }, permissionCeiling: 'default', ...over });
const ctx = (chatId: string) => ({ params: { chatId } }) as unknown as CallCtx;

function appTools(catalog: AgentCatalogService, classify: (req: string) => AgentClassification) {
  const create = vi.fn(async (req: NewChat) => ({ id: `c${create.mock.calls.length}`, title: req.title, ...catalog.resolve(req).request }));
  const brain = {
    info: () => ({ brainRoot: tmp() }), routingInfo: () => ({ registry: null }),
    settings: () => ({ engineOn: { claude: true }, engines: { claude: true }, messaging: {}, orchestratorChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '' } }),
    route: (req: RouteRequest) => routeChat(req, null, null, null),
  } as unknown as BrainService;
  const chats = { list: () => [{ id: 'orch', title: 'Orchestrator', harness: 'claude', isOrchestrator: true }], create } as unknown as ChatService;
  const tools = appControlTools({ chats, browser: {} as BrowserService, brain, agents: () => catalog.list(), classifyAgents: async r => classify(r),
    agentStats: () => '4 run, 2 con esito, 100% riuscite', window: () => null, emitUi: () => {}, version: '0' }, 'orch');
  return { create, tool: tools.find(t => t.name === 'app_create_chat')! };
}

describe('app_create_chat without agentId (#70)', () => {
  it('runs the chat as the classifier\'s match above its threshold', async () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const fixer = catalog.save(draft());
    const { create, tool } = appTools(catalog, () => ({ candidates: [{ id: fixer.id, score: 70, why: { field: 'whenToUse' } }], mode: 'words', threshold: 20, noneCloseEnough: false, proposal: null }));
    const out = await tool.run({ title: 'Ordini · Fix totale', prompt: 'Correggi il bug del totale' }) as { route: { source: string; agent: { chosenBy: string } } };
    expect(create.mock.calls[0]?.[0]).toMatchObject({ agentId: fixer.id, harness: 'claude', model: 'large' });
    expect(out.route).toMatchObject({ source: 'agent', agent: { id: fixer.id, chosenBy: 'classifier', score: 70, threshold: 20 } });
    expect(create.mock.calls[0]?.[0].route?.reason).toMatch(/scelto dal classificatore.*4 run/);
    expect(create.mock.calls[0]?.[0].prompt).toContain('agent_start_subagent');
  });

  it('falls back to Generale (table routing) under the threshold, recording the score it saw', async () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const fixer = catalog.save(draft());
    const { create, tool } = appTools(catalog, () => ({ candidates: [{ id: fixer.id, score: 10, why: { field: 'name' } }], mode: 'words', threshold: 20, noneCloseEnough: true, proposal: 'ask-user-to-create' }));
    await tool.run({ title: 'Varie · Una cosa', prompt: 'Fai una cosa' });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('agentId');
    expect(create.mock.calls[0]?.[0].route).toMatchObject({ source: 'default', agent: { id: 'default-general', chosenBy: 'fallback', score: 10, threshold: 20 } });
  });

  it('keeps Generale when Generale itself ranks first above the threshold', async () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const fixer = catalog.save(draft());
    const { create, tool } = appTools(catalog, () => ({ candidates: [{ id: 'default-general', score: 50, why: { field: 'purpose' } }, { id: fixer.id, score: 40, why: { field: 'name' } }], mode: 'words', threshold: 20, noneCloseEnough: false, proposal: null }));
    await tool.run({ title: 'Varie · Organizza', prompt: 'Organizza il lavoro' });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('agentId');
    expect(create.mock.calls[0]?.[0].route).toMatchObject({ agent: { id: 'default-general', chosenBy: 'fallback', score: 50 } });
  });

  it('skips the classifier when the caller names the engine or model', async () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const classify = vi.fn(() => ({ candidates: [], mode: 'words' as const, threshold: 20, noneCloseEnough: true, proposal: null }));
    const { create, tool } = appTools(catalog, classify);
    await tool.run({ title: 'A · b', prompt: 'c', harness: 'claude' });
    expect(classify).not.toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('agentId');
  });
});

describe('agent_start_subagent (#70)', () => {
  const run = (over: Partial<AgentRun>): AgentRun => ({ runId: 'run-w', chatId: 'w', agentId: 'agent-x', version: 1, goal: 'g', startedBy: 'orchestrator', startedAt: 1,
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0, tokens: null, ...over });
  const chat = (over: Partial<ChatSummary>) => ({ id: 'w', title: 'Bug · Worker', cwd: '/repo', harness: 'claude', isOrchestrator: false, ...over }) as ChatSummary;

  it('starts a catalog agent through the worker\'s Orchestrator, linked to the worker\'s open run', async () => {
    const create = vi.fn(async () => ({ chatId: 'child' }));
    let runs: AgentRun[] = [run({})];
    const [tool] = subagentTools({ chats: () => [chat({}), chat({ id: 'orch', title: 'Orchestrator', isOrchestrator: true })], runs: () => runs, create,
      policy: () => null, profile: () => ({ tools: { allow: ['read'] }, ceiling: 'default' }), worktrees: async () => [] });
    await expect(Promise.resolve(tool!.run({ agentId: 'agent-review', title: 'Bug · Review', prompt: 'Review the fix' }, ctx('w')))).resolves.toContain('child');
    expect(create).toHaveBeenCalledWith('orch', { agentId: 'agent-review', title: 'Bug · Review', prompt: 'Review the fix', parentRunId: 'run-w', goal: 'Review the fix', cwd: '/repo' });
    // bounds: three open children, two levels deep, an open run, a work chat
    runs = [run({}), ...[1, 2, 3].map(i => run({ runId: `k${i}`, chatId: `k${i}`, parentRunId: 'run-w' }))];
    await expect(Promise.resolve(tool!.run({ agentId: 'a', title: 't', prompt: 'p' }, ctx('w')))).rejects.toThrow(/3 open sub-agents/);
    runs = [run({ parentRunId: 'mid' }), run({ runId: 'mid', chatId: 'm', parentRunId: 'top' }), run({ runId: 'top', chatId: 't' })];
    await expect(Promise.resolve(tool!.run({ agentId: 'a', title: 't', prompt: 'p' }, ctx('w')))).rejects.toThrow(/2 levels/);
    runs = [];
    await expect(Promise.resolve(tool!.run({ agentId: 'a', title: 't', prompt: 'p' }, ctx('w')))).rejects.toThrow(/no open agent run/);
    await expect(Promise.resolve(tool!.run({ agentId: 'a', title: 't', prompt: 'p' }, ctx('orch')))).rejects.toThrow(/app_create_chat/);
  });

  it('refuses a child wider than its parent, a folder outside the parent\'s worktrees, and reserves the cap before creating', async () => {
    const releases: (() => void)[] = [];
    const create = vi.fn(() => new Promise<unknown>(res => { releases.push(() => res({ chatId: 'child' })); }));
    const profiles: Record<string, AgentPolicy> = {
      narrow: { tools: { allow: ['read'] }, ceiling: 'plan' },
      edits: { tools: { allow: ['read', 'edit'] }, ceiling: 'default' },
      higher: { tools: { allow: ['read'] }, ceiling: 'acceptEdits' },
      anyMcp: { tools: { allow: ['read', 'mcp'] }, ceiling: 'plan' },
      unbounded: { tools: null, ceiling: null },
    };
    const parent: AgentPolicy = { tools: { allow: ['read', 'mcp'], mcp: ['docs'] }, ceiling: 'default' };
    const [tool] = subagentTools({ chats: () => [chat({}), chat({ id: 'orch', title: 'Orchestrator', isOrchestrator: true })], runs: () => [run({})], create,
      policy: id => id === 'w' ? parent : null, profile: id => profiles[id], worktrees: async cwd => cwd === '/repo' ? ['/repo', '/repo-wt/fix'] : [] });
    const go = (agentId: string, cwd?: string) => Promise.resolve(tool!.run({ agentId, title: 't', prompt: 'p', ...(cwd ? { cwd } : {}) }, ctx('w')));
    for (const wide of ['edits', 'higher', 'anyMcp', 'unbounded']) await expect(go(wide)).rejects.toThrow(/does not have/);
    await expect(go('ghost')).rejects.toThrow(/Unknown agent/);
    await expect(go('narrow', '/elsewhere')).rejects.toThrow(/worktrees only/);
    expect(create).not.toHaveBeenCalled();
    // three concurrent starts fill the cap while none of their runs exists yet: the fourth is refused
    const started = [go('narrow'), go('narrow', '/repo-wt/fix'), go('narrow')];
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    await expect(go('narrow')).rejects.toThrow(/3 open sub-agents/);
    for (const r of releases) r();
    await Promise.all(started);
    expect(withinPolicy(profiles.narrow!, parent)).toBe(true);
    expect(withinPolicy({ tools: { allow: ['mcp'], mcp: ['docs'] }, ceiling: 'plan' }, parent)).toBe(true);
    expect(withinPolicy(profiles.unbounded!, null)).toBe(true);
  });

  it('goes through app_create_chat with the run link, so the child reports to its parent', async () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const reviewer = catalog.save(draft({ name: 'Reviewer' }));
    const create = vi.fn(async (req: NewChat) => ({ id: 'child', title: req.title, ...catalog.resolve(req).request }));
    const brain = { info: () => ({ brainRoot: tmp() }), routingInfo: () => ({ registry: null }),
      settings: () => ({ engineOn: { claude: true }, engines: { claude: true }, messaging: {}, orchestratorChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '' } }),
      route: (req: RouteRequest) => routeChat(req, null, null, null) } as unknown as BrainService;
    const chats = { list: () => [{ id: 'orch', title: 'Orchestrator', harness: 'claude', isOrchestrator: true }, { id: 'w', title: 'Bug · Worker', harness: 'claude', run: { runId: 'run-w' } }], create } as unknown as ChatService;
    const tool = appControlTools({ chats, browser: {} as BrowserService, brain, agents: () => catalog.list(), window: () => null, emitUi: () => {}, version: '0' }, 'orch').find(t => t.name === 'app_create_chat')!;
    await tool.run({ agentId: reviewer.id, title: 'Bug · Review', prompt: 'Review', parentRunId: 'run-w', cwd: tmp() });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ agentId: reviewer.id, parentRunId: 'run-w', route: { source: 'agent', agent: { chosenBy: 'parent' } } });
    expect(create.mock.calls[0]?.[0].prompt).toContain('Sei un sotto-agente di «Bug · Worker»');
  });
});

describe('agent_create after a panel approval (#73)', () => {
  function fixture() {
    const userData = tmp(), now = Date.now(), items: ChatItem[] = [];
    const catalog = new AgentCatalogService({ userData, models, now: () => now, approvedRoots: () => [userData] });
    const service = new AgentAuthoring({ userData, catalog, runs: new AgentRunStore(userData), items: () => items, now: () => now, suggestionSpend: () => 0, publish: vi.fn(), send: vi.fn(async () => undefined), isOrchestrator: () => true });
    return { catalog, service, items, now };
  }
  const preset = (catalog: AgentCatalogService) => catalog.list().profiles.find(p => p.origin.kind === 'preset' && p.routable !== false && p.tools?.allow.includes('read'))!.id;

  it('creates the agent from the user\'s panel answer; a refused call gives the approval back', async () => {
    const f = fixture(), presetId = preset(f.catalog);
    await expect(f.service.call('agent_create', { draft: draft(), presetId, reason: 'No agent fits' }, 'orch')).rejects.toThrow(/approval/);
    f.service.rememberHumanAnswer('orch', 'req-1', 'Creo l’agente TimeCamp?', { q: 'Sì, crealo' });
    // wrong category and avatar: refused with the valid values, approval kept
    await expect(f.service.call('agent_create', { draft: { ...draft(), category: 'time' }, presetId, reason: 'TimeCamp' }, 'orch')).rejects.toThrow(/development \| ops/);
    await expect(f.service.call('agent_create', { draft: { ...draft(), avatar: { kind: 'symbol', value: 'clock' } }, presetId, reason: 'TimeCamp' }, 'orch')).rejects.toThrow(/Simbolo non valido: briefcase/);
    await expect(f.service.call('agent_create', { draft: draft(), presetId: 'nope', reason: 'TimeCamp' }, 'orch')).rejects.toThrow(/active base preset: /);
    const p = await f.service.call('agent_create', { draft: draft({ name: 'TimeCamp' }), presetId, reason: 'TimeCamp' }, 'orch') as { name: string; lastEditedBy: string };
    expect(p).toMatchObject({ name: 'TimeCamp', lastEditedBy: 'orchestrator' });
    // used once
    await expect(f.service.call('agent_create', { draft: draft({ name: 'Again' }), presetId, reason: 'Again' }, 'orch')).rejects.toThrow(/approval/);
    // another chat's answer, and a "no", never approve
    f.service.rememberHumanAnswer('other', 'req-2', 'Creo?', { q: 'Sì' });
    f.service.rememberHumanAnswer('orch', 'req-3', 'Creo?', { q: 'No, lascia stare' });
    await expect(f.service.call('agent_create', { draft: draft(), presetId, reason: 'x' }, 'orch')).rejects.toThrow(/approval/);
    await expect(f.service.call('agent_create', { draft: draft(), presetId, requestItemId: 'answer:req-3', reason: 'x' }, 'orch')).rejects.toThrow(/declined/);
  });

  it('lists the valid values in the tool description', () => {
    const f = fixture();
    const tool = authoringTools(f.service, 'orch', () => true, () => ['preset-a', 'preset-b']).find(t => t.name === 'agent_create')!;
    expect(tool.description).toMatch(/presetId = .*preset-a \| preset-b/);
    expect(tool.description).toContain('development | ops | personal | other');
    expect(tool.description).toContain('briefcase');
    expect(tool.description).toContain('does not use up the approval');
    expect((tool.inputSchema as { required: string[] }).required).not.toContain('requestItemId');
  });
});

describe('"Contesto massimo" (#80)', () => {
  it('is validated, versioned, kept by older clients, cleared by null and resolved for the chat', () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const a = catalog.save(draft({ maxContext: 400_000 }));
    expect(a).toMatchObject({ maxContext: 400_000, version: 1 });
    expect(() => catalog.save(draft({ maxContext: 5_000 }))).toThrow(/Contesto massimo/);
    expect(() => catalog.save(draft({ maxContext: 2_000_000 }))).toThrow(/Contesto massimo/);
    const { maxContext: _m, ...older } = a; void _m;
    expect(catalog.save(older, a.id)).toMatchObject({ maxContext: 400_000, version: 1 });
    const changed = catalog.save({ ...a, maxContext: 600_000 }, a.id);
    expect(changed).toMatchObject({ maxContext: 600_000, version: 2 });
    expect(catalog.history(a.id).find(v => v.version === 2)?.behaviour.maxContext).toBe(600_000);
    expect(catalog.resolve({ agentId: a.id, harness: 'claude', cwd: '/' })).toMatchObject({ maxContext: 600_000 });
    const cleared = catalog.save({ ...changed, maxContext: null }, a.id);
    expect(cleared).not.toHaveProperty('maxContext');
    expect(cleared.version).toBe(3);
    expect(catalog.resolve({ agentId: a.id, harness: 'claude', cwd: '/' })).not.toHaveProperty('maxContext');
  });

  it('is applied by agent_update as a trial version with an undo (ADR 0082), and by agent_learn_propose through the setting path', async () => {
    const userData = tmp(), catalog = new AgentCatalogService({ userData, models });
    const a = catalog.save(draft());
    const service = new AgentAuthoring({ userData, catalog, runs: new AgentRunStore(userData), items: () => [], suggestionSpend: () => 0, publish: vi.fn(), send: vi.fn(async () => undefined), isOrchestrator: () => true });
    const done = await service.call('agent_update', { agentId: a.id, patch: { maxContext: 300_000 }, reason: 'long repo reads' }, 'orch') as { applied: boolean };
    expect(done).toMatchObject({ applied: true, agent: { maxContext: 300_000, trial: { baseline: 1 } } });
    expect(catalog.list().profiles.find(p => p.id === a.id)).toMatchObject({ maxContext: 300_000 });
    expect(service.proposals()).toEqual([]);
  });

  it('agent_learn_propose on the app endpoints: maxContext and auto-applied lessons only for the authenticated Orchestrator', async () => {
    const propose = vi.fn((...a: unknown[]) => ({ id: 'l1', args: a }));
    const learning = { propose, waiting: () => [], review: vi.fn() } as unknown as NonNullable<Parameters<typeof appControlTools>[0]['agentLearning']>;
    const list = [{ id: 'orch', title: 'Orchestrator', harness: 'claude', isOrchestrator: true }];
    const deps = { chats: { list: () => list } as unknown as ChatService, browser: {} as BrowserService, brain: {} as BrainService, agentLearning: learning, agentAuthoring: { call: vi.fn() } as unknown as AgentAuthoring, window: () => null, emitUi: () => {}, version: '0' };
    const orch = appControlTools(deps, 'orch'), stranger = appControlTools(deps, 'c_work');
    expect(JSON.stringify(orch.find(t => t.name === 'agent_learn_propose')!.inputSchema)).toContain('maxContext');
    expect(orch.map(t => t.name)).toContain('agent_lessons_waiting');
    const other = stranger.find(t => t.name === 'agent_learn_propose')!;
    expect(JSON.stringify(other.inputSchema)).not.toContain('maxContext');
    expect(stranger.map(t => t.name)).not.toContain('agent_lessons_waiting');
    await other.run({ agentId: 'a', rule: 'r', evidence: 'e' });
    expect(propose.mock.calls[0]).toEqual(['a', 'r', 'e', undefined, undefined, 'app:c_work']);
    await orch.find(t => t.name === 'agent_learn_propose')!.run({ agentId: 'a', rule: 'r', evidence: 'e', target: 'rule' });
    expect(propose.mock.calls[1]).toEqual(['a', 'r', 'e', 'rule', undefined, undefined]);
  });

  it('does not let a model-less profile be overridden but lets the chat bring the table\'s model', () => {
    const catalog = new AgentCatalogService({ userData: tmp(), models });
    const a = catalog.save(draft({ model: null }));
    expect(catalog.resolve({ agentId: a.id, harness: 'claude', cwd: '/', model: 'large', effort: 'high' }).request).toMatchObject({ model: 'large', effort: 'high' });
    const pinned = catalog.save(draft());
    expect(() => catalog.resolve({ agentId: pinned.id, harness: 'claude', cwd: '/', model: 'other' })).toThrow(/non corrisponde/);
  });
});

describe('legacy profiles get guidance (#70)', () => {
  it('completes an untouched import with whenToUse and instructions as a migration version', () => {
    const userData = tmp(), at = 1_000;
    const routes = [{ kind: 'bug-fix' as const, harness: 'claude', model: 'large', effort: null, why: 'w', since: '', evidence: '' }];
    const first = new AgentCatalogService({ userData, models, legacyRoutes: () => routes, now: () => at });
    const imported = first.list().profiles.find(p => p.id.startsWith('legacy-'))!;
    expect(imported.instructions).toMatch(/Riproduci il problema/);
    // a catalog written before ADR 0078: the same import without guidance
    const file = path.join(userData, 'agents.v2.json');
    const body = JSON.parse(fs.readFileSync(file, 'utf8')) as { profiles: Record<string, unknown>[] };
    for (const p of body.profiles) if (String(p.id).startsWith('legacy-')) { p.instructions = ''; delete p.manifest; }
    fs.writeFileSync(file, JSON.stringify(body));
    const again = new AgentCatalogService({ userData, models, legacyRoutes: () => [], now: () => at + 10 });
    const done = again.list().profiles.find(p => p.id === imported.id)!;
    expect(done.instructions).toMatch(/Riproduci il problema/);
    expect(done.manifest?.whenToUse).toMatch(/Correggere un bug/);
    expect(done.version).toBe(imported.version + 1);
    expect(again.history(done.id).at(-1)).toMatchObject({ author: 'migration' });
  });
});
