// Unit tests of the renderer's pure helpers: Italian formatting (lib/format.ts), fuzzy search (lib/fuzzy.ts),
// Mosaico geometry (lib/grid.ts) and the remembered preferences parser (store/ui.ts loadPrefs).
import { describe, expect, it } from 'vitest';
import type { BrowserTab, ChatSummary } from '@shared/contract';
import { ago, chatCost, diffTotals, duration, estimateText, estimateTip, folderName, formatCost, minutes, prettyModel, stateInfo, toolLabel, until, workTime } from '../../src/renderer/lib/format';
import { fuzzyFilter, fuzzyScore } from '../../src/renderer/lib/fuzzy';
import { cellsFor, dragSplit, fractions, gridFor, mosaicTiles, pairIndex, pairSlots, PAIR_COLORS, splitZones, tileKey } from '../../src/renderer/lib/grid';
import { defaultPrefs, loadPrefs } from '../../src/renderer/store/ui';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'running',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
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
    // work time and the estimate beside the cost
    expect(workTime({}, 5000)).toBeNull();
    expect(workTime({ workMs: 60_000, workSince: 1000 }, 121_000)).toBe(180_000);
    expect(workTime({ workSince: 9000 }, 5000)).toBe(0); // a frozen UI clock behind main's never goes negative
    expect(minutes(20_000)).toBe('<1 min');
    expect(minutes(12 * 60_000)).toBe('12 min');
    expect(minutes(65 * 60_000)).toBe('1 h 05');
    expect(estimateText(undefined)).toBeNull();
    expect(estimateText(null)).toBe('stima senza dati');
    expect(estimateText({ usdLow: 0.4, usdHigh: 1.2, minLow: 9.6, minHigh: 25, basis: 8 })).toBe('stima 0,40–1,20 $ · 10–25 min');
    expect(estimateText({ usdLow: 0.4, usdHigh: 1.2, minLow: null, minHigh: null, basis: 8 })).toBe('stima 0,40–1,20 $ · durata senza dati');
    const e80 = { usdLow: 0.5, usdHigh: 9, minLow: 10, minHigh: 120, basis: 140, from: 'brain' as const, label: 'tutte le chat', errMin: 50, errUsd: 12, usdMid: 3, minMid: 40, cover: 0.8 as const, held: { min: 0.86, usd: 0.65, n: 140 } };
    expect(estimateTip(e80, '1 $')).toMatch(/8 volte su 10 \(sulle ultime 140 chat: durata 86%, costo 65%\); valore tipico 40 min, 3,00 \$/);
    expect(estimateTip({ ...e80, cover: 0.5, held: null }, '1 $')).toMatch(/metà centrale/);
    expect(estimateText({ usdLow: 1.7, usdHigh: 20, minLow: 10, minHigh: 107, basis: 222 })).toBe('stima 1,70–20,00 $ · 10 min–1 h 47');
    // the tooltip: the brain's estimate says how wrong it was on the past chats
    expect(estimateTip(null, '2 $')).toBe('Meno di 5 lavori simili: niente stima');
    expect(estimateTip({ usdLow: 1, usdHigh: 2, minLow: 1, minHigh: 2, basis: 7 }, '2 $')).toBe('Stima da 7 lavori simili; finora 2 $');
    expect(estimateTip({ usdLow: 1, usdHigh: 2, minLow: 1, minHigh: 2, basis: 222, from: 'brain', label: 'tutte le chat', errMin: 70, errUsd: 15 }, '2 $'))
      .toBe('Stima da 222 chat passate (tutte le chat); sulle chat passate sbaglia in media di 1 h 10 e 15,00 $; finora 2 $');
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettyModel('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5 1M');
    expect(prettyModel('grok-4.7', 'cursor')).toBe('Grok 4.7');
    expect(prettyModel('gpt-5', 'cursor')).toBe('GPT-5');
    expect(prettyModel(null)).toBe('predefinito');
    expect(folderName('C:\\lavoro\\core-web\\')).toBe('core-web');
  });

  it('state pills never rely on color alone (they have a label)', () => {
    expect(stateInfo({ state: 'running', isRegia: false, pending: 0 })).toEqual({ label: 'al lavoro', tone: 'run' });
    expect(stateInfo({ state: 'running', isRegia: false, pending: 1 })).toEqual({ label: 'ti aspetta', tone: 'wait' });
    expect(stateInfo({ state: 'idle', isRegia: true, pending: 0 }).label).toBe('ti ascolta');
    expect(stateInfo({ state: 'idle', isRegia: false, pending: 0 }).label).toBe('finito');
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
    expect(fuzzyScore('zzz', 'Regia')).toBe(-1);
    const list = ['Fix totale ordine', 'Bug notifiche SMS', 'Apri: Diario'];
    expect(fuzzyFilter(list, 'sms', x => x)[0]).toBe('Bug notifiche SMS');
    expect(fuzzyFilter(list, '', x => x)).toEqual(list);
  });
});

