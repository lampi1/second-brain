// Unit tests of the maps that follow their chats (issue #456, ADR 0330): main/projectmap/follow.ts reads what a linked
// chat says (at work, waits for the user, failed, reported done or blocked, says nothing), and main/projectmap/
// service.ts moves the pieces it is linked to: saved when it starts, reports done or reports blocked (one version per
// real change), shown only while it waits or stands on an error; a chat linked to a box moves its open pieces; a box is
// saved with what its pieces say; a chat bound only because it edited a file moves nothing; a status set by hand stands.
// The review of PR #457 added: what the chats said is forgotten when none speaks any more, a link survives an edit in
// another map, a chat's own edits never read «da verificare» (somebody else's do), a removed chat is followed, a box
// whose pieces cannot say «waits» says it itself, a failed save is tried again, a message or a question after a done
// report writes no version, a report given before a link is not about the newly linked piece, a repeated link keeps a
// status set by hand, the projects list counts like the header; a file edited on another piece links nothing, a chat
// that had finished before its link says nothing, working_on in the turn of the report, a box's files edited before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { sayOf, wantOf } from '../../src/main/projectmap/follow';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';
import { countOf } from '../../src/shared/project-map-progress';
import { statusesOf, waitingOf } from '../../src/shared/project-map-status';
import type { StrategyPlan } from '../../src/shared/strategy';
import { appProjectMapTool, mapHint, mapLinkOf } from '../../src/main/projectmap/tools';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:\\repo\\shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const ask = (chatId: string): PendingRequest => ({ id: 'r1', chatId, type: 'question', tool: 'AskUserQuestion' } as PendingRequest);
const run = (outcome?: 'done' | 'partial' | 'blocked', t = 0) => ({ runId: 'r', chatId: 'w', agentId: 'artisan', version: 1, goal: '', startedBy: 'orchestrator', startedAt: t + 10, ...(outcome ? { report: { at: t + 20, outcome, verified: 'yes', summary: '' } } : {}) }) as unknown as NonNullable<ChatSummary['run']>;

