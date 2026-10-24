// The maintenance's memory tidy-up (ADR 0129): near-duplicate proposals merged, a proposal already confirmed retired,
// case-specific facts rewritten as the rule behind them (a still-specific rewrite or "drop" retires them), one logged
// change per role with its undo; the undo puts the store back and a fact the user undid is never touched again; without
// an engine only the merges run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog, type AgentRestorer } from '../../../src/main/brainmodel/changes';
import { parseTidy, tidyMemoryJob } from '../../../src/main/brainmodel/memory-tidy';
import type { JobContext } from '../../../src/main/brainmodel/jobs';
import type { UpgradeAsk } from '../../../src/main/brainmodel/upgrade';
import { canUndoMemoryTidy, confirmMemory, readMemoryRecords, retractMemory, tidyMemory, undoMemoryTidy, type MemoryRecord } from '../../../src/main/rules/memory-records';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const NOW = Date.parse('2026-10-22T09:00:00Z');
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tidy-'))); dirs.push(d); return d; };

/** A store with facts written as they are (old facts predate the gate: written straight to the file). */
function store(root: string, facts: Partial<MemoryRecord>[]): void {
  const at = '2026-10-20T08:00:00.000Z';
  const rows = facts.map((f, i) => ({ memoryId: `f${i}`, scope: { roleId: 'artisan' }, subject: 'setup', predicate: 'note', value: '', sourceEventId: `e${i}`, sourceRunId: `r${i}`,
    observedAt: at, validFrom: at, validTo: null, status: 'proposed', supersedes: null, transitions: [{ at, status: 'proposed' }], ...f }));
  fs.mkdirSync(path.join(root, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, 'memory/records.json'), JSON.stringify(rows, null, 2));
}
function ctx(root: string, log: ChangeLog, ask?: UpgradeAsk): JobContext {
  return { root, skillDir: path.join(root, '.claude/skills'), skills: () => [], profiles: () => [{ id: 'artisan', name: 'Artisan' }] as never, runs: () => [],
    lessons: { pending: () => [], settle: () => {} }, agents: { update: () => null }, log, now: () => NOW, ...(ask ? { ask } : {}) };
}
const restorer = (root: string): AgentRestorer => ({ activeVersion: () => null, restore: () => {}, memory: { canUndo: u => canUndoMemoryTidy(root, u), undo: u => undoMemoryTidy(root, u) } });
const byId = (root: string) => new Map(readMemoryRecords(root).map(r => [r.memoryId, r]));

