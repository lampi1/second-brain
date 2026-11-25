// Unit tests of main/plans/{service,follow,start,tools}.ts (ADR 0342) over plain chat summaries and an in-memory store:
// which map a chat gets, how the map follows it, what each action asks of the chat, the migration at load, the list and
// the search, the first message of a new Strategist and the Orchestrator's actions. The same on a real ChatManager:
// test/unit/agents/work-map-chats.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatSummary } from '../../../src/shared/contract';
import { STRATEGY_FLOW, type PlanPhase, type PlanStep, type StrategyPlan } from '../../../src/shared/strategy';
import type { Plan } from '../../../src/shared/plan';
import { requestOf } from '../../../src/main/plans/follow';
import { Plans, type PlansDeps } from '../../../src/main/plans/service';
import { startPrompt, strategistStarter } from '../../../src/main/plans/start';
import { isJobAction, jobAction } from '../../../src/main/plans/tools';

let now: number, saved: Plan[], chats: ChatSummary[], emitted: string[], calls: unknown[][], n: number;
beforeEach(() => { now = 1000; saved = []; chats = []; emitted = []; calls = []; n = 0; });

const steps = (...states: PlanStep['state'][]): PlanStep[] => states.map((state, i) => ({ title: `Passo ${i + 1}`, state }));
const plan = (phase: PlanPhase, at = 100, s: PlanStep[] = steps('todo', 'todo')): StrategyPlan => ({ phase, at, clarified: [], steps: s });
function chat(id: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return { id, harness: 'claude', origin: 'app', title: `Lavoro ${id}`, cwd: 'C:/repo', sessionId: null, model: null, effort: null, permissionMode: null, state: 'running', costUsd: 0, pending: 0, isOrchestrator: false,
    lastText: '', updatedAt: 0, browserTabIds: [], agent: { id: 'strategist', source: 'catalog' }, run: { runId: `run-${id}`, goal: 'Porta gli sconti', startedAt: 900 }, ...extra } as unknown as ChatSummary;
}
const put = (c: ChatSummary): ChatSummary => { chats = [...chats.filter(x => x.id !== c.id), c]; return c; };
const change = (id: string, extra: Partial<ChatSummary>) => put({ ...chats.find(c => c.id === id)!, ...extra });

function maps(extra: Partial<PlansDeps> = {}): Plans {
  const set = (id: string, phase: PlanPhase, x: Partial<StrategyPlan> = {}) => { const c = chats.find(y => y.id === id)!; put({ ...c, plan: { ...c.plan!, phase, at: ++now, ...x } }); };
  return new Plans({
    store: {
      load: () => [...new Map(saved.map(m => [m.id, m])).values()].map(m => structuredClone(m)), save: m => { saved.push(structuredClone(m)); },
      history: id => saved.filter(m => m.id === id).map(m => ({ version: m.version, at: m.updatedAt, by: m.by, summary: m.summary })), version: (id, v) => saved.find(m => m.id === id && m.version === v) ?? null,
    },
    chats: {
      list: () => chats,
      planDecide: async (id, d, at, text, by, keep) => { calls.push(['planDecide', id, d, at, text, by, keep]); set(id, keep ? 'approved' : 'running'); },
      planStart: async id => { calls.push(['planStart', id]); set(id, 'running'); },
      planStop: async id => { calls.push(['planStop', id]); const c = chats.find(x => x.id === id)!; if (c.plan) set(id, c.plan.phase, { stopped: true }); },
      planResume: async id => { calls.push(['planResume', id]); const c = chats.find(x => x.id === id)!, { closedAt: _a, closedBy: _b, ...open } = c; const { stopped: _s, ...p } = c.plan ?? plan('running'); put({ ...open, ...(c.plan ? { plan: p } : {}) } as ChatSummary); },
      planReplan: async (id, text) => { calls.push(['planReplan', id, text]); set(id, 'revising'); },
      planPutAway: id => { calls.push(['planPutAway', id]); set(id, 'revising', { stopped: true, putAway: true }); },
    },
    emit: id => emitted.push(id), now: () => now, newId: () => `wm_test${String(++n).padStart(2, '0')}`, ...extra,
  });
}
const saw = (w: Plans, c: ChatSummary) => { w.observe('chat:updated', put(c)); return w.ofChat(c.id)!; };