describe('sayOf', () => {
  const say = (p: Partial<ChatSummary>, all: ChatSummary[] = [], asks: PendingRequest[] = []) => sayOf(chat({ id: 'w', ...p }), all, asks);
  it('at work: it runs, starts, is queued, or a chat it delegated runs', () => {
    expect(say({ state: 'running' })).toBe('run');
    expect(say({ state: 'starting' })).toBe('run');
    expect(say({ state: 'idle', background: 1 })).toBe('run');
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false } }, [chat({ id: 'kid', parentId: 'w', state: 'running' })])).toBe('run');
    // a chat it delegated that closed does not count
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false } }, [chat({ id: 'kid', parentId: 'w', state: 'closed', closedAt: 5 })])).toBe('work');
  });
  it('a question an agent holds is waited for at that agent, until it reaches the user (ADR 0344)', () => {
    const q = (level: 'strategist' | 'orchestrator' | 'user', via: 'request' | 'message' = 'message') => [{ id: 'q', asks: [], level, at: 1, levelAt: 1, trail: [], via }];
    expect(say({ state: 'idle', waitsOn: 'user', questions: q('strategist'), lastResult: { at: 1, isError: false } })).toBe('held');
    expect(say({ state: 'waiting', questions: q('orchestrator', 'request') })).toBe('held');
    expect(say({ state: 'running', questions: q('strategist') })).toBe('run');
    expect(say({ state: 'waiting', pending: 1, questions: q('user', 'request') })).toBe('wait');
    expect(wantOf(['held'])).toMatchObject({ durable: 'work', live: { actor: 'agent' } });
    expect(wantOf(['held', 'run']).live).toBeNull();
    expect(wantOf(['held', 'wait']).live).toEqual({ actor: 'user' });
  });
  it('waits for the user: an open request (its own or a delegated chat\'s), or its last answer says so', () => {
    expect(say({ state: 'waiting' })).toBe('wait');
    expect(say({ state: 'running' }, [], [ask('w')])).toBe('wait');
    expect(say({ state: 'running' }, [chat({ id: 'kid', parentId: 'w', state: 'running' })], [ask('kid')])).toBe('wait');
    expect(say({ state: 'idle', waitsOn: 'user', lastResult: { at: 1, isError: false } })).toBe('wait');
    expect(say({ state: 'running' }, [], [ask('other')])).toBe('run');
  });
  it('failed, stuck, done, still on it', () => {
    expect(say({ state: 'error' })).toBe('fail');
    expect(say({ state: 'idle', lastResult: { at: 1, isError: true } })).toBe('fail');
    expect(say({ state: 'idle', run: run('blocked'), lastResult: { at: 30, isError: false } })).toBe('stuck');
    expect(say({ state: 'idle', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('done');
    expect(say({ state: 'idle', run: run('partial'), lastResult: { at: 30, isError: false } })).toBe('work');
    // a turn ended well, no report yet, the chat is still open: it is not finished
    expect(say({ state: 'idle', run: run(), lastResult: { at: 30, isError: false } })).toBe('work');
    // a delegated chat's report
    expect(say({ state: 'idle', delegation: { role: 'artisan', goal: '', doneWhen: [], at: 5, result: { outcome: 'done', summary: '', at: 9 } } as ChatSummary['delegation'] })).toBe('done');
    // a report of an earlier assignment is not this one's
    expect(say({ state: 'idle', lastResult: { at: 30, isError: false }, run: { ...run('done'), startedAt: 25 } })).toBe('work');
  });
  it('at work again after its done report (the turn that reported goes on, a message followed): redo, not a new start', () => {
    expect(say({ state: 'running', run: run('done') })).toBe('redo');
    expect(say({ state: 'running', run: run('partial') })).toBe('run');
    // a new assignment is a new start
    expect(say({ state: 'running', run: { ...run('done'), startedAt: 25 } })).toBe('run');
    // a question after the done report (an open request, a closing question): it waits again, the work stays done
    expect(say({ state: 'waiting', run: run('done') })).toBe('reask');
    expect(say({ state: 'idle', waitsOn: 'user', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('reask');
  });
  it('a report given before the chat was linked to a piece is not about that piece', () => {
    const c = chat({ id: 'w', state: 'running', run: run('done') });
    expect(sayOf(c, [], [], 20)).toBe('redo');
    expect(sayOf(c, [], [], 21)).toBe('run');
    expect(sayOf({ ...c, state: 'idle', lastResult: { at: 30, isError: false } }, [], [], 21)).toBe('work');
    // it did nothing since the link: it says nothing (also when the app closed it)
    expect(sayOf({ ...c, state: 'idle', lastResult: { at: 20, isError: false } }, [], [], 21)).toBeNull();
    expect(sayOf({ ...c, state: 'closed', closedAt: 50, closedBy: 'auto', lastResult: { at: 20, isError: false } }, [], [], 21)).toBeNull();
  });
  it('with no report to give it is done when the app closed it after a turn that ended well', () => {
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'auto', lastResult: { at: 30, isError: false } })).toBe('done');
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'user', lastResult: { at: 30, isError: false } })).toBeNull();
    expect(say({ state: 'closed', closedAt: 50, closedBy: 'user', run: run('done'), lastResult: { at: 30, isError: false } })).toBe('done');
  });
  it('says nothing when it never started or the user stopped it', () => {
    expect(say({ state: 'idle' })).toBeNull();
    expect(say({ state: 'idle', lastResult: { at: 1, isError: false, interrupted: true } })).toBeNull();
  });
});

describe('wantOf', () => {
  it('what the chats on one piece say together', () => {
    expect(wantOf([])).toEqual({ durable: null, live: null, running: false, redo: false });
    expect(wantOf(['run'])).toEqual({ durable: 'work', live: null, running: true, redo: false });
    expect(wantOf(['done', 'done'])).toEqual({ durable: 'ok', live: null, running: false, redo: false });
    expect(wantOf(['done', 'work'])).toEqual({ durable: 'work', live: null, running: false, redo: false });
    expect(wantOf(['done', 'stuck'])).toEqual({ durable: 'blocked', live: null, running: false, redo: false });
    // it waits for the user: saved under way, shown stuck on him while it lasts
    expect(wantOf(['run', 'wait'])).toEqual({ durable: 'work', live: { actor: 'user' }, running: true, redo: false });
    // an error shows only when nobody else goes on
    expect(wantOf(['fail'])).toEqual({ durable: 'work', live: { actor: 'agent' }, running: false, redo: false });
    expect(wantOf(['fail', 'run'])).toEqual({ durable: 'work', live: null, running: true, redo: false });
    // at work again after a done report: the piece stays saved done, it shows under way while it lasts
    expect(wantOf(['redo', 'done'])).toEqual({ durable: 'ok', live: null, running: true, redo: true });
    expect(wantOf(['redo', 'work'])).toEqual({ durable: 'work', live: null, running: true, redo: false });
    // it asks the user after its done report: stuck on him while it lasts, saved done
    expect(wantOf(['reask'])).toEqual({ durable: 'ok', live: { actor: 'user' }, running: false, redo: false });
  });
});

