// The News readers (src/main/news/parse.ts, ADR 0264): RSS and Atom (escaped HTML in the text, CDATA), GitHub
// releases without prereleases, the Hugging Face Papers and Hacker News APIs with their thresholds, a news page with
// its links and dates, a dated Markdown changelog, an article's own date and the format sniffing. Small inline
// fixtures shaped like the real ones read on 2026-11-10.
import { describe, expect, it } from 'vitest';
import { articleDate, isPrerelease, parseFeed, parseGithub, parseHfPapers, parseHn, parseMarkdownDated, parsePage, plain, sniff, textDate } from '../../src/main/news/parse';

describe('parseFeed', () => {
  it('reads RSS items with link, date and a plain snippet', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>x</title>
      <item><title><![CDATA[Introducing AlphaProof Code]]></title><link>https://deepmind.google/blog/introducing-alphaproof-code/</link>
      <pubDate>Mon, 10 Nov 2026 09:00:00 GMT</pubDate><description>&lt;p&gt;Agents wrote &lt;b&gt;three million&lt;/b&gt; lines.&lt;/p&gt;</description></item>
    </channel></rss>`;
    const [s] = parseFeed(xml, 'https://deepmind.google/blog/rss.xml');
    expect(s).toMatchObject({ title: 'Introducing AlphaProof Code', url: 'https://deepmind.google/blog/introducing-alphaproof-code/', at: Date.UTC(2026, 10, 10, 9), snippet: 'Agents wrote three million lines.' });
  });

  it('reads Atom entries, picking the alternate link', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>llm-anthropic 0.31</title>
      <link rel="alternate" href="https://simonwillison.net/2026/Nov/9/llm-anthropic/"/><updated>2026-11-09T20:00:00Z</updated>
      <summary type="html">&lt;p&gt;Release: llm-anthropic 0.31&lt;/p&gt;</summary></entry></feed>`;
    const [s] = parseFeed(xml, 'https://simonwillison.net/atom/everything/');
    expect(s?.url).toBe('https://simonwillison.net/2026/Nov/9/llm-anthropic/');
    expect(s?.at).toBe(Date.parse('2026-11-09T20:00:00Z'));
    expect(s?.snippet).toBe('Release: llm-anthropic 0.31');
  });

  it('drops a link that is not http(s)', () => {
    const xml = '<rss><channel><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>';
    expect(parseFeed(xml, 'https://x.test/feed')).toEqual([]);
  });
});

describe('plain', () => {
  it('decodes entities and strips tags, also when the HTML itself is escaped', () => {
    expect(plain('&lt;b&gt;Hi&lt;/b&gt; &amp; you')).toBe('Hi & you');
    expect(plain('<![CDATA[<p>Hi</p>]]>')).toBe('Hi');
  });
});

