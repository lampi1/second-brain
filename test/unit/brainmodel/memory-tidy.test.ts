// The maintenance's memory tidy-up (ADR 0129, 0149): near-duplicate proposals merged, a proposal already confirmed retired,
// case-specific facts rewritten as the rule behind them (a still-specific rewrite or "drop" retires them), the facts left
// saved with no card (a newer value replacing the confirmed one it contradicts), at most MEMORY_CAP confirmed facts per
// role (the least recent pruned), one logged change per role with its undo; the undo puts the store back and a fact the
// user undid is never touched again; without an engine case-specific facts wait.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog, type AgentRestorer } from '../../../src/main/brainmodel/changes';
import { MEMORY_CAP, parseTidy, tidyMemoryJob } from '../../../src/main/brainmodel/memory-tidy';
import type { JobContext } from '../../../src/main/brainmodel/jobs';
import type { UpgradeAsk } from '../../../src/main/brainmodel/upgrade';
import { canUndoMemoryTidy, readMemoryRecords, retractMemory, tidyMemory, undoMemoryTidy, type MemoryRecord } from '../../../src/main/rules/memory-records';

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
/** minutes after 2026-10-01, as the store writes times */
const t = (min: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + min * 60_000).toISOString();
/** a fact confirmed at a given minute (proposed a minute before), with its verification */
const confirmedAt = (min: number, f: Partial<MemoryRecord> = {}): Partial<MemoryRecord> => ({ status: 'confirmed', observedAt: t(min - 1), validFrom: t(min - 1),
  transitions: [{ at: t(min - 1), status: 'proposed' }, { at: t(min), status: 'confirmed' }], verification: { sourceEventId: `h${min}`, sourceRunId: `h${min}`, evidence: 'ok' }, ...f });
const proposedAt = (min: number, f: Partial<MemoryRecord> = {}): Partial<MemoryRecord> => ({ observedAt: t(min), validFrom: t(min), transitions: [{ at: t(min), status: 'proposed' }], ...f });
/** distinct general facts, no digits (never two of one thing, never case-specific) */
const word = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26));
const auto = (r: MemoryRecord | undefined) => r?.status === 'confirmed' && /^tidy-[0-9a-f]+:auto$/.test(r.transitions?.at(-1)?.reason ?? '');