const drawing = {
  elements: [
    { id: 'f1', kind: 'phase', name: 'Struttura', status: 'ok' },
    { id: 'a', kind: 'step', name: 'Tab', parent: 'f1', status: 'ok' },
    { id: 'b', kind: 'step', name: 'Riepilogo', parent: 'f1', status: 'planned' },
    { id: 'f2', kind: 'phase', name: 'Fatture', status: 'planned' },
    { id: 'c', kind: 'step', name: 'Pulsanti', parent: 'f2', status: 'planned' },
    { id: 'd', kind: 'step', name: 'Pagamenti', parent: 'f2', status: 'planned', evidence: ['src/pay/'] },
  ],
};

let dir: string, now: number, chats: ChatSummary[], pending: PendingRequest[];
const make = (store = new ProjectMapStore(() => dir)) => new ProjectMaps({ store, chats: () => chats, items: (): ChatItem[] => [], pending: () => pending,
  emit: () => {}, stateFile: path.join(dir, 'state.json'), now: () => now, debounceMs: 10 });
/** the chat changed: main tells the page, the maps hear it */
const set = (m: ProjectMaps, id: string, p: Partial<ChatSummary>) => { chats = chats.map(c => (c.id === id ? { ...c, ...p } : c)); m.observe('chat:updated', chats.find(c => c.id === id)); };
const saved = (id: string) => new ProjectMapStore(() => dir).get('shop')!.elements.find(e => e.id === id)!.status;
const version = () => new ProjectMapStore(() => dir).get('shop')!.version;

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pfollow-'));
  now = 1_000_000; chats = [chat({ id: 'w', title: 'Artisan · Riepilogo' })]; pending = [];
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('a map follows its linked chats', () => {
  it('a box is saved with what its pieces say, whatever status was sent for it', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    // f1 was sent ok over a step still planned
    expect(saved('f1')).toBe('work');
    expect(saved('f2')).toBe('planned');
    m.update('shop', { changes: [{ id: 'f2', status: 'ok' }, { id: 'c', status: 'work' }], by: 'Artisan' });
    expect(saved('f2')).toBe('work');
  });

  it('starts → under way, waits → stuck on the user (shown only), reports done → done, a new assignment → under way again', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    expect(m.link('shop', 'w', ['b'])).toEqual({ project: 'shop', elements: ['b'] });
    expect(saved('b')).toBe('planned'); // linked, not started yet: nothing to say
    set(m, 'w', { state: 'running', run: run(undefined, now) });
    expect(saved('b')).toBe('work');
    const v = version();
    expect(new ProjectMapStore(() => dir).get('shop')).toMatchObject({ by: 'app', summary: 'Riepilogo: in lavorazione' });
    // the same state again writes nothing
    set(m, 'w', { state: 'running', costUsd: 1 });
    expect(version()).toBe(v);
    // it asks the user: the drawing shows stuck on him, the file keeps «under way», no version
    pending = [ask('w')];
    set(m, 'w', { state: 'waiting', pending: 1 });
    expect(m.view('shop')!.map.elements.find(e => e.id === 'b')).toMatchObject({ status: 'blocked', actor: 'user' });
    expect(saved('b')).toBe('work');
    expect(version()).toBe(v);
    // answered: back to work, then it reports done
    pending = [];
    set(m, 'w', { state: 'running', pending: 0 });
    expect(m.view('shop')!.map.elements.find(e => e.id === 'b')).toMatchObject({ status: 'work' });
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: 30, isError: false } });
    expect(saved('b')).toBe('ok');
    expect(saved('f1')).toBe('ok'); // every step done: the phase is done
    expect(new ProjectMapStore(() => dir).get('shop')!.summary).toBe('Riepilogo: fatto');
    // the same chat gets a new assignment
    set(m, 'w', { state: 'running', run: { ...run(undefined, now), startedAt: now + 40 } });
    expect(saved('b')).toBe('work');
    expect(saved('f1')).toBe('work');
  });

  it('an error shows stuck on the agent while it stands; a blocked report is saved', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running' });
    set(m, 'w', { state: 'error' });
    expect(m.view('shop')!.map.elements.find(e => e.id === 'c')).toMatchObject({ status: 'blocked', actor: 'agent' });
    expect(saved('c')).toBe('work');
    set(m, 'w', { state: 'idle', run: run('blocked', now), lastResult: { at: 30, isError: false } });
    expect(saved('c')).toBe('blocked');
    expect(saved('f2')).toBe('blocked');
  });

  it('a chat linked to a box: the box reads under way while it works, and its open steps turn done with it', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['f2']);
    const v = version();
    set(m, 'w', { state: 'running' });
    // which step is under way is not known: nothing is saved, the live view marks the box
    expect([saved('c'), saved('d'), saved('f2'), version()]).toEqual(['planned', 'planned', 'planned', v]);
    const live = m.view('shop')!.map;
    expect(live.elements.find(e => e.id === 'f2')!.busy).toBe(true);
    expect(statusesOf(live, now).get('f2')).toEqual({ status: 'work', stale: false });
    // between two turns it is still on it
    set(m, 'w', { state: 'idle', lastResult: { at: 30, isError: false } });
    expect(statusesOf(m.view('shop')!.map, now).get('f2')).toEqual({ status: 'work', stale: false });
    // it waits for the user: the first open step reads stuck on him, and the box with it
    pending = [ask('w')];
    set(m, 'w', { state: 'waiting' });
    expect(statusesOf(m.view('shop')!.map, now).get('f2')).toEqual({ status: 'blocked', stale: false, actor: 'user' });
    pending = [];
    set(m, 'w', { state: 'closed', closedAt: now, closedBy: 'auto', lastResult: { at: 30, isError: false } });
    expect([saved('c'), saved('d'), saved('f2')]).toEqual(['ok', 'ok', 'ok']);
    expect(m.view('shop')!.map.elements.find(e => e.id === 'f2')!.busy).toBeUndefined();
    // the mark is never saved
    expect(fs.readFileSync(path.join(dir, 'projects', 'shop', 'map.json'), 'utf8')).not.toContain('busy');
  });

  it('a chat that delegated work is at work while its sub-chat runs', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['c']);
    chats.push(chat({ id: 'kid', parentId: 'w' }));
    set(m, 'kid', { state: 'running' });
    expect(saved('c')).toBe('work');
  });

  it('working_on links the chat that says it; a status it sets itself stands', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    chats = chats.map(c => ({ ...c, state: 'running' as const }));
    m.update('shop', { workingOn: ['c', 'd'], chatId: 'w', by: 'Artisan' });
    expect([saved('c'), saved('d')]).toEqual(['work', 'work']);
    // it finishes one and says so: the app does not take it back while the chat goes on
    m.update('shop', { changes: [{ id: 'c', status: 'ok' }], by: 'Artisan' });
    set(m, 'w', { state: 'running', costUsd: 2 });
    expect([saved('c'), saved('d')]).toEqual(['ok', 'work']);
  });

  it('a chat bound only because it edited a file moves no status', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    chats = chats.map(c => ({ ...c, state: 'running' as const }));
    m.observe('chat:item', { chatId: 'w', item: { kind: 'tool', name: 'Edit', status: 'ok', at: now + 1, input: { file_path: 'C:\\repo\\shop\\src\\pay\\a.ts' } } });
    expect(m.view('shop')!.agents.map(a => a.elements)).toEqual([['d']]);
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: 30, isError: false } });
    expect(saved('d')).toBe('planned');
  });

  it('unlinking, an unknown element, an unknown chat', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    expect(() => m.link('shop', 'w', ['nope'])).toThrow('no element nope');
    expect(() => m.link('shop', 'ghost', ['c'])).toThrow('no chat');
    m.link('shop', 'w', ['c']);
    m.link('shop', 'w', []);
    set(m, 'w', { state: 'running' });
    expect(saved('c')).toBe('planned');
  });
});