describe('which map a chat has', () => {
  it('a Strategist root chat has one from its first event, with the request as its idea and no flow text', () => {
    const w = maps(), m = saw(w, chat('a', { run: { runId: 'r1', goal: `Porta gli sconti\n\n${STRATEGY_FLOW}`, startedAt: 900 } as ChatSummary['run'] }));
    expect(m).toMatchObject({ title: 'Lavoro a', idea: 'Porta gli sconti', state: 'running', owner: { chatId: 'a', task: 'r1' }, version: 1 });
    expect(emitted).toEqual([m.id]);
    // an event that changes nothing here writes nothing
    w.observe('chat:updated', { ...chats[0]!, lastText: 'x', updatedAt: 5 });
    expect(saved).toHaveLength(1);
  });

  it('any root chat with a plan has one; a delegated chat, the Orchestrator and an ordinary chat do not', () => {
    const w = maps(), agent = { id: 'plain', source: 'plain' } as unknown as ChatSummary['agent'];
    expect(saw(w, chat('p', { agent, plan: plan('proposed') })).state).toBe('toApprove');
    saw(w, chat('x', { agent }));
    saw(w, chat('k', { parentId: 'p' }));
    saw(w, chat('o', { isOrchestrator: true }));
    expect(w.list().map(i => i.ownerChatId)).toEqual(['p']);
  });

  it('a second job in the same chat gets its own map; the first is left stopped, or finished', () => {
    const w = maps(), first = saw(w, chat('a', { plan: plan('running') }));
    change('a', { run: { runId: 'run-2', goal: 'Altro', startedAt: 1200 } as ChatSummary['run'] });
    const { plan: _p, ...bare } = chats[0]!;
    const second = saw(w, bare as ChatSummary);
    expect(second.id).not.toBe(first.id);
    expect(w.get(first.id)).toMatchObject({ state: 'stopped', stopped: { by: 'replaced' }, plan: { phase: 'running' } });
    // the first job cannot be acted on through a chat that works on the second
    expect(w.view(first.id)!.info.can).toEqual(['resume', 'archive']);
  });

  it('the map made before the first run is known is the same map after', () => {
    const w = maps(), { run: _r, ...early } = chat('a');
    const m = saw(w, early as ChatSummary);
    expect(m.owner).toEqual({ chatId: 'a', task: 'chat' });
    expect(saw(w, chat('a')).id).toBe(m.id);
    expect(w.list()).toHaveLength(1);
  });

  it('a chat that continues another takes its map, and the steps stay until the new chat has its own', () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('running', 100, steps('done', 'now', 'todo')) }));
    const next = saw(w, chat('b', { continuedFrom: { id: 'a', title: 'Lavoro a' } as unknown as ChatSummary['continuedFrom'], plan: plan('asking', 200, []) }));
    expect(next).toMatchObject({ id: m.id, owner: { chatId: 'b' }, past: ['a'] });
    expect(next.plan!.steps.map(s => s.state)).toEqual(['done', 'todo', 'todo']);
    // the old chat's later events do not take it back
    saw(w, { ...chats.find(c => c.id === 'a')!, title: 'Vecchia' });
    expect(w.get(m.id)!.owner!.chatId).toBe('b');
  });

  it('says which project maps the job touches, from its plan, its chat and its steps\' chats', () => {
    const w = maps({ projectsOf: c => (c.id === 'k' ? ['magazzino'] : ['negozio']) });
    put(chat('k', { parentId: 'a' }));
    saw(w, chat('a'));
    const m = saw(w, chat('a', { plan: { ...plan('running', 100, [{ title: 'x', state: 'now', chatIds: ['k'] }]) } }));
    expect(m.touches).toEqual(['negozio', 'cassa', 'magazzino']);
    expect(m.project).toBe('negozio');
    expect(w.touching('magazzino').map(i => i.id)).toEqual([m.id]);
    expect(w.touching('altro')).toEqual([]);
  });
});

