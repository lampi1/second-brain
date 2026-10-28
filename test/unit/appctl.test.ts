// The app-control MCP tools (main/appctl/tools.ts): effort changes, messages labelled as an agent's, role delegation
// (app_create_chat with roleId), long-chat hand-offs, the routing table tools, logs and UI steering, endpoint auth.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import type { AgentModelChoice } from '../../src/shared/agents';
import { AGENT_LABEL, CHAT_PROMPT_MAX, CHAT_TITLE_MAX, PULL_ASK_MIN, UNBLOCK_ASK_MIN, RESOLVED_LABEL, appControlTools, orchestratorEndpointAuth } from '../../src/main/appctl/tools';
import { EndpointTokens } from '../../src/main/mcp/tokens';
import { log } from '../../src/main/log';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
import type { RunFeedback } from '../../src/main/agents/run-feedback';
import { routeChat, type RouteRequest } from '../../src/main/brain/routing';
import { DemoRouting } from '../../src/main/brain/routing-demo';
import type { NewChat, RoutingRow, RoutingTable } from '../../src/shared/contract';

/** a brain with no routing table and no registry (a role chat's route is its role's, brain/routing.ts routeAgent) */
const ROUTED = { routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null, 7) };
/** the real role catalog with a Claude engine whose tiers map to m-top / m-mid / m-light */
function roleCatalog(): AgentCatalogService {
  const models = (): AgentModelChoice[] => [
    { engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true },
    { engine: 'cursor', label: 'Cursor', enabled: true, trusted: true, effort: false, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: false, authenticated: null }];
  return new AgentCatalogService({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-appctl-roles-')), models, tierModel: (_e, tier) => `m-${tier}` });
}

function deps() {
  const sent: { chatId: string; text: string }[] = [];
  const ui: unknown[] = [];
  const chats = {
    list: () => [], items: () => [], pending: () => [{ id: 'r1', chatId: 'c1', type: 'permission', tool: 'Bash', title: 'git commit', detail: '', input: {}, at: 0 }],
    send: async (chatId: string, text: string) => { sent.push({ chatId, text }); },
  } as unknown as ChatService;
  const browser = { list: () => [] } as unknown as BrowserService;
  const brain = { feed: () => [], usage: () => ({ todayUsd: 1, fiveHourPct: null, fiveHourResetsAt: null, weekPct: null }), info: () => ({ brainRoot: null }) } as unknown as BrainService;
  const tools = appControlTools({ chats, browser, brain, window: () => null, emitUi: c => ui.push(c), version: '0.0.0' });
  const tool = (n: string) => tools.find(t => t.name === n)!;
  return { sent, ui, tools, tool };
}

describe('app control tools', () => {
  it('assigns a scoped follow-up with stable source identity and refuses changed scope or unauthenticated reuse', async () => {
    const catalog = roleCatalog(), scout = catalog.list().profiles.find(p => p.id === 'scout')!;
    const target = { id: 'w', harness: 'claude', cwd: '/project', state: 'idle', agent: { id: 'scout', version: scout.activeVersion }, run: { taskVersion: 2, taskId: 'task', runId: 'run' } };
    const assignTask = vi.fn(async () => {});
    const chats = { list: () => [{ id: 'o', isOrchestrator: true, harness: 'claude' }, target], assignTask } as unknown as ChatService;
    const brain = { settings: () => ({ messaging: { crossHarness: false } }) } as unknown as BrainService;
    const tools = (caller?: string) => appControlTools({ chats, browser: {} as BrowserService, brain, agents: () => catalog.list(), window: () => null, emitUi: () => {}, version: '0' }, caller);
    const args = { chatId: 'w', prompt: 'Expand the second point', mode: 'continue', roleId: 'scout', cwd: '/project', expectedVersion: 2 };
    const tool = tools('o').find(t => t.name === 'app_assign_task')!;
    await tool.run(args);
    expect(assignTask).toHaveBeenCalledWith('w', `${AGENT_LABEL}\n\nExpand the second point`, { mode: 'continue', expectedVersion: 2, source: { kind: 'chat', chatId: 'o' } });
    await expect(Promise.resolve().then(() => tool.run({ ...args, cwd: '/different' }))).rejects.toThrow(/Project changed/);
    await expect(Promise.resolve().then(() => tool.run({ ...args, roleId: 'sentinel' }))).rejects.toThrow(/Role mismatch/);
    await expect(Promise.resolve().then(() => tools().find(t => t.name === 'app_assign_task')!.run(args))).rejects.toThrow(/authenticated/);
    expect(assignTask).toHaveBeenCalledTimes(1);
  });

  it('sets only a validated next-turn effort within the caller space and preserves the current report', async () => {
    const current = { supported: true, requested: 'xhigh', submitted: 'xhigh', effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: 'high' };
    const rows = [{ id: 'work', harness: 'claude', model: 'chosen-model', effort: 'xhigh', effortStatus: current }, { id: 'app', harness: 'claude', cwd: 'C:/repo' }, { id: 'cursor', harness: 'cursor' }, { id: 'api', harness: 'anthropic' }];
    const set = vi.fn(async (id: string, patch: object) => ({ ...rows.find(c => c.id === id), id, effortStatus: { ...current, requested: 'medium', pending: true }, ...patch }));
    const chats = { list: () => rows, set } as unknown as ChatService;
    const tool = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }).find(t => t.name === 'app_set_chat_effort')!;
    expect(await tool.run({ chatId: 'work', effort: 'medium', model: 'other', approvalPolicy: 'never' })).toMatchObject({ chatId: 'work', effort: { requested: 'medium', submitted: 'xhigh', effective: null, pending: true } });
    expect(set.mock.calls).toEqual([['work', { effort: 'medium' }]]);
    for (const effort of [null, 1, 'bogus', { toString: () => 'medium' }]) await expect(Promise.resolve().then(() => tool.run({ chatId: 'work', effort }))).rejects.toThrow(/validi/);
    expect(await tool.run({ chatId: 'app', effort: 'medium' })).toMatchObject({ chatId: 'app' });
    // Cursor takes it as its model's thought_level option (issue #97); an API engine has none
    expect(await tool.run({ chatId: 'cursor', effort: 'low' })).toMatchObject({ chatId: 'cursor' });
    await expect(Promise.resolve().then(() => tool.run({ chatId: 'api', effort: 'medium' }))).rejects.toThrow(/non supporta/);
    expect(set).toHaveBeenCalledTimes(3);
    expect(rows[0]).toMatchObject({ model: 'chosen-model', effort: 'xhigh', effortStatus: current });
  });
  it('can never answer permissions; questions only through app_resolve_question', () => {
    const { tools } = deps();
    expect(tools.map(t => t.name).some(n => /answer|approve|allow|permission/i.test(n))).toBe(false);
    expect(tools.filter(t => /resolve/.test(t.name)).map(t => t.name)).toEqual(['app_resolve_question']);
  });

  describe('app_resolve_question: the answer the user gave in the Orchestrator closes the work chat\'s question', () => {
    const q = { id: 'q1', chatId: 'w', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 100,
      questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }, { question: 'Chi lo segue?', options: [], multiSelect: false }] };
    const perm = { id: 'p1', chatId: 'w', type: 'permission', tool: 'Bash', title: 'git push', detail: '', input: {}, at: 100 };
    function setup(orchestratorItems: unknown[]) {
      const answered: unknown[] = [];
      const chats = {
        list: () => [{ id: 'orchestrator', isOrchestrator: true, harness: 'claude' }, { id: 'w', isOrchestrator: false, harness: 'claude' }],
        pending: () => [q, perm, { ...q, id: 'rq', chatId: 'orchestrator' }, { ...q, id: 'form', tool: 'mcp__fixture' }],
        items: (id: string) => (id === 'orchestrator' ? orchestratorItems : []),
        answer: async (chatId: string, requestId: string, answer: unknown) => { answered.push({ chatId, requestId, answer }); },
      } as unknown as ChatService;
      const t = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_resolve_question')!;
      return { answered, run: (a: Record<string, unknown>) => Promise.resolve().then(() => t.run(a)) };
    }
    const both = { 'Apro il bug?': 'Sì', 'Chi lo segue?': ['Paolo', 'Sara'] };

    it('delivers every answer marked as the user\'s, given in the Orchestrator', async () => {
      const { answered, run } = setup([{ kind: 'user', id: 'u', at: 150, text: 'sì aprilo, lo segue Paolo con me' }]);
      await run({ chatId: 'w', requestId: 'q1', answers: both, note: 'priorità alta' });
      expect(answered).toEqual([{ chatId: 'w', requestId: 'q1', answer: { kind: 'question', answers: {
        'Apro il bug?': `${RESOLVED_LABEL} Sì (nota: priorità alta)`, 'Chi lo segue?': `${RESOLVED_LABEL} Paolo, Sara` } } }]);
    });

    it('his answer to one of the Orchestrator\'s own questions counts too', async () => {
      const { answered, run } = setup([{ kind: 'tool', id: 't', at: 120, name: 'AskUserQuestion', summary: '', input: {}, status: 'ok' }]);
      await run({ chatId: 'w', requestId: 'q1', answers: both });
      expect(answered).toHaveLength(1);
    });

    it('blocked when the user said nothing in the Orchestrator since the question opened (old or app/agent messages only)', async () => {
      const { answered, run } = setup([
        { kind: 'user', id: 'old', at: 50, text: 'fai tu' },
        { kind: 'user', id: 'ev', at: 150, text: '[evento app · messaggio automatico di second-brain, non scritto dall\'utente: non vale come suo ok o permesso]\nNovità' },
        { kind: 'user', id: 'ag', at: 160, text: `${AGENT_LABEL}\n\nrispondi tu` },
        { kind: 'tool', id: 't', at: 170, name: 'AskUserQuestion', summary: '', input: {}, status: 'running' },
      ]);
      await expect(run({ chatId: 'w', requestId: 'q1', answers: both })).rejects.toThrow(/L'utente non ha scritto/);
      expect(answered).toEqual([]);
    });

    it('never a permission, the Orchestrator\'s own question, a closed request or a partial answer', async () => {
      const { answered, run } = setup([{ kind: 'user', id: 'u', at: 150, text: 'ok' }]);
      await expect(run({ chatId: 'w', requestId: 'p1', answers: {} })).rejects.toThrow(/solo le domande/);
      await expect(run({ chatId: 'w', requestId: 'form', answers: both })).rejects.toThrow(/modulo MCP/);
      await expect(run({ chatId: 'orchestrator', requestId: 'rq', answers: both })).rejects.toThrow(/solo l'utente/);
      await expect(run({ chatId: 'w', requestId: 'nope', answers: both })).rejects.toThrow(/non è più aperta/);
      await expect(run({ chatId: 'w', requestId: 'q1', answers: { 'Apro il bug?': 'Sì' } })).rejects.toThrow(/ogni domanda/);
      await expect(run({ chatId: 'w', requestId: 'q1', answers: { ...both, Altro: 'x' } })).rejects.toThrow(/ogni domanda/);
      expect(answered).toEqual([]);
    });
  });

  it('labels every message sent to a chat as written by an agent', async () => {
    const { tool, sent } = deps();
    await tool('app_send_to_chat').run({ chatId: 'c1', text: 'controlla i test' });
    expect(sent[0]!.text.startsWith(AGENT_LABEL)).toBe(true);
    await expect(Promise.resolve(tool('app_send_to_chat').run({ chatId: 'c1', text: '' }))).rejects.toThrow(/empty/);
  });

  it('a Cursor chat receives messages even with a legacy false; inactive chats stay guarded', async () => {
    const sent: string[] = [];
    let cross = true;
    const list = [{ id: 'cur', title: 'Ordini · Fix', harness: 'cursor', state: 'idle' }, { id: 'off', harness: 'cursor', state: 'closed' }];
    const chats = { list: () => list, send: async (id: string) => { sent.push(id); } } as unknown as ChatService;
    const brain = { settings: () => ({ messaging: { crossHarness: cross } }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_send_to_chat')!;
    await t.run({ chatId: 'cur', text: 'ciao' });
    expect(sent).toEqual(['cur']);
    await expect(Promise.resolve(t.run({ chatId: 'off', text: 'ciao' }))).rejects.toThrow(/non è attiva/);
    cross = false;
    await t.run({ chatId: 'cur', text: 'ciao' });
    expect(sent).toEqual(['cur', 'cur']);
  });

  it('a Cursor Orchestrator writes across engines even with legacy false; inactive targets stay guarded', async () => {
    const sent: string[] = [];
    let cross = false;
    const list = [{ id: 'r', harness: 'cursor', state: 'idle', isOrchestrator: true }, { id: 'cur', harness: 'cursor', state: 'closed' }, { id: 'cl', harness: 'claude', state: 'idle' }, { id: 'cloff', harness: 'claude', state: 'closed' }];
    const chats = { list: () => list, send: async (id: string) => { sent.push(id); } } as unknown as ChatService;
    const brain = { settings: () => ({ messaging: { crossHarness: cross } }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_send_to_chat')!;
    await t.run({ chatId: 'cur', text: 'ciao' });
    await t.run({ chatId: 'cl', text: 'ciao' });
    cross = true;
    await t.run({ chatId: 'cl', text: 'ciao' });
    await expect(Promise.resolve(t.run({ chatId: 'cloff', text: 'ciao' }))).rejects.toThrow(/Claude non è attiva/);
    expect(sent).toEqual(['cur', 'cl', 'cl']);
  });

  it('the Orchestrator delegates a role chat in the brain folder, labelled; the role decides engine and model; the engine switches hold', async () => {
    const made: Record<string, unknown>[] = [];
    let cursorOn = true;
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }], create: async (req: Record<string, unknown>) => { made.push(req); return { id: `n${made.length}`, title: req.title }; } } as unknown as ChatService;
    const orchestratorChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: cursorOn }, orchestratorChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: req => catalog.resolve(req) }, 'r').find(x => x.name === 'app_create_chat')!;
    expect(await t.run({ title: 'Ordini · Fix', prompt: 'correggi il totale', roleId: 'artisan' })).toMatchObject({ chatId: 'n1', harness: 'claude', cwd: 'C:/brain', model: 'm-mid', route: { source: 'agent', agent: { id: 'artisan', chosenBy: 'orchestrator' } } });
    expect(String(made[0]!.prompt).startsWith(AGENT_LABEL)).toBe(true);
    expect(made[0]).toMatchObject({ roleId: 'artisan', orchestrator: false });
    expect(made[0]).not.toHaveProperty('independentOf');
    // the role decides: no engine, model or effort from the caller; never a second Orchestrator; a role is required
    for (const extra of [{ harness: 'cursor' }, { model: 'opus' }, { effort: 'high' }]) await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', roleId: 'scout', ...extra }))).rejects.toThrow(/the role decides it/);
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', roleId: 'scout', orchestrator: true }))).rejects.toThrow(/Orchestrator/);
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y' }))).rejects.toThrow(/roleId required/);
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', roleId: 'reviewer' }))).rejects.toThrow(/roleId required/);
    // a tier up to the role's maximum; above it, refused
    expect(await t.run({ title: 'Ordini · Fix 2', prompt: 'p', roleId: 'artisan', tier: 'top' })).toMatchObject({ model: 'm-top', route: { agent: { tier: 'top' } } });
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', roleId: 'herald', tier: 'top' }))).rejects.toThrow(/massimo/);
    expect(made).toHaveLength(2);
    // a role on Cursor while «Gli Orchestrator possono usare Cursor» is off: refused, nothing created
    catalog.save({ ...catalog.list().profiles.find(p => p.id === 'scout')!, engine: 'cursor', model: null }, 'scout');
    cursorOn = false;
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', roleId: 'scout' }))).rejects.toThrow(/Gli Orchestrator possono usare Cursor/);
    expect(made).toHaveLength(2);
  });

  it('app_create_chat gives the explicit kind to the role resolution and the chat, so a model-less role meets its table row', async () => {
    const made: Record<string, unknown>[] = [], asked: NewChat[] = [];
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }], create: async (req: Record<string, unknown>) => { made.push(req); return { id: 'n1', title: req.title }; } } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true }, engines: { claude: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: req => { asked.push(req); return catalog.resolve(req); } }, 'r').find(x => x.name === 'app_create_chat')!;
    await t.run({ title: 'Ordini · Controllo', prompt: 'guarda il ramo', roleId: 'sentinel', kind: 'review' });
    expect(asked[0]).toMatchObject({ routeHint: { kind: 'review' } });
    expect(made[0]).toMatchObject({ routeHint: { kind: 'review' } });
    await t.run({ title: 'Ordini · Controllo 2', prompt: 'guarda il ramo', roleId: 'sentinel' });
    expect(asked[1]).not.toHaveProperty('routeHint');
  });

  it('app_create_chat shows the prompt and title limits in its schema and names the length it refuses (#172)', async () => {
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }], create: async (req: Record<string, unknown>) => ({ id: 'n1', title: req.title }) } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true }, engines: { claude: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const all = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: req => catalog.resolve(req) }, 'r');
    const t = all.find(x => x.name === 'app_create_chat')!;
    const props = (t.inputSchema as { properties: Record<string, { maxLength?: number }> }).properties;
    expect(props.prompt!.maxLength).toBe(CHAT_PROMPT_MAX);
    expect(props.title!.maxLength).toBe(CHAT_TITLE_MAX);
    expect((all.find(x => x.name === 'app_assign_task')!.inputSchema as { properties: Record<string, { maxLength?: number }> }).properties.prompt!.maxLength).toBe(CHAT_PROMPT_MAX);
    const long = 'x'.repeat(CHAT_PROMPT_MAX + 1);
    await expect(Promise.resolve(t.run({ title: 'X', prompt: long, roleId: 'scout' }))).rejects.toThrow(new RegExp(`${CHAT_PROMPT_MAX}.*${CHAT_PROMPT_MAX + 1}`));
    await expect(Promise.resolve(t.run({ title: ' ', prompt: 'y', roleId: 'scout' }))).rejects.toThrow(/^title: required$/);
    expect(await t.run({ title: 'X', prompt: 'x'.repeat(CHAT_PROMPT_MAX), roleId: 'scout' })).toMatchObject({ chatId: 'n1' });
  });

  it('app_create_chat warns when a passed skill needs tools the role lacks (#93); with full permissions it does not', async () => {
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }], create: async (req: Record<string, unknown>) => ({ id: 'n1', title: req.title }) } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true }, engines: { claude: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const skillTools = () => [{ name: 'issue-open', tools: ['Write', 'node scripts/open-issue.mjs'] }];
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: req => catalog.resolve(req), skillTools }, 'r').find(x => x.name === 'app_create_chat')!;
    expect(await t.run({ title: 'Issue · Bozza', prompt: 'apri la issue', roleId: 'herald', skills: ['issue-open'] })).not.toHaveProperty('warnings');
    const herald = catalog.list().profiles.find(p => p.id === 'herald')!;
    catalog.save({ ...herald, tools: { allow: ['read', 'web', 'mail-draft'] } }, 'herald');
    const out = await t.run({ title: 'Issue · Bozza 2', prompt: 'apri la issue', roleId: 'herald', skills: ['issue-open'] }) as { warnings?: string[] };
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatch(/skill «issue-open» needs edit, shell, which Herald lacks/);
    const cat = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), skillTools }, 'r').find(x => x.name === 'agent_catalog')!;
    const listed = await cat.run({ id: 'herald', skills: ['issue-open'] }) as { roles: { skillWarnings?: string[] }[] };
    expect(listed.roles[0]!.skillWarnings?.[0]).toMatch(/issue-open/);
  });

  it('the Orchestrator\'s own mount has task_estimate, and app_create_chat answers with the estimate from similar tasks (ADR 0087)', async () => {
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }], create: async (req: Record<string, unknown>) => ({ id: 'n1', title: req.title }) } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const past = Array.from({ length: 4 }, (_, i) => ({ runId: `r_00000000000${i}`, chatId: `c${i}`, agentId: 'artisan', version: 1, goal: 'Correggi il bug del totale', startedBy: 'orchestrator', startedAt: i * 1e6, endedAt: i * 1e6 + 300_000, endReason: 'completed', executionMs: 240_000, costUsd: 0.1, tokens: null, counters: {} }));
    const runFeedback = { runList: () => past, metrics: () => [] } as unknown as RunFeedback;
    const deps = { chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: (req: NewChat) => catalog.resolve(req), runFeedback };
    expect(appControlTools(deps, 'r').some(x => x.name === 'task_estimate')).toBe(true);
    expect(appControlTools(deps).some(x => x.name === 'task_estimate')).toBe(false);
    expect(await appControlTools(deps, 'r').find(x => x.name === 'task_estimate')!.run({ request: 'Correggi il bug dello sconto', agentId: 'artisan' })).toMatchObject({ basis: 'agent-kind', n: 4, path: 'one-agent', quick: true });
    const created = await appControlTools(deps, 'r').find(x => x.name === 'app_create_chat')!.run({ title: 'Ordini · Fix', prompt: 'Correggi il bug dello sconto', roleId: 'artisan' });
    expect(created).toMatchObject({ estimate: { timeMs: 240_000, n: 4, parts: 1, path: 'one-agent', confidence: 'low' } });
  });

  it('app_ui never maximizes a delegated chat or its browser (no screenshot of its content); a root chat it may', () => {
    const ui: unknown[] = [];
    const list = [{ id: 'c_root', title: 'Root', isOrchestrator: false }, { id: 'c_kid', parentId: 'c_root', title: 'Kid', isOrchestrator: false }];
    const chats = { list: () => list } as unknown as ChatService;
    const browser = { list: () => [{ id: 'tab-kid', ownerChatId: 'c_kid' }, { id: 'tab-root', ownerChatId: 'c_root' }] } as unknown as BrowserService;
    const ui_ = appControlTools({ chats, browser, brain: {} as BrainService, window: () => null, emitUi: c => ui.push(c), version: '0' }, 'o').find(x => x.name === 'app_ui')!;
    for (const value of ['c_kid', 'chat:c_kid', 'tab-kid', 'browser:tab-kid']) expect(() => ui_.run({ action: 'maximize', value })).toThrow(/delegata/);
    expect(ui).toEqual([]);
    expect(ui_.run({ action: 'maximize', value: 'c_root' })).toBe('ok');
    expect(ui_.run({ action: 'maximize', value: 'tab-root' })).toBe('ok');
    expect(ui).toHaveLength(2);
  });

  it('app_create_chat on the plain /mcp/app mount (any local process) asks for a chat bound by the Orchestrator; its own mount does not', async () => {
    const opts: unknown[] = [];
    const chats = { list: () => [{ id: 'r', harness: 'claude', model: 'claude-opus-5-5', isOrchestrator: true, title: 'Orchestrator' }],
      create: async (req: Record<string, unknown>, _by: unknown, _i: unknown, _l: unknown, o: unknown) => { opts.push(o); return { id: `n${opts.length}`, title: req.title }; } } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, orchestratorChats: { harness: 'claude' } }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const catalog = roleCatalog();
    const deps = { chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', agents: () => catalog.list(), resolveRole: (req: NewChat) => catalog.resolve(req) };
    const create = (caller?: string) => appControlTools(deps, caller).find(x => x.name === 'app_create_chat')!;
    await create('r').run({ title: 'Ordini · Fix', prompt: 'p', roleId: 'artisan' });
    await create().run({ title: 'Ordini · Fix 2', prompt: 'p', roleId: 'artisan' });
    await create('not-an-orchestrator').run({ title: 'Ordini · Fix 3', prompt: 'p', roleId: 'artisan' });
    expect(opts).toEqual([{ boundByOrchestrator: false }, { boundByOrchestrator: true }, { boundByOrchestrator: true }]);
  });

  it('long chats: hand-off and continuation cross engines with legacy false and keep their labels', async () => {
    const calls: [string, string, Record<string, unknown>][] = [];
    let cross = true;
    const list = [
      { id: 'cl', harness: 'claude', state: 'closed', title: 'Fix', pending: 0, model: null, costUsd: 1, isOrchestrator: false, lastText: '', contextTokens: 250_000, handoffAt: 5 },
      { id: 'cu', harness: 'cursor', state: 'idle', title: 'Sms', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: '', contextTokens: 30_000, contextEstimated: true },
      { id: 'cx', harness: 'cursor', state: 'closed', title: 'Old', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: '' },
    ];
    const chats = {
      list: () => list,
      handoff: async (id: string, o: Record<string, unknown>) => { calls.push(['handoff', id, o]); return { chatId: id, path: `C:/h/${id}.md`, source: 'chat', at: 1, title: 'x', text: 'T' }; },
      continueChat: async (id: string, o: Record<string, unknown>) => { calls.push(['continue', id, o]); return { id: 'new', title: 'Fix (2)', harness: 'claude' }; },
    } as unknown as ChatService;
    const brain = { settings: () => ({ contextWarnTokens: 200_000, messaging: { crossHarness: cross }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true } }) } as unknown as BrainService;
    const tools = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' });
    const t = (n: string) => tools.find(x => x.name === n)!;
    const out = await t('app_chats').run({}) as { app: Record<string, unknown>[] };
    expect(out.app[0]).toMatchObject({ contextTokens: 250_000, long: true, handoffAt: new Date(5).toISOString() });
    expect(out.app[1]).toMatchObject({ long: false, contextEstimated: true });
    expect(out.app[2]!.contextTokens).toBeUndefined();
    expect(await t('app_handoff_chat').run({ chatId: 'cl' })).toMatchObject({ path: 'C:/h/cl.md', text: 'T' });
    await t('app_handoff_chat').run({ chatId: 'cu' });
    await t('app_handoff_chat').run({ chatId: 'cx' });
    expect(calls.map(c => [c[1], c[2].allowStart])).toEqual([['cl', true], ['cu', true], ['cx', false]]);
    expect(await t('app_continue_chat').run({ chatId: 'cl' })).toMatchObject({ chatId: 'new', continuedFrom: 'cl' });
    expect(calls.at(-1)![2]).toMatchObject({ promptPrefix: AGENT_LABEL, allowStart: true });
    cross = false;
    await t('app_continue_chat').run({ chatId: 'cu' });
    await t('app_handoff_chat').run({ chatId: 'cu' });
    await expect(Promise.resolve(t('app_handoff_chat').run({ chatId: 'nope' }))).rejects.toThrow(/sconosciuta/);
    // A Cursor Orchestrator can reach Claude too; the stopped-chat wake rules still apply.
    list.push({ id: 'r', harness: 'cursor', state: 'idle', title: 'Orchestrator', pending: 0, model: null, costUsd: 0, isOrchestrator: true, lastText: '' });
    await t('app_handoff_chat').run({ chatId: 'cx' });
    expect(calls.at(-1)![2].allowStart).toBe(true);
    await t('app_continue_chat').run({ chatId: 'cl' });
    cross = true;
    await t('app_continue_chat').run({ chatId: 'cl' });
    expect(calls.at(-1)![2].allowStart).toBe(false);
    // a delegated chat's hand-off is its content: only its parent reads it, and it goes on under its parent (ADR 0083)
    list.push({ id: 'kid', harness: 'claude', state: 'idle', title: 'Scout', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: 'segreto', parentId: 'cl' } as typeof list[number]);
    const before = calls.length;
    await expect(Promise.resolve().then(() => t('app_handoff_chat').run({ chatId: 'kid' }))).rejects.toThrow(/delegata/);
    await expect(Promise.resolve().then(() => t('app_continue_chat').run({ chatId: 'kid' }))).rejects.toThrow(/delegata/);
    expect(calls).toHaveLength(before);
  });

  it('app_digest leaves out the commands run in delegated chats (state only, never their content)', async () => {
    const list = [
      { id: 'root', harness: 'claude', state: 'idle', title: 'Root', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: '' },
      { id: 'kid', harness: 'claude', state: 'idle', title: 'Kid', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: '', parentId: 'root' },
    ];
    const at = Date.now();
    const runs = [{ id: 'x1', chatId: 'root', itemId: 'i', code: 'npm test', cwd: '/w', state: 'ok', exitCode: 0, output: '', startedAt: at, endedAt: at },
      { id: 'x2', chatId: 'kid', itemId: 'i', code: 'cat kid-secret.txt', cwd: '/w', state: 'ok', exitCode: 0, output: '', startedAt: at, endedAt: at }];
    const chats = { list: () => list, pending: () => [] } as unknown as ChatService;
    const brain = { settings: () => ({ contextWarnTokens: 200_000 }) } as unknown as BrainService;
    const tools = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', runs: () => runs } as unknown as Parameters<typeof appControlTools>[0]);
    const out = JSON.stringify(await tools.find(x => x.name === 'app_digest')!.run({}));
    expect(out).toContain('npm test');
    expect(out).not.toContain('kid-secret');
  });

  it('app_routing reads the table; app_routing_save writes a new version by itself, signed, with reason and data; hard rules hold', async () => {
    const routing = new DemoRouting('2026-10-14T08:00:00.000Z');
    const chats = { list: () => [{ id: 'r1', isOrchestrator: true, title: 'Orchestrator' }] } as unknown as ChatService;
    const brain = {
      routingInfo: () => routing.info(),
      saveRouting: (routes: RoutingRow[], reason: string | null, o: { by: string; evidence?: string | null; base?: number; exploration?: number }) =>
        routing.save(routes, '2026-10-14T09:00:00.000Z', { ...o, reason }),
    } as unknown as BrainService;
    const tools = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' });
    const read = await tools.find(x => x.name === 'app_routing')!.run({}) as { table: RoutingTable; pickable: { id: string }[]; appChats: unknown };
    expect(read.pickable.map(m => m.id)).not.toContain('claude-fable-5-1');
    expect(read.appChats).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
    const save = tools.find(x => x.name === 'app_routing_save')!;
    const routes = [...read.table.routes, { kind: 'writing', harness: 'claude', model: 'claude-haiku-5-5', effort: 'medium', why: 'mail: basta Haiku' }];
    await expect(Promise.resolve().then(() => save.run({ routes, reason: 'meno costi' }))).rejects.toThrow(/obbligatori/);
    await expect(Promise.resolve().then(() => save.run({ routes, reason: 'r', evidence: 'e' }))).rejects.toThrow(/baseVersion/);
    // built on an older version: refused, the newer one stays (no silent overwrite)
    await expect(Promise.resolve().then(() => save.run({ routes, reason: 'r', evidence: 'e', baseVersion: 2 }))).rejects.toThrow(/è cambiata .ora versione 3,/);
    expect(await save.run({ routes, exploration: 0.2, reason: 'mail su Haiku', evidence: '12 chat, 0 correzioni', baseVersion: 3 })).toEqual({ version: 4, exploration: 0.2, rows: 5 });
    expect(routing.info().history[0]).toMatchObject({ to: 4, by: 'agente: Orchestrator', reason: 'mail su Haiku', evidence: '12 chat, 0 correzioni', exploration: { from: 0, to: 0.2 } });
    // Never Fable, and changing an app row must still preserve every locked row.
    await expect(Promise.resolve().then(() => save.run({ routes: [{ ...routes[0], model: 'claude-sonnet-5-5' }], reason: 'r', evidence: 'e', baseVersion: 4 }))).rejects.toThrow(/bloccata dall’utente/);
    await expect(Promise.resolve().then(() => save.run({ routes: [{ kind: 'review', harness: 'claude', model: 'claude-fable-5-1', effort: 'high', why: 'w' }], reason: 'r', evidence: 'e', baseVersion: 4 }))).rejects.toThrow(/Fable mai/);
    expect(routing.info().table!.version).toBe(4);
    // the demo's bug-fix row is locked by the user: the agent may not change it
    const bug = read.table.routes.findIndex(x => x.kind === 'bug-fix');
    await expect(Promise.resolve().then(() => save.run({ routes: routes.map((x, i) => (i === bug ? { ...x, effort: 'medium' } : x)), reason: 'r', evidence: 'e', baseVersion: 4 }))).rejects.toThrow(/bloccata dall’utente/);
  });

  it('filters logs by level and text and steers the UI', async () => {
    const { tool, ui } = deps();
    log.warn('chats', 'session slow', { chat: 'c9' });
    log.info('browser', 'tab opened');
    const out = await tool('app_logs').run({ level: 'warn', grep: 'slow' }) as { msg: string }[];
    expect(out.map(e => e.msg)).toContain('session slow');
    expect(out.every(e => e.msg !== 'tab opened')).toBe(true);
    await tool('app_ui').run({ action: 'page', value: 'task' });
    expect(ui).toEqual([{ action: 'page', value: 'task' }]);
    expect(() => tool('app_ui').run({ action: 'view', value: 'corsie' })).toThrow(/not allowed/);
  });

  it('lists the recent closed chats apart and lets the Orchestrator reopen one', async () => {
    const now = Date.now();
    const base = { harness: 'claude', state: 'closed', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: 'fatto' };
    const list = [
      { ...base, id: 'open', title: 'Aperta', state: 'idle' },
      { ...base, id: 'old', title: 'Vecchia', closedAt: now - 8 * 24 * 3600_000, closedBy: 'auto' },
      { ...base, id: 'new', title: 'Nuova', closedAt: now - 60_000, closedBy: 'auto' },
    ];
    const reopened: string[] = [];
    const chats = { list: () => list, reopen: async (id: string) => { reopened.push(id); return { ...list.find(c => c.id === id)!, closedAt: undefined }; } } as unknown as ChatService;
    const tools = appControlTools({ chats, browser: {} as BrowserService, brain: { settings: () => ({ contextWarnTokens: 200_000 }) } as unknown as BrainService, window: () => null, emitUi: () => {}, version: '0' });
    const out = await tools.find(t => t.name === 'app_chats')!.run({}) as { app: { id: string }[]; closed: { id: string; closedBy: string }[] };
    expect(out.app.map(c => c.id)).toEqual(['open']);
    expect(out.closed.map(c => c.id)).toEqual(['new']); // older than 7 days: not listed
    expect(out.closed[0]!.closedBy).toBe('auto');
    await tools.find(t => t.name === 'app_reopen_chat')!.run({ chatId: 'new' });
    expect(reopened).toEqual(['new']);
    await expect(Promise.resolve(tools.find(t => t.name === 'app_reopen_chat')!.run({ chatId: 'nope' }))).rejects.toThrow(/non trovata/);
  });

  it('no tool promotes, restarts, merges or reads the removed "Migliora l\'app" state: the user presses Aggiorna (ADR 0079)', () => {
    const chats = { list: () => [], items: () => [], pending: () => [] } as unknown as ChatService;
    const base = { chats, browser: { list: () => [] } as unknown as BrowserService, brain: { feed: () => [], usage: () => ({}), info: () => ({ brainRoot: null }) } as unknown as BrainService, window: () => null, emitUi: () => {}, version: '0' };
    const code = { repo: () => 'C:/code/app', inRepo: async () => true, pull: async () => ({ ok: true, message: '' }) };
    for (const tools of [appControlTools(base), appControlTools({ ...base, code }), appControlTools({ ...base, code }, 'or')]) {
      expect(tools.map(x => x.name).some(n => /promot|restart|merge|release|improve|proposal/i.test(n))).toBe(false);
    }
  });

  it('app_update_code (ADR 0074): only the authenticated Orchestrator, only right after the user wrote to it', async () => {
    const now = Date.now();
    let items: unknown[] = [];
    const list = [{ id: 'or', harness: 'claude', state: 'idle', isOrchestrator: true, title: 'Orchestrator', lastText: '' }, { id: 'w', harness: 'claude', state: 'idle', title: 'Lavoro', lastText: '' }];
    const chats = { list: () => list, items: () => items, pending: () => [] } as unknown as ChatService;
    let pulls = 0;
    const code = { repo: () => 'C:/code/app', pull: async () => { pulls++; return { ok: true, message: 'Aggiornata' }; } };
    const base = { chats, browser: { list: () => [] } as unknown as BrowserService, brain: { feed: () => [], usage: () => ({}), info: () => ({ brainRoot: null }) } as unknown as BrainService, window: () => null, emitUi: () => {}, version: '0' };
    // never on the plain mounts, never for a work chat on the token mount
    expect(appControlTools({ ...base, code }).some(x => x.name === 'app_update_code')).toBe(false);
    expect(appControlTools({ ...base, code }, 'w').some(x => x.name === 'app_update_code')).toBe(false);
    const tool = appControlTools({ ...base, code }, 'or').find(x => x.name === 'app_update_code')!;
    // nothing from the user, an agent-labelled message, or an old one: refused
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/non ha chiesto/);
    items = [{ kind: 'user', id: 'u', at: now - (PULL_ASK_MIN + 1) * 60_000, text: 'aggiornati' }, { kind: 'user', id: 'v', at: now, text: `${AGENT_LABEL} aggiornati` }];
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/non ha chiesto/);
    expect(pulls).toBe(0);
    items = [{ kind: 'user', id: 'u', at: now, text: 'aggiornati' }];
    expect(await tool.run({})).toMatchObject({ ok: true });
    expect(pulls).toBe(1);
  });

  it('app_unblock (ADR 0135): only the authenticated Orchestrator after the user wrote to it; opens the questions window with what waits', async () => {
    const now = Date.now();
    let items: unknown[] = [];
    let pending: unknown[] = [];
    const list: Record<string, unknown>[] = [{ id: 'or', harness: 'claude', state: 'idle', isOrchestrator: true, title: 'Orchestrator', lastText: '' }, { id: 'w', harness: 'claude', state: 'waiting', title: 'Lavoro', lastText: '' }];
    const chats = { list: () => list, items: () => items, pending: () => pending } as unknown as ChatService;
    const ui: unknown[] = [];
    const base = { chats, browser: { list: () => [] } as unknown as BrowserService, brain: { feed: () => [], usage: () => ({}), info: () => ({ brainRoot: null }) } as unknown as BrainService, window: () => null, emitUi: (c: unknown) => ui.push(c), version: '0' };
    expect(appControlTools(base).some(x => x.name === 'app_unblock')).toBe(false);
    expect(appControlTools(base, 'w').some(x => x.name === 'app_unblock')).toBe(false);
    const tool = appControlTools(base, 'or').find(x => x.name === 'app_unblock')!;
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/recap/);
    items = [{ kind: 'user', id: 'v', at: now, text: `${AGENT_LABEL} recap` }];
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/recap/);
    // too old, or an agent's mail after his message (a woken turn): refused
    items = [{ kind: 'user', id: 'u', at: now - (UNBLOCK_ASK_MIN + 1) * 60_000, text: 'fammi un recap' }];
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/recap/);
    items = [{ kind: 'user', id: 'u', at: now, text: 'fammi un recap' }, { kind: 'user', id: 'm', at: now, text: `${AGENT_LABEL} fatto` }];
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/recap/);
    items = [{ kind: 'user', id: 'u', at: now, text: 'fammi un recap' }];
    expect(await tool.run({})).toMatchObject({ waiting: 0 });
    expect(ui).toEqual([]);
    pending = [{ id: 'r1', chatId: 'w', type: 'question', tool: 'AskUserQuestion', title: 'Procedo?', detail: '', input: {}, at: 0 }];
    list.push({ id: 's', harness: 'claude', state: 'idle', title: 'Piano', lastText: '', plan: { phase: 'proposed', at: 1 } });
    expect(await tool.run({})).toMatchObject({ waiting: 2, questionsAndPermissions: 1, plans: 1 });
    expect(ui).toEqual([{ action: 'unblock' }]);
  });

  it('app_unblock opens durable workflow and learning decisions without any live chat request', async () => {
    const ui: unknown[] = [];
    const base = {
      chats: { list: () => [{ id: 'or', isOrchestrator: true }], items: () => [{ kind: 'user', at: Date.now(), text: 'Fai il punto' }], pending: () => [] } as unknown as ChatService,
      browser: {} as BrowserService, brain: {} as BrainService, window: () => null, version: '0', emitUi: (c: unknown) => ui.push(c),
      workflows: { list: () => [{ status: 'approval', proposal: { id: 'p' } }, { status: 'done' }] },
      agentLearning: { waiting: () => [{ id: 'lesson' }] },
    } as unknown as Parameters<typeof appControlTools>[0];
    const tool = appControlTools(base, 'or').find(x => x.name === 'app_unblock')!;
    expect(await tool.run({})).toMatchObject({ waiting: 2, workflows: 1, lessons: 1, questionsAndPermissions: 0, plans: 0 });
    expect(ui).toEqual([{ action: 'unblock' }]);
  });

  it('app_close_chat closes like the ✕ (log + feed), never the Orchestrator nor a chat waiting for the user', async () => {
    const base = { harness: 'claude', state: 'idle', pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: 'fatto' };
    const list = [{ ...base, id: 'w', title: 'Lavoro' }, { ...base, id: 'r', title: 'Orchestrator', isOrchestrator: true }, { ...base, id: 'q', title: 'Domanda', state: 'waiting', pending: 1 }];
    const closed: string[] = [];
    const feed: unknown[] = [];
    const chats = { list: () => list, close: async (id: string) => { closed.push(id); } } as unknown as ChatService;
    const brain = { settings: () => ({ contextWarnTokens: 200_000 }), publish: (e: unknown[]) => feed.push(...e) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_close_chat')!;
    expect(await t.run({ chatId: 'w' })).toBe('closed');
    expect(closed).toEqual(['w']);
    expect(feed).toEqual([{ kind: 'chat-closed', title: 'Lavoro', detail: 'chiusa dall’Orchestrator', chatId: 'w', who: 'claude' }]);
    expect(log.recent.some(e => e.msg === 'agent closed a chat' && e.chat === 'w')).toBe(true);
    await expect(Promise.resolve(t.run({ chatId: 'r' }))).rejects.toThrow(/Orchestrator/);
    await expect(Promise.resolve(t.run({ chatId: 'q' }))).rejects.toThrow(/aspetta/);
    await expect(Promise.resolve(t.run({ chatId: 'nope' }))).rejects.toThrow(/non trovata/);
    expect(closed).toEqual(['w']);
  });

  it('the Orchestrator\'s messages carry its title, on its own endpoint and on /mcp/app', async () => {
    const sent: (string | undefined)[] = [];
    const list = [{ id: 'r1', title: 'Orchestrator', harness: 'cursor', isOrchestrator: true, state: 'idle' }, { id: 'w', title: 'W', harness: 'cursor', state: 'idle' }];
    const chats = {
      list: () => list,
      send: async (_id: string, _t: string, _i?: unknown, _r?: boolean, from?: string) => { sent.push(from); },
    } as unknown as ChatService;
    const orchestratorChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: false }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, orchestratorChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const tools = (caller?: string) => appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }, caller);
    const run = (caller: string | undefined, n: string, a: Record<string, unknown>) => tools(caller).find(t => t.name === n)!.run(a);
    await run('r1', 'app_send_to_chat', { chatId: 'w', text: 'ciao' });
    // no caller (test agents on /mcp/app) acts for the Orchestrator too
    await run(undefined, 'app_send_to_chat', { chatId: 'w', text: 'ciao' });
    expect(sent).toEqual(['Orchestrator', 'Orchestrator']);
  });

  it("a Orchestrator's own endpoint answers only that open Orchestrator with its own token, never a guessed or borrowed one", () => {
    const tokens = new EndpointTokens();
    const list = [{ id: 'r1', isOrchestrator: true }, { id: 'r2', isOrchestrator: true }, { id: 'w', isOrchestrator: false }];
    const ok = orchestratorEndpointAuth(tokens, () => list);
    const t1 = tokens.tokenFor('r1'), t2 = tokens.tokenFor('r2'), tw = tokens.tokenFor('w');
    expect(ok({ chatId: 'r1', token: t1 })).toBe(true);
    expect(ok({ chatId: 'r2', token: t1 })).toBe(false); // another Orchestrator's token
    expect(ok({ chatId: 'r2', token: '' })).toBe(false);
    expect(ok({ chatId: 'r2' })).toBe(false);
    expect(ok({ chatId: 'w', token: tw })).toBe(false); // not a Orchestrator
    list[1]!.isOrchestrator = false; // replaced or closed: its endpoint stops answering
    expect(ok({ chatId: 'r2', token: t2 })).toBe(false);
  });
});
