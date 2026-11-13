// What a collapsed strip says while its chat works (src/renderer/lib/strip-status.ts, ADR 0102): the step running now,
// else the plan's item in progress, else the last action; "passo n/N" with an engine plan; the silence from the last
// item's time, a running tool's clock apart from a stalled chat, amber past stallMin.
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { QUIET_MIN, stripStatus } from '../../src/renderer/lib/strip-status';

const MIN = 60_000;
let n = 0;
const tool = (name: string, input: unknown, at: number, status: 'running' | 'ok' | 'error' = 'ok'): ChatItem =>
  ({ kind: 'tool', id: `t${++n}`, at, name, summary: `${name}: x`, input, status });
const said = (text: string, at: number, streaming = false): ChatItem => ({ kind: 'assistant', id: `a${++n}`, at, text, ...(streaming ? { streaming } : {}) });
const todos = (at: number, ...st: string[]): ChatItem => tool('TodoWrite', { todos: st.map((s, i) => ({ content: `Passo ${i + 1}`, activeForm: `Faccio il passo ${i + 1}`, status: s })) }, at);

describe('stripStatus', () => {
  it('nothing readable yet: no step, no clock (the generic line stays)', () => {
    expect(stripStatus([], 10 * MIN, 10)).toEqual({ step: null, plan: null, quietMin: null, toolRunning: false, stalled: false });
    expect(stripStatus(undefined, 10 * MIN, 10).step).toBeNull();
  });
  it('a command running now is the step, its clock is "da N min", never stalled before stallMin', () => {
    const now = 20 * MIN;
    const st = stripStatus([tool('Read', { file_path: 'src/a.ts' }, 10 * MIN), tool('Bash', { command: 'npm test\nmore' }, 15 * MIN, 'running')], now, 10);
    expect(st.step).toMatchObject({ mark: 'cur', text: 'Lancia', code: 'npm test' });
    expect(st).toMatchObject({ quietMin: 5, toolRunning: true, stalled: false });
  });
  it('the plan position counts the done items, and the plan\'s current item shows when no tool runs', () => {
    const now = 3 * MIN;
    const st = stripStatus([todos(1 * MIN, 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending', 'pending'), said('ok', 3 * MIN)], now, 10);
    expect(st.plan).toEqual({ at: 3, of: 7 });
    expect(st.step?.text).toBe('Faccio il passo 3');
  });
  it('a plan of one item is no "passo 1/1"; every item done stays at the last', () => {
    expect(stripStatus([todos(MIN, 'in_progress')], MIN, 10).plan).toBeNull();
    expect(stripStatus([todos(MIN, 'completed', 'completed')], MIN, 10).plan).toEqual({ at: 2, of: 2 });
  });
  it('without a plan or a running tool the last action is the step', () => {
    const st = stripStatus([tool('Edit', { file_path: 'src/x.ts' }, MIN), said('fatto', MIN)], MIN, 10);
    expect(st.step?.text).toBe('Modificato x.ts');
    expect(st.plan).toBeNull();
  });
  it('silence: no clock under QUIET_MIN, "ferma" from the last item, stalled from stallMin on', () => {
    const t0 = 100 * MIN, items = [said('penso', t0)];
    expect(stripStatus(items, t0 + (QUIET_MIN - 1) * MIN + 59_000, 10).quietMin).toBeNull();
    expect(stripStatus(items, t0 + QUIET_MIN * MIN, 10)).toMatchObject({ quietMin: QUIET_MIN, toolRunning: false, stalled: false });
    expect(stripStatus(items, t0 + 9 * MIN, 10).stalled).toBe(false);
    expect(stripStatus(items, t0 + 10 * MIN, 10)).toMatchObject({ quietMin: 10, stalled: true });
  });
  it('a reply streaming in is no silence', () => {
    expect(stripStatus([said('scrivo', MIN, true)], 30 * MIN, 10).quietMin).toBeNull();
  });
});

it('does not format old action groups when a collapsed strip only needs the last action', () => {
  const read = vi.fn(() => 'src/old.ts');
  const old = Array.from({ length: 500 }, (_, i) => tool('Read', { get file_path() { return read(); } }, i));
  const latest = tool('Bash', { command: 'npm test' }, 501);
  expect(stripStatus([...old, latest, said('stream', 502, true)], 502, 10).step?.code).toBe('npm test');
  expect(read).not.toHaveBeenCalled();
});