describe('an idea alone', () => {
  it('is a map with no chat, planned later: «Parti» opens a Strategist that owns it', async () => {
    const started: unknown[] = [];
    const w = maps({ projectNamed: x => (x === 'Negozio' ? 'negozio' : null), startStrategist: async (m, c, by) => { started.push([m.id, c, by]); return put(chat('s', { planId: m.id, plan: plan('asking', 300, []) })); } });
    const m = w.idea({ title: '  Sconti   a fasce ', idea: 'Per quantità', project: 'Negozio' });
    expect(m).toMatchObject({ title: 'Sconti a fasce', idea: 'Per quantità', project: 'negozio', touches: ['negozio'], state: 'idea', by: 'user' });
    expect(m.owner).toBeUndefined();
    expect(w.view(m.id)!.boxes).toHaveLength(1);
    expect(await w.act(m.id, 'start')).toMatchObject({ id: m.id, owner: { chatId: 's' }, state: 'idea', plan: { phase: 'asking' } });
    expect(started).toEqual([[m.id, undefined, 'user']]);
    expect(w.list()).toHaveLength(1);
    expect(w.list()[0]!.planning).toBe(true);
  });
  it('is refused with no title or too long a text, and keeps a project name that is no map', () => {
    const w = maps();
    expect(() => w.idea({ title: ' ' })).toThrow(/title/);
    expect(() => w.idea({ title: 'x', idea: 'y'.repeat(4001) })).toThrow(/al massimo 4000/);
    expect(w.idea({ title: 'x', project: 'Casa' })).toMatchObject({ project: 'Casa', touches: [] });
  });
  it('is archived and reopened, never deleted', async () => {
    const w = maps(), m = w.idea({ title: 'Poi' });
    await w.act(m.id, 'archive');
    expect(w.list()).toEqual([]);
    expect(w.list({ archived: true })[0]).toMatchObject({ id: m.id, can: ['reopen'] });
    expect((await w.act(m.id, 'reopen')).state).toBe('idea');
  });
});

describe('the lifecycle', () => {
  it('approve and start are two actions: keep leaves it planned, start runs it', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) }));
    await expect(w.act(m.id, 'approve')).rejects.toThrow(/at:/);
    expect((await w.act(m.id, 'keep', { at: 100 })).state).toBe('planned');
    await expect(w.act(m.id, 'approve', { at: 100 })).rejects.toThrow(/Non si può approvare: la mappa è «Approvata, tenuta per dopo»/);
    expect((await w.act(m.id, 'start', {}, 'Orchestrator')).state).toBe('running');
    expect(calls).toEqual([['planDecide', 'a', 'approve', 100, undefined, 'pc', true], ['planStart', 'a']]);
    expect(w.get(m.id)!.by).toBe('Orchestrator');
    expect(w.view(m.id)!.history.map(h => h.summary)).toEqual(['Lavoro iniziato', 'Approvata, tenuta per dopo', 'In corso']);
  });

  it('approve starts at once', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) }));
    expect((await w.act(m.id, 'approve', { at: 100 })).state).toBe('running');
    expect(calls).toEqual([['planDecide', 'a', 'approve', 100, undefined, 'pc', false]]);
  });

  it('stop and resume, with a plan and without one', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('running') })), bare = saw(w, chat('b', { workSince: 900 }));
    expect(await w.act(m.id, 'stop')).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    expect((await w.act(m.id, 'resume')).state).toBe('running');
    expect(await w.act(bare.id, 'stop')).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    // an event of the chat as it was does not start it again; its next work does
    w.observe('chat:updated', change('b', { title: 'Altro titolo' }));
    expect(w.get(bare.id)!.state).toBe('stopped');
    w.observe('chat:updated', change('b', { workSince: now + 10 }));
    expect(w.get(bare.id)!.state).toBe('running');
  });

  it('replan goes to its chat in the user\'s words', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('running', 100, steps('now', 'todo')) }));
    await expect(w.act(m.id, 'replan', { text: '  ' })).rejects.toThrow(/cosa cambiare/);
    expect((await w.act(m.id, 'replan', { text: ' Prima i resi ' })).state).toBe('running');
    expect(calls).toEqual([['planReplan', 'a', 'Prima i resi']]);
    expect(w.list()[0]).toMatchObject({ planning: true });
  });

  it('finished and seen goes to the archive and can be reopened; a later event does not bring it back', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('running') }));
    expect((await w.act(m.id, 'seen')).state).toBe('running'); // only a finished one moves
    w.observe('chat:updated', change('a', { plan: plan('done', 200, steps('done', 'done')) }));
    expect(w.get(m.id)).toMatchObject({ state: 'finished', finishedAt: now });
    const done = await w.act(m.id, 'seen');
    expect(done).toMatchObject({ state: 'archived', seenAt: now, archivedAt: now });
    expect(w.list()).toEqual([]);
    expect(w.list({ query: 'passo 2' })).toHaveLength(1); // the search looks in the archive
    w.observe('chat:updated', change('a', { closedAt: 5000, closedBy: 'auto' }));
    expect(w.get(m.id)!.state).toBe('archived');
    expect(await w.act(m.id, 'reopen')).toMatchObject({ state: 'finished', seenAt: now });
    expect(w.list()).toHaveLength(1);
  });

  it('a job with no plan is finished when it reported', () => {
    const w = maps(), m = saw(w, chat('a'));
    w.observe('chat:updated', change('a', { run: { ...chats[0]!.run!, report: { at: 1100, outcome: 'done', via: 'agent_report' } } as ChatSummary['run'] }));
    expect(w.get(m.id)!.state).toBe('finished');
  });

  it('archiving a plan that waits answers its request; archiving one that goes on is refused', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) })), going = saw(w, chat('b', { plan: plan('running') }));
    expect((await w.act(m.id, 'archive')).state).toBe('archived');
    expect(calls).toEqual([['planPutAway', 'a']]);
    await expect(w.act(going.id, 'archive')).rejects.toThrow(/Non si può archiviare/);
    // a plan proposed after that is in front of the user again
    now += 100;
    w.observe('chat:updated', change('a', { plan: plan('proposed', now) }));
    expect(w.get(m.id)!.state).toBe('toApprove');
    // put away again and reopened: stopped by the user, to resume
    await w.act(m.id, 'archive');
    expect(await w.act(m.id, 'reopen')).toMatchObject({ state: 'stopped', stopped: { by: 'user' } });
    expect(w.list().find(i => i.id === m.id)!.can).toEqual(['resume', 'archive']);
  });

  it('one action at a time on a map', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) }));
    const first = w.act(m.id, 'approve', { at: 100 });
    await expect(w.act(m.id, 'approve', { at: 100 })).rejects.toThrow(/già in corso/);
    expect((await first).state).toBe('running');
  });

  it('a refused decision leaves the map as it was', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) }));
    const { chats: c } = (w as unknown as { d: PlansDeps }).d;
    c.planDecide = async () => { throw new Error('Il piano è cambiato.'); };
    await expect(w.act(m.id, 'approve', { at: 99 })).rejects.toThrow('Il piano è cambiato.');
    expect(w.get(m.id)).toMatchObject({ state: 'toApprove', version: 1 });
    expect((await w.act(m.id, 'archive')).state).toBe('archived'); // not left busy
  });
});