describe('tidyMemoryJob', () => {
  it('keeps different numeric claims, negation and fact subjects apart, and saves them with no card', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [
      { value: 'The server restarts every night at 6', status: 'confirmed' },
      { value: 'The server restarts every night at 7' },
      { value: 'The server never restarts every night at 6' },
      { value: 'The server restarts every night at 6', subject: 'database' },
    ]);
    const before = readMemoryRecords(root);
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 1 });
    const rows = byId(root);
    expect(rows.get('f0')).toEqual(before[0]); // free notes are separate facts: nothing replaced, nothing merged
    for (const id of ['f1', 'f2', 'f3']) expect(auto(rows.get(id))).toBe(true);
    expect(log.all()[0]!.summary).toMatch(/Artisan: 3 fatti salvati$/);
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 0 });
  });
  it('merges, generalizes, drops and saves in one logged change per role, and the undo puts everything back', async () => {
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
    expect(r).toMatchObject({ job: 'merge-memory', changes: 2 });
    expect(JSON.parse(prompts[0]!).items.map((x: { fact: string }) => x.fact)).toEqual([expect.stringContaining('localhost:44309'), 'Il bug era il work item 48213']);
    const rows = byId(root);
    expect(rows.get('f0')).toMatchObject({ status: 'retracted' });
    expect(rows.get('f1')).toMatchObject({ status: 'retracted' });
    expect(rows.get('f2')).toMatchObject({ status: 'retracted' }); // merged into the newer twin
    expect(auto(rows.get('f3'))).toBe(true); // the twin left: saved
    expect(rows.get('f5')).toMatchObject({ status: 'retracted' }); // already confirmed
    expect(auto(rows.get('f6'))).toBe(true); // another role: saved in its own change
    const general = [...rows.values()].find(x => x.value.startsWith('After login'))!;
    expect(general).toMatchObject({ status: 'proposed', scope: { roleId: 'artisan' }, validTo: null }); // written now: saved by the next pass
    const change = log.all().find(c => c.target === 'agents/artisan/memory.md')!, scout = log.all().find(c => c.target === 'agents/scout/memory.md')!;
    expect(change).toMatchObject({ job: 'merge-memory', kind: 'memory', summary: expect.stringMatching(/Artisan: 1 fatto reso generale, 2 doppioni uniti, 1 fatto legato a un caso tolto, 1 fatto salvato$/) });
    expect(change.evidence.join('\n')).toMatch(/localhost:44309.*→.*launch profile/);
    expect(change.evidence.join('\n')).toMatch(/salvato: «Il server di test/);
    expect(change.memory).toMatchObject({ confirmed: ['f3'] });
    expect(scout).toMatchObject({ summary: expect.stringMatching(/scout: 1 fatto salvato$/), memory: { confirmed: ['f6'] } });
    // the undo puts the store back: the new fact goes, the saved ones are proposals again
    for (const c of [change, scout]) { expect(log.canRollback(c, restorer(root))).toBe(true); log.rollback(c.id, restorer(root)); }
    expect(readMemoryRecords(root)).toEqual(JSON.parse(before));
    // a fact the user undid is never touched again; nothing new to do
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 0 });
    expect(byId(root).get('f3')).toMatchObject({ status: 'proposed' });
  });
  it('no engine: a case-specific fact waits (never saved), the rest is merged and saved; a still-specific rewrite drops it', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'Deploy fatto dal ramo feat/x il 2026-10-20' }, { value: 'Il server di test si riavvia ogni notte alle 6' }, { value: 'Il server di test si riavvia ogni notte alle 6' }]);
    const none = await tidyMemoryJob(ctx(root, log));
    expect(none).toMatchObject({ changes: 1, note: expect.stringMatching(/1 fatti legati a un caso aspettano un motore/) });
    expect(byId(root).get('f0')).toMatchObject({ status: 'proposed', transitions: [{ status: 'proposed' }] });
    expect(log.all()[0]!.memory?.confirmed).toHaveLength(1);
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 0 }); // still waiting
    const ask: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Il deploy parte dal ramo feat/x il 2026-10-20"}]}' });
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 1 });
    expect(byId(root).get('f0')!.status).toBe('retracted');
  });
  it('a change made since blocks the undo', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'Il server di test si riavvia ogni notte alle 6' }, { value: 'Il server di test si riavvia ogni notte alle 6' }]);
    await tidyMemoryJob(ctx(root, log));
    const change = log.all()[0]!, kept = readMemoryRecords(root).find(r => r.status === 'confirmed')!;
    expect(log.canRollback(change, restorer(root))).toBe(true);
    // a restorer without a memory side cannot undo it
    expect(log.canRollback(change, { activeVersion: () => null, restore: () => {} })).toBe(false);
    // the user retracts the saved one: the pass can no longer be undone
    retractMemory(root, kept.memoryId, 'not true any more', '2026-10-22T10:00:00.000Z');
    expect(log.canRollback(change, restorer(root))).toBe(false);
  });
  it('a generalized confirmed fact stays until a later pass saves its rewrite, which then replaces it', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'App locale su http://localhost:44309', status: 'confirmed', verification: { sourceEventId: 'h', sourceRunId: 'h', evidence: 'ok' } }]);
    const original = readMemoryRecords(root)[0]!;
    const ask: UpgradeAsk = async () => ({ ok: true, text: '{"items":[{"id":"m1","keep":"Dopo il login l’app locale gira su una porta diversa da quella di default: leggila dal profilo di avvio"}]}' });
    await tidyMemoryJob(ctx(root, log, ask));
    let rows = readMemoryRecords(root);
    const replacement = rows.find(r => r.memoryId !== original.memoryId)!;
    expect(rows.find(r => r.memoryId === original.memoryId)).toEqual(original);
    expect(replacement).toMatchObject({ status: 'proposed', supersedes: original.memoryId, validTo: null });
    expect(replacement.verification).toBeUndefined();
    expect(replacement.transitions).toEqual([{ at: new Date(NOW).toISOString(), status: 'proposed', reason: expect.stringContaining(`generalized-from:${original.memoryId}`) }]);
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 1 });
    rows = readMemoryRecords(root);
    expect(rows.find(r => r.memoryId === original.memoryId)).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(`:replaced:${replacement.memoryId}$`) })]) });
    expect(auto(rows.find(r => r.memoryId === replacement.memoryId))).toBe(true);
    expect(await tidyMemoryJob(ctx(root, log, ask))).toMatchObject({ changes: 0 });
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
  it('a newer value replaces the confirmed one it contradicts; an older one, or one of two waiting together, is merged instead', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    const port = { subject: 'local app', predicate: 'runs on port' };
    store(root, [
      confirmedAt(10, { ...port, value: 'six' }),
      proposedAt(5, { ...port, value: 'seven' }), // older than the confirmation: merged into it, never in its place
      proposedAt(20, { ...port, value: 'eight' }),
      proposedAt(30, { ...port, value: 'nine' }), // the most recent: saved, replacing «six»
      proposedAt(1, { ...port, value: 'ten', scope: { roleId: 'scout' } }), proposedAt(2, { ...port, value: 'eleven', scope: { roleId: 'scout' } }),
    ]);
    const before = fs.readFileSync(path.join(root, 'memory/records.json'), 'utf8');
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 2 });
    const rows = byId(root);
    expect(rows.get('f0')).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(/:replaced:f3$/) })]) });
    expect(rows.get('f1')).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(/:merged:f0$/) })]) });
    expect(rows.get('f2')).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(/:merged:f3$/) })]) });
    expect(auto(rows.get('f3'))).toBe(true);
    expect(rows.get('f4')).toMatchObject({ status: 'retracted' });
    expect(auto(rows.get('f5'))).toBe(true);
    // never two confirmed values of one thing
    expect([...rows.values()].filter(r => r.status === 'confirmed' && r.scope.roleId === 'artisan').map(r => r.value)).toEqual(['nine']);
    for (const c of log.all()) log.rollback(c.id, restorer(root));
    expect(readMemoryRecords(root)).toEqual(JSON.parse(before));
  });
  it(`keeps at most ${MEMORY_CAP} confirmed facts per role, pruning the least recently confirmed; the undo brings them back`, async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    const facts = Array.from({ length: MEMORY_CAP + 1 }, (_, i) => confirmedAt(i + 10, { value: `Il modulo ${word(i)} tiene i file nella sua cartella` }));
    facts[0] = { ...facts[0], transitions: [{ at: t(9), status: 'proposed' }, { at: t(5000), status: 'confirmed' }] }; // written first, confirmed last: stays
    store(root, [...facts, proposedAt(6000, { value: 'Il modulo nuovo tiene i file nella sua cartella' }),
      confirmedAt(1, { value: 'Prima di un merge lancia i test', scope: { roleId: 'scout' } }), confirmedAt(2, { value: 'Le note vanno in docs', scope: { roleId: 'scout' } })]);
    const before = fs.readFileSync(path.join(root, 'memory/records.json'), 'utf8');
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 1 });
    const rows = byId(root), live = (role: string) => [...rows.values()].filter(r => r.status === 'confirmed' && r.scope.roleId === role);
    expect(live('artisan')).toHaveLength(MEMORY_CAP);
    expect(live('scout')).toHaveLength(2);
    expect(rows.get('f1')).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([expect.objectContaining({ reason: expect.stringMatching(`:cap:${MEMORY_CAP}$`) })]) });
    expect(rows.get('f2')).toMatchObject({ status: 'retracted' });
    expect(rows.get('f0')).toMatchObject({ status: 'confirmed' });
    expect(auto(rows.get(`f${MEMORY_CAP + 1}`))).toBe(true);
    const change = log.all()[0]!;
    expect(change.summary).toMatch(/Artisan: 1 fatto salvato, 2 fatti vecchi tolti$/);
    expect(change.evidence.join('\n')).toMatch(new RegExp(`tolto, oltre i ${MEMORY_CAP} fatti: «Il modulo ab`));
    log.rollback(change.id, restorer(root));
    expect(readMemoryRecords(root)).toEqual(JSON.parse(before));
  });
  it('skips the facts whose earlier change the user rolled back', async () => {
    const root = tmp(), log = new ChangeLog(tmp(), () => NOW);
    store(root, [{ value: 'I log stanno in logs/feedback' }]);
    await tidyMemoryJob(ctx(root, log));
    const change = log.all()[0]!;
    expect(change.memory).toMatchObject({ confirmed: ['f0'] });
    log.rollback(change.id, restorer(root));
    expect(log.all()[0]!.rolledBackAt).toBeTruthy();
    expect(byId(root).get('f0')).toMatchObject({ status: 'proposed' });
    expect(await tidyMemoryJob(ctx(root, log))).toMatchObject({ changes: 0 });
    expect(byId(root).get('f0')).toMatchObject({ status: 'proposed' });
  });
});