describe('grid', () => {
  it('puts each browser right after the chat that drives it; finished chats stay until they close, closed ones leave', () => {
    const chats = {
      r: chat('r', { isRegia: true }), a: chat('a'), b: chat('b', { state: 'idle', updatedAt: 0 }), c: chat('c'),
      d: chat('d', { state: 'closed', closedAt: 1 }),
    };
    const tiles = mosaicTiles(['r', 'a', 'b', 'c', 'd'], chats, [tab('t1', 'c'), tab('t2', 'a'), tab('t3', null), tab('t4', 'r')]);
    expect(tiles.map(tileKey)).toEqual(['browser:t4', 'chat:a', 'browser:t2', 'chat:b', 'chat:c', 'browser:t1', 'browser:t3']);
  });

  it('splits chats and browsers into two zones; hidden browsers leave only the ones waiting for the user', () => {
    const tiles = [{ kind: 'browser', id: 't4' }, { kind: 'chat', id: 'a' }, { kind: 'browser', id: 't2' }, { kind: 'chat', id: 'c' }, { kind: 'browser', id: 't1' }] as const;
    const shown = splitZones([...tiles], false);
    expect(shown.chats.map(tileKey)).toEqual(['chat:a', 'chat:c']);
    expect(shown.browsers.map(tileKey)).toEqual(['browser:t4', 'browser:t2', 'browser:t1']);
    expect(splitZones([...tiles], true).browsers).toEqual([]);
    expect(splitZones([...tiles], true, ['t2']).browsers.map(tileKey)).toEqual(['browser:t2']);
    expect(splitZones([...tiles], true).chats).toHaveLength(2);
  });

  it('chooses a balanced grid', () => {
    expect(gridFor(5, 830, 740, 1.05, 250)).toEqual({ cols: 3, rows: 2 }); // the chat zone avoids compact (short) tiles
    expect(gridFor(1, 1200, 800)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(4, 1200, 800)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(6, 1240, 800)).toEqual({ cols: 3, rows: 2 });
  });

  it('the last row stretches so there are no holes', () => {
    expect(cellsFor(5, 3)).toEqual([
      { col: 0, row: 0, span: 1 }, { col: 1, row: 0, span: 1 }, { col: 2, row: 0, span: 1 },
      { col: 0, row: 1, span: 1 }, { col: 1, row: 1, span: 2 },
    ]);
    expect(cellsFor(7, 3)[6]).toEqual({ col: 0, row: 2, span: 3 });
  });

  it('fractions and splitter drags stay valid', () => {
    expect(fractions([1, 1], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(fractions([2, 2], 2)).toEqual([0.5, 0.5]);
    const fr = dragSplit([0.5, 0.5], 0, 0.6);
    expect(fr[0]).toBeCloseTo(0.88);
    expect(fr[1]).toBeCloseTo(0.12);
  });
});

describe('prefs', () => {
  it('parses stored prefs defensively', () => {
    expect(loadPrefs(null, 0)).toEqual(defaultPrefs);
    expect(loadPrefs('not json', 0)).toEqual(defaultPrefs);
    const p = loadPrefs(JSON.stringify({ view: 'corsie', density: 'compact', theme: 'weird', cols: { 3: [1, 2, 1] } }));
    expect(p.view).toBe('corsie');
    expect(p.density).toBe('compact');
    expect(p.theme).toBe('system');
    expect(p.cols['3']).toEqual([1, 2, 1]);
    expect(p.browsersHidden).toBe(false);
    expect(p.browserZone).toBe(defaultPrefs.browserZone);
    const h = loadPrefs(JSON.stringify({ browsersHidden: true, browserZone: 0.5 }));
    expect(h.browsersHidden).toBe(true);
    expect(h.browserZone).toBe(0.5);
    const bad = loadPrefs(JSON.stringify({ browsersHidden: 'yes', browserZone: 3 }));
    expect(bad.browsersHidden).toBe(false);
    expect(bad.browserZone).toBe(defaultPrefs.browserZone);
  });
});
