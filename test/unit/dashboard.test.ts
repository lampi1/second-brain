// Dashboard truthfulness and graph behaviour: unknowns, real message activity and bounded navigation.
import { describe, expect, it } from 'vitest';
import type { ChatSummary, ChatItem } from '../../src/shared/contract';
import { chatName, connections, contextLevel, contextRatio, cursorCoverage, layout, neighbourhood, observedErrors, placeLabels } from '../../src/renderer/dashboard/data';

const chat = (id: string, patch: Partial<ChatSummary> = {}): ChatSummary => ({
  id, title: id, harness: 'codex', origin: 'app', cwd: '', sessionId: null, model: null, effort: null,
  permissionMode: null, state: 'idle', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0,
  browserTabIds: [], ...patch,
});
describe('dashboard sources', () => {
  it('ownership alone does not invent message traffic', () => {
    expect(connections([chat('orchestrator', { isRegia: true }), chat('worker')], {})).toEqual([{ from: 'orchestrator', to: 'worker', at: null }]);
  });
  it('lights only successful known message destinations and preserves the newest observed event', () => {
    const chats = [chat('o', { isRegia: true }), chat('a'), chat('b')];
    const tool = (id: string, status: 'ok' | 'error', to: string, at: number): ChatItem => ({ kind: 'tool', id, name: 'mcp__second_brain__send_to_chat', status, input: { to }, at, summary: '' });
    const result = connections(chats, { a: [tool('1', 'ok', 'b', 123), tool('2', 'error', 'o', 999), tool('3', 'ok', 'unknown', 500)], b: [{ kind: 'user', id: 'u', from: 'a', at: 150, text: 'hello' }] });
    expect(result.find(e => e.from === 'a' && e.to === 'b')?.at).toBe(150);
    expect(result.find(e => e.from === 'o' && e.to === 'a')?.at).toBeNull();
    expect(result).toHaveLength(3);
  });
  it('does not guess which duplicate title sent a message', () => {
    expect(connections([chat('a', { title: 'same' }), chat('b', { title: 'same' }), chat('c')], { c: [{ kind: 'user', id: '1', at: 1, text: '', from: 'same' }] })).toEqual([]);
  });
  it('distinguishes unknown context from a measured zero and keeps overflow', () => {
    expect(contextRatio(chat('a'))).toBeNull();
    expect(contextRatio(chat('a', { contextTokens: 0, contextMaxTokens: 100 }))).toBe(0);
    expect(contextRatio(chat('a', { contextTokens: 120, contextMaxTokens: 100 }))).toBe(1.2);
  });
  it('reports an unmeasured context as unknown, never below threshold', () => {
    expect(contextLevel(chat('a'), 100)).toBe('unknown');
    expect(contextLevel(chat('a', { contextTokens: 0 }), 100)).toBe('below');
    expect(contextLevel(chat('a', { contextTokens: 500 }), 100)).toBe('above');
  });
  it('derives Cursor coverage from the Rome day of the export download, not the last usage row', () => {
    const stale = { downloaded: '2026-10-16T09:00:00Z', lastRow: '2026-10-17' }, fresh = { downloaded: '2026-10-17T08:00:00Z', lastRow: '2026-10-09' };
    expect(cursorCoverage(stale, '2026-10-17')).toBe(false);
    expect(cursorCoverage(fresh, '2026-10-17')).toBe(true);
    expect(cursorCoverage({ downloaded: '2026-10-16T22:30:00Z' }, '2026-10-17')).toBe(true);
    expect(cursorCoverage({}, '2026-10-17')).toBeNull();
    expect(cursorCoverage({ downloaded: 'garbage' }, '2026-10-17')).toBeNull();
  });
  it('names the Orchestrator chat Orchestrator, whatever its title', () => {
    expect(chatName(chat('o', { isRegia: true, title: 'Regia' }))).toBe('Orchestrator');
    expect(chatName(chat('a', { title: 'Worker' }))).toBe('Worker');
  });
  it('labels retained errors without treating a user interruption as failure', () => {
    const rows = observedErrors([chat('a')], { a: [
      { kind: 'system', id: '1', at: 1, level: 'error', text: 'Connection failed' },
      { kind: 'result', id: '2', at: 2, isError: true, interrupted: true, costUsd: 0, durationMs: 0, turns: 0 },
    ] }, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toBe('Connection failed');
  });
});
describe('dashboard graph', () => {
  const nodes = Array.from({ length: 130 }, (_, i) => ({ id: String(i), label: `Note ${i}`, kind: 'file', layer: 'brain' }));
  const edges = [{ from: '120', to: '3', kind: 'link', label: '' }];
  it('search reaches nodes outside the initial cap and includes their neighbours', () => {
    expect(neighbourhood(nodes, edges, '', null)).toHaveLength(100);
    expect(neighbourhood(nodes, edges, 'Note 120', null).map(n => n.id)).toEqual(['120', '3']);
    expect(neighbourhood(nodes, edges, '', '3').map(n => n.id)).toEqual(['3', '120']);
  });
  it('places neighbouring labels without overlapping each other or the dots', () => {
    const items = [{ id: 'a', x: 400, y: 260, r: 11, text: 'Posta tra chat' }, { id: 'b', x: 410, y: 285, r: 11, text: 'Chat di lavoro' }, { id: 'c', x: 395, y: 240, r: 11, text: 'Orchestrator' }];
    const spots = placeLabels(items, items.map(i => ({ x: i.x, y: i.y, r: 6 })), 14, { x: 400, y: 260 });
    const boxes = [...spots.values()].map(s => { const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - s.w : s.x - s.w / 2; return { x0, x1: x0 + s.w, y0: s.y - s.h / 2, y1: s.y + s.h / 2 }; });
    expect(boxes).toHaveLength(3);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
      for (const dot of items) expect(a.x1 <= dot.x - 6 || dot.x + 6 <= a.x0 || a.y1 <= dot.y - 6 || dot.y + 6 <= a.y0).toBe(true);
    }
  });
  it('returns a deterministic bounded layout, including disconnected notes', () => {
    const result = layout(nodes.slice(0, 30), edges, '0');
    expect(result).toEqual(layout(nodes.slice(0, 30), edges, '0'));
    expect(result.get('0')).toEqual({ x: 400, y: 260 });
    for (const point of result.values()) { expect(point.x).toBeGreaterThanOrEqual(65); expect(point.x).toBeLessThanOrEqual(735); }
  });
});
