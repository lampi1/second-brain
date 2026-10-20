// The Judge's sampled reviews (src/main/agents/judge-sample.ts, ADR 0083): which finished runs are picked (reported,
// recent, unjudged, not a Judge's own, not reviewed yet), the daily cap and its reset, the self-contained contract the
// Judge gets, and the review's verdict turned into the run's feedback (none without a verdict).
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRun } from '../../../src/shared/agents';
import type { AgentFeedbackArgs } from '../../../src/shared/agent-lifecycle';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import { JudgeSampler, pickSamples, reviewPrompt } from '../../../src/main/agents/judge-sample';

const NOW = Date.UTC(2026, 9, 19, 12);
const run = (id: string, over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${id.padStart(12, '0')}`, chatId: `c_${id}`, agentId: 'scout', version: 1, goal: 'Trova gli errori',
  startedBy: 'user', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed', counters: {} as AgentRun['counters'], costUsd: 0.1, tokens: null,
  report: { at: NOW - 3600_000, outcome: 'done', verified: 'yes', summary: 'Trovati 3 errori' }, model: 'opus', ...over });
const chat = (id: string): ChatSummary => ({ id, harness: 'claude', origin: 'app', title: `Chat ${id}`, cwd: '/w', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: 'Ecco i 3 errori: a, b, c', updatedAt: 1, browserTabIds: [] });

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('pickSamples', () => {
  it('takes reported, recent, unjudged runs that no Judge reviewed, at most n', () => {
    const runs = [
      run('1'), run('2'),
      run('3', { endedAt: undefined }),                                                      // still running
      run('4', { endReason: 'stale' }),                                                      // no result
      run('5', { endedAt: NOW - 8 * 86_400_000 }),                                           // too old
      run('6', { agentId: 'judge' }),                                                        // a Judge's own
      run('7', { outcome: { verdict: 'success', basis: 'human', by: 'user', at: 1 } }),      // the user judged it
      run('8', { outcome: { verdict: 'success', basis: 'orchestrator-opinion', by: 'p', at: 1 } }), // its parent did
      run('9', { report: undefined }),
      run('10'), run('11', { reviewOf: 'r_000000000010', agentId: 'judge' }),                // reviewed already
      run('13', { parentRunId: 'r_000000000099' }),                                          // a delegated child's: its parent's content
    ];
    const picked = pickSamples(runs, new Set(['r_000000000002']), NOW, 5).map(r => r.runId);
    expect(picked).toEqual(['r_000000000001']);
    expect(pickSamples(runs, new Set(), NOW, 0)).toEqual([]);
    expect(pickSamples([run('1'), run('2'), run('12')], new Set(), NOW, 2)).toHaveLength(2);
  });
  it('gives the Judge a self-contained contract with the goal, the report, the answer and how to answer', () => {
    const p = reviewPrompt(run('1'), chat('c_1'));
    expect(p).toContain('finished run of Scout «Chat c_1»');
    expect(p).toContain('Goal of that run: Trova gli errori');
    expect(p).toContain('Trovati 3 errori');
    expect(p).toContain('Ecco i 3 errori');
    expect(p).toContain('"verdict":"success|partial|fail"');
  });
});

describe('JudgeSampler', () => {
  const make = (runs: AgentRun[], daily = 2, refusal: string | null = null, chatOf: (id: string) => ChatSummary = chat) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-judge-')); dirs.push(dir);
    const created: NewChat[] = [], fed: [AgentFeedbackArgs, string][] = [];
    let now = NOW, n = 0;
    const s = new JudgeSampler({ file: path.join(dir, 'judge-samples.json'), runs: () => runs, chat: id => chatOf(id),
      create: async req => { created.push(req); return { ...chat(`j${++n}`), id: `j${n}` }; }, daily: () => daily, judgeEngine: () => 'codex',
      refusal: () => refusal, feedback: async (a, by) => { fed.push([a, by]); }, now: () => now });
    return { s, created, fed, later: (ms: number) => { now += ms; } };
  };
  it('starts at most judgeDaily a day, as Judge chats linked to the run on another model, then again the next day', async () => {
    const { s, created, later } = make([run('1'), run('2'), run('3')], 2);
    expect(await s.tick()).toBe(2);
    expect(created[0]).toMatchObject({ harness: 'codex', roleId: 'judge', cwd: '/w' });
    expect(created[0]).not.toHaveProperty('independentOf'); // a new session is the review's independence (ADR 0091)
    expect(created.map(c => c.reviewOf).every(id => id?.startsWith('r_'))).toBe(true);
    expect(await s.tick()).toBe(0);                 // the day's cap
    later(86_400_000);
    expect(await s.tick()).toBe(1);                 // the one left, never one reviewed already
    expect(new Set(created.map(c => c.reviewOf)).size).toBe(3);
  });
  it('never puts a delegated child\'s answer in a root Judge chat (the Orchestrator would read it)', async () => {
    const { s, created } = make([run('1')], 2, null, id => ({ ...chat(id), parentId: 'c_parent' }));
    expect(await s.tick()).toBe(0);
    expect(created).toEqual([]);
  });
  it('starts nothing when off or when the engine is refused', async () => {
    expect(await make([run('1')], 0).s.tick()).toBe(0);
    const r = make([run('1')], 2, 'engine switched off');
    expect(await r.s.tick()).toBe(0);
    expect(r.created).toEqual([]);
  });
  it('turns the review\'s verdict into the run\'s feedback, with the review as evidence; none without a verdict', async () => {
    const { s, fed } = make([run('1'), run('2')], 2);
    await s.tick();
    const [a, b] = s.list();
    const judge = (target: string, chatId: string, verdict?: 'fail'): AgentRun => run('99', { agentId: 'judge', chatId, reviewOf: target,
      report: { at: NOW, outcome: 'done', verified: 'yes', summary: 'Manca il terzo errore', ...(verdict ? { verdict } : {}) } });
    await s.ended(judge(a!.runId, a!.chatId, 'fail'));
    expect(fed).toEqual([[{ runId: a!.runId, verdict: 'fail', notes: 'Judge: Manca il terzo errore', evidence: [{ kind: 'run', ref: 'r_000000000099', at: NOW - 3600_000 }] }, 'judge-sample']]);
    await s.ended(judge(b!.runId, b!.chatId));
    expect(fed).toHaveLength(1);
    expect(s.list().map(r => r.state)).toEqual(['recorded', 'no-verdict']);
    await s.ended(judge(a!.runId, 'c_other', 'fail'));  // not the chat we started: ignored
    expect(fed).toHaveLength(1);
  });
});