describe('the owner chat', () => {
  it('closed by the user = stopped, not removed, the plan kept; resume goes on in the same chat', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('running', 100, steps('done', 'todo')) }));
    w.observe('chat:updated', change('a', { closedAt: 1500, closedBy: 'user' }));
    expect(w.get(m.id)).toMatchObject({ state: 'stopped', stopped: { at: 1500, by: 'closed' }, plan: { steps: [{ state: 'done' }, { state: 'todo' }] } });
    expect((await w.act(m.id, 'resume')).state).toBe('running');
    expect(calls).toEqual([['planResume', 'a']]);
  });

  it('closed by the app: a plan that waits stays as it is, one under way is stopped, a job with no plan is over', () => {
    const w = maps(), by = { closedAt: 1500, closedBy: 'auto' as const };
    expect(saw(w, chat('a', { plan: plan('proposed') })).state).toBe('toApprove');
    expect(saw(w, { ...chats[0]!, ...by }).state).toBe('toApprove');
    saw(w, chat('b', { plan: plan('approved') }));
    expect(saw(w, { ...chats.find(c => c.id === 'b')!, ...by }).state).toBe('planned');
    saw(w, chat('c', { plan: plan('running') }));
    expect(saw(w, { ...chats.find(c => c.id === 'c')!, ...by }).state).toBe('stopped');
    saw(w, chat('d'));
    expect(saw(w, { ...chats.find(c => c.id === 'd')!, ...by }).state).toBe('finished');
  });

  it('gone from the app = stopped; resume and replan open a new Strategist with what the map saved', async () => {
    const started: [string, string | undefined][] = [];
    const w = maps({ startStrategist: async (m, c) => { started.push([m.id, c]); return put(chat('n', { planId: m.id, plan: plan('asking', 400, []) })); } });
    const m = saw(w, chat('a', { plan: plan('running', 100, steps('done', 'now')) }));
    chats = [];
    w.observe('chat:removed', { chatId: 'a' });
    expect(w.get(m.id)).toMatchObject({ state: 'stopped', stopped: { by: 'gone' }, plan: { phase: 'running' } });
    expect(await w.act(m.id, 'resume')).toMatchObject({ id: m.id, owner: { chatId: 'n' }, past: ['a'], state: 'idea' });
    expect(w.get(m.id)!.plan!.steps.map(s => s.state)).toEqual(['done', 'todo']);
    expect(started).toEqual([[m.id, undefined]]);
  });

  it('a finished job stays finished when its chat goes', () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('done') }));
    w.observe('chat:removed', { chatId: 'a' });
    expect(w.get(m.id)!.state).toBe('finished');
  });
});