describe('the Orchestrator links a chat', () => {
  it('app_project_map link, the `map` of a new chat, and the hint when a chat starts unlinked in a mapped folder', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    const tool = appProjectMapTool(m, () => {});
    expect(tool.run({ action: 'link', project: 'shop', chatId: 'w', elements: ['c'] })).toEqual({ ok: true, project: 'shop', linked: ['c'] });
    expect(m.view('shop')!.agents.map(a => a.elements)).toEqual([['c']]);
    expect(mapLinkOf(m, { project: 'Shop', on: ['c', 'c'] })).toEqual({ project: 'shop', on: ['c'] });
    expect(mapLinkOf(m, undefined)).toBeNull();
    expect(() => mapLinkOf(m, { project: 'shop', on: [] })).toThrow('at least one');
    expect(() => mapLinkOf(m, { project: 'shop', on: ['zzz'] })).toThrow('no element zzz');
    expect(() => mapLinkOf(undefined, { project: 'shop', on: ['c'] })).toThrow('only the Orchestrator');
    expect(mapHint(m, 'C:\\repo\\shop\\src')).toContain('not linked to the map «shop» (25%)');
    expect(mapHint(m, 'C:\\repo\\other')).toBeUndefined();
  });
});

describe('the follow holds in the corner cases (review of PR #457)', () => {
  const start = () => { const m = make(); m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' }); return m; };
  /** what the drawing shows for a piece right now */
  const shown = (m: ProjectMaps, id: string) => { const v = m.view('shop')!; return statusesOf(v.map, now, v.changed).get(id); };
  const edit = (m: ProjectMaps, chatId: string, file: string, at: number) => m.observe('chat:item', { chatId, item: { kind: 'tool', name: 'Edit', status: 'ok', at, input: { file_path: file } } });

  it('what the chats said is forgotten when none speaks any more: the next chat on the piece starts it again', () => {
    const m = start();
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running' });
    expect(saved('c')).toBe('work');
    // the user stops it; the Orchestrator puts the piece back
    set(m, 'w', { state: 'idle', lastResult: { at: 30, isError: false, interrupted: true } });
    m.update('shop', { changes: [{ id: 'c', status: 'planned' }], by: 'Orchestrator' });
    chats.push(chat({ id: 'w2' }));
    m.link('shop', 'w2', ['c']);
    set(m, 'w2', { state: 'running' });
    expect(saved('c')).toBe('work');
  });

  it('a new link speaks afresh, also while an older chat is still on the piece', () => {
    const m = start();
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running' });
    set(m, 'w', { state: 'idle', lastResult: { at: 30, isError: false } });
    m.update('shop', { changes: [{ id: 'c', status: 'planned' }], by: 'Orchestrator' });
    expect(saved('c')).toBe('planned'); // set by hand: it stands while the chats say nothing new
    chats.push(chat({ id: 'w2', state: 'running' }));
    m.link('shop', 'w2', ['c']);
    expect(saved('c')).toBe('work');
  });

  it('a linked chat that edits a file of another map keeps its link', () => {
    const m = start();
    m.save({ title: 'lib', root: 'C:\\repo\\lib', map: { elements: [{ id: 'core', kind: 'system', name: 'Core', status: 'ok', evidence: ['src/'] }] }, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running' });
    edit(m, 'w', 'C:\\repo\\lib\\src\\x.ts', now + 1);
    expect(m.view('shop')!.agents.map(a => a.elements)).toEqual([['c']]);
    expect(m.view('lib')!.changed).toEqual({ core: now + 1 }); // the edit still dates the other map's piece
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: 30, isError: false } });
    expect(saved('c')).toBe('ok');
  });

  it('a chat\'s own edits never turn its piece «da verificare»; somebody else\'s do', () => {
    const m = start();
    chats.push(chat({ id: 'kid', parentId: 'w' }), chat({ id: 'z' }));
    m.link('shop', 'w', ['d']);
    set(m, 'w', { state: 'running' });
    now += 60_000;
    edit(m, 'w', 'C:\\repo\\shop\\src\\pay\\a.ts', now);
    edit(m, 'kid', 'C:\\repo\\shop\\src\\pay\\b.ts', now); // a chat it delegated works for it
    expect(m.view('shop')!.changed).toEqual({});
    // between two turns: confirmed when the turn ended, and the two hours count from there
    now += 3 * 3600_000;
    set(m, 'w', { state: 'idle', lastResult: { at: now, isError: false } });
    expect(shown(m, 'd')).toEqual({ status: 'work', stale: false });
    // a chat that does not speak for the piece edits its file: to verify
    edit(m, 'z', 'C:\\repo\\shop\\src\\pay\\a.ts', now + 5);
    expect(shown(m, 'd')).toEqual({ status: 'unknown', stale: true });
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    expect(shown(m, 'd')).toEqual({ status: 'ok', stale: false });
    // nobody at work for more than two hours: to verify, as ever
    m.link('shop', 'z', ['c']);
    set(m, 'z', { state: 'idle', lastResult: { at: now, isError: false } });
    expect(shown(m, 'c')).toEqual({ status: 'work', stale: false });
    now += 3 * 3600_000;
    expect(shown(m, 'c')).toEqual({ status: 'unknown', stale: true });
  });

  it('a chat linked to a box with files of its own: done is done, not «da verificare»', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: { elements: [
      { id: 'f2', kind: 'phase', name: 'Fatture', status: 'planned', evidence: ['src/inv/'] },
      { id: 'c', kind: 'step', name: 'Pulsanti', parent: 'f2', status: 'planned', evidence: ['src/inv/buttons/'] },
    ] }, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['f2']);
    set(m, 'w', { state: 'running' });
    now += 60_000;
    edit(m, 'w', 'C:\\repo\\shop\\src\\inv\\x.ts', now);
    edit(m, 'w', 'C:\\repo\\shop\\src\\inv\\buttons\\y.ts', now);
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now, isError: false } });
    expect(saved('c')).toBe('ok');
    expect(shown(m, 'f2')).toEqual({ status: 'ok', stale: false });
    // a message that follows, with one more edit: still done when the turn ends
    set(m, 'w', { state: 'running' });
    edit(m, 'w', 'C:\\repo\\shop\\src\\inv\\x.ts', now + 100);
    set(m, 'w', { state: 'idle', lastResult: { at: now + 200, isError: false } });
    expect([shown(m, 'f2'), shown(m, 'c')]).toEqual([{ status: 'ok', stale: false }, { status: 'ok', stale: false }]);
  });

  it('a removed chat is followed: the piece says what the chats left on it say', () => {
    const m = start();
    chats.push(chat({ id: 'w2' }));
    m.link('shop', 'w', ['c']);
    m.link('shop', 'w2', ['c']);
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: 30, isError: false } });
    set(m, 'w2', { state: 'running' });
    expect(saved('c')).toBe('work');
    chats = chats.filter(c => c.id !== 'w2');
    m.observe('chat:removed', { chatId: 'w2' });
    expect(saved('c')).toBe('ok');
  });

  it('a system whose parts are all done: the chat linked to it waits → the system itself reads stuck on the user', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: { elements: [
      { id: 'web', kind: 'system', name: 'Web', status: 'ok' },
      { id: 'cart', kind: 'part', name: 'Carrello', parent: 'web', status: 'ok' },
      { id: 'api', kind: 'system', name: 'Api', status: 'ok' },
      { id: 'auth', kind: 'part', name: 'Accesso', parent: 'api', status: 'planned' },
    ] }, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['web']);
    set(m, 'w', { state: 'running' });
    expect(m.list()[0]!.waiting).toBe(0);
    pending = [ask('w')];
    set(m, 'w', { state: 'waiting' });
    const v = m.view('shop')!;
    expect(statusesOf(v.map, now, v.changed).get('web')).toEqual({ status: 'blocked', stale: false, actor: 'user' });
    expect(statusesOf(v.map, now, v.changed).get('cart')).toEqual({ status: 'ok', stale: false });
    // the header, the projects list and the progress count it once
    expect(waitingOf(v.map, statusesOf(v.map, now, v.changed))).toBe(1);
    expect(m.list()[0]!.waiting).toBe(1);
    expect(countOf(v.map, null)).toMatchObject({ you: [{ id: 'web', name: 'Web' }], groups: [{ id: 'web', state: 'blocked' }, { id: 'api', state: 'todo' }] });
    // the mark belongs to the live view: a file that got it by mistake reads without it
    const store = new ProjectMapStore(() => dir);
    store.save({ ...v.map, version: v.map.version + 1 });
    expect(store.get('shop')!.elements.find(e => e.id === 'web')).not.toHaveProperty('waits');
    // answered, and it goes on: under way, and the mark was never saved
    pending = [];
    set(m, 'w', { state: 'running' });
    expect(statusesOf(m.view('shop')!.map, now).get('web')).toEqual({ status: 'work', stale: false });
  });

  it('the projects list counts like the header: a piece that waits once, not its box too, and not after two hours', () => {
    const m = start();
    // the box carries an actor of its own too (sent with the change): it is not counted
    m.update('shop', { changes: [{ id: 'f2', status: 'blocked', actor: 'user' }, { id: 'c', status: 'blocked', actor: 'user', note: 'serve una scelta' }], by: 'Artisan' });
    const box = new ProjectMapStore(() => dir).get('shop')!.elements.find(e => e.id === 'f2')!;
    expect([box.status, box.actor]).toEqual(['blocked', 'user']);
    expect(m.list()[0]!.waiting).toBe(1);
    const v = m.view('shop')!;
    expect(waitingOf(v.map, statusesOf(v.map, now, v.changed))).toBe(1);
    // nobody confirmed it for two hours: «da verificare» on the map, and no longer counted in the list either
    now += 3 * 3600_000;
    expect(m.list()[0]!.waiting).toBe(0);
  });

  it('a save that failed is tried again at the next change of the chat', () => {
    const store = new ProjectMapStore(() => dir), m = make(store);
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    m.link('shop', 'w', ['c']);
    vi.spyOn(store, 'save').mockImplementationOnce(() => { throw new Error('disk full'); });
    set(m, 'w', { state: 'running' });
    expect(saved('c')).toBe('planned');
    set(m, 'w', { state: 'running', costUsd: 1 });
    expect(saved('c')).toBe('work');
  });

  it('a plan\'s step is tried again too after a save that failed, and leaves a chat linked to another map where it is', () => {
    const store = new ProjectMapStore(() => dir), m = make(store);
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    m.save({ title: 'lib', root: 'C:\\repo\\lib', map: { elements: [{ id: 'core', kind: 'system', name: 'Core', status: 'ok' }] }, by: 'Scout', summary: '' });
    m.link('lib', 'w', ['core']);
    const plan: StrategyPlan = { phase: 'running', clarified: [], at: 1, map: 'shop', steps: [{ title: 'Pulsanti', state: 'now', on: 'c', chatIds: ['w'] }] } as StrategyPlan;
    chats.push(chat({ id: 's', plan }));
    vi.spyOn(store, 'save').mockImplementationOnce(() => { throw new Error('disk full'); });
    m.observe('chat:updated', chats.find(c => c.id === 's'));
    expect(saved('c')).toBe('planned');
    m.observe('chat:updated', chats.find(c => c.id === 's'));
    expect(saved('c')).toBe('work');
    expect(m.view('lib')!.agents.map(a => a.elements)).toEqual([['core']]);
  });

  it('a message or a question after its done report writes no version: the piece stays saved done and shows it while it lasts', () => {
    const m = start();
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running', run: run(undefined, now) });
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    const v = version();
    set(m, 'w', { state: 'running' });
    expect([saved('c'), version()]).toEqual(['ok', v]);
    expect(shown(m, 'c')).toEqual({ status: 'work', stale: false });
    // it asks him something in that turn
    pending = [ask('w')];
    set(m, 'w', { state: 'waiting' });
    expect(shown(m, 'c')).toEqual({ status: 'blocked', stale: false, actor: 'user' });
    pending = [];
    set(m, 'w', { state: 'running' });
    set(m, 'w', { state: 'idle', lastResult: { at: now + 60, isError: false } });
    expect([saved('c'), version()]).toEqual(['ok', v]);
    expect(shown(m, 'c')).toEqual({ status: 'ok', stale: false });
  });

  it('a report it gave before is not about a piece it is linked to afterwards', () => {
    const m = start();
    m.link('shop', 'w', ['b']);
    set(m, 'w', { state: 'running', run: run(undefined, now) });
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    expect(saved('b')).toBe('ok');
    // a message follows, and the Orchestrator links it to the next piece too
    now += 60_000;
    set(m, 'w', { state: 'running' });
    m.link('shop', 'w', ['b', 'c']);
    expect([saved('b'), saved('c')]).toEqual(['ok', 'work']);
    set(m, 'w', { state: 'idle', lastResult: { at: now + 30, isError: false } });
    expect([saved('b'), saved('c')]).toEqual(['ok', 'work']); // no report for the new piece yet
    set(m, 'w', { state: 'idle', run: { ...run('done', now), startedAt: 10 }, lastResult: { at: now + 60, isError: false } });
    expect([saved('b'), saved('c')]).toEqual(['ok', 'ok']);
  });

  it('a repeated link keeps a status set by hand; a link to a piece the chat was not on starts it', () => {
    const m = start();
    chats = chats.map(c => ({ ...c, state: 'running' as const }));
    m.update('shop', { workingOn: ['c', 'd'], chatId: 'w', by: 'Artisan' });
    m.update('shop', { changes: [{ id: 'c', status: 'ok' }], by: 'Artisan' });
    const v = version();
    m.update('shop', { workingOn: ['c', 'd'], chatId: 'w', by: 'Artisan' });
    expect([saved('c'), saved('d'), version()]).toEqual(['ok', 'work', v]);
    // the Orchestrator marks one for the user and links the chat again: it stands
    m.update('shop', { changes: [{ id: 'd', status: 'blocked', actor: 'user' }], by: 'Orchestrator' });
    m.link('shop', 'w', ['c', 'd']);
    expect(saved('d')).toBe('blocked');
    m.link('shop', 'w', ['b', 'c', 'd']);
    expect([saved('b'), saved('d')]).toEqual(['work', 'blocked']);
  });
});

