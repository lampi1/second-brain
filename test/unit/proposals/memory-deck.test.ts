// The memory cards of the Proposte deck (ADR 0128): near-duplicates are one card led by the best fact, a fact already
// confirmed with the same words is not shown, at most three cards per role and day (rules first, case-specific last),
// the rest one batch card; a contradiction always keeps its own card. Through the deck: a batch and a merged card decide
// every fact they hold.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() }, errText: (e: unknown) => String(e instanceof Error ? e.message : e) }));
import { memoryCards, MEMORY_CARDS_PER_DAY } from '../../../src/main/proposals/memory-deck';
import { ProposalsService } from '../../../src/main/proposals/service';
import type { MemoryReviewRecord } from '../../../src/shared/learning-review';

const DAY = '2026-10-20';
let n = 0;
const rec = (value: string, x: Partial<MemoryReviewRecord> = {}): MemoryReviewRecord => {
  const id = x.memoryId ?? `m${++n}`, at = x.observedAt ?? `${DAY}T0${n % 10}:00:00.000Z`;
  return { memoryId: id, scope: { roleId: 'artisan' }, subject: 'setup', predicate: 'note', value, sourceEventId: `ev-${id}`, sourceRunId: `run-${id}`, observedAt: at, validFrom: at, validTo: null, status: 'proposed', supersedes: null, ...x } as MemoryReviewRecord;
};

describe('memoryCards', () => {
  it('merges near-duplicates into one card led by the best fact', () => {
    const a = rec('Il server di test si riavvia ogni notte alle 6', { memoryId: 'a', observedAt: `${DAY}T01:00:00.000Z` });
    const b = rec('il server di test si riavvia ogni notte alle 6.', { memoryId: 'b', observedAt: `${DAY}T02:00:00.000Z` });
    const other = rec('I prompt per dopo stanno nella cartella prompts', { memoryId: 'c' });
    const cards = memoryCards([a, b, other]);
    expect(cards).toHaveLength(2);
    const one = cards.find(c => c.kind === 'one' && c.group.dups.length)!;
    expect(one.kind === 'one' && [one.group.rep.memoryId, one.group.dups.map(d => d.memoryId)]).toEqual(['b', ['a']]); // the newest leads
  });
  it('hides a fact already confirmed with the same words, keeps a contradiction alone', () => {
    const known = rec('I log sono in logs/feedback', { memoryId: 'k', status: 'confirmed' });
    const again = rec('i log sono in LOGS/feedback', { memoryId: 'again' });
    const contra = rec('nuovo valore', { memoryId: 'x', subject: 'App locale', predicate: 'usa la porta' });
    const old = rec('vecchio valore', { memoryId: 'o', subject: 'App locale', predicate: 'usa la porta', status: 'confirmed' });
    const cards = memoryCards([known, again, contra, old]);
    expect(cards.map(c => (c.kind === 'one' ? c.group.rep.memoryId : c.id))).toEqual(['x']);
    expect(cards[0]!.kind === 'one' && cards[0]!.group.conflicts.map(c => c.memoryId)).toEqual(['o']);
  });
  it('caps each role and day, rules first and case-specific last, the rest in one batch', () => {
    const facts = [
      rec('Il bug è il work item 48213', { memoryId: 'specific' }),
      rec('La cartella dei report è reports/mensili', { memoryId: 'plain1' }),
      rec('Prima di un merge lancia npm run check:branch', { memoryId: 'rule' }),
      rec('Il catalogo prodotti si aggiorna dal file prodotti.csv', { memoryId: 'plain2' }),
      rec('Le immagini del sito vanno in public/img', { memoryId: 'plain3' }),
      rec('Per la demo serve il profilo demo', { memoryId: 'other-day', observedAt: '2026-10-19T08:00:00.000Z' }),
      rec('Il deploy di test parte dal ramo principale', { memoryId: 'scout', scope: { roleId: 'scout' } }),
    ];
    const cards = memoryCards(facts);
    const shown = cards.filter(c => c.kind === 'one').map(c => (c.kind === 'one' ? c.group.rep.memoryId : ''));
    expect(shown.slice(0, MEMORY_CARDS_PER_DAY)).toContain('rule');
    expect(shown).not.toContain('specific');
    expect(shown).toEqual(expect.arrayContaining(['other-day', 'scout']));
    const batch = cards.find(c => c.kind === 'batch')!;
    expect(batch.kind === 'batch' && [batch.id, batch.groups.map(g => g.rep.memoryId)]).toEqual([`batch-artisan-${DAY}`, expect.arrayContaining(['specific'])]);
    expect(batch.kind === 'batch' && batch.groups).toHaveLength(2);
    expect(cards).toHaveLength(MEMORY_CARDS_PER_DAY + 2 + 1);
  });
  it('one fact over the cap is shown alone, not as a batch of one', () => {
    const cards = memoryCards(['Uno: la cartella dati è data', 'Due: i test stanno in test', 'Tre: il build va in out', 'Quattro: i log stanno in logs'].map(v => rec(v)));
    expect(cards.every(c => c.kind === 'one')).toBe(true);
    expect(cards).toHaveLength(4);
  });
});

