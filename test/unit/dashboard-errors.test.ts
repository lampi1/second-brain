// Qualità's app errors (src/renderer/dashboard/errors.ts) and the Costi facts (brain/lib/cost-facts.ts): known
// causes, the text signature that makes repeats fall together, the groups with their 14-day series, places and
// skills, the AI errors by type with the rule's status, the trend and the quiet days; cost facts only from enough data.
import { describe, expect, it } from 'vitest';
import { causeOf, daysSince, groupErrors, signature, trendOf, type ObservedLike } from '../../src/renderer/dashboard/errors';
import { costFacts } from '../../src/renderer/brain/lib/cost-facts';

const NOW = new Date(2026, 9, 19, 12, 0).getTime(), DAY = 864e5;
const e = (id: string, ago: number, detail: string, extra: Partial<ObservedLike> = {}): ObservedLike => ({ id, at: NOW - ago * DAY, title: 'Chat', detail, source: 'claude', ...extra });

describe('errors', () => {
  it('recognises the causes, most specific first', () => {
    expect(causeOf({ detail: 'API Error: 429 rate_limit_error' })).toBe('rateLimit');
    expect(causeOf({ detail: 'Overloaded (529)' })).toBe('overloaded');
    expect(causeOf({ detail: 'prompt is too long: 210000 tokens' })).toBe('context');
    expect(causeOf({ detail: '401 Unauthorized' })).toBe('auth');
    expect(causeOf({ detail: 'Command timed out after 120s' })).toBe('timeout');
    expect(causeOf({ detail: 'connect ECONNREFUSED 127.0.0.1:4329' })).toBe('network');
    expect(causeOf({ detail: "ENOENT: no such file or directory, open 'x'" })).toBe('notFound');
    expect(causeOf({ detail: 'permission denied' })).toBe('permission');
    expect(causeOf({ detail: 'MCP server "browser" disconnected' })).toBe('mcp');
    expect(causeOf({ detail: 'boom', turn: true })).toBe('turn');
    expect(causeOf({ detail: 'Bash: exit 2', tool: true })).toBe('tool');
    expect(causeOf({ detail: 'something odd' })).toBe('other');
  });

  it('strips what changes between repeats', () => {
    expect(signature('Bash: exit 2 in C:\\repo\\a.ts at 12:30 (id 0a1b2c3d4e)')).toBe(signature('Bash: exit 7 in C:\\repo\\b.ts at 09:15 (id 99ffee8812)'));
    expect(signature('fetch "https://a.example/x?1"')).toBe(signature("fetch 'https://b.example/y'"));
  });

  it('groups repeats with their days, places and skills, the most frequent first', () => {
    const g = groupErrors([
      e('1', 0, '429 rate limit', { chat: 'QA', role: 'Sentinel', skills: ['qa-run'] }),
      e('2', 3, 'rate limit reached', { chat: 'SMS', role: 'Artisan' }),
      e('3', 10, 'Bash: exit 1 in /a', { tool: true, chat: 'QA' }),
      e('4', 1, 'Bash: exit 2 in /b', { tool: true, chat: 'Fix' }),
      e('5', 20, 'odd thing', { source: 'feed', title: 'Strano' }),
    ], NOW);
    expect(g.map(x => [x.cause, x.count])).toEqual([['rateLimit', 2], ['tool', 2], ['other', 1]]);
    expect(g[0]).toMatchObject({ roles: ['Sentinel', 'Artisan'], chats: ['QA', 'SMS'], skills: ['qa-run'], lastAt: NOW, firstAt: NOW - 3 * DAY, title: null });
    expect(g[0]!.days).toHaveLength(14);
    expect(g[0]!.days[13]).toBe(1);
    expect(g[0]!.days[10]).toBe(1);
    expect(g[2]!.days.every(d => d === 0)).toBe(true); // older than 14 days: counted, not drawn
    expect(g[2]!.title).toBe('Strano');
    expect(trendOf(g[0]!.days)).toBe('up');
    expect(trendOf([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe('down');
    expect(trendOf(Array(14).fill(0))).toBe('flat');
    expect(daysSince(NOW - 2.5 * DAY, NOW)).toBe(2);
    expect(daysSince(null, NOW)).toBeNull();
  });

});

describe('cost facts', () => {
  const money = (v: number) => `$${v.toFixed(2)}`;
  it('names the priciest day, the top model and the priciest kind', () => {
    const f = costFacts({ total: 10, byDay: { '2026-10-17': { usd: 6, calls: 1 }, '2026-10-18': { usd: 2, calls: 1 }, '2026-10-19': { usd: 2, calls: 1 } }, byModel: { opus: { usd: 8, calls: 1 }, haiku: { usd: 2, calls: 1 } }, byKind: { fix: { usd: 7, calls: 1 }, qa: { usd: 3, calls: 1 } } }, money);
    expect(f[0]).toMatch(/^Il giorno più caro è stato .+: \$6\.00, 1,8× la media del periodo\.$/);
    expect(f[1]).toBe('opus vale 80% della spesa del periodo.');
    expect(f[2]).toBe('Il lavoro che costa di più è «fix»: $7.00 nel periodo.');
    expect(costFacts({ total: 0, byDay: {}, byModel: {}, byKind: {} }, money)).toEqual([]);
  });
});
