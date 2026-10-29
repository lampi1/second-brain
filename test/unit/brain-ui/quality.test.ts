// The Qualità page's numbers (src/renderer/brain/lib/quality.ts) and their normalizers (types.ts): errors caught by the
// user per 100 turns over the days both sources cover, rules by outcome, rows out of the count, reopened share.
import { describe, expect, it } from 'vitest';
import { caughtPer100, outOfCount, rate, reopenShare, ruleStats, sameChat } from '../../../src/renderer/brain/lib/quality';
import { normAppQuality, normErrQuality, normTables, type ErrQuality } from '../../../src/renderer/brain/types';

const q = (over: Partial<ErrQuality> = {}): ErrQuality => ({
  today: '2026-10-13', windowDays: 14, from: '2026-09-30', to: '2026-10-13', lines: 10, typed: 7, unparsed: [], invalid: [], seenByDay: [], totals: [], rules: [], ...over,
});

describe('caughtPer100', () => {
  const seen = [
    { date: '2026-10-09', owner: 4, other: 1, unknown: 0 },  // before the logs: outside
    { date: '2026-10-11', owner: 3, other: 2, unknown: 1 },
    { date: '2026-10-12', owner: 2, other: 0, unknown: 0 },
    { date: '2026-10-14', owner: 9, other: 0, unknown: 0 },  // after the logs' last day: outside
  ];
  const turns = { from: '2026-10-11', to: '2026-10-13', byDay: [{ date: '2026-10-11', claude: 80, cursor: 20 }, { date: '2026-10-13', claude: 25, cursor: 0 }] };

  it('divides only over the days the logs cover, both sides', () => {
    const c = caughtPer100(seen, turns);
    expect(c).toMatchObject({ from: '2026-10-11', to: '2026-10-13', turns: 125, caught: 5, others: 2, unknown: 1, per100: 4, before: 4 });
    expect(c.days).toEqual([
      { date: '2026-10-11', turns: 100, caught: 3, others: 2, source: 'errors' },
      { date: '2026-10-12', turns: 0, caught: 2, others: 0, source: 'errors' },
      { date: '2026-10-13', turns: 25, caught: 0, others: 0, source: 'errors' },
    ]);
  });

  it('no logs → no range, no rate (never a division by zero)', () => {
    const c = caughtPer100(seen, { from: null, to: null, byDay: [] });
    expect(c).toMatchObject({ turns: 0, caught: 0, per100: null, days: [], before: 0 });
    expect(caughtPer100([], { from: '2026-10-11', to: '2026-10-11', byDay: [] }).per100).toBeNull();
  });

  // ADR 0197: the owner's «in questi ho sempre zero» (0 from ai-errors.md while he corrected agents every day)
  describe('with the app\'s own count of his corrections', () => {
    const t3 = { from: '2026-10-11', to: '2026-10-13', byDay: [{ date: '2026-10-11', claude: 100, cursor: 0 }, { date: '2026-10-12', claude: 50, cursor: 0 }, { date: '2026-10-13', claude: 50, cursor: 0 }] };
    const day = (date: string, o: Partial<{ messages: number; tagged: number; afterReport: number; recognized: number; semantic: number; chats: string[] }> = {}) =>
      ({ date, messages: 10, tagged: 0, afterReport: 0, recognized: 0, semantic: 0, chats: [], ...o });

    it('counts tags, after-report corrections and recognised messages; ai-errors rows only beyond them', () => {
      const corr = { since: '2026-10-12', runs: [{ date: '2026-10-11', tagged: 2, afterReport: 0 }],
        byDay: [day('2026-10-12', { tagged: 1, afterReport: 1, recognized: 2, semantic: 1, chats: ['Fix login'] }), day('2026-10-13', { recognized: 1 })] };
      const seen = [{ date: '2026-10-12', owner: 1, other: 3, unknown: 2 }, { date: '2026-10-13', owner: 3, other: 0, unknown: 0 }];
      const rows = [{ data: '2026-10-12', chi: 'fix login', visto: '' }, { data: '2026-10-12', chi: 'Altro', visto: '' }];
      const c = caughtPer100(seen, t3, corr, rows);
      // 11th: runs' 2 tags; 12th: 4 from the app (rows: 1 owner + 1 matched = 2, not beyond 4); 13th: 1 + (3 − 1) rows
      expect(c).toMatchObject({ caught: 9, turns: 200, per100: 4.5, tagged: 1, afterReport: 1, recognized: 3, semantic: 1, fromRuns: 2, fromErrors: 2, matched: 1, messages: 20, others: 3, unknown: 2, since: '2026-10-12' });
      expect(c.days.map(d => [d.date, d.caught, d.source])).toEqual([['2026-10-11', 2, 'runs'], ['2026-10-12', 4, 'app'], ['2026-10-13', 3, 'app']]);
    });

    it('a day the app counted with no correction is a real zero', () => {
      const c = caughtPer100([], t3, { since: '2026-10-11', runs: [], byDay: [day('2026-10-11')] });
      expect(c).toMatchObject({ caught: 0, per100: 0, messages: 10 });
    });

    it('nothing measured at all → no number, never a fake zero', () => {
      const c = caughtPer100([{ date: '2026-10-12', owner: 0, other: 26, unknown: 186 }], t3, { since: null, runs: [], byDay: [] });
      expect(c.per100).toBeNull();
      expect(c).toMatchObject({ caught: 0, others: 26, unknown: 186 });
    });

    it('matches a row\'s chat to a corrected chat loosely, never a short or unrelated name', () => {
      expect(sameChat('Fix login', ['fix login'])).toBe(true);
      expect(sameChat('Artisan · Fix login page', ['Fix login page'])).toBe(true);
      expect(sameChat('UI', ['UI work'])).toBe(false);
      expect(sameChat('Report vendite', ['Fix login'])).toBe(false);
    });
  });

  it('rate per day, one decimal, Italian comma', () => {
    expect(rate(3, 70)).toBe('4,3');
    expect(rate(0, 10)).toBe('0');
    expect(rate(2, 0)).toBe('—');
  });
});

