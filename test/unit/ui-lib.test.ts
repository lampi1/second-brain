// Unit tests of the renderer's pure helpers: Italian formatting (lib/format.ts), fuzzy search (lib/fuzzy.ts),
// workspace tiles (lib/grid.ts) and the remembered preferences parser (store/ui.ts loadPrefs).
import { describe, expect, it } from 'vitest';
import type { BrowserTab, ChatSummary } from '@shared/contract';
import { ago, chatCost, diffTotals, duration, folderName, formatCost, minutes, modelWithEffort, prettyModel, stateInfo, toolLabel, until, workTime } from '../../src/renderer/lib/format';
import { fuzzyFilter, fuzzyScore } from '../../src/renderer/lib/fuzzy';
import { pairIndex, pairSlots, PAIR_COLORS, tileKey, workspaceTiles } from '../../src/renderer/lib/grid';
import { defaultPrefs, loadPrefs } from '../../src/renderer/store/ui';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'running',
  costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const tab = (id: string, owner: string | null): BrowserTab => ({ id, url: 'https://x', title: id, loading: false, ownerChatId: owner });

describe('chat ↔ browser pairs', () => {
  it('give each chat that drives a browser its own color slot, in creation order; others get none', () => {
    const order = ['a', 'b', 'c', 'd'];
    const tabs = [tab('t1', 'c'), tab('t2', 'a'), tab('t3', 'c'), tab('t4', null)];
    const slots = pairSlots(new Map(), order, tabs);
    expect(pairIndex(slots, tabs, 'a')).toBe(0);
    expect(pairIndex(slots, tabs, 'c')).toBe(1);           // two tabs, one pair, one color
    expect(pairIndex(slots, tabs, 'b')).toBeNull();        // no browser
    expect(pairIndex(slots, tabs, null)).toBeNull();       // the user's own tab
    expect(pairSlots(slots, order, tabs)).toBe(slots);     // nothing changed: same map (memo)
    expect(pairSlots(new Map(), [], tabs).get('c')).toBe(0);   // not yet in the order (just created) still gets a slot
  });

  it('keep colors stable when another pair goes away, and reuse the free slot', () => {
    const order = ['a', 'b', 'c'];
    let tabs = [tab('t1', 'a'), tab('t2', 'b')];
    let slots = pairSlots(new Map(), order, tabs);
    tabs = [tab('t2', 'b')];                               // a closes its tab: b keeps its color
    slots = pairSlots(slots, order, tabs);
    expect(pairIndex(slots, tabs, 'b')).toBe(1);
    expect(pairIndex(slots, tabs, 'a')).toBeNull();
    tabs = [tab('t2', 'b'), tab('t3', 'c'), tab('t4', 'a')];   // c is new; a comes back with its own color
    slots = pairSlots(slots, order, tabs);
    expect([pairIndex(slots, tabs, 'a'), pairIndex(slots, tabs, 'b'), pairIndex(slots, tabs, 'c')]).toEqual([0, 1, 2]);
    slots = pairSlots(slots, ['b', 'c'], [tab('t2', 'b'), tab('t3', 'c')]);   // a closed: its slot is free again
    expect(pairSlots(slots, ['b', 'c', 'd'], [tab('t2', 'b'), tab('t3', 'c'), tab('t5', 'd')]).get('d')).toBe(0);
    const many = Array.from({ length: PAIR_COLORS + 1 }, (_, i) => `x${i}`);
    const all = many.map(id => tab(`t-${id}`, id));
    expect(pairIndex(pairSlots(new Map(), many, all), all, `x${PAIR_COLORS}`)).toBe(0);   // past 8: the least used
  });

  it('past 8, a new pair avoids the colors on screen even when dormant chats hold every slot', () => {
    const eight = Array.from({ length: PAIR_COLORS }, (_, i) => `x${i}`);
    let slots = pairSlots(new Map(), eight, eight.map(id => tab(`t-${id}`, id)));   // 8 pairs, then all close their tabs
    slots = pairSlots(slots, [...eight, 'new'], [tab('t-x0', 'x0'), tab('t-new', 'new')]);   // x0 is back, a ninth arrives
    expect(slots.get('x0')).toBe(0);
    expect(slots.get('new')).toBe(1);
  });
});

