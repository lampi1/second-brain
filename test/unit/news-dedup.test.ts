// The News' deduplication (src/main/news/dedup.ts, ADR 0265): one link with or without tracking and www., the same
// release under two spellings, the same launch told by a lab, a blog and Hacker News, and what must stay apart (two
// versions, two stories that only share a word).
import { describe, expect, it } from 'vitest';
import type { NewsItem, NewsSource } from '@shared/news';
import { canonicalUrl, dedupe, sameStory, titleWords } from '../../src/main/news/dedup';

const T = Date.UTC(2026, 10, 9, 12);
const src = (id: string, primary: boolean, weight: number): NewsSource => ({ id, name: id, url: `https://${id}.test/feed`, read: 'feed', section: 'models', weight, primary, on: true, builtin: true });
const SOURCES = [src('lab', true, 1), src('blog', false, 0.75), src('hn', true, 0.45), src('cc', true, 0.95), src('gh', true, 0.9)];
const item = (id: string, source: string, title: string, url: string, at = T, more: Partial<NewsItem> = {}): NewsItem => ({
  id, title, url, source, sourceName: source, at, seenAt: at, snippet: '', section: 'models', also: [], score: 0, rank: { recency: 0, source: 0, relevance: 0, echo: 0 }, ...more,
});

describe('canonicalUrl', () => {
  it('drops www., tracking parameters and a trailing slash, keeps the anchor', () => {
    expect(canonicalUrl('https://www.Anthropic.com/news/x/?utm_source=hn&ref=feed')).toBe('anthropic.com/news/x');
    expect(canonicalUrl('https://code.claude.com/docs/en/changelog#2-1-322')).toBe('code.claude.com/docs/en/changelog#2-1-322');
    expect(canonicalUrl('https://x.test/a?id=2&b=1')).toBe('x.test/a?b=1&id=2');
  });
});

describe('sameStory', () => {
  it('matches a release under two spellings', () => {
    expect(sameStory({ title: 'Claude Code 2.1.322', at: T }, { title: 'claude code v2.1.322', at: T })).toBe(true);
  });
  it('keeps two versions apart', () => {
    expect(sameStory({ title: 'Claude Code 2.1.322', at: T }, { title: 'Claude Code 2.1.321', at: T })).toBe(false);
    expect(sameStory({ title: 'Claude Code 2.1.32', at: T }, { title: 'Claude Code 2.1.322', at: T })).toBe(false);
  });
  it('matches one launch told in close words, not two stories that share one word', () => {
    expect(sameStory({ title: 'Introducing Claude Fable 5.2 and Claude Mythos 5.2', at: T }, { title: 'Claude Fable 5.2 and Mythos 5.2 are out', at: T + 3_600_000 })).toBe(true);
    expect(sameStory({ title: 'Agent memory needs a format', at: T }, { title: 'The components of agent memory', at: T })).toBe(false);
  });
  it('does not match stories days apart', () => {
    expect(sameStory({ title: 'Claude Code 2.1.322', at: T }, { title: 'Claude Code 2.1.322', at: T + 6 * 86_400_000 })).toBe(false);
  });
  it('reads the meaningful words', () => {
    expect([...titleWords('Introducing the new Claude Code 2.1.322')]).toEqual(['claude', 'code', '2.1.322']);
  });
});

describe('dedupe', () => {
  it('keeps the primary source and lists the others as also', () => {
    const items = [
      item('b', 'blog', 'Claude Fable 5.2 and Mythos 5.2 are out', 'https://blog.test/fable', T + 1000),
      item('l', 'lab', 'Introducing Claude Fable 5.2 and Claude Mythos 5.2', 'https://www.anthropic.com/claude-fable-and-mythos-5-2', T),
      item('h', 'hn', 'Claude Fable 5.2', 'https://anthropic.com/claude-fable-and-mythos-5-2?utm_source=hn', T + 2000, { signal: 1240 }),
    ];
    const { items: out, merged } = dedupe(items, SOURCES);
    expect(merged).toBe(2);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('lab');
    expect(out[0]?.also.map(a => a.source).sort()).toEqual(['blog', 'hn']);
    expect(out[0]?.signal).toBe(1240);
    expect(out[0]?.at).toBe(T);
  });

  it('keeps what the user did and what the AI wrote on either copy', () => {
    const old = item('l', 'lab', 'Claude Code 2.1.322', 'https://code.claude.com/docs/en/changelog#2-1-322', T, { read: true, saved: true, summary: 'Fast mode on Vertex.', why: 'Vertex only.', fit: 1, lesson: 'les-1' });
    const fresh = item('g', 'gh', 'v2.1.322', 'https://github.com/anthropics/claude-code/releases/tag/v2.1.322', T, { title: 'Claude Code v2.1.322' });
    const { items: out } = dedupe([old, fresh], SOURCES);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ read: true, saved: true, summary: 'Fast mode on Vertex.', fit: 1, lesson: 'les-1' });
  });

  it('leaves different stories alone', () => {
    const { items: out, merged } = dedupe([
      item('a', 'cc', 'Claude Code 2.1.322', 'https://code.claude.com/docs/en/changelog#2-1-322'),
      item('b', 'cc', 'Claude Code 2.1.321', 'https://code.claude.com/docs/en/changelog#2-1-321'),
    ], SOURCES);
    expect(merged).toBe(0);
    expect(out).toHaveLength(2);
  });
});
