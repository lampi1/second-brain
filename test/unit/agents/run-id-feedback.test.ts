// The way to a role run id: app_chats lists each role chat's run (runId, role, version, state), and a runId that names no
// run gets an actionable error (a chat id → that chat's runId; a plain chat → not a run; else pruned). Reproduces the
// owner's report: a feedback with a chat id answered a bare "Unknown run.".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appControlTools } from '../../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import { RunFeedback } from '../../../src/main/agents/run-feedback';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { AgentRunStore, unknownRunError } from '../../../src/main/agents/runs';
import { closeAppDbs } from '../../../src/main/app-db';
import type { AgentRun } from '../../../src/shared/agents';
import { AGENT_FEEDBACK_SCHEMA } from '../../../src/shared/agent-lifecycle';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-runid-')); dirs.push(d); return d; };
afterEach(() => { closeAppDbs(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: 'r_0123456789ab', chatId: 'c_work000001', agentId: 'reviewer', version: 2, goal: 'g', startedBy: 'orchestrator', startedAt: 1,
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null, ...over });
const chatRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, harness: 'claude', state: 'idle', title: id, pending: 0, model: null, costUsd: 0, isOrchestrator: false, lastText: '', ...extra });

describe('app_chats exposes the agent run of each agent chat', () => {
  it('lists runId, agentId, version and running/ended state; a plain chat has no run', async () => {
    const list = [chatRow('c_work000001', { run: run() }), chatRow('c_done000001', { run: run({ runId: 'r_ba9876543210', chatId: 'c_done000001', endedAt: 5, endReason: 'completed' }) }), chatRow('c_cb79813eb5', { isOrchestrator: true })];
    const chats = { list: () => list } as unknown as ChatService;
    const brain = { settings: () => ({}) } as unknown as BrainService;
    const tools = appControlTools({ chats, browser: {} as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' });
    const out = await tools.find(t => t.name === 'app_chats')!.run({}) as { app: Record<string, unknown>[] };
    expect(out.app[0]!.run).toEqual({ runId: 'r_0123456789ab', taskId: 'r_0123456789ab', taskVersion: 1, agentId: 'reviewer', version: 2, state: 'running' });
    expect(out.app[1]!.run).toEqual({ runId: 'r_ba9876543210', taskId: 'r_ba9876543210', taskVersion: 1, agentId: 'reviewer', version: 2, state: 'ended' });
    expect(out.app[2]!.run).toBeUndefined();
  });
  it('a feedback\'s runId says where the id comes from', () => {
    expect(AGENT_FEEDBACK_SCHEMA.properties.runId.description).toMatch(/runId\) from agent_children, not the chat id/);
  });
});

describe('a runId that names no run gets an actionable error', () => {
  const runs = [run()];
  const chat = (id: string) => [{ id: 'c_work000001', run: runs[0] }, { id: 'c_cb79813eb5' }].find(c => c.id === id);
  it('a chat id of an agent chat names its runId', () => {
    const e = unknownRunError('c_work000001', runs, chat).message;
    expect(e).toContain('c_work000001 is a chat id, not a run id');
    expect(e).toContain('runId "r_0123456789ab"');
  });
  it('a chat id found only in the run store (chat forgotten) still names its runId', () => {
    expect(unknownRunError('c_work000001', runs, () => undefined).message).toContain('runId "r_0123456789ab"');
  });
  it('a chat without a run is not an agent run', () => {
    expect(unknownRunError('c_cb79813eb5', runs, chat).message).toBe('chat c_cb79813eb5 is not an agent run (plain chat or Orchestrator): feedback only applies to runs of catalog agents.');
  });
  it('anything else: no run, maybe pruned', () => {
    expect(unknownRunError('r_ffffffffffff', runs, chat).message).toBe('no agent run with id r_ffffffffffff (it may have been pruned): use the runId listed by app_chats.');
  });
});

describe('reported case: a feedback names a chat id instead of a run id', () => {
  function wired() {
    const userData = tmp(), now = Date.now();
    const catalog = new AgentCatalogService({ userData, models: () => [], now: () => now });
    const runs = new AgentRunStore(userData);
    const work = runs.start({ agentId: 'scout', chatId: 'c_work000001', version: 1, goal: 'Review', startedBy: 'orchestrator', startedAt: now, costKnown: true });
    const chats = [{ id: 'c_work000001', run: work }, { id: 'c_cb79813eb5' }];
    const chat = (id: string) => chats.find(c => c.id === id);
    const feedback = new RunFeedback({ userData, catalog, runs, publish: () => {}, send: async () => undefined, chat, now: () => now });
    return { feedback, work };
  }
  it('names the run to use instead of a bare "Unknown run."', async () => {
    const { feedback, work } = wired();
    const args = (runId: string) => ({ runId, verdict: 'partial' as const, notes: 'Missed the tests', evidence: [] });
    await expect(feedback.recordFeedback(args('c_work000001'), 'c_cb79813eb5')).rejects.toThrow(`runId "${work.runId}"`);
    await expect(feedback.recordFeedback(args('c_cb79813eb5'), 'c_cb79813eb5')).rejects.toThrow(/c_cb79813eb5 is not an agent run/);
    // the runId itself works: a chat id is never silently accepted as one
    await expect(feedback.recordFeedback(args(work.runId), 'c_cb79813eb5')).resolves.toMatchObject({ runId: work.runId, agentId: 'scout' });
    await expect(feedback.recordFeedback({ runId: 'r_ffffffffffff', verdict: 'fail', notes: 'x', evidence: [] }, 'c_cb79813eb5')).rejects.toThrow(/may have been pruned/);
  });
});