describe('format', () => {
  it('costs, models, folders', () => {
    expect(formatCost(1.84)).toBe('1,84 $');
    expect(formatCost(38.2)).toBe('38,20 $');
    expect(chatCost({ harness: 'cursor', costUsd: 0 })).toBe('costo n/d');
    expect(chatCost({ harness: 'cursor', costUsd: 0, costKnown: false, costLedgerUsd: 1.5 })).toBe('≈ 1,50 $');
    // work time, shown beside the cost
    expect(workTime({}, 5000)).toBeNull();
    expect(workTime({ workMs: 60_000, workSince: 1000 }, 121_000)).toBe(180_000);
    expect(workTime({ workSince: 9000 }, 5000)).toBe(0); // a frozen UI clock behind main's never goes negative
    expect(minutes(20_000)).toBe('<1 min');
    expect(minutes(12 * 60_000)).toBe('12 min');
    expect(minutes(65 * 60_000)).toBe('1 h 05');
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5');
    // issue #100: the effort the engine reports (or the app sent with the turn) beside the model; never the one only asked
    const st = (p: object) => ({ supported: true, requested: 'high' as const, submitted: null, effective: null, pending: true, effectiveSource: 'unknown' as const, sessionDefault: 'medium', ...p });
    expect(modelWithEffort({ model: 'claude-opus-5-5', harness: 'claude', effortStatus: st({ effective: 'low', effectiveSource: 'provider' }) })).toBe('Opus 5.5 · low');
    expect(modelWithEffort({ model: 'claude-opus-5-5', harness: 'claude', effortStatus: st({ submitted: 'xhigh' }) })).toBe('Opus 5.5 · xhigh');
    expect(modelWithEffort({ model: 'claude-opus-5-5', harness: 'claude', effortStatus: st({}) })).toBe('Opus 5.5');
    expect(modelWithEffort({ model: 'claude-opus-5-5', harness: 'claude' })).toBe('Opus 5.5');
    expect(modelWithEffort({ model: 'grok-4.7[context=256k,reasoning_effort=low]', harness: 'cursor', effortStatus: st({ effective: 'low' }) })).toBe('Grok 4.7 · low');
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettyModel('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5 1M');
    expect(prettyModel('grok-4.7', 'cursor')).toBe('Grok 4.7');
    expect(prettyModel('gpt-5', 'cursor')).toBe('GPT-5');
    expect(prettyModel(null)).toBe('predefinito');
    expect(folderName('C:\\lavoro\\core-web\\')).toBe('core-web');
  });

  it('state pills never rely on color alone (they have a label)', () => {
    expect(stateInfo({ state: 'running', isOrchestrator: false, pending: 0 })).toEqual({ label: 'al lavoro', tone: 'run' });
    expect(stateInfo({ state: 'running', isOrchestrator: false, pending: 1 })).toEqual({ label: 'ti aspetta', tone: 'wait' });
    expect(stateInfo({ state: 'idle', isOrchestrator: true, pending: 0 }).label).toBe('ti ascolta');
    expect(stateInfo({ state: 'idle', isOrchestrator: false, pending: 0 }).label).toBe('finito');
  });

  it('times and durations', () => {
    expect(ago(1000, 1000 + 20_000)).toBe('ora');
    expect(ago(0, 4 * 60_000)).toBe('4 min');
    expect(ago(0, 3 * 3600_000)).toBe('3 h');
    expect(until(133 * 60_000, 0)).toBe('tra 2 h 13 min');
    expect(duration(42_000)).toBe('0:42');
    expect(duration(134_000)).toBe('2:14');
    expect(duration(3_780_000)).toBe('1 h 03');
  });

  it('tool labels and diff totals', () => {
    expect(toolLabel('mcp__sb-browser__browser_click')).toBe('Browser · click');
    expect(toolLabel('Edit')).toBe('Modifica');
    expect(toolLabel('mcp__tracker__create_bug')).toBe('tracker · create bug');
    const diff = [{ path: 'a', added: 18, removed: 6 }, { path: 'b', added: 24, removed: 1 }];
    expect(diffTotals(diff)).toEqual({ added: 42, removed: 7 });
    expect(diffTotals([])).toBeNull();
  });
});

describe('fuzzy', () => {
  it('matches subsequences, accent and case insensitive, word starts first', () => {
    expect(fuzzyScore('qari', 'QA · Rimborsi')).toBeGreaterThan(0);
    expect(fuzzyScore('qualita', 'Apri: Qualità')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'Orchestrator')).toBe(-1);
    const list = ['Fix totale ordine', 'Bug notifiche SMS', 'Apri: Diario'];
    expect(fuzzyFilter(list, 'sms', x => x)[0]).toBe('Bug notifiche SMS');
    expect(fuzzyFilter(list, '', x => x)).toEqual(list);
  });
});

describe('grid', () => {
  it('puts each browser right after the chat that drives it; finished chats stay until they close, closed ones leave', () => {
    const chats = {
      r: chat('r', { isOrchestrator: true }), a: chat('a'), b: chat('b', { state: 'idle', updatedAt: 0 }), c: chat('c'),
      d: chat('d', { state: 'closed', closedAt: 1 }),
    };
    const tiles = workspaceTiles(['r', 'a', 'b', 'c', 'd'], chats, [tab('t1', 'c'), tab('t2', 'a'), tab('t3', null), tab('t4', 'r')]);
    expect(tiles.map(tileKey)).toEqual(['browser:t4', 'chat:a', 'browser:t2', 'chat:b', 'chat:c', 'browser:t1', 'browser:t3']);
  });
});

describe('prefs', () => {
  it('parses stored prefs defensively', () => {
    expect(loadPrefs(null, 0)).toEqual(defaultPrefs);
    expect(loadPrefs('not json', 0)).toEqual(defaultPrefs);
    // the retired views (Mosaico, Corsie), the icon-only sidebar and the top Orchestrator leave nothing behind
    const p = loadPrefs(JSON.stringify({ view: 'corsie', density: 'compact', theme: 'weird', cols: { 3: [1, 2, 1] }, rows: {}, browserZone: 0.5, navCollapsed: true, orchestratorPlacement: 'top', orchestratorTopHeight: 300 }));
    expect(p.density).toBe('compact');
    expect(p.theme).toBe('system');
    for (const key of ['view', 'cols', 'rows', 'browserZone', 'navCollapsed', 'orchestratorPlacement', 'orchestratorTopHeight']) expect(p).not.toHaveProperty(key);
    // the retired hide-browsers switch (#82): a saved "on" is dropped, an opened browser always shows
    expect(loadPrefs(JSON.stringify({ browsersHidden: true, density: 'compact' }))).not.toHaveProperty('browsersHidden');
    expect(loadPrefs(JSON.stringify({ browsersHidden: true, density: 'compact' })).density).toBe('compact');
  });
});
