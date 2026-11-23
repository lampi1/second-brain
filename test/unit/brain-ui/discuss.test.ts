// Unit tests of the "Discuti" texts and records (src/renderer/brain/lib/discuss.ts): the Orchestrator draft (source,
// facts, opening question by error or number), and the "discussa" store (bad storage, dedup, caps, an old record of a
// work chat still read).
import { describe, expect, it } from 'vitest';
import {
  addDiscussed, discussText, openingQuestion, readDiscussed, topicKey, writeDiscussed, ERROR_QUESTION, NUMBER_QUESTION, type KV, type Quote, type Topic,
} from '../../../src/renderer/brain/lib/discuss';

const Q = (o: Partial<Quote> = {}): Topic => ({ kind: 'quote', quote: { id: 'cost|week', what: 'numero', title: 'Spesa della settimana', source: '/api/cost', facts: ['42 $ in 7 giorni', '  '], ...o } });

describe('discussText', () => {
  it('quotes the number with its source and facts, then asks', () => {
    const t = discussText(Q());
    expect(t.split('\n')[0]).toBe("Let's discuss the number «Spesa della settimana» (source: /api/cost).");
    expect(t).toContain('- 42 $ in 7 giorni');
    expect(t).not.toMatch(/\n{3}/);
    expect(t.endsWith(NUMBER_QUESTION)).toBe(true);
  });
  it('names a recurring error', () => expect(discussText(Q({ what: 'errore' }))).toContain("Let's discuss the recurring error «"));
  it('shortens long facts', () => expect(discussText(Q({ facts: ['x'.repeat(1000)] })).length).toBeLessThan(800));
});

describe('openingQuestion', () => {
  it('is the quote’s own, else by error or number', () => {
    expect(openingQuestion(Q({ question: 'Perché?' }))).toBe('Perché?');
    expect(openingQuestion(Q({ what: 'errore' }))).toBe(ERROR_QUESTION);
    expect(openingQuestion(Q())).toBe(NUMBER_QUESTION);
  });
});

describe('discussed records', () => {
  const mem = (init?: string): KV & { v: string | null } => ({ v: init ?? null, getItem() { return this.v; }, setItem(_k, v) { this.v = v; } });
  it('reads nothing from bad or missing storage', () => {
    expect(readDiscussed(null)).toEqual({});
    expect(readDiscussed(mem('{bad'))).toEqual({});
    expect(readDiscussed(mem('[1]'))).toEqual({});
    expect(readDiscussed(mem(JSON.stringify({ a: [{ via: 'x', chatId: 'c', at: 1 }], b: 'no' })))).toEqual({});
  });
  it('round-trips, newest first, one entry per chat', () => {
    const kv = mem();
    let m = addDiscussed({}, 'k', { via: 'orchestrator', chatId: 'r', chatTitle: 'Orchestrator', at: 1 });
    m = addDiscussed(m, 'k', { via: 'chat', chatId: 'c1', chatTitle: 'Idea · X', at: 2 });
    m = addDiscussed(m, 'k', { via: 'orchestrator', chatId: 'r', chatTitle: 'Orchestrator', at: 3 });
    writeDiscussed(kv, m);
    const back = readDiscussed(kv);
    expect(back.k!.map(d => d.at)).toEqual([3, 2]);
  });
  it('keeps at most 5 per topic and drops the oldest topics past the cap', () => {
    let m = {};
    for (let i = 0; i < 8; i++) m = addDiscussed(m, 'k', { via: 'chat', chatId: `c${i}`, chatTitle: '', at: i });
    expect((m as Record<string, unknown[]>).k).toHaveLength(5);
    let big = {};
    for (let i = 0; i < 405; i++) big = addDiscussed(big, `t${i}`, { via: 'chat', chatId: 'c', chatTitle: '', at: i });
    expect(Object.keys(big)).toHaveLength(400);
    expect(big).not.toHaveProperty('t0');
    expect(big).toHaveProperty('t404');
  });
  it('a storage that throws never breaks the page', () => {
    const bad: KV = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
    expect(readDiscussed(bad)).toEqual({});
    expect(() => writeDiscussed(bad, {})).not.toThrow();
  });
  it('the key is the quote id', () => expect(topicKey(Q())).toBe('quote|cost|week'));
});