describe('the link is exact (third review of PR #457)', () => {
  const start = () => { const m = make(); m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' }); return m; };
  const shown = (m: ProjectMaps, id: string) => { const v = m.view('shop')!; return statusesOf(v.map, now, v.changed).get(id); };
  const edit = (m: ProjectMaps, chatId: string, file: string, at: number) => m.observe('chat:item', { chatId, item: { kind: 'tool', name: 'Edit', status: 'ok', at, input: { file_path: file } } });

  it('a file the linked chat edits on another piece shows the chat there and links nothing: that piece keeps its status', () => {
    const m = start();
    m.link('shop', 'w', ['c']);
    set(m, 'w', { state: 'running' });
    edit(m, 'w', 'C:\\repo\\shop\\src\\pay\\a.ts', now + 1);
    expect(m.view('shop')!.agents.map(a => a.elements)).toEqual([['c', 'd']]);
    expect(m.view('shop')!.changed).toEqual({ d: now + 1 }); // not its piece: the edit counts
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    expect([saved('c'), saved('d')]).toEqual(['ok', 'planned']);
    // the link is still the one made on purpose after a restart
    m.flush();
    const again = make();
    set(again, 'w', { state: 'running', run: { ...run(undefined, now), startedAt: now + 40 } });
    expect([saved('c'), saved('d')]).toEqual(['work', 'planned']);
  });

  it('a chat that had finished before it was linked says nothing: whoever links it sets the status', () => {
    const m = start();
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    now += 60_000;
    const v = version();
    m.link('shop', 'w', ['c']);
    expect([saved('c'), version()]).toEqual(['planned', v]);
    // the same for one the app closed
    set(m, 'w', { state: 'closed', closedAt: now, closedBy: 'auto' });
    m.link('shop', 'w', ['c', 'd']);
    expect([saved('c'), saved('d'), version()]).toEqual(['planned', 'planned', v]);
  });

  it('working_on in the same turn as the report: the report is about those pieces', () => {
    const m = start();
    chats = chats.map(c => ({ ...c, state: 'running' as const, run: run('done', now) }));
    now += 60;
    m.update('shop', { workingOn: ['c'], chatId: 'w', by: 'Artisan' });
    expect(saved('c')).toBe('ok');
    // in a later turn it is new work
    set(m, 'w', { state: 'idle', lastResult: { at: now + 10, isError: false } });
    now += 60_000;
    set(m, 'w', { state: 'running' });
    m.update('shop', { workingOn: ['c', 'd'], chatId: 'w', by: 'Artisan' });
    expect([saved('c'), saved('d')]).toEqual(['ok', 'work']);
  });

  it('a box\'s own files edited before the chat was linked to it: its done report confirms them', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: { elements: [
      { id: 'f2', kind: 'phase', name: 'Fatture', status: 'planned', evidence: ['src/inv/'] },
      { id: 'c', kind: 'step', name: 'Pulsanti', parent: 'f2', status: 'planned' },
    ] }, by: 'Scout', summary: '' });
    set(m, 'w', { state: 'running' });
    edit(m, 'w', 'C:\\repo\\shop\\src\\inv\\x.ts', now + 1);
    expect(m.view('shop')!.changed).toEqual({ f2: now + 1 });
    now += 60_000;
    m.link('shop', 'w', ['f2']);
    set(m, 'w', { state: 'idle', run: run('done', now), lastResult: { at: now + 30, isError: false } });
    expect(shown(m, 'f2')).toEqual({ status: 'ok', stale: false });
  });

  it('the projects list and the header agree also on a piece a plan\'s step works on', () => {
    const m = start();
    m.update('shop', { changes: [{ id: 'c', status: 'blocked', actor: 'user' }], by: 'Artisan' });
    const plan = { phase: 'running', clarified: [], at: 1, map: 'shop', steps: [{ title: 'Pulsanti', state: 'now', on: 'c' }] } as StrategyPlan;
    chats.push(chat({ id: 's', state: 'running', plan }));
    now += 3 * 3600_000;
    const v = m.view('shop')!;
    // the step under way vouches for the piece: still the user's turn, in both
    expect(waitingOf(v.map, statusesOf(v.map, now, v.changed))).toBe(1);
    expect(m.list()[0]!.waiting).toBe(1);
  });
});
