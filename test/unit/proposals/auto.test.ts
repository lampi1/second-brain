// The Proposte deck applying the obvious cards by itself (ADR 0193): a card of a group the ledger says the user always
// approves goes through its source's own decide exactly once, is logged and journaled, leaves the deck and shows in
// «Applicate da sole» with Annulla (the change log's rollback, which counts as a no); the others carry their reason;
// a user's decision records its time from first shown; never-auto groups stay asked whatever the history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
vi.mock('../../../src/main/log', () => ({ log: { info: (...a: unknown[]) => { logged.info.push(a); }, warn: vi.fn() }, errText: (e: unknown) => String(e instanceof Error ? e.message : e) }));
import { ProposalsService } from '../../../src/main/proposals/service';
import { LEDGER_FILE, readLedger, type DecisionEntry } from '../../../src/main/proposals/ledger';
import type { ProposalPorts, Source } from '../../../src/main/proposals/sources';
import type { Proposal, ProposalGroup, ProposalSource } from '../../../src/shared/proposals';

const NOW = Date.parse('2026-10-29T10:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auto-'));
function seed(dir: string, group: ProposalGroup, n: number, decision: 'approve' | 'reject' = 'approve'): string {
  const entries: DecisionEntry[] = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, card: `research:s${i}`, at: NOW - 86_400_000 + i, source: 'research', group, ask: 'research',
    applied: false, reversible: true, evidence: false, size: 10, decision, by: 'user', title: `old ${i}` }));
  fs.writeFileSync(path.join(dir, LEDGER_FILE), JSON.stringify({ version: 1, entries }));
  return dir;
}
const card = (id: string, source: ProposalSource, group: ProposalGroup, x: Partial<Proposal> = {}): Proposal => ({
  id: `${source}:${id}`, source, group, applied: false, title: `Carta ${id}`, content: 'una regola utile',
  ask: { kind: 'research', finding: 'rule', adds: 'a', removes: '', why: 'w', expected: '', risk: '', evidence: [], sources: [] },
  facts: [], provenance: { who: { kind: 'maintenance', id: 'research' }, at: new Date(NOW - 60_000).toISOString(), evidence: [] }, canApprove: true, canReject: true, ...x,
});
/** A source with given cards; decide removes the card and answers a change id. */
function fake(id: ProposalSource, cards: Proposal[]) {
  let open = [...cards];
  const decide = vi.fn(async (_p: ProposalPorts, c: Proposal) => { open = open.filter(x => x.id !== c.id); return [`ch-${c.id}`]; });
  const src: Source = { id, available: () => true, list: async () => open.map(c => structuredClone(c)), decide };
  return { src, decide };
}
function ports() {
  const rolled: string[] = [];
  let undone = new Set<string>();
  const p: Omit<ProposalPorts, 'reviewed'> = {
    now: () => NOW, runs: () => [], chats: () => [],
    changes: { list: () => ['ch-research:r1'].map(id => ({ id, canRollback: !undone.has(id) })) as never, stored: () => [], rollback: id => { rolled.push(id); undone = new Set([...undone, id]); } },
  };
  return { p, rolled };
}

