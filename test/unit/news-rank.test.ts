// The News' ranking (src/main/news/rank.ts, ADR 0265, editions ADR 0279): recency halves in 36 hours, the edition's key words count, the
// AI's fit weighs more once it exists, echo from other sources and points, a read story sinks, an undated one is not
// new, and the section comes from the words unless the source is a harness or research one.
import { describe, expect, it } from 'vitest';
import type { NewsItem, NewsSource } from '@shared/news';
import { UNDATED_RECENCY, echo, rank, recency, relevance, sectionOf } from '../../src/main/news/rank';
import { editionFromTemplate, templateOf } from '../../src/main/news/sources';

const AI = editionFromTemplate(templateOf('ai')!, 'it', 0);
const CARS = { core: ['autonomia', 'batteri', 'ricarica'], near: ['prova', 'prezzo'], sections: [{ id: 'prove', name: 'Prove', words: ['prova', 'test'] }, { id: 'ricarica', name: 'Ricarica', words: ['ricarica', 'colonnin'] }] };

const NOW = Date.UTC(2026, 10, 10, 12);
const H = 3_600_000;
const src = (id: string, weight: number, read: NewsSource['read'] = 'feed'): NewsSource => ({ id, name: id, edition: 'ai', url: `https://${id}.test/`, read, section: 'models', weight, primary: true, on: true, builtin: true });
const SOURCES = [src('lab', 1), src('misc', 0.5), src('hn', 0.45, 'hn'), src('papers', 0.6, 'hf-papers')];
const item = (id: string, title: string, at: number, more: Partial<NewsItem> = {}): NewsItem => ({
  id, edition: 'ai', title, url: `https://x.test/${id}`, source: 'lab', sourceName: 'lab', at, seenAt: at, snippet: '', section: 'models', also: [], score: 0, rank: { recency: 0, source: 0, relevance: 0, echo: 0 }, ...more,
});

describe('parts', () => {
  it('recency is 1 now and halves every 36 hours', () => {
    expect(recency(NOW, NOW)).toBe(1);
    expect(recency(NOW - 36 * H, NOW)).toBeCloseTo(0.5);
    expect(recency(NOW + H, NOW)).toBe(1);
  });
  it('relevance favours the user\'s work words', () => {
    expect(relevance('New MCP spec for agent skills', '', AI)).toBeGreaterThan(relevance('A new phone', '', AI));
    expect(relevance('Bike lanes in Paris', '', AI)).toBe(0);
    expect(relevance('agent agent agent harness skills mcp', '', AI)).toBe(1);
  });
  it('echo grows with other sources and points', () => {
    const by = new Map(SOURCES.map(s => [s.id, s]));
    expect(echo({ also: [], source: 'lab' }, by)).toBe(0);
    expect(echo({ also: [{ source: 'a', name: 'a', url: 'u' }], source: 'lab' }, by)).toBeCloseTo(0.3);
    expect(echo({ also: [], source: 'hn', signal: 600 }, by)).toBeGreaterThan(echo({ also: [], source: 'hn', signal: 150 }, by));
  });
});

describe('rank', () => {
  it('puts a fresh story about the user\'s work above an old general one', () => {
    const out = rank([item('old', 'Company news', NOW - 72 * H), item('new', 'Claude Code adds agent hooks', NOW - 2 * H)], SOURCES, NOW, AI);
    expect(out.map(i => i.id)).toEqual(['new', 'old']);
    expect(out[0]?.rank.recency).toBeGreaterThan(0.9);
  });
  it('lets the AI fit outweigh the words', () => {
    const a = item('a', 'Agent harness skills news', NOW, { fit: 0 });
    const b = item('b', 'A quiet note', NOW, { fit: 3 });
    expect(rank([a, b], SOURCES, NOW, AI)[0]?.id).toBe('b');
  });
  it('sinks a read story, not a saved one', () => {
    const [r] = rank([item('r', 'Agent news', NOW, { read: true })], SOURCES, NOW, AI);
    const [u] = rank([item('u', 'Agent news', NOW)], SOURCES, NOW, AI);
    const [s] = rank([item('s', 'Agent news', NOW, { read: true, saved: true })], SOURCES, NOW, AI);
    expect(r!.score).toBeLessThan(u!.score);
    expect(s!.score).toBe(u!.score);
  });
  it('does not treat an undated story as new', () => {
    const [x] = rank([item('x', 'Something', NOW, { undated: true })], SOURCES, NOW, AI);
    expect(x?.rank.recency).toBe(UNDATED_RECENCY);
  });
  it('uses the source weight', () => {
    const out = rank([item('m', 'Same title', NOW, { source: 'misc' }), item('l', 'Same title', NOW)], SOURCES, NOW, AI);
    expect(out[0]?.id).toBe('l');
  });
});

describe('sectionOf', () => {
  it('reads the section from the words', () => {
    expect(sectionOf('MCP spec 2026-11 released', '', { section: 'models' }, AI)).toBe('skills');
    expect(sectionOf('A new SWE-bench leaderboard', '', { section: 'skills' }, AI)).toBe('models');
  });
  it('keeps a pinned source\'s own section', () => {
    expect(sectionOf('Claude Code adds Fable 5.2 model', '', { section: 'harness', pin: true }, AI)).toBe('harness');
    expect(sectionOf('A new model', '', { section: 'research', pin: true }, AI)).toBe('research');
  });
  it('falls back to the source, or to no section when the source names none of the edition', () => {
    expect(sectionOf('Quarterly update', '', { section: 'models' }, AI)).toBe('models');
    expect(sectionOf('Quarterly update', '', { section: 'gone' }, AI)).toBe('');
    expect(sectionOf('Quarterly update', '', { section: 'gone', pin: true }, AI)).toBe('');
  });
});

describe('any subject (ADR 0279)', () => {
  it('ranks by the edition\'s own words: stems match their endings, in any language', () => {
    expect(relevance('Nuove batterie: autonomia di 900 km', '', CARS)).toBeGreaterThan(relevance('Claude Code adds agent hooks', '', CARS));
    expect(relevance('Claude Code adds agent hooks', '', CARS)).toBe(0);
    expect(relevance('La batteria è più leggera', '', CARS)).toBeGreaterThan(0);
    // a word inside another word does not count
    expect(relevance('Approvato il piano', '', CARS)).toBe(0);
  });
  it('an edition with no words gives no relevance and no section', () => {
    const none = { core: [], near: [], sections: [] };
    expect(relevance('Anything at all', '', none)).toBe(0);
    expect(sectionOf('Anything', '', { section: 'x' }, none)).toBe('');
  });
  it('sends a story to the edition\'s sections by their words', () => {
    expect(sectionOf('Prova su strada in inverno', '', { section: '' }, CARS)).toBe('prove');
    expect(sectionOf('Nuove colonnine in autostrada', '', { section: 'prove' }, CARS)).toBe('ricarica');
  });
  it('the same story scores differently in two editions', () => {
    const it = item('x', 'Autonomia e ricarica: la prova', NOW);
    expect(rank([it], SOURCES, NOW, CARS)[0]!.rank.relevance).toBeGreaterThan(rank([it], SOURCES, NOW, AI)[0]!.rank.relevance);
  });
});
