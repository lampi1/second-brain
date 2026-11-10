// The News' ranking (src/main/news/rank.ts, ADR 0265): recency halves in 36 hours, the user's work words count, the
// AI's fit weighs more once it exists, echo from other sources and points, a read story sinks, an undated one is not
// new, and the section comes from the words unless the source is a harness or research one.
import { describe, expect, it } from 'vitest';
import type { NewsItem, NewsSource } from '@shared/news';
import { UNDATED_RECENCY, echo, rank, recency, relevance, sectionOf } from '../../src/main/news/rank';

const NOW = Date.UTC(2026, 10, 10, 12);
const H = 3_600_000;
const src = (id: string, weight: number, read: NewsSource['read'] = 'feed'): NewsSource => ({ id, name: id, url: `https://${id}.test/`, read, section: 'models', weight, primary: true, on: true, builtin: true });
const SOURCES = [src('lab', 1), src('misc', 0.5), src('hn', 0.45, 'hn'), src('papers', 0.6, 'hf-papers')];
const item = (id: string, title: string, at: number, more: Partial<NewsItem> = {}): NewsItem => ({
  id, title, url: `https://x.test/${id}`, source: 'lab', sourceName: 'lab', at, seenAt: at, snippet: '', section: 'models', also: [], score: 0, rank: { recency: 0, source: 0, relevance: 0, echo: 0 }, ...more,
});

describe('parts', () => {
  it('recency is 1 now and halves every 36 hours', () => {
    expect(recency(NOW, NOW)).toBe(1);
    expect(recency(NOW - 36 * H, NOW)).toBeCloseTo(0.5);
    expect(recency(NOW + H, NOW)).toBe(1);
  });
  it('relevance favours the user\'s work words', () => {
    expect(relevance('New MCP spec for agent skills', '')).toBeGreaterThan(relevance('A new phone', ''));
    expect(relevance('Bike lanes in Paris', '')).toBe(0);
    expect(relevance('agent agent agent harness skills mcp', '')).toBe(1);
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
    const out = rank([item('old', 'Company news', NOW - 72 * H), item('new', 'Claude Code adds agent hooks', NOW - 2 * H)], SOURCES, NOW);
    expect(out.map(i => i.id)).toEqual(['new', 'old']);
    expect(out[0]?.rank.recency).toBeGreaterThan(0.9);
  });
  it('lets the AI fit outweigh the words', () => {
    const a = item('a', 'Agent harness skills news', NOW, { fit: 0 });
    const b = item('b', 'A quiet note', NOW, { fit: 3 });
    expect(rank([a, b], SOURCES, NOW)[0]?.id).toBe('b');
  });
  it('sinks a read story, not a saved one', () => {
    const [r] = rank([item('r', 'Agent news', NOW, { read: true })], SOURCES, NOW);
    const [u] = rank([item('u', 'Agent news', NOW)], SOURCES, NOW);
    const [s] = rank([item('s', 'Agent news', NOW, { read: true, saved: true })], SOURCES, NOW);
    expect(r!.score).toBeLessThan(u!.score);
    expect(s!.score).toBe(u!.score);
  });
  it('does not treat an undated story as new', () => {
    const [x] = rank([item('x', 'Something', NOW, { undated: true })], SOURCES, NOW);
    expect(x?.rank.recency).toBe(UNDATED_RECENCY);
  });
  it('uses the source weight', () => {
    const out = rank([item('m', 'Same title', NOW, { source: 'misc' }), item('l', 'Same title', NOW)], SOURCES, NOW);
    expect(out[0]?.id).toBe('l');
  });
});

describe('sectionOf', () => {
  it('reads the section from the words', () => {
    expect(sectionOf('MCP spec 2026-11 released', '', 'models')).toBe('skills');
    expect(sectionOf('A new SWE-bench leaderboard', '', 'skills')).toBe('models');
  });
  it('keeps a harness or research source\'s own section', () => {
    expect(sectionOf('Claude Code adds Fable 5.2 model', '', 'harness')).toBe('harness');
    expect(sectionOf('A new model', '', 'research')).toBe('research');
  });
  it('falls back to the source', () => {
    expect(sectionOf('Quarterly update', '', 'models')).toBe('models');
  });
});