describe('tidyMemory', () => {
  it('confirm replaces the contradicted confirmed fact, prune retires one over the cap, the undo restores all', () => {
    const root = tmp();
    store(root, [
      confirmedAt(10, { subject: 'local app', predicate: 'runs on port', value: 'six' }),
      proposedAt(20, { subject: 'local app', predicate: 'runs on port', value: 'seven' }),
      confirmedAt(5, { value: 'Le note vanno in docs' }),
      proposedAt(30, { value: 'I log stanno in logs' }),
    ]);
    const before = readMemoryRecords(root), now = new Date(NOW).toISOString();
    const undo = tidyMemory(root, { retire: [], generalize: [], confirm: [{ id: 'f1', replaces: ['f0'] }, { id: 'f2', replaces: [] }],
      prune: [{ id: 'f2', reason: 'cap:40' }, { id: 'f1', reason: 'cap:40' }, { id: 'f3', reason: 'cap:40' }] }, 'tidy-x', now);
    // a confirmed fact is never "saved" again, a fact just saved is never pruned, a proposed one is never pruned
    expect(undo).toEqual({ tag: 'tidy-x', retired: ['f0', 'f2'], added: [], confirmed: ['f1'] });
    const rows = byId(root);
    expect(rows.get('f0')).toMatchObject({ status: 'retracted', validTo: now, transitions: expect.arrayContaining([{ at: now, status: 'retracted', reason: 'tidy-x:replaced:f1' }]) });
    expect(rows.get('f1')).toMatchObject({ status: 'confirmed', verification: { sourceEventId: 'tidy-x:auto', sourceRunId: 'maintenance:tidy-x' }, transitions: [{ status: 'proposed' }, { at: now, status: 'confirmed', reason: 'tidy-x:auto' }] });
    expect(rows.get('f2')).toMatchObject({ status: 'retracted', transitions: expect.arrayContaining([{ at: now, status: 'retracted', reason: 'tidy-x:cap:40' }]) });
    expect(rows.get('f3')).toEqual(before[3]);
    expect(canUndoMemoryTidy(root, undo)).toBe(true);
    undoMemoryTidy(root, undo);
    expect(readMemoryRecords(root)).toEqual(before);
    expect(canUndoMemoryTidy(root, undo)).toBe(false);
  });
  it('a saved fact the user changed since blocks the undo', () => {
    const root = tmp();
    store(root, [proposedAt(20, { value: 'I log stanno in logs' })]);
    const undo = tidyMemory(root, { retire: [], generalize: [], confirm: [{ id: 'f0', replaces: [] }] }, 'tidy-y', new Date(NOW).toISOString());
    retractMemory(root, 'f0', 'wrong', '2026-10-22T10:00:00.000Z');
    expect(canUndoMemoryTidy(root, undo)).toBe(false);
    expect(() => undoMemoryTidy(root, undo)).toThrow(/no longer be undone/);
  });
});

describe('parseTidy', () => {
  it('keeps the asked ids only, one line each; a missing id is not answered', () => {
    const m = parseTidy('ecco: {"items":[{"id":"m1","keep":"Regola\\nsu due righe"},{"id":"m9","drop":true},{"id":"m2","drop":true},{"id":"m1","drop":true}]}', ['m1', 'm2', 'm3']);
    expect([...m!.entries()]).toEqual([['m1', 'Regola su due righe'], ['m2', null]]);
    expect(parseTidy('non so', ['m1'])).toBeNull();
  });
});
