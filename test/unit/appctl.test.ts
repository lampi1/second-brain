import { describe, expect, it, vi } from 'vitest';
import { AGENT_LABEL, PULL_ASK_MIN, RESOLVED_LABEL, appControlTools, regiaEndpointAuth } from '../../src/main/appctl/tools';
import { EndpointTokens } from '../../src/main/mcp/tokens';
import { log } from '../../src/main/log';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
import { routeChat, type RouteRequest } from '../../src/main/brain/routing';
import { DEMO_REGISTRY, DemoRouting } from '../../src/main/brain/routing-demo';
import type { RoutingRow, RoutingTable } from '../../src/shared/contract';

/** a brain with no routing table and no registry: every chat gets the user's "Chat aperte dalla Regia" */
const ROUTED = { routingInfo: () => ({ registry: null }), route: (req: RouteRequest) => routeChat(req, null, null, null, 7) };

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
  it('sets only a validated next-turn effort within the caller space and preserves the current report', async () => {
    const current = { supported: true, requested: 'xhigh', submitted: 'xhigh', effective: null, pending: false, effectiveSource: 'unknown', sessionDefault: 'high' };
    const rows = [{ id: 'work', harness: 'claude', model: 'chosen-model', effort: 'xhigh', effortStatus: current }, { id: 'app', harness: 'claude', space: 'app' }, { id: 'cursor', harness: 'cursor' }];
    const set = vi.fn(async (id: string, patch: object) => ({ ...rows.find(c => c.id === id), id, effortStatus: { ...current, requested: 'medium', pending: true }, ...patch }));
    const chats = { list: () => rows, set } as unknown as ChatService;
    const tool = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }).find(t => t.name === 'app_set_chat_effort')!;
    expect(await tool.run({ chatId: 'work', effort: 'medium', model: 'other', approvalPolicy: 'never' })).toMatchObject({ chatId: 'work', effort: { requested: 'medium', submitted: 'xhigh', effective: null, pending: true } });
    expect(set.mock.calls).toEqual([['work', { effort: 'medium' }]]);
    for (const effort of [null, 1, 'bogus', { toString: () => 'medium' }]) await expect(Promise.resolve().then(() => tool.run({ chatId: 'work', effort }))).rejects.toThrow(/validi/);
    expect(await tool.run({ chatId: 'app', effort: 'medium' })).toMatchObject({ chatId: 'app' });
    await expect(Promise.resolve().then(() => tool.run({ chatId: 'cursor', effort: 'medium' }))).rejects.toThrow(/non supporta/);
    expect(set).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ model: 'chosen-model', effort: 'xhigh', effortStatus: current });
  });
  it('can never answer permissions; questions only through app_resolve_question', () => {
    const { tools } = deps();
    expect(tools.map(t => t.name).some(n => /answer|approve|allow|permission/i.test(n))).toBe(false);
    expect(tools.filter(t => /resolve/.test(t.name)).map(t => t.name)).toEqual(['app_resolve_question']);
  });

  describe('app_resolve_question: the answer the user gave in the Regia closes the work chat\'s question', () => {
    const q = { id: 'q1', chatId: 'w', type: 'question', tool: 'AskUserQuestion', title: 'Domanda', detail: '', input: {}, at: 100,
      questions: [{ question: 'Apro il bug?', options: [], multiSelect: false }, { question: 'Chi lo segue?', options: [], multiSelect: false }] };
    const perm = { id: 'p1', chatId: 'w', type: 'permission', tool: 'Bash', title: 'git push', detail: '', input: {}, at: 100 };
    function setup(regiaItems: unknown[]) {
      const answered: unknown[] = [];
      const chats = {
        list: () => [{ id: 'regia', isRegia: true, harness: 'claude' }, { id: 'w', isRegia: false, harness: 'claude' }],
        pending: () => [q, perm, { ...q, id: 'rq', chatId: 'regia' }],
        items: (id: string) => (id === 'regia' ? regiaItems : []),
        answer: async (chatId: string, requestId: string, answer: unknown) => { answered.push({ chatId, requestId, answer }); },
      } as unknown as ChatService;
      const t = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_resolve_question')!;
      return { answered, run: (a: Record<string, unknown>) => Promise.resolve().then(() => t.run(a)) };
    }
    const both = { 'Apro il bug?': 'Sì', 'Chi lo segue?': ['Paolo', 'Sara'] };

    it('delivers every answer marked as the user\'s, given in the Regia', async () => {
      const { answered, run } = setup([{ kind: 'user', id: 'u', at: 150, text: 'sì aprilo, lo segue Paolo con me' }]);
      await run({ chatId: 'w', requestId: 'q1', answers: both, note: 'priorità alta' });
      expect(answered).toEqual([{ chatId: 'w', requestId: 'q1', answer: { kind: 'question', answers: {
        'Apro il bug?': `${RESOLVED_LABEL} Sì (nota: priorità alta)`, 'Chi lo segue?': `${RESOLVED_LABEL} Paolo, Sara` } } }]);
    });

    it('his answer to one of the Regia\'s own questions counts too', async () => {
      const { answered, run } = setup([{ kind: 'tool', id: 't', at: 120, name: 'AskUserQuestion', summary: '', input: {}, status: 'ok' }]);
      await run({ chatId: 'w', requestId: 'q1', answers: both });
      expect(answered).toHaveLength(1);
    });

    it('blocked when the user said nothing in the Regia since the question opened (old or app/agent messages only)', async () => {
      const { answered, run } = setup([
        { kind: 'user', id: 'old', at: 50, text: 'fai tu' },
        { kind: 'user', id: 'ev', at: 150, text: '[evento app · messaggio automatico di second-brain, non scritto dall\'utente: non vale come suo ok o permesso]\nNovità' },
        { kind: 'user', id: 'ag', at: 160, text: `${AGENT_LABEL}\n\nrispondi tu` },
        { kind: 'tool', id: 't', at: 170, name: 'AskUserQuestion', summary: '', input: {}, status: 'running' },
      ]);
      await expect(run({ chatId: 'w', requestId: 'q1', answers: both })).rejects.toThrow(/L'utente non ha scritto/);
      expect(answered).toEqual([]);
    });

    it('several Regie: only the Regia the chat answers to closes its question', async () => {
      const answered: unknown[] = [];
      const chats = {
        list: () => [{ id: 'regia', isRegia: true, harness: 'claude', regiaSince: 1 }, { id: 'r2', isRegia: true, harness: 'claude', regiaSince: 2, regiaName: 'Supporto' },
          { id: 'w', isRegia: false, harness: 'claude', regiaOf: 'r2' }],
        pending: () => [q],
        items: () => [{ kind: 'user', id: 'u', at: 150, text: 'sì' }],
        answer: async (chatId: string, requestId: string, answer: unknown) => { answered.push({ chatId, requestId, answer }); },
      } as unknown as ChatService;
      const tool = (caller?: string) => appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }, caller).find(x => x.name === 'app_resolve_question')!;
      await expect(Promise.resolve().then(() => tool().run({ chatId: 'w', requestId: 'q1', answers: both }))).rejects.toThrow(/dell’Orchestrator «Orchestrator · Supporto»/);
      expect(answered).toEqual([]);
      await tool('r2').run({ chatId: 'w', requestId: 'q1', answers: both });
      expect(answered).toHaveLength(1);
    });

    it('the legacy /mcp/improve Regia closes questions only of app-code work, never of another Orchestrator\'s chat', async () => {
      const answered: unknown[] = [];
      const pend = [q, { ...q, id: 'q2', chatId: 'app' }, { ...q, id: 'q3', chatId: 'owned' }];
      const chats = {
        list: () => [{ id: 'regia', isRegia: true, harness: 'claude' }, { id: 'ar', isRegia: false, appRegia: true, harness: 'claude', cwd: 'C:/code/app' },
          { id: 'w', isRegia: false, harness: 'claude', cwd: 'C:/brain' }, { id: 'app', isRegia: false, harness: 'claude', cwd: 'C:/code/app-wt/x' },
          { id: 'owned', isRegia: false, harness: 'claude', cwd: 'C:/code/app', regiaOf: 'regia' }],
        pending: () => pend,
        items: () => [{ kind: 'user', id: 'u', at: 150, text: 'sì' }],
        answer: async (chatId: string, requestId: string, answer: unknown) => { answered.push({ chatId, requestId, answer }); },
      } as unknown as ChatService;
      const t = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0', sourceOnly: true,
        improve: { repo: () => 'C:/code/app', state: async () => ({}) as never, inRepo: async (dir: string) => dir.startsWith('C:/code/app') } }).find(x => x.name === 'app_resolve_question')!;
      const run = (a: Record<string, unknown>) => Promise.resolve().then(() => t.run(a));
      await expect(run({ chatId: 'w', requestId: 'q1', answers: both })).rejects.toThrow(/codice dell’app/);
      await expect(run({ chatId: 'owned', requestId: 'q3', answers: both })).rejects.toThrow(/codice dell’app/);
      expect(answered).toEqual([]);
      await run({ chatId: 'app', requestId: 'q2', answers: both });
      expect(answered).toHaveLength(1);
    });

    it('never a permission, the Regia\'s own question, a closed request or a partial answer', async () => {
      const { answered, run } = setup([{ kind: 'user', id: 'u', at: 150, text: 'ok' }]);
      await expect(run({ chatId: 'w', requestId: 'p1', answers: {} })).rejects.toThrow(/solo le domande/);
      await expect(run({ chatId: 'regia', requestId: 'rq', answers: both })).rejects.toThrow(/solo l'utente/);
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

  it('a Cursor Regia writes across engines even with legacy false; inactive targets stay guarded', async () => {
    const sent: string[] = [];
    let cross = false;
    const list = [{ id: 'r', harness: 'cursor', state: 'idle', isRegia: true }, { id: 'cur', harness: 'cursor', state: 'closed' }, { id: 'cl', harness: 'claude', state: 'idle' }, { id: 'cloff', harness: 'claude', state: 'closed' }];
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

  it('the Regia creates work chats in the brain folder, labelled, and obeys the engine switches', async () => {
    const made: Record<string, unknown>[] = [];
    let cross = true, cursorOn = true, regia: 'claude' | 'cursor' = 'claude';
    const chats = { list: () => [{ id: 'r', harness: regia, isRegia: true }], create: async (req: Record<string, unknown>) => { made.push(req); return { id: 'n1', title: req.title }; } } as unknown as ChatService;
    const regiaChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: cross }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: cursorOn }, regiaChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_create_chat')!;
    expect(await t.run({ title: 'Ordini · Fix', prompt: 'correggi il totale' })).toMatchObject({ chatId: 'n1', harness: 'claude', cwd: 'C:/brain' });
    expect(String(made[0]!.prompt).startsWith(AGENT_LABEL)).toBe(true);
    expect(made[0]).not.toHaveProperty('model');
    expect(made[0]).not.toHaveProperty('effort');
    // never a second Regia, not even silently: the role is the user's choice
    expect(made[0]!.regia).toBe(false);
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', regia: true }))).rejects.toThrow(/Orchestrator/);
    expect(made).toHaveLength(1);
    cross = false;
    expect(await t.run({ title: 'X', prompt: 'y', harness: 'cursor' })).toMatchObject({ harness: 'cursor' });
    // A legacy false does not restrict either engine; engine launch permissions below still apply.
    regia = 'cursor';
    expect(await t.run({ title: 'Cursor · Prova', prompt: 'y', harness: 'cursor' })).toMatchObject({ harness: 'cursor' });
    expect(await t.run({ title: 'X', prompt: 'y', harness: 'claude' })).toMatchObject({ harness: 'claude' });
    cross = true;
    expect(await t.run({ title: 'Claude · Prova', prompt: 'y', harness: 'claude' })).toMatchObject({ harness: 'claude' });
    expect(made.map(m => [m.harness, m.regia])).toEqual([['claude', false], ['cursor', false], ['cursor', false], ['claude', false], ['claude', false]]);
    // «Le Regie possono usare Cursor» off: refused to every Regia, a Cursor one too (review 2026-10-14)
    cursorOn = false;
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'y', harness: 'cursor' }))).rejects.toThrow(/Gli Orchestrator possono usare Cursor/);
  });

  it('long chats: hand-off and continuation cross engines with legacy false and keep their labels', async () => {
    const calls: [string, string, Record<string, unknown>][] = [];
    let cross = true;
    const list = [
      { id: 'cl', harness: 'claude', state: 'closed', title: 'Fix', pending: 0, model: null, costUsd: 1, isRegia: false, lastText: '', contextTokens: 250_000, handoffAt: 5 },
      { id: 'cu', harness: 'cursor', state: 'idle', title: 'Sms', pending: 0, model: null, costUsd: 0, isRegia: false, lastText: '', contextTokens: 30_000, contextEstimated: true },
      { id: 'cx', harness: 'cursor', state: 'closed', title: 'Old', pending: 0, model: null, costUsd: 0, isRegia: false, lastText: '' },
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
    // A Cursor Regia can reach Claude too; the stopped-chat wake rules still apply.
    list.push({ id: 'r', harness: 'cursor', state: 'idle', title: 'Regia', pending: 0, model: null, costUsd: 0, isRegia: true, lastText: '' });
    await t('app_handoff_chat').run({ chatId: 'cx' });
    expect(calls.at(-1)![2].allowStart).toBe(true);
    await t('app_continue_chat').run({ chatId: 'cl' });
    cross = true;
    await t('app_continue_chat').run({ chatId: 'cl' });
    expect(calls.at(-1)![2].allowStart).toBe(false);
  });

  it('what the Regia does not say comes from "Chat aperte dalla Regia", read at each call', async () => {
    const made: Record<string, unknown>[] = [];
    const regiaChats = { harness: 'cursor', claudeModel: 'claude-opus-5-5', cursorModel: 'grok-4.7', claudeEffort: 'high' };
    const chats = { list: () => [], create: async (req: Record<string, unknown>) => { made.push(req); return { id: `n${made.length}`, title: req.title }; } } as unknown as ChatService;
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, regiaChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_create_chat')!;
    // nothing said: the default engine and its model; no effort for Cursor
    expect(await t.run({ title: 'A', prompt: 'p' })).toMatchObject({ harness: 'cursor', model: 'grok-4.7', effort: null });
    expect(made[0]).toMatchObject({ harness: 'cursor', model: 'grok-4.7' });
    expect(made[0]).not.toHaveProperty('effort');
    // the engine said: that engine's default model and the Claude effort
    await t.run({ title: 'B', prompt: 'p', harness: 'claude' });
    expect(made[1]).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' });
    // the model said: kept as is
    await t.run({ title: 'C', prompt: 'p', harness: 'cursor', model: 'gpt-5' });
    expect(made[2]).toMatchObject({ harness: 'cursor', model: 'gpt-5' });
    // a model without its engine is refused: "opus" must never become a Cursor chat because Cursor is the default
    await expect(Promise.resolve(t.run({ title: 'X', prompt: 'p', model: 'opus' }))).rejects.toThrow(/harness/);
    expect(made).toHaveLength(3);
    // a change applies at the next call, no restart
    regiaChats.harness = 'claude'; regiaChats.claudeModel = ''; regiaChats.claudeEffort = '';
    await t.run({ title: 'D', prompt: 'p' });
    expect(made[3]).toMatchObject({ harness: 'claude' });
    expect(made[3]).not.toHaveProperty('model');
    expect(made[3]).not.toHaveProperty('effort');
  });

  it('routes by the table: omitted engine = its row; an override needs a reason; hard rules hold; the route travels with the chat', async () => {
    const made: Record<string, unknown>[] = [];
    const table: RoutingTable = { version: 4, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: [
      { kind: '*', area: ['App', 'Pers · App'], harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'app: Opus', since: '2026-10-12', evidence: 'regola' },
      { kind: 'triage', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', why: 'smistare: Sonnet', since: '2026-10-12', evidence: 'n=31' },
    ] };
    const rules = { tasks: [['triage', String.raw`\b(triage|smista\w*)\b`, 'i'], ['bug-fix', String.raw`\b(fix|bug)\b`, 'i']] as [string, string, string][] };
    const regiaChats = { harness: 'cursor', claudeModel: '', cursorModel: 'grok-4.7', claudeEffort: 'high' };
    const chats = { list: () => [], create: async (req: Record<string, unknown>) => { made.push(req); return { id: `n${made.length}`, title: req.title }; } } as unknown as ChatService;
    const brain = {
      routingInfo: () => ({ registry: DEMO_REGISTRY }), route: (req: RouteRequest) => routeChat(req, table, DEMO_REGISTRY, rules, 7),
      settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, regiaChats }), info: () => ({ brainRoot: 'C:/brain' }),
    } as unknown as BrainService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }).find(x => x.name === 'app_create_chat')!;
    // the kind read from the title picks the row
    expect(await t.run({ title: 'Posta · smista la inbox', prompt: 'p' })).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', route: { source: 'table', kind: 'triage', tableVersion: 4 } });
    expect(made[0]).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', route: { policy: 'routing', source: 'table', kind: 'triage', area: 'Posta', version: 4, at: 7 } });
    // naming what the row says is no override
    expect(await t.run({ title: 'Posta · smista', prompt: 'p', model: 'claude-sonnet-5-5' })).toMatchObject({ route: { source: 'table' } });
    // something else without a reason: refused, nothing created; with a reason: an override, logged with it
    await expect(Promise.resolve().then(() => t.run({ title: 'Posta · smista', prompt: 'p', model: 'claude-opus-5-5' }))).rejects.toThrow(/override senza motivo/);
    expect(await t.run({ title: 'Posta · smista', prompt: 'p', model: 'opus', reason: 'mail delicate' })).toMatchObject({ model: 'opus', route: { source: 'override', reason: 'mail delicate' } });
    // no row: the user's defaults (Cursor here), and naming another engine stays free as before
    expect(await t.run({ title: 'Ordini · fix totale', prompt: 'p' })).toMatchObject({ harness: 'cursor', model: 'grok-4.7', effort: null, route: { source: 'default', kind: 'bug-fix' } });
    expect(await t.run({ title: 'Ordini · fix totale', prompt: 'p', harness: 'claude' })).toMatchObject({ harness: 'claude', effort: 'high', route: { source: 'override', reason: null } });
    // a known model brings its engine; an agent's kind wins over the words
    expect(await t.run({ title: 'Ordini · x', prompt: 'p', model: 'claude-haiku-5-5', kind: 'ops-read' })).toMatchObject({ harness: 'claude', route: { kind: 'ops-read' } });
    // Hard rules: max needs a reason, models stay on their engine, and app chats may explicitly choose Cursor.
    await expect(Promise.resolve().then(() => t.run({ title: 'Ordini · x', prompt: 'p', harness: 'claude', effort: 'max' }))).rejects.toThrow(/max/);
    await expect(Promise.resolve().then(() => t.run({ title: 'Ordini · x', prompt: 'p', harness: 'cursor', model: 'claude-opus-5-5' }))).rejects.toThrow(/solo su claude/);
    expect(await t.run({ title: 'App · tema', prompt: 'p', harness: 'cursor', reason: 'prova' })).toMatchObject({ harness: 'cursor', route: { area: 'App', source: 'override' } });
    await expect(Promise.resolve().then(() => t.run({ title: 'Ordini · x', prompt: 'p', kind: 'boh' }))).rejects.toThrow(/kind sconosciuto/);
    await expect(Promise.resolve().then(() => t.run({ title: 'Ordini · x', prompt: 'p', harness: 'claude', model: 'claude-mistero-9' }))).rejects.toThrow(/models\.json/);
    expect(made).toHaveLength(7);
  });

  it('app_routing reads the table; app_routing_save writes a new version by itself, signed, with reason and data; hard rules hold', async () => {
    const routing = new DemoRouting('2026-10-14T08:00:00.000Z');
    const chats = { list: () => [{ id: 'r1', isRegia: true, title: 'Regia' }] } as unknown as ChatService;
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
    expect(routing.info().history[0]).toMatchObject({ to: 4, by: 'agente: Regia', reason: 'mail su Haiku', evidence: '12 chat, 0 correzioni', exploration: { from: 0, to: 0.2 } });
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
    await tool('app_ui').run({ action: 'page', value: 'devops' });
    expect(ui).toEqual([{ action: 'page', value: 'devops' }]);
    expect(() => tool('app_ui').run({ action: 'view', value: 'corsie' })).toThrow(/not allowed/);
  });

  it('lists the recent closed chats apart and lets the Regia reopen one', async () => {
    const now = Date.now();
    const base = { harness: 'claude', state: 'closed', pending: 0, model: null, costUsd: 0, isRegia: false, lastText: 'fatto' };
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

  it('legacy mounts share chats; the improve mount retains source-folder gates and read-only branch tools', async () => {
    const made: Record<string, unknown>[] = [];
    const sent: string[] = [];
    const list = [
      { id: 'r', harness: 'claude', state: 'idle', isRegia: true, title: 'Regia', lastText: '' },
      { id: 'w', harness: 'claude', state: 'idle', title: 'Ordini · Fix', lastText: '' },
      { id: 'ar', harness: 'claude', state: 'idle', space: 'app', appRegia: true, title: "Regia dell'app", lastText: '' },
      { id: 'a', harness: 'claude', state: 'idle', space: 'app', title: 'App · tema', lastText: '' },
    ];
    const chats = {
      list: () => list, items: () => [], pending: () => [{ id: 'p1', chatId: 'w' }, { id: 'p2', chatId: 'a' }],
      send: async (id: string) => { sent.push(id); },
      create: async (req: Record<string, unknown>) => { made.push(req); return { id: 'n', title: req.title }; },
      queueState: () => ({ enabled: true, cpu: 90, freeRam: 40, waiting: [{ chatId: 'w', kind: 'turn', position: 1, since: 0 }, { chatId: 'a', kind: 'start', position: 2, since: 0 }] }),
    } as unknown as ChatService;
    const brain = {
      ...ROUTED,
      settings: () => ({ messaging: { crossHarness: true }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, regiaChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '' }, contextWarnTokens: 200_000 }),
      info: () => ({ brainRoot: 'C:/brain' }), usage: () => ({}),
      feed: () => [{ id: 'f1', chatId: 'w' }, { id: 'f2', chatId: 'a' }, { id: 'f3' }],
    } as unknown as BrainService;
    log.info('test', 'space-probe', { chat: 'w' });
    log.info('test', 'space-probe', { chat: 'a' });
    const run = (chatId: string) => ({ id: chatId, chatId, state: 'done', exitCode: 0, code: 'x', cwd: 'c', output: '', startedAt: 0, endedAt: 1 });
    const runs = (chatId?: string) => [run('w'), run('a')].filter(r => !chatId || r.chatId === chatId);
    const base = { chats, browser: { list: () => [] } as unknown as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0', runs: runs as never };
    const work = appControlTools(base);
    const app = appControlTools({ ...base, sourceOnly: true, improve: { repo: () => 'C:/code/app', state: async () => ({ repo: 'C:/code/app' }) as never, inRepo: async (dir: string) => dir.startsWith('C:/code/app') } });
    const t = (tools: typeof work, n: string) => tools.find(x => x.name === n)!;

    const ids = async (tools: typeof work) => ((await t(tools, 'app_chats').run({})) as { app: { id: string }[] }).app.map(c => c.id);
    expect(await ids(work)).toEqual(['r', 'w', 'ar', 'a']);
    expect(await ids(app)).toEqual(['r', 'w', 'ar', 'a']);

    await t(work, 'app_send_to_chat').run({ chatId: 'a', text: 'x' });
    await t(app, 'app_send_to_chat').run({ chatId: 'w', text: 'x' });
    await t(app, 'app_send_to_chat').run({ chatId: 'a', text: 'x' });
    expect(sent).toEqual(['a', 'w', 'a']);

    await t(app, 'app_create_chat').run({ title: 'App · tema', prompt: 'tema scuro' });
    expect(made[0]).toMatchObject({ cwd: 'C:/code/app', regia: false });
    await t(work, 'app_create_chat').run({ title: 'Ordini', prompt: 'x' });
    expect(made[1]).toMatchObject({ cwd: 'C:/brain' });
    expect(made[0]).not.toHaveProperty('space');
    expect(made[1]).not.toHaveProperty('space');
    // the app's chats start only in the code folder or one of its worktrees
    await expect(Promise.resolve().then(() => t(app, 'app_create_chat').run({ title: 'App · x', prompt: 'x', cwd: 'C:/brain' }))).rejects.toThrow(/non ammessa/);
    expect(made).toHaveLength(2);

    // items, runs and requests of the other space read as unknown
    expect(await t(app, 'app_chat_items').run({ chatId: 'w' })).toEqual([]);
    expect(await t(work, 'app_chat_items').run({ chatId: 'a' })).toEqual([]);
    expect(((await t(app, 'app_pending').run({})) as { chatId: string }[]).map(r => r.chatId)).toEqual(['w', 'a']);
    expect(((await t(work, 'app_pending').run({})) as { chatId: string }[]).map(r => r.chatId)).toEqual(['w', 'a']);
    expect(((await t(app, 'app_command_runs').run({})) as { chatId: string }[]).map(r => r.chatId)).toEqual(['w', 'a']);
    expect(await t(app, 'app_command_runs').run({ chatId: 'w' })).toHaveLength(1);
    expect(((await t(app, 'app_state').run({})) as { pending: number }).pending).toBe(2);
    // the CPU queue (ADR 0036): each space sees only its own waiting chats
    expect(((await t(app, 'app_state').run({})) as { queue: { waiting: { chatId: string }[] } }).queue.waiting.map(w => w.chatId)).toEqual(['w', 'a']);
    expect(((await t(work, 'app_state').run({})) as { queue: { cpu: number; waiting: { chatId: string }[] } }).queue).toMatchObject({ cpu: 90, waiting: [{ chatId: 'w', position: 1 }, { chatId: 'a', position: 2 }] });
    // feed, logs and maximize stay in the caller's space too
    expect(await t(app, 'app_feed').run({})).toEqual([{ id: 'f1', chatId: 'w' }, { id: 'f2', chatId: 'a' }, { id: 'f3' }]);
    expect(((await t(app, 'app_logs').run({ grep: 'space-probe' })) as { chat: string }[]).map(e => e.chat)).toEqual(['w', 'a']);
    expect(() => t(app, 'app_ui').run({ action: 'maximize', value: 'a' })).not.toThrow();
    expect(() => t(work, 'app_ui').run({ action: 'maximize', value: 'a' })).not.toThrow();
    // closing too: never a chat of the other space, never the app's Regia
    await expect(Promise.resolve().then(() => t(app, 'app_close_chat').run({ chatId: 'missing' }))).rejects.toThrow(/non trovata/);
    await expect(Promise.resolve().then(() => t(work, 'app_close_chat').run({ chatId: 'missing' }))).rejects.toThrow(/non trovata/);
    await expect(Promise.resolve().then(() => t(app, 'app_close_chat').run({ chatId: 'ar' }))).rejects.toThrow(/Orchestrator/);
    expect(work.some(x => x.name === 'app_improve_state')).toBe(false);
    expect(await t(app, 'app_improve_state').run({})).toMatchObject({ repo: 'C:/code/app' });
    // no tool promotes, restarts or merges: the user presses Aggiorna
    expect(app.map(x => x.name).some(n => /promot|restart|merge|release/i.test(n))).toBe(false);
  });

  it('app_update_code (ADR 0074): only the authenticated Orchestrator, only right after the user wrote to it', async () => {
    const now = Date.now();
    let items: unknown[] = [];
    const list = [{ id: 'or', harness: 'claude', state: 'idle', isRegia: true, orchestrator: true, title: 'Orchestrator', lastText: '' }, { id: 'w', harness: 'claude', state: 'idle', title: 'Lavoro', lastText: '' }];
    const chats = { list: () => list, items: () => items, pending: () => [] } as unknown as ChatService;
    let pulls = 0;
    const improve = { repo: () => 'C:/code/app', state: async () => ({}) as never, pull: async () => { pulls++; return { ok: true, message: 'Aggiornata' }; } };
    const base = { chats, browser: { list: () => [] } as unknown as BrowserService, brain: { feed: () => [], usage: () => ({}), info: () => ({ brainRoot: null }) } as unknown as BrainService, window: () => null, emitUi: () => {}, version: '0' };
    // never on the plain mounts, never for a work chat on the token mount
    expect(appControlTools({ ...base, improve }).some(x => x.name === 'app_update_code')).toBe(false);
    expect(appControlTools({ ...base, sourceOnly: true, improve }).some(x => x.name === 'app_update_code')).toBe(false);
    expect(appControlTools({ ...base, unified: true, improve }, 'w').some(x => x.name === 'app_update_code')).toBe(false);
    const tool = appControlTools({ ...base, unified: true, improve }, 'or').find(x => x.name === 'app_update_code')!;
    // nothing from the user, an agent-labelled message, or an old one: refused
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/non ha chiesto/);
    items = [{ kind: 'user', id: 'u', at: now - (PULL_ASK_MIN + 1) * 60_000, text: 'aggiornati' }, { kind: 'user', id: 'v', at: now, text: `${AGENT_LABEL} aggiornati` }];
    await expect(Promise.resolve().then(() => tool.run({}))).rejects.toThrow(/non ha chiesto/);
    expect(pulls).toBe(0);
    items = [{ kind: 'user', id: 'u', at: now, text: 'aggiornati' }];
    expect(await tool.run({})).toMatchObject({ ok: true });
    expect(pulls).toBe(1);
  });

  it('app_close_chat closes like the ✕ (log + feed), never the Regia nor a chat waiting for the user', async () => {
    const base = { harness: 'claude', state: 'idle', pending: 0, model: null, costUsd: 0, isRegia: false, lastText: 'fatto' };
    const list = [{ ...base, id: 'w', title: 'Lavoro' }, { ...base, id: 'r', title: 'Regia', isRegia: true }, { ...base, id: 'q', title: 'Domanda', state: 'waiting', pending: 1 }];
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

  it('several Regie (ADR 0021): the caller endpoint picks the Regia; its chats answer to it, its messages carry its title', async () => {
    const made: Record<string, unknown>[] = [];
    const sent: (string | undefined)[] = [];
    const list = [{ id: 'r1', title: 'Regia', harness: 'claude', isRegia: true, state: 'idle' }, { id: 'r2', title: 'Regia · App', harness: 'cursor', isRegia: true, state: 'idle' }, { id: 'w', title: 'W', harness: 'cursor', state: 'idle' }];
    const chats = {
      list: () => list, create: async (req: Record<string, unknown>) => { made.push(req); return { id: 'n', title: req.title }; },
      send: async (_id: string, _t: string, _i?: unknown, _r?: boolean, from?: string) => { sent.push(from); },
    } as unknown as ChatService;
    const regiaChats = { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: '', cursorReasoning: 'medium', cursorFast: false };
    const brain = { ...ROUTED, settings: () => ({ messaging: { crossHarness: false }, engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, regiaChats }), info: () => ({ brainRoot: 'C:/brain' }) } as unknown as BrainService;
    const tools = (caller?: string) => appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }, caller);
    const run = (caller: string | undefined, n: string, a: Record<string, unknown>) => tools(caller).find(t => t.name === n)!.run(a);
    // (not an "App · …" title: the app's own chats never go to Cursor, a hard rule of the routing, ADR 0032)
    await run('r2', 'app_create_chat', { title: 'Sms · Fix', prompt: 'x', harness: 'cursor' });
    expect(made[0]).toMatchObject({ regiaOf: 'r2', harness: 'cursor' });
    expect(String(made[0]!.prompt)).toContain('Il tuo Orchestrator è «Regia · App»: scrivigli con send_to_chat.');
    // no caller or a stale one = the first Regia (test agents on /mcp/app)
    await run(undefined, 'app_create_chat', { title: 'Lavoro · Fix', prompt: 'x', harness: 'claude' });
    await run('gone', 'app_create_chat', { title: 'Lavoro · Fix 2', prompt: 'x', harness: 'claude' });
    expect(made.slice(1).map(m => m.regiaOf)).toEqual(['r1', 'r1']);
    await run('r2', 'app_send_to_chat', { chatId: 'w', text: 'ciao' });
    expect(sent).toEqual(['Regia · App']);
    // Both callers can reach the chat, retaining their own sender identity.
    await run('r1', 'app_send_to_chat', { chatId: 'w', text: 'ciao' });
    expect(sent).toEqual(['Regia · App', 'Regia']);
  });

  it("a Regia's own endpoint answers only that open Regia with its own token, never a guessed or borrowed one", () => {
    const tokens = new EndpointTokens();
    const list = [{ id: 'r1', isRegia: true }, { id: 'r2', isRegia: true }, { id: 'w', isRegia: false }];
    const ok = regiaEndpointAuth(tokens, () => list);
    const t1 = tokens.tokenFor('r1'), t2 = tokens.tokenFor('r2'), tw = tokens.tokenFor('w');
    expect(ok({ chatId: 'r1', token: t1 })).toBe(true);
    expect(ok({ chatId: 'r2', token: t1 })).toBe(false); // another Regia's token
    expect(ok({ chatId: 'r2', token: '' })).toBe(false);
    expect(ok({ chatId: 'r2' })).toBe(false);
    expect(ok({ chatId: 'w', token: tw })).toBe(false); // not a Regia
    list[1]!.isRegia = false; // replaced or closed: its endpoint stops answering
    expect(ok({ chatId: 'r2', token: t2 })).toBe(false);
  });
});
