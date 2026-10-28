// The production Live/UsageMonitor paths skip child launches for unchanged known inputs, while preserving retries,
// rolling chat expiry, day rollover, in-flight changes, explicit refresh and shutdown. Child output is deterministic.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as node from '../../../src/main/brain/node';
import { Live, romeDay, type RawEvent } from '../../../src/main/brain/live';
import { UsageMonitor } from '../../../src/main/brain/usage';
import { plainNode, tmpBrain, until } from './helpers';

const stops: (() => void)[] = [], roots: string[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function setup() {
  const root = tmpBrain(); roots.push(root);
  fs.writeFileSync(path.join(root, 'ops', 'tools', 'cost.mjs'), '// replaced by deterministic child output');
  let revision: string | null = '1';
  const inputs = { revision: vi.fn(async () => revision), stop: vi.fn() };
  return { root, inputs, change: (next: string | null) => { revision = next; } };
}
const result = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: '', code: 0 });
const cost = () => ({ complete: true, from: romeDay(), to: romeDay(), byDay: { [romeDay()]: { usd: 1 } }, chats: {} });
const chat = (at: number, state = 'aspetta te') => ({ complete: true, chats: [{ at, line: `- Claude · Demo · work · 28/10, 10:00 · ${state} · id abc12345` }] });

describe('input-driven background script launches', () => {
  it('recovers after a temporarily missing script even when its data inputs did not change', async () => {
    const s = setup(), script = path.join(s.root, 'ops', 'tools', 'cost.mjs');
    const run = vi.spyOn(node, 'runNode').mockResolvedValue(result(cost()));
    const m = new UsageMonitor({ root: s.root, node: plainNode, claudeConfig: null, costInputs: s.inputs, onUsage: () => {} }); stops.push(() => m.stop());
    await m.refresh(false); expect(m.get().costKnown).toBe(true);
    fs.unlinkSync(script); await m.refresh(false); expect(m.get().costKnown).toBe(false);
    fs.writeFileSync(script, '// restored'); await m.refresh(false);
    expect(run).toHaveBeenCalledTimes(2); expect(m.get().costKnown).toBe(true);
  });

  it('skips unchanged cost, preserves explicit refresh/day rollover, and retries incomplete or failed reads', async () => {
    const s = setup(); let now = Date.now();
    const run = vi.spyOn(node, 'runNode').mockResolvedValue(result(cost()));
    const usage = vi.fn();
    const m = new UsageMonitor({ root: s.root, node: plainNode, claudeConfig: null, costInputs: s.inputs, now: () => now, onUsage: usage }); stops.push(() => m.stop());
    await m.refresh(false); await m.refresh(false); expect(run).toHaveBeenCalledTimes(1); expect(usage).toHaveBeenCalledTimes(2);
    await m.refresh(); expect(run).toHaveBeenCalledTimes(2);
    now += 864e5; await m.refresh(false); expect(run).toHaveBeenCalledTimes(3);
    s.change('2'); run.mockResolvedValueOnce(result({ ...cost(), complete: false }));
    await m.refresh(false); await m.refresh(false); expect(run).toHaveBeenCalledTimes(5);
    s.change('3'); run.mockResolvedValueOnce({ stdout: '', stderr: '', code: 1, error: 'failed' });
    await m.refresh(false); await m.refresh(false); expect(run).toHaveBeenCalledTimes(7);
    s.change(null); await m.refresh(false); await m.refresh(false); expect(run).toHaveBeenCalledTimes(9);
  });

  it('does not consume input changes arriving while cost is being read or emit after shutdown', async () => {
    const s = setup(); let finish!: (r: node.RunResult) => void;
    const run = vi.spyOn(node, 'runNode').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(result(cost()));
    const usage = vi.fn(); const m = new UsageMonitor({ root: s.root, node: plainNode, costInputs: s.inputs, onUsage: usage }); stops.push(() => m.stop());
    const pending = m.refresh(false); expect(await until(() => !!finish)).toBe(true);
    s.change('2'); finish(result(cost())); await pending;
    await m.refresh(false); expect(run).toHaveBeenCalledTimes(2);
    run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); finish = undefined!;
    const last = m.refresh(); expect(await until(() => !!finish)).toBe(true); m.stop(); finish(result(cost())); await last;
    expect(usage).toHaveBeenCalledTimes(2); expect(s.inputs.stop).toHaveBeenCalled();
  });

  it('keeps chat waiting transitions, expires old rows locally and retries incomplete lists', async () => {
    const s = setup(); const clock = vi.spyOn(Date, 'now'); let now = Date.now(); clock.mockImplementation(() => now);
    let output = chat(now - 2 * 864e5 + 1000);
    const run = vi.spyOn(node, 'runNode').mockImplementation(async () => result(output));
    const events: RawEvent[] = [];
    const live = new Live({ root: s.root, node: plainNode, stateFile: path.join(s.root, 'live.json'), chatInputs: s.inputs, chatsEveryMs: 20, onEvents: next => events.push(...next) }); stops.push(() => live.stop());
    await live.start(); expect(await until(() => live.chatPolls === 1)).toBe(true);
    expect(await until(() => s.inputs.revision.mock.calls.length >= 5)).toBe(true); expect(run).toHaveBeenCalledTimes(1); expect(events).toEqual([]);
    now += 2000; output = chat(now); s.change('2');
    expect(await until(() => live.chatPolls === 2)).toBe(true); expect(events.filter(e => e.kind === 'chat-waiting')).toHaveLength(1);
    output = { ...chat(now, 'in corso'), complete: false }; s.change('3');
    expect(await until(() => live.chatPolls >= 4)).toBe(true);
    output = chat(now); s.change('4');
    expect(await until(() => events.filter(e => e.kind === 'chat-waiting').length === 2)).toBe(true);
    live.stop(); expect(s.inputs.stop).toHaveBeenCalled();
  });
});
