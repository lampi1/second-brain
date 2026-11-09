// The recall check (ADR 0235): cases from facts written by recorded runs, words vs words + meaning, the card's states,
// and that nothing is written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRun } from '../../src/shared/agents';
import { proposeMemory, type MemoryRecord } from '../../src/main/rules/memory-records';
import { MIN_CASES, RecallCheck, evaluateRecall, factText, rankHybrid, recallCases } from '../../src/main/rules/recall-check';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const run = (runId: string, goal: string): AgentRun => ({ runId, chatId: `c_${runId}`, agentId: 'artisan', version: 1, goal, startedBy: 'user', startedAt: 0, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null });
const runId = (i: number) => `r_${String(i).padStart(12, '0')}`;

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-check-')); roots.push(root);
  const add = (value: string, sourceRunId: string, roleId = 'artisan') => proposeMemory(root, { scope: { roleId }, subject: 'procedure', predicate: 'always', value, sourceEventId: `memory-proposal:${sourceRunId}`, sourceRunId }, '2026-01-01T00:00:00Z');
  return { root, add };
}
/** A toy embedding: one dimension per topic word, so «database» in Italian and English point the same way. */
const TOPICS = [['database', 'banca', 'dati'], ['fatture', 'invoices'], ['deploy', 'rilascio'], ['test', 'prove']];
const toy = (text: string): Float32Array => {
  const t = text.toLowerCase(), v = new Float32Array(TOPICS.length);
  TOPICS.forEach((ws, i) => { if (ws.some(w => t.includes(w))) v[i] = 1; });
  const n = Math.hypot(...v); if (n) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
};

describe('recall cases', () => {
  it('takes one case per launchable fact written by a known run, in its own scope', () => {
    const w = world();
    w.add('Run the migration runner before database changes.', runId(1));
    w.add('Export invoices with the accounting workbook.', runId(2), 'scout');
    w.add('A fact from a run the app does not know.', runId(3));
    const { cases, pools } = recallCases(JSON.parse(fs.readFileSync(path.join(w.root, 'memory/records.json'), 'utf8')), [run(runId(1), 'Change the database schema'), run(runId(2), 'Send the invoices')]);
    expect(cases.map(c => c.runId).sort()).toEqual([runId(1), runId(2)]);
    expect(pools.size).toBe(2);
  });
});

describe('words vs words + meaning', () => {
  const facts = (w: ReturnType<typeof world>) => [
    w.add('Run the migration runner before database changes.', runId(1)),
    w.add('Export invoices with the accounting workbook.', runId(2)),
    w.add('Deploy only after the release checklist.', runId(3)),
  ];
  it('finds by meaning a fact the goal names in another language, and words alone miss it', () => {
    const w = world(), [db] = facts(w);
    const goal = 'Modifica lo schema della banca dati';
    const ids = rankHybrid([db!], goal, toy(goal), r => toy(factText(r)));
    expect(ids).toEqual([db!.memoryId]);
    const r = evaluateRecall([{ fact: db!, goal, runId: runId(1) }], new Map<string, MemoryRecord[]>([[JSON.stringify(['artisan', '', '', '', '']), [db!]]]), f => toy(factText(f)), c => toy(c.goal));
    expect(r).toMatchObject({ n: 1, words: 0, hybrid: 1, onlyHybrid: 1, onlyWords: 0 });
    expect(r.missed[0]).toMatchObject({ goal, role: 'artisan' });
  });
  it('without vectors the fused ranking is the words ranking', () => {
    const w = world(), all = facts(w);
    expect(rankHybrid(all, 'database migration runner', null, () => null)).toEqual([all[0]!.memoryId]);
  });
});

describe('RecallCheck', () => {
  const setup = (n: number, ready = true) => {
    const w = world(), runs: AgentRun[] = [];
    for (let i = 1; i <= n; i++) { w.add(`Topic ${i}: database step ${i} uses the migration runner.`, runId(i)); runs.push(run(runId(i), `Lavoro sulla banca dati, passo ${i}`)); }
    const file = path.join(w.root, 'memory/records.json'), before = fs.readFileSync(file, 'utf8');
    let calls = 0;
    const check = new RecallCheck({ root: () => w.root, runs: () => runs, ready: () => ready, pause: async () => {}, now: () => 1000,
      embed: async texts => { calls++; return texts.map(toy); } });
    return { check, file, before, calls: () => calls };
  };
  it('says too few under MIN_CASES cases', async () => {
    const { check } = setup(MIN_CASES - 1);
    expect(await check.state(true)).toMatchObject({ state: 'few', n: MIN_CASES - 1, words: null });
  });
  it('without a brain says too few', async () => {
    const check = new RecallCheck({ root: () => null, runs: () => [], ready: () => true, embed: async () => null });
    expect((await check.state(true)).state).toBe('few');
  });
  it('without the model gives the words side only', async () => {
    const { check } = setup(MIN_CASES, false);
    const card = await check.state();
    expect(card.state).toBe('no-model'); expect(card.words).not.toBeNull(); expect(card.hybrid).toBeNull();
  });
  it('is busy at first, then ready, cached, and writes nothing', async () => {
    const s = setup(MIN_CASES + 1);
    expect((await s.check.state()).state).toBe('busy');
    const card = await s.check.state(true);
    expect(card).toMatchObject({ state: 'ready', n: MIN_CASES + 1, k: 8 });
    expect(card.hybrid).toBeGreaterThanOrEqual(card.words!);
    const calls = s.calls();
    expect((await s.check.state()).state).toBe('ready');
    expect(s.calls()).toBe(calls);
    expect(fs.readFileSync(s.file, 'utf8')).toBe(s.before);
  });
});