describe('ruleStats', () => {
  it('counts by outcome; judged = came back + did not; came back first, newest first', () => {
    const rule = (date: string, status: ErrQuality['rules'][number]['status']) => ({ date, type: 't', area: 'a', rule: `${status}@${date}`, status, ageDays: 1, again: [] });
    const s = ruleStats(q({ rules: [rule('2026-10-01', 'non-tornato'), rule('2026-10-02', 'tornato'), rule('2026-10-10', 'troppo-presto'), rule('2026-10-05', 'tornato'), rule('2026-10-11', 'senza-tipo')] }));
    expect(s).toMatchObject({ tornato: 2, nonTornato: 1, presto: 1, senzaTipo: 1, judged: 3 });
    expect(s.rules.map(r => r.rule)).toEqual(['tornato@2026-10-05', 'tornato@2026-10-02', 'non-tornato@2026-10-01', 'troppo-presto@2026-10-10', 'senza-tipo@2026-10-11']);
  });
});

describe('outOfCount', () => {
  it('unreadable + no valid type, labels by count', () => {
    const o = outOfCount(q({ unparsed: [{ date: 'd', line: 'l' }], invalid: [{ date: 'd', type: 'shell', line: '' }, { date: 'd', type: 'bug-introdotto', line: '' }, { date: 'd', type: 'bug-introdotto', line: '' }] }));
    expect(o).toEqual({ total: 4, unparsed: 1, invalid: 3, labels: [['bug-introdotto', 2], ['shell', 1]] });
  });
});

describe('reopenShare', () => {
  const r = { at: 'x', days: 90, resolved: 102, reopened: 13, bugs: [], error: null, refreshing: false };
  it('a whole percentage, null with no resolutions', () => {
    expect(reopenShare(r)).toBe(13);
    expect(reopenShare({ ...r, resolved: 0, reopened: 0 })).toBeNull();
  });
});

describe('normalizers', () => {
  it('normErrQuality fills every field; null for an old brain without quality()', () => {
    expect(normErrQuality(undefined)).toBeNull();
    expect(normTables({}).quality).toBeNull();
    const n = normErrQuality({ lines: '3', rules: [{ status: 'boh', again: [{ date: 'd' }] }], seenByDay: [{ date: 'd', owner: 1 }], totals: [['a', 2]] })!;
    expect(n).toMatchObject({ windowDays: 14, lines: 3, unparsed: [], invalid: [], totals: [['a', 2]] });
    expect(n.rules[0]).toMatchObject({ status: 'senza-tipo', ageDays: null, again: [{ date: 'd', line: '' }] });
    expect(n.seenByDay[0]).toEqual({ date: 'd', owner: 1, other: 0, unknown: 0 });
  });

  it('normAppQuality fills every field from nothing', () => {
    expect(normAppQuality(null)).toEqual({
      turns: { from: null, to: null, byDay: [] },
      prs: { at: null, total: 0, blocked: [], error: null },
      reopen: { at: null, days: 90, resolved: 0, reopened: 0, bugs: [], error: null, refreshing: false },
    });
    const n = normAppQuality({ prs: { blocked: [{ id: 1, reasons: ['build fallita', 3] }] }, reopen: { refreshing: 'yes', bugs: [{ reopened: [{ by: 'QA' }] }] } });
    expect(n.prs.blocked[0]).toMatchObject({ id: 1, reasons: ['build fallita', '3'] });
    expect(n.reopen.refreshing).toBe(false);
    expect(n.reopen.bugs[0]!.reopened[0]).toEqual({ resolvedAt: '', reopenedAt: '', by: 'QA', to: '' });
  });
});
