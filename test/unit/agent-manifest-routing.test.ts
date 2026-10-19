// Catalog delegation keeps engine policy and profile identity; a fake session proves Orchestrator context reaches the engine.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { agentCatalogBrief } from '../../src/main/agents/discovery';
import { appControlTools } from '../../src/main/appctl/tools';
import { routeChat, type RouteRequest } from '../../src/main/brain/routing';
import { engineOf, fingerprint, setTrust } from '../../src/main/engines/registry';
import { ChatManager } from '../../src/main/chats/manager';
import type { HarnessSession } from '../../src/main/chats/session';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
import type { NewChat, RoutingTable } from '../../src/shared/contract';
import { ANTHROPIC_API } from '../../src/shared/contract';
import type { AgentModelChoice } from '../../src/shared/agents';

const dirs: string[] = [], managers: ChatManager[] = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-manifest-route-')); dirs.push(dir); return dir; };
afterEach(async () => { for (const manager of managers.splice(0)) await manager.shutdown(50); setTrust({}); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'codex', label: 'Codex', enabled: true, trusted: true, installed: null, authenticated: null, effort: true, models: [{ id: 'synthetic-model', name: 'Synthetic' }], source: 'unknown', defaultModel: true, modelSelectable: true, modelReason: null }];
it('selects the profile without interpreting declared access as permission and refuses disabled engines', async () => {
  setTrust({ codex: fingerprint(engineOf('codex')!), [ANTHROPIC_API]: fingerprint(engineOf(ANTHROPIC_API)!) });
  const service = new AgentCatalogService({ userData: tmp(), models });
  const profile = service.save({ ...service.list().profiles[0]!, manifest: { accessScopes: ['all actions approved'], declaredTools: ['bypassPermissions'] } });
  let allowed = true;
  let table: RoutingTable | null = null;
  const create = vi.fn(async (req: NewChat) => ({ id: 'new', title: req.title, ...service.resolve(req).request }));
  const brain = {
    info: () => ({ brainRoot: '/synthetic' }), routingInfo: () => ({ registry: null }),
    settings: () => ({ engineOn: { codex: allowed, [ANTHROPIC_API]: true }, engines: { codex: allowed, [ANTHROPIC_API]: true }, messaging: {}, regiaChats: { harness: 'codex', claudeModel: '', cursorModel: '', claudeEffort: '' } }),
    route: (req: RouteRequest) => routeChat({ api: ANTHROPIC_API, ...req }, table, null, null),
  } as unknown as BrainService;
  const chats = { list: () => [{ id: 'regia', harness: 'codex', isRegia: true }], create } as unknown as ChatService;
  const tools = appControlTools({ chats, browser: {} as BrowserService, brain, agents: () => service.list(), window: () => null, emitUi: () => {}, version: '0' }, 'regia');
  const tool = tools.find(t => t.name === 'app_create_chat')!;
  const args = { title: 'Research', prompt: 'Find sources', agentId: profile.id };
  await tool.run(args);
  expect(create.mock.calls[0]?.[0]).toMatchObject({ agentId: profile.id, harness: 'codex', regiaOf: 'regia' });
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty('permissionMode');
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty('manifest');
  await expect(tool.run({ ...args, harness: 'claude' })).rejects.toThrow(/non corrisponde/);
  await expect(tool.run({ ...args, agentId: 'missing' })).rejects.toThrow(/non trovato/);
  table = { version: 1, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: [{ kind: '*', harness: 'codex', model: 'inherited-model', effort: 'high', why: 'Table choice', since: '', evidence: '' }] };
  // Agent first (ADR 0078): a different table row never refuses an agent's chat; a profile without a model takes the
  // row's model (and its effort, the profile naming none) as a default, recorded as the agent's route.
  await tool.run(args);
  expect(create.mock.calls[1]?.[0]).toMatchObject({ agentId: profile.id, harness: 'codex', model: 'inherited-model', effort: 'high' });
  expect(create.mock.calls[1]?.[0].route).toMatchObject({ source: 'agent', agent: { id: profile.id, chosenBy: 'orchestrator', modelFrom: 'table' } });
  expect(create.mock.calls[1]?.[0].route?.reason).toMatch(/modello dalla tabella/);
  const max = service.save({ ...profile, effort: 'max' });
  // the profile's own effort is the user's choice: no reason is asked
  await tool.run({ ...args, agentId: max.id });
  expect(create.mock.calls[2]?.[0]).toMatchObject({ effort: 'max', route: { source: 'agent' } });
  // The table's API preference cannot replace an explicitly selected profile's engine.
  table.routes[0] = { ...table.routes[0]!, kind: 'writing', model: 'synthetic-model', effort: null, onApi: true };
  const explicit = service.save({ ...profile, model: 'synthetic-model' });
  await tool.run({ ...args, agentId: explicit.id, kind: 'writing' });
  expect(create.mock.calls[3]?.[0]).toMatchObject({ harness: 'codex', agentId: explicit.id, model: 'synthetic-model' });
  allowed = false;
  await expect(tool.run(args)).rejects.toThrow(/spento/);
  expect(create).toHaveBeenCalledTimes(4);
  await expect(Promise.resolve(tools.find(t => t.name === 'agent_catalog')!.run({ id: profile.id }))).resolves.toMatchObject({ permissionsGranted: false });
});

it('refreshes compact declarations for Regia turns and keeps them out of work-chat turns', async () => {
  const sent: { id: string; text: string }[] = [];
  let brief = 'DECLARATIONS VERSION ONE\n';
  const manager = new ChatManager({ userData: tmp(), emitter: { emit: () => {} }, agentCatalogBrief: () => brief,
    sessionFactory: (harness, options, sink): HarnessSession => ({ harness, state: 'idle', sessionId: options.sessionId ?? null, pid: null, root: null, busy: false, alive: true,
      start: () => { sink.changed({ state: 'idle' }); }, send: text => { sent.push({ id: options.chatId, text }); }, answer: () => false, interrupt: async () => {},
      setModel: async () => {}, setPermissionMode: async () => {}, setEffort: async () => {}, rename: async () => {}, contextUsage: async () => null, usage: async () => null, close: async () => {}, killNow: () => {},
    }),
  });
  managers.push(manager);
  const cwd = tmp(), regia = await manager.create({ harness: 'codex', cwd, regia: true }), work = await manager.create({ harness: 'codex', cwd });
  await manager.send(regia.id, 'Choose a delegate');
  brief = 'DECLARATIONS VERSION TWO\n';
  await manager.send(regia.id, 'Choose again');
  await manager.send(work.id, 'Work');
  expect(sent.map(row => row.text)).toEqual(['DECLARATIONS VERSION ONE\nChoose a delegate', 'DECLARATIONS VERSION TWO\nChoose again', 'Work']);
  const service = new AgentCatalogService({ userData: tmp(), models });
  for (let i = 0; i < 40; i++) service.save({ ...service.list().profiles[0]!, name: 'x'.repeat(80), manifest: { whenToUse: 'u'.repeat(1200) } });
  const context = agentCatalogBrief(() => service.list());
  expect(context.length).toBeLessThan(9000);
  expect(context).toContain('omitted');
  expect(context).not.toContain('Chiarisci il risultato atteso');
});
