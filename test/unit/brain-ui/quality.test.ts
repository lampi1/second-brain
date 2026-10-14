// The Qualità page's numbers (src/renderer/brain/lib/quality.ts) and their normalizers (types.ts): errors caught by the
// user per 100 turns over the days both sources cover, rules by outcome, rows out of the count, reopened share.
import { describe, expect, it } from 'vitest';
import { caughtPer100, outOfCount, rate, reopenShare, ruleStats } from '../../../src/renderer/brain/lib/quality';
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
      { date: '2026-10-11', turns: 100, caught: 3, others: 2 },
      { date: '2026-10-12', turns: 0, caught: 2, others: 0 },
      { date: '2026-10-13', turns: 25, caught: 0, others: 0 },
    ]);
  });

  it('no logs → no range, no rate (never a division by zero)', () => {
    const c = caughtPer100(seen, { from: null, to: null, byDay: [] });
    expect(c).toMatchObject({ turns: 0, caught: 0, per100: null, days: [], before: 0 });
    expect(caughtPer100([], { from: '2026-10-11', to: '2026-10-11', byDay: [] }).per100).toBeNull();
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