describe('at load', () => {
  it('an old chat with a plan gets its map once, not twice', () => {
    put(chat('a', { plan: plan('proposed') }));
    const w = maps();
    w.adopt();
    expect(w.list()).toMatchObject([{ ownerChatId: 'a', state: 'toApprove' }]);
    w.adopt();
    w.observe('chat:updated', { ...chats[0]! });
    const again = maps();
    again.adopt();
    expect(again.list().map(i => i.id)).toEqual(w.list().map(i => i.id));
    expect(saved).toHaveLength(1);
  });

  it('an old job already over goes straight to the archive; an old closed chat with no plan gets no map', () => {
    put(chat('a', { plan: plan('done', 80), closedAt: 90, closedBy: 'auto' }));
    put(chat('b', { closedAt: 90, closedBy: 'auto' }));
    const w = maps();
    w.adopt();
    expect(w.list()).toEqual([]);
    expect(w.list({ archived: true })).toMatchObject([{ ownerChatId: 'a', state: 'archived', finishedAt: 80 }]);
  });

  it('a restart keeps every map and its plan; a map whose chat is gone is stopped', () => {
    const w = maps(), idea = w.idea({ title: 'Poi' }), kept = saw(w, chat('a', { plan: plan('approved') })), lost = saw(w, chat('b', { plan: plan('running') }));
    const before = { idea: w.get(idea.id), kept: w.get(kept.id) };
    chats = chats.filter(c => c.id !== 'b');
    const again = maps();
    again.adopt();
    expect(again.get(idea.id)).toEqual(before.idea);
    expect(again.get(kept.id)).toEqual(before.kept);
    expect(again.get(lost.id)).toMatchObject({ state: 'stopped', stopped: { by: 'gone' }, plan: { steps: [{ id: 's1', title: 'Passo 1' }, { id: 's2', after: ['s1'], title: 'Passo 2' }] } });
  });

  it('a map that cannot be saved never breaks the chat\'s own event', () => {
    const w = maps({ store: { load: () => [], save: () => { throw new Error('disk full'); }, history: () => [], version: () => null } });
    expect(() => w.observe('chat:updated', put(chat('a')))).not.toThrow();
    expect(w.list()).toEqual([]);
  });
});

describe('the list and the versions', () => {
  it('what waits for the user comes first, then running, stopped, planned, ideas, finished', () => {
    const w = maps();
    w.idea({ title: 'Idea' });
    saw(w, chat('fin', { plan: plan('done') }));
    saw(w, chat('pla', { plan: plan('approved') }));
    saw(w, chat('sto', { plan: { ...plan('running'), stopped: true } }));
    saw(w, chat('run', { plan: plan('running') }));
    saw(w, chat('app', { plan: plan('proposed') }));
    expect(w.list().map(i => i.state)).toEqual(['toApprove', 'running', 'stopped', 'planned', 'idea', 'finished']);
  });
  it('an earlier version is seen as it was, with nothing to do on it', () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed') }));
    w.observe('chat:updated', change('a', { plan: plan('running', 200) }));
    expect(w.view(m.id, 1)).toMatchObject({ map: { version: 1, state: 'toApprove' }, info: { can: [] } });
    expect(w.view(m.id)!.info.can).toEqual(['stop', 'replan']);
    expect(w.view(m.id, 9)).toBeNull();
    expect(w.view('wm_nothere')).toBeNull();
  });
});