describe('parseGithub', () => {
  it('keeps releases and leaves prereleases out', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>v2.1.322</title><link rel="alternate" href="https://github.com/anthropics/claude-code/releases/tag/v2.1.322"/><updated>2026-11-10T08:00:00Z</updated></entry>
      <entry><title>v2.2.0-beta.1</title><link rel="alternate" href="https://github.com/anthropics/claude-code/releases/tag/v2.2.0-beta.1"/><updated>2026-11-10T09:00:00Z</updated></entry>
    </feed>`;
    expect(parseGithub(xml, 'https://github.com/anthropics/claude-code/releases.atom').map(s => s.title)).toEqual(['v2.1.322']);
    expect(isPrerelease('rust-v0.60.0-alpha.3')).toBe(true);
    expect(isPrerelease('Release 1.4.0')).toBe(false);
  });
});

describe('API readers', () => {
  it('reads Hugging Face Papers above the vote threshold', () => {
    const json = [
      { title: 'Reframe', publishedAt: '2026-11-08T12:00:00Z', paper: { id: '2611.12886', upvotes: 61, ai_summary: 'Two-stage post-training.' } },
      { title: 'Quiet paper', publishedAt: '2026-11-08T12:00:00Z', paper: { id: '2611.00001', upvotes: 3 } },
    ];
    const out = parseHfPapers(json, 25);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: 'https://huggingface.co/papers/2611.12886', signal: 61, snippet: 'Two-stage post-training.' });
  });

  it('reads Hacker News stories about AI with a link and enough points', () => {
    const json = { hits: [
      { objectID: '46100001', title: 'Claude Code leaks secrets in settings', url: 'https://apiiro.com/blog/x', points: 540, created_at: '2026-11-08T10:00:00Z' },
      { title: 'A new bike lane in Paris', url: 'https://example.com/bike', points: 900, created_at: '2026-11-08T10:00:00Z' },
      { title: 'Ask HN: which LLM do you use?', url: 'https://news.ycombinator.com/item?id=1', points: 400, created_at: '2026-11-08T10:00:00Z' },
      { title: 'GPT trick', url: 'https://example.com/gpt', points: 20, created_at: '2026-11-08T10:00:00Z' },
    ] };
    expect(parseHn(json, 150).map(s => s.url)).toEqual(['https://apiiro.com/blog/x']);
    expect(parseHn(json, 150)[0]?.discuss).toBe('https://news.ycombinator.com/item?id=46100001');
  });

  it('says so when the answer is malformed (the source row shows it)', () => {
    expect(() => parseHn(null)).toThrow();
    expect(() => parseHfPapers({ nope: true })).toThrow();
  });
});

describe('parsePage', () => {
  const html = `<html><body><nav><a href="/news">News</a><a href="https://twitter.com/x">X</a></nav>
    <a href="/news/roadshow-launch"><h3>Anthropic launches roadshow</h3><p>Today Anthropic launched.</p><time datetime="2026-11-09T18:00:00Z"></time></a>
    <a href="/news/roadshow-launch">Read more</a>
    <a href="/claude-fable-and-mythos-5-2"><span>Nov 9, 2026</span><h2>Introducing Claude Fable 5.2</h2></a>
    <a href="/careers/jobs">Careers at a fast growing company</a></body></html>`;

  it('keeps the story links under the page (or matching its pattern), with title and date', () => {
    const out = parsePage(html, 'https://www.anthropic.com/news', '^/(news/[\\w-]+|claude-[\\w-]+)$');
    expect(out.map(s => s.url)).toEqual(['https://www.anthropic.com/news/roadshow-launch', 'https://www.anthropic.com/claude-fable-and-mythos-5-2']);
    expect(out[0]).toMatchObject({ title: 'Anthropic launches roadshow', snippet: 'Today Anthropic launched.', at: Date.parse('2026-11-09T18:00:00Z') });
    expect(out[1]?.title).toBe('Introducing Claude Fable 5.2');
    expect(out[1]?.at).not.toBeNull();
  });

  it('without a pattern, keeps only links under the page path', () => {
    expect(parsePage(html, 'https://www.anthropic.com/news').map(s => s.url)).toEqual(['https://www.anthropic.com/news/roadshow-launch']);
  });
});

describe('dates', () => {
  it('reads a date written in the text', () => {
    expect(textDate('Product · Nov 9, 2026 · 4 min')).toBe(Date.UTC(2026, 10, 9, 12));
    expect(textDate('no date here')).toBeNull();
  });

  it('reads an article\'s own date', () => {
    expect(articleDate('<meta property="article:published_time" content="2026-11-07T10:00:00Z">')).toBe(Date.parse('2026-11-07T10:00:00Z'));
    expect(articleDate('<script type="application/ld+json">{"datePublished":"2026-11-06"}</script>')).toBe(Date.parse('2026-11-06'));
    expect(articleDate('<p>nothing</p>')).toBeNull();
  });
});

describe('parseMarkdownDated', () => {
  it('turns each dated heading into a story with an anchor link', () => {
    const md = '# Release notes\n\n### November 3, 2026\n\nText generated by Claude carries a watermark.\n\n### November 2, 2026\n\nMessage threads in beta.\n';
    const out = parseMarkdownDated(md, 'https://platform.claude.com/docs/en/release-notes/overview.md');
    expect(out).toHaveLength(2);
    expect(out[0]?.url).toBe('https://platform.claude.com/docs/en/release-notes/overview#november-3-2026');
    expect(out[0]?.title).toContain('watermark');
    expect(out[0]?.at).toBe(Date.UTC(2026, 10, 3, 12));
  });
});

describe('sniff', () => {
  it('tells a feed, Markdown and a page apart', () => {
    expect(sniff('<?xml version="1.0"?><rss>', 'text/xml', 'https://x.test/f')).toBe('feed');
    expect(sniff('# Notes', 'text/markdown', 'https://x.test/a.md')).toBe('md');
    expect(sniff('<!doctype html><html>', 'text/html', 'https://x.test/')).toBe('page');
  });
});