describe('through the deck', () => {
  it('a batch and a merged card decide every fact they hold', async () => {
    const rows = [
      rec('Il server di test si riavvia ogni notte alle 6', { memoryId: 'a' }), rec('il server di test si riavvia ogni notte alle 6!', { memoryId: 'a2' }),
      rec('Prima di un merge lancia npm run check:branch', { memoryId: 'r1' }), rec('Quando il build fallisce guarda prima i log', { memoryId: 'r2' }),
      rec('La cartella dei report è reports/mensili', { memoryId: 'p1' }), rec('Il catalogo si aggiorna dal file prodotti.csv', { memoryId: 'p2' }),
    ];
    let open = [...rows];
    const calls: string[] = [];
    const s = new ProposalsService({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-deck-')), ports: { now: () => Date.parse(`${DAY}T12:00:00Z`), runs: () => [], chats: () => [],
      memory: { list: () => open, confirm: async id => { calls.push(`confirm ${id}`); open = open.filter(r => r.memoryId !== id); }, retract: async (id, why) => { calls.push(`retract ${id} ${why.split(' ')[0]}`); open = open.filter(r => r.memoryId !== id); } } } });
    const items = (await s.list()).items;
    const batch = items.find(c => c.id === `memory:batch-artisan-${DAY}`)!;
    expect(batch.ask).toMatchObject({ kind: 'remember', role: 'artisan', many: 2 });
    expect(batch.content.split('\n')).toHaveLength(2);
    const merged = items.find(c => c.ask.kind === 'remember' && c.ask.same === 2)!;
    expect(await s.decide({ id: batch.id, decision: 'reject', seen: batch.content })).toMatchObject({ ok: true });
    expect(calls.filter(c => c.startsWith('retract'))).toHaveLength(2);
    calls.length = 0;
    expect(await s.decide({ id: merged.id, decision: 'approve' })).toMatchObject({ ok: true });
    expect(calls).toEqual([`confirm ${merged.id.slice('memory:'.length)}`, expect.stringMatching(/^retract a2? Merged$/)]);
  });
});

describe('the demo', () => {
  it('its facts pass the gate and each is still its own card, the contradiction too', async () => {
    const { writeDemoProposals } = await import('../../../src/main/proposals/demo');
    const { readMemoryRecords } = await import('../../../src/main/rules/memory-records');
    const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-deck-demo-'));
    writeDemoProposals(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-deck-data-')), brain, Date.parse(`${DAY}T12:00:00Z`));
    const cards = memoryCards(readMemoryRecords(brain) as MemoryReviewRecord[]);
    expect(cards).toHaveLength(4);
    expect(cards.every(c => c.kind === 'one' && !c.group.worth.specific)).toBe(true);
    expect(cards.filter(c => c.kind === 'one' && c.group.conflicts.length)).toHaveLength(1);
  });
});