describe('ProposalsService auto-apply (ADR 0193)', () => {
  it('applies an obvious card through source.decide once, logs it, journals it and lists it with Annulla', async () => {
    const dir = seed(tmp(), 'rule', 60);
    const { src, decide } = fake('research', [card('r1', 'research', 'rule')]);
    const record = vi.fn();
    const { p, rolled } = ports();
    const s = new ProposalsService({ ports: p, userData: dir, sources: [src], record });
    const state = await s.list();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]!.slice(1)).toEqual([expect.objectContaining({ id: 'research:r1' }), 'approve', undefined, undefined]);
    expect(state.items).toEqual([]);
    expect(state.saved).toBe(1);
    expect(state.auto).toEqual([expect.objectContaining({ card: 'research:r1', group: 'rule', title: 'Carta r1', canUndo: true })]);
    expect(logged.info.some(a => a[0] === 'proposals' && a[1] === 'auto-applied' && (a[2] as { data: { group: string; source: string; reason: string } }).data.group === 'rule'
      && (a[2] as { data: { reason: string } }).data.reason.startsWith('rule: auto'))).toBe(true);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'brain', title: 'Proposta applicata da sola: Carta r1' }));
    const e = readLedger(dir).at(-1)!;
    expect(e).toMatchObject({ card: 'research:r1', by: 'auto', decision: 'approve', changes: ['ch-research:r1'], reversible: true });
    // a second read applies nothing again
    await s.list();
    expect(decide).toHaveBeenCalledTimes(1);
    // Annulla: the change log's rollback; the entry counts as a no from now on
    const undone = await s.undoAuto({ id: e.id });
    expect(undone.ok).toBe(true);
    expect(rolled).toEqual(['ch-research:r1']);
    expect(readLedger(dir).at(-1)!.undoneAt).toBe(NOW);
    expect(undone.state.auto?.[0]).toMatchObject({ undoneAt: NOW, canUndo: false });
    expect(undone.state.saved).toBe(0);
    expect((await s.undoAuto({ id: e.id })).ok).toBe(false);
    expect((await s.undoAuto({ id: 's1' })).ok).toBe(false); // a user's decision is no auto card
  });

  it('a rollback from anywhere marks the approval undone (changeUndone)', async () => {
    const dir = seed(tmp(), 'rule', 60);
    const { src } = fake('research', [card('r1', 'research', 'rule')]);
    const s = new ProposalsService({ ports: ports().p, userData: dir, sources: [src], record: () => {} });
    await s.list();
    s.changeUndone('ch-research:r1');
    expect(readLedger(dir).at(-1)).toMatchObject({ by: 'auto', undoneAt: NOW });
    s.stop();
  });

  it('asks while the ledger is short, and says why; never a preselected answer', async () => {
    const dir = seed(tmp(), 'rule', 9);
    const { src, decide } = fake('research', [card('r1', 'research', 'rule')]);
    const s = new ProposalsService({ ports: ports().p, userData: dir, sources: [src], record: () => {} });
    const { items, auto, saved } = await s.list();
    expect(decide).not.toHaveBeenCalled();
    expect(items[0]!.why).toEqual({ code: 'few', n: 9 });
    expect(auto).toEqual([]);
    expect(saved).toBe(0);
  });

  it('never applies a never-auto card, whatever the history', async () => {
    const dir = seed(tmp(), 'setting', 200);
    const { src, decide } = fake('setting', [card('s1', 'setting', 'setting', { ask: { kind: 'setting', label: 'Budget', before: '1', after: '2' } })]);
    const s = new ProposalsService({ ports: ports().p, userData: dir, sources: [src], record: () => {} });
    const { items } = await s.list();
    expect(decide).not.toHaveBeenCalled();
    expect(items[0]!.why).toEqual({ code: 'never', what: 'setting' });
  });

  it('a failed automatic approval leaves the card to the user and is not retried', async () => {
    const dir = seed(tmp(), 'rule', 60);
    const decide = vi.fn(async () => { throw new Error('file changed'); });
    const c = card('r1', 'research', 'rule');
    const src: Source = { id: 'research', available: () => true, list: async () => [structuredClone(c)], decide };
    const s = new ProposalsService({ ports: ports().p, userData: dir, sources: [src], record: () => {} });
    expect((await s.list()).items[0]!.why).toEqual({ code: 'blocked' });
    await s.list();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('a user decision records its time from first shown, its changes and the card\'s traits', async () => {
    const dir = tmp();
    let now = NOW;
    const { src } = fake('research', [card('r1', 'research', 'rule', { content: 'abc', evidenceRuns: ['r_1'] })]);
    const s = new ProposalsService({ ports: { ...ports().p, now: () => now }, userData: dir, sources: [src], record: () => {} });
    await s.list();
    s.shown('research:r1');
    now += 4_500;
    s.shown('research:r1'); // the first time counts
    now += 500;
    expect((await s.decide({ id: 'research:r1', decision: 'reject' })).ok).toBe(true);
    expect(readLedger(dir)).toEqual([expect.objectContaining({ card: 'research:r1', by: 'user', decision: 'reject', ms: 5_000, group: 'rule', ask: 'research', evidence: true, size: 3, reversible: true, applied: false })]);
  });
});