describe('tidyMemoryJob', () => {
  it('leaves different numeric claims, negation and fact subjects for review', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [
      { value: 'The server restarts every night at 6', status: 'confirmed' },
      { value: 'The server restarts every night at 7' },
      { value: 'The server never restarts every night at 6' },
      { value: 'The server restarts every night at 6', subject: 'database' },
    ]);
    const before = readMemoryRecords(root);
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 0 });
    expect(readMemoryRecords(root)).toEqual(before);
  });
  it('merges, generalizes and drops in one logged change per role, and the undo puts everything back', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [
      { value: 'Statistiche prestazioni locally: https://localhost:44309/stats (after login ExampleApp runs on 44309, not 44319)' },
      { value: 'Il bug era il work item 48213' },
      { value: 'Il server di test si riavvia ogni notte alle 6' },
      { value: 'Il server di test si riavvia ogni notte alle 6', observedAt: '2026-10-21T08:00:00.000Z' },
      { value: 'I log stanno in logs/feedback', status: 'confirmed' },
      { value: 'I log stanno in logs/feedback' },
      { value: 'Prima di un merge lancia i test', scope: { roleId: 'scout' } },
    ]);
    const before = fs.readFileSync(path.join(root, 'memory/records.json'), 'utf8');
    const prompts: string[] = [];
    const ask: UpgradeAsk = async (system, prompt) => {
      prompts.push(prompt); expect(system).toMatch(/general, reusable knowledge/);
      return { ok: true, text: JSON.stringify({ items: [{ id: 'm1', keep: 'After login the local app runs on a port other than the default: read it from the launch profile' }, { id: 'm2', drop: true }] }) };
    };
    const r = await tidyMemoryJob(ctx(root, log, ask));
    expect(r).toMatchObject({ job: 'merge-memory', changes: 1 });
    expect(JSON.parse(prompts[0]!).items.map((x: { fact: string }) => x.fact)).toEqual([expect.stringContaining('localhost:44309'), 'Il bug era il work item 48213']);
    const rows = byId(root);
    expect(rows.get('f0')).toMatchObject({ status: 'retracted' });
    expect(rows.get('f1')).toMatchObject({ status: 'retracted' });
    expect(rows.get('f2')).toMatchObject({ status: 'retracted' }); // merged into the newer twin
    expect(rows.get('f3')).toMatchObject({ status: 'proposed' });
    expect(rows.get('f5')).toMatchObject({ status: 'retracted' }); // already confirmed
    expect(rows.get('f6')).toMatchObject({ status: 'proposed' }); // another role, nothing to do
    const general = [...rows.values()].find(x => x.value.startsWith('After login'))!;
    expect(general).toMatchObject({ status: 'proposed', scope: { roleId: 'artisan' }, validTo: null });
    const change = log.all()[0]!;
    expect(change).toMatchObject({ job: 'merge-memory', kind: 'memory', target: 'agents/artisan/memory.md', summary: expect.stringMatching(/Artisan: 1 fatto reso generale, 2 doppioni uniti, 1 fatto legato a un caso tolto/) });
    expect(change.evidence.join('\n')).toMatch(/localhost:44309.*→.*launch profile/);
    // the undo puts the store back, the new fact goes
    expect(log.canRollback(change, restorer(root))).toBe(true);
    log.rollback(change.id, restorer(root));
    expect(readMemoryRecords(root)).toEqual(JSON.parse(before));
    // a fact the user undid is never touched again; nothing new to do
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 0 });
  });
  it('a rewrite that is still case-specific drops the fact; no engine: only the merges, with a note', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'Deploy fatto dal ramo feat/x il 2026-10-20' }, { value: 'Il server di test si riavvia ogni notte alle 6' }, { value: 'Il server di test si riavvia ogni notte alle 6' }]);
    const none = await tidyMemoryJob(ctx(root, log));
    expect(none).toMatchObject({ changes: 1, note: expect.stringMatching(/1 fatti legati a un caso aspettano un motore/) });
    expect(byId(root).get('f0')!.status).toBe('proposed');
    const ask: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Il deploy parte dal ramo feat/x il 2026-10-20"}]}' });
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 1 });
    expect(byId(root).get('f0')!.status).toBe('retracted');
  });
  it('a change made since blocks the undo', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'Il server di test si riavvia ogni notte alle 6' }, { value: 'Il server di test si riavvia ogni notte alle 6' }]);
    await tidyMemoryJob(ctx(root, log));
    const change = log.all()[0]!, kept = readMemoryRecords(root).find(r => r.status === 'proposed')!;
    expect(log.canRollback(change, restorer(root))).toBe(true);
    // the user confirms the kept one: the merged one can still come back (its own record is unchanged)
    confirmMemory(root, kept.memoryId, { sourceEventId: 'h', sourceRunId: 'h', evidence: 'ok' }, '2026-10-22T10:00:00.000Z');
    expect(log.canRollback(change, restorer(root))).toBe(true);
    // a restorer without a memory side cannot undo it
    expect(log.canRollback(change, { activeVersion: () => null, restore: () => {} })).toBe(false);
  });
  it('generalized confirmed facts remain unchanged until a separately reviewed replacement is approved', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'App locale su http://localhost:44309', status: 'confirmed', verification: { sourceEventId: 'h', sourceRunId: 'h', evidence: 'ok' } }]);
    const original = readMemoryRecords(root)[0]!;
    const ask: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Dopo il login l’app locale gira su una porta diversa da quella di default: leggila dal profilo di avvio"}]}' });
    await tidyMemoryJob(ctx(root, log, ask));
    const rows = readMemoryRecords(root), replacement = rows.find(r => r.memoryId !== original.memoryId)!;
    expect(rows.find(r => r.memoryId === original.memoryId)).toEqual(original);
    expect(replacement).toMatchObject({ status: 'proposed', supersedes: original.memoryId, validTo: null });
    expect(replacement.verification).toBeUndefined();
    expect(replacement.transitions).toEqual([{ at: new Date(NOW).toISOString(), status: 'proposed', reason: expect.stringContaining(`generalized-from:${original.memoryId}`) }]);
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 0 });
    confirmMemory(root, replacement.memoryId, { sourceEventId: 'review-new', sourceRunId: 'review-new', evidence: 'user checked replacement' }, '2026-10-22T10:00:00Z');
    expect(byId(root).get(original.memoryId)?.status).toBe('retracted');
    expect(byId(root).get(replacement.memoryId)?.status).toBe('confirmed');
  });
  it('undoing a proposed rewrite preserves the original and prevents repeated cleanup prompts', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'App locale su http://localhost:44309', status: 'confirmed', verification: { sourceEventId: 'h', sourceRunId: 'h', evidence: 'ok' } }]);
    const before = readMemoryRecords(root);
    const ask: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Read the local port from the launch profile"}]}' });
    await tidyMemoryJob(ctx(root, log, ask));
    const change = log.all()[0]!;
    expect(log.canRollback(change, restorer(root))).toBe(true);
    log.rollback(change.id, restorer(root));
    expect(readMemoryRecords(root)).toEqual(before);
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 0 });
  });
  it('never auto-retires approved records or re-proposes a dismissed replacement', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'App locale su http://localhost:44309', status: 'confirmed', verification: { sourceEventId: 'h', sourceRunId: 'h', evidence: 'ok' } }]);
    const before = readMemoryRecords(root);
    const drop: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","drop":true}]}' });
    expect(await tidyMemoryJob(ctx(root, log, drop))).toMatchObject({ changes: 0 });
    expect(tidyMemory(root, { retire: [{ id: 'f0', reason: 'not useful' }], generalize: [] }, 'tidy-test', new Date(NOW).toISOString())).toMatchObject({ retired: [], added: [] });
    expect(readMemoryRecords(root)).toEqual(before);
    const rewrite: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Read the local port from the launch profile"}]}' });
    await tidyMemoryJob(ctx(root, log, rewrite));
    const replacement = readMemoryRecords(root).find(r => r.supersedes === 'f0')!;
    retractMemory(root, replacement.memoryId, 'Rejected in Memoria → Proposte', '2026-10-22T10:00:00Z');
    expect(await tidyMemoryJob(ctx(root, log, rewrite))).toMatchObject({ changes: 0 });
    expect(readMemoryRecords(root)).toHaveLength(2);
    expect(byId(root).get('f0')).toEqual(before[0]);
  });
});

describe('parseTidy', () => {
  it('keeps the asked ids only, one line each; a missing id is not answered', () => {
    const m = parseTidy('ecco: {"items":[{"id":"m1","keep":"Regola\\nsu due righe"},{"id":"m9","drop":true},{"id":"m2","drop":true},{"id":"m1","drop":true}]}', ['m1', 'm2', 'm3']);
    expect([...m!.entries()]).toEqual([['m1', 'Regola su due righe'], ['m2', null]]);
    expect(parseTidy('non so', ['m1'])).toBeNull();
  });
});
