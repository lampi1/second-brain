// Unit tests of the renderer's pure helpers: Italian formatting (lib/format.ts), fuzzy search (lib/fuzzy.ts),
// Mosaico geometry (lib/grid.ts) and the remembered preferences parser (store/ui.ts loadPrefs).
import { describe, expect, it } from 'vitest';
import type { BrowserTab, ChatSummary } from '@shared/contract';
import { ago, chatCost, diffTotals, duration, folderName, formatCost, prettyModel, stateInfo, toolLabel, until } from '../../src/renderer/lib/format';
import { fuzzyFilter, fuzzyScore } from '../../src/renderer/lib/fuzzy';
import { cellsFor, dragSplit, fractions, FOLD_AFTER_MS, gridFor, mosaicTiles, tileKey } from '../../src/renderer/lib/grid';
import { defaultPrefs, loadPrefs } from '../../src/renderer/store/ui';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'running',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const tab = (id: string, owner: string | null): BrowserTab => ({ id, url: 'https://x', title: id, loading: false, ownerChatId: owner });

describe('format', () => {
  it('costs, models, folders', () => {
    expect(formatCost(1.84)).toBe('1,84 $');
    expect(formatCost(38.2)).toBe('38,20 $');
    expect(chatCost({ harness: 'cursor', costUsd: 0 })).toBe('costo n/d');
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
  it('puts each browser right after the chat that drives it and folds finished chats', () => {
    const now = 100 * 60_000;
    const chats = {
      r: chat('r', { isRegia: true }), a: chat('a'), b: chat('b', { state: 'idle', updatedAt: now - FOLD_AFTER_MS - 1 }), c: chat('c'),
      d: chat('d', { state: 'idle', updatedAt: now - 60_000 }),
    };
    const { tiles, folded } = mosaicTiles(['r', 'a', 'b', 'c', 'd'], chats, [tab('t1', 'c'), tab('t2', 'a'), tab('t3', null), tab('t4', 'r')], now, new Set());
    expect(tiles.map(tileKey)).toEqual(['browser:t4', 'chat:a', 'browser:t2', 'chat:c', 'browser:t1', 'chat:d', 'browser:t3']);
    expect(folded.map(c => c.id)).toEqual(['b']);
    const kept = mosaicTiles(['r', 'a', 'b'], chats, [], now, new Set(['b']));
    expect(kept.tiles.map(tileKey)).toEqual(['chat:a', 'chat:b']);
  });

  it('chooses a balanced grid', () => {
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
    expect(loadPrefs(null)).toEqual(defaultPrefs);
    expect(loadPrefs('not json')).toEqual(defaultPrefs);
    const p = loadPrefs(JSON.stringify({ view: 'corsie', density: 'compact', theme: 'weird', cols: { 3: [1, 2, 1] } }));
    expect(p.view).toBe('corsie');
    expect(p.density).toBe('compact');
    expect(p.theme).toBe('system');
    expect(p.cols['3']).toEqual([1, 2, 1]);
  });
});
