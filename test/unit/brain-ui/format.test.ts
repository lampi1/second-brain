// Formatting of the brain pages (src/renderer/brain/lib/format.ts): money, thousands, ages, calendar days.
import { describe, expect, it } from 'vitest';
import { dayAge, dayName, daysBetween, fmt, isDay, minutesAgo, shiftDay, ymd } from '../../../src/renderer/brain/lib/format';

describe('fmt', () => {
  it('money: decimals under 10 $, none above; empty for missing', () => {
    expect(fmt.usd(1.844)).toBe('1,84 $');
    expect(fmt.usd(38.2)).toBe('38 $');
    expect(fmt.usd(2105.4)).toMatch(/^2\.?105 \$$/);
    expect(fmt.usd(null)).toBe('');
    expect(fmt.usd(Number.NaN)).toBe('');
  });
  it('a day with its year in the UI locale, never the OS one (the Fatto date field, ADR 0101)', () => {
    expect(fmt.dayFull('2026-10-20')).toBe('mar 20/10/2026');
    expect(fmt.dayFull('nope')).toBe('nope');
  });
  it('thousands and millions', () => {
    expect(fmt.k(704202)).toBe('704k');
    expect(fmt.k(1_250_000)).toBe('1,3M');
    expect(fmt.k(950)).toBe('950');
  });
  it('percent of a total, 0 when the total is 0', () => {
    expect(fmt.pct(1, 4)).toBe(25);
    expect(fmt.pct(1, 0)).toBe(0);
  });
  it('ago from ms and ISO', () => {
    const now = Date.UTC(2026, 9, 11, 12, 0);
    expect(fmt.ago(now - 30e3, now)).toBe('adesso');
    expect(fmt.ago(now - 5 * 6e4, now)).toBe('5 min fa');
    expect(fmt.ago(new Date(now - 3 * 36e5).toISOString(), now)).toBe('3 h fa');
    expect(fmt.ago('', now)).toBe('');
  });
});

describe('days', () => {
  it('minutesAgo names yesterday and days', () => {
    expect(minutesAgo(1440)).toBe('ieri');
    expect(minutesAgo(3 * 1440)).toBe('3 giorni fa');
  });
  it('shiftDay crosses months and years', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('not a day', 1)).toBe('not a day');
  });
  it('daysBetween and the age tone (green ≤ 3, amber ≤ 7, red beyond)', () => {
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10);
    expect(dayAge('2026-10-11', '2026-10-11')).toEqual({ label: 'oggi', tone: 'good' });
    expect(dayAge('2026-10-10', '2026-10-11')).toEqual({ label: 'ieri', tone: 'good' });
    expect(dayAge('2026-10-06', '2026-10-11')?.tone).toBe('warn');
    expect(dayAge('2026-10-01', '2026-10-11')?.tone).toBe('bad');
    expect(dayAge('', '2026-10-11')).toBeNull();
  });
  it('dayName: Oggi / Ieri / a short date', () => {
    expect(dayName('2026-10-11', '2026-10-11')).toBe('Oggi');
    expect(dayName('2026-10-10', '2026-10-11')).toBe('Ieri');
    expect(dayName('2026-10-05', '2026-10-11')).toMatch(/05\/10/);
  });
  it('isDay and ymd', () => {
    expect(isDay('2026-10-11')).toBe(true);
    expect(isDay('11/10/2026')).toBe(false);
    expect(ymd(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
  });
});
