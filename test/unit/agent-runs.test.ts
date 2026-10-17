// The agent run store (A5): strict reading, the pure lifecycle steps, bounds that prune only ended runs, refused links.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRunStore, RUNS_MAX, STALE_MS, addTurn, endRun, readRun, reopenRun, staleDue, type RunStart } from '../../src/main/agents/runs';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runs-')); roots.push(dir); return dir; };
const start = (o: Partial<RunStart> = {}): RunStart => ({ chatId: 'c1', agentId: 'reviewer', version: 2, goal: '  Rivedi  ', startedBy: 'user', startedAt: 1000, costKnown: true, ...o });

describe('agent run store', () => {
  it('starts, saves and reads back a run', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const run = s.start(start());
    expect(run).toMatchObject({ goal: 'Rivedi', costUsd: 0, tokens: { input: 0 }, counters: { reopened: 0, contextPeak: null } });
    expect(run.runId).toMatch(/^r_[a-f0-9]{12}$/);
    expect(new AgentRunStore(dir).get(run.runId)).toEqual(run);
    expect(s.start(start({ costKnown: false })).costUsd).toBeNull();
  });

  it('refuses a malformed run field by field', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(readRun(run)).toEqual(run);
    for (const bad of [{ runId: 'x' }, { agentId: 'Bad Id' }, { version: -1 }, { startedBy: 'agent' }, { endedAt: 5 }, { endReason: 'done', endedAt: 5 },
      { counters: { ...run.counters, questions: 1.5 } }, { costUsd: -1 }, { tokens: { input: 1 } }, { outcome: { verdict: 'ok', basis: 'human', at: 1, by: 'user' } }, { spawnedBy: 'nope' }])
      expect(readRun({ ...run, ...bad })).toBeNull();
  });

  it('a damaged file is kept, nothing is recorded and saving refuses', () => {
    const dir = tmp(), file = path.join(dir, 'agent-runs.json');
    fs.writeFileSync(file, '{"version":2,"runs":[]}');
    const s = new AgentRunStore(dir);
    expect(s.problem).toMatch(/non è leggibile/);
    expect(() => s.start(start())).toThrow(/non è leggibile/);
    expect(() => s.save()).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{"version":2,"runs":[]}');
  });

  it('the first end wins; a reopen clears the end and the verdict and counts', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(endRun(run, 'completed', 5)).toBe(true);
    expect(endRun(run, 'closed', 6)).toBe(false);
    expect(run).toMatchObject({ endedAt: 5, endReason: 'completed' });
    run.outcome = { verdict: 'success', basis: 'human', at: 5, by: 'user' };
    expect(reopenRun(run)).toBe(true);
    expect(run.endedAt ?? run.endReason ?? run.outcome).toBeUndefined();
    expect(run.counters.reopened).toBe(1);
    expect(reopenRun(run)).toBe(false);
  });

  it('stale only when idle long enough and nothing waits', () => {
    const run = new AgentRunStore(tmp()).start(start());
    expect(staleDue(run, 0, false, STALE_MS)).toBe(true);
    expect(staleDue(run, 0, true, STALE_MS)).toBe(false);
    expect(staleDue(run, 1, false, STALE_MS)).toBe(false);
  });

  it('cost and tokens: null stays null, an ended run takes nothing', () => {
    const run = new AgentRunStore(tmp()).start(start());
    addTurn(run, 0.1, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    addTurn(run, 0.2, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    expect(run).toMatchObject({ costUsd: 0.3, tokens: { input: 2, output: 2 } });
    addTurn(run, null, undefined);
    addTurn(run, 1, { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 });
    expect(run).toMatchObject({ costUsd: null, tokens: null });
    const other = new AgentRunStore(tmp()).start(start());
    endRun(other, 'closed', 2);
    addTurn(other, 5, undefined);
    expect(other).toMatchObject({ costUsd: 0, tokens: { input: 0 } });
  });

  it('refuses unknown links and a spawned run with another parent', () => {
    const s = new AgentRunStore(tmp());
    const a = s.start(start()), b = s.start(start());
    expect(() => s.start(start({ reworkOf: 'r_000000000000' }))).toThrow(/non trovata/);
    expect(() => s.start(start({ spawnedBy: a.runId, parentRunId: b.runId }))).toThrow(/genitore/);
    const k = s.start(start({ spawnedBy: a.runId }));
    expect(k.parentRunId).toBe(a.runId);
    expect(s.children(a.runId)).toEqual([k]);
    endRun(k, 'closed', 3);
    expect(s.children(a.runId)).toEqual([]);
  });

  it('past the count it prunes only ended runs, oldest end first', () => {
    const dir = tmp();
    const s = new AgentRunStore(dir);
    const open = s.start(start(), false);
    const ended = Array.from({ length: RUNS_MAX }, (_, i) => { const r = s.start(start({ startedAt: i }), false); endRun(r, 'closed', 10_000 - i); return r; });
    s.save();
    expect(s.list()).toHaveLength(RUNS_MAX);
    expect(s.get(open.runId)).toBe(open);
    expect(s.get(ended.at(-1)!.runId)).toBeUndefined(); // the oldest end (10000 - (MAX-1))
    expect(s.get(ended[0]!.runId)).toBeDefined();
    expect(new AgentRunStore(dir).list()).toHaveLength(RUNS_MAX);
  });

  it('adopt takes back a lost run once', () => {
    const s = new AgentRunStore(tmp());
    const run = new AgentRunStore(tmp()).start(start());
    expect(s.adopt(run)).toBe(run);
    expect(s.adopt({ ...run })).toBe(run);
  });
});