describe('a new Strategist for a map', () => {
  const map = (extra: Partial<Plan> = {}): Plan => ({ id: 'wm_abc123', version: 1, title: 'Sconti', idea: 'Sconti a fasce', touches: ['negozio'], state: 'idea', createdAt: 1, updatedAt: 1, by: 'user', summary: '', ...extra });
  it('gets the idea, the answers, the steps with where they were and what to change', () => {
    const text = startPrompt(map({ owner: { chatId: 'a', task: 't' }, plan: { ...plan('running', 100, [{ title: 'Cerco', state: 'done', role: 'scout' }, { title: 'Faccio', state: 'now' }]), clarified: [{ q: 'Dove?', a: 'Ordini' }] } }), 'Prima i resi');
    for (const part of ['Sconti a fasce', 'Titolo del lavoro: Sconti.', 'negozio (project_map_read)', 'aspetta di nuovo il mio ok', '- Dove? → Ordini', '1. Cerco (scout, fatto)', '2. Faccio (in corso)', 'Cosa cambiare: Prima i resi']) expect(text).toContain(part);
    expect(startPrompt(map({ touches: [] }))).toBe('Sconti a fasce\nTitolo del lavoro: Sconti.');
  });
  it('is a Strategist with the plan flow, linked to the map; the Orchestrator\'s start says it is not the user\'s text', async () => {
    const made: unknown[][] = [];
    const start = strategistStarter({ chats: { create: async (...a: unknown[]) => { made.push(a); return chat('s'); } } as never, harness: () => 'claude', folderOf: () => 'C:/repo' });
    await start(map(), undefined, 'user');
    await start(map({ plan: plan('running') }), 'Prima i resi', 'Orchestrator');
    expect(made[0]).toEqual([{ harness: 'claude', cwd: 'C:/repo', title: 'Sconti', prompt: startPrompt(map()), goal: 'Sconti a fasce', orchestrator: false, roleId: 'strategist' }, 'agent', undefined, undefined, { planId: 'wm_abc123' }]);
    expect((made[1]![0] as { prompt: string }).prompt).not.toBe(startPrompt(map({ plan: plan('running') }), 'Prima i resi'));
    expect(made[1]![4]).toMatchObject({ planId: 'wm_abc123', resumePlan: { phase: 'running' } });
    await expect(strategistStarter({ chats: {} as never, harness: () => 'claude', folderOf: () => null })(map(), undefined, 'user')).rejects.toThrow(/cartella/);
  });
  it('requestOf leaves the app\'s instructions out', () => {
    expect(requestOf(chat('a', { run: { runId: 'r', goal: STRATEGY_FLOW, startedAt: 1 } as ChatSummary['run'] }))).toBeUndefined();
  });
});

describe('the Orchestrator\'s actions', () => {
  it('finds a map by id or exact title and acts on the plan proposed now', async () => {
    const w = maps(), m = saw(w, chat('a', { plan: plan('proposed', 100) }));
    expect(isJobAction('approve')).toBe(true);
    expect(isJobAction('list')).toBe(false);
    expect(await jobAction(w, 'jobs', {})).toMatchObject({ jobs: [{ id: m.id, state: 'toApprove' }] });
    expect(await jobAction(w, 'job', { job: 'lavoro A' })).toContain('plan waits for the user');
    expect(await jobAction(w, 'keep', { job: m.id })).toEqual({ ok: true, job: m.id, state: 'planned', chatId: 'a' });
    expect(calls[0]).toEqual(['planDecide', 'a', 'approve', 100, undefined, 'pc', true]);
    expect(await jobAction(w, 'replan', { job: m.id, text: 'Meno passi' })).toMatchObject({ ok: true });
    expect(calls.at(-1)).toEqual(['planReplan', 'a', 'Meno passi']);
  });
  it('writes an idea down, and says what is wrong with a job it cannot find', async () => {
    const w = maps();
    expect(await jobAction(w, 'idea', { title: 'Sconti', text: 'A fasce', project: 'Negozio' })).toMatchObject({ ok: true, state: 'idea' });
    w.idea({ title: 'Sconti' });
    await expect(jobAction(w, 'job', { job: 'Sconti' })).rejects.toThrow(/2 maps are called/);
    await expect(jobAction(w, 'job', { job: 'Altro' })).rejects.toThrow(/no work map/);
    await expect(jobAction(w, 'job', {})).rejects.toThrow(/work map's id/);
    expect(await jobAction(w, 'jobs', { query: 'fasce' })).toMatchObject({ jobs: [{ title: 'Sconti', project: 'Negozio' }] });
  });
});
