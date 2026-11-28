// «Attività pianificate» (ADR 0373): the pure rules of src/shared/activities.ts: validation, the schedule, the filter,
// the cursor and the triage clip; and that the contract carries the activities channels.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_HISTORY_MAX, TRIAGE_ITEM_CHARS, TRIAGE_MAX_ITEMS, activityTemplates, clipForTriage, dayKey, defaultActivity, defaultFilter,
  describeSchedule, inSchedule, isNoReply, nextRunAt, passesFilter, readsAtZeroTokens, selectNew, sumCost, triageToday, trimHistory,
  validateActivityInput, validateSchedule, type ActivityItem, type ActivityRun,
} from '../../src/shared/activities';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/shared/contract';

// local-time helper: 2026-11-30 is a Monday
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const item = (key: string, t: number, more: Partial<ActivityItem> = {}): ActivityItem => ({ key, at: t, from: 'Anna Rossi', title: 'Bug in fattura', text: 'testo', unread: true, mentionsMe: false, ...more });
const run = (id: string, t: number, more: Partial<ActivityRun> = {}): ActivityRun => ({ id, activityId: 'a', at: t, durationMs: 10, trigger: 'timer', status: 'idle', read: 0, kept: 0, proposals: 0, usedModel: false, tokens: null, costUsd: null, model: null, ...more });

describe('validateActivityInput', () => {
  it('fills a minimal activity with the source defaults', () => {
    const r = validateActivityInput({ name: ' Mail ', source: 'outlook', propose: 'rispondi' });
    expect(r).toEqual({ ok: true, value: { name: 'Mail', source: 'outlook', schedule: { everyMin: 30, days: [], window: null }, filter: defaultFilter(), propose: 'rispondi', dailyCap: 20, enabled: false } });
  });
  it('needs a source and a sentence of what to propose', () => {
    const r = validateActivityInput({ name: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/fonte/);
    const r2 = validateActivityInput({ source: 'teams' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join(' ')).toMatch(/cosa proporre/);
  });
  it('rejects a wrong field instead of fixing it', () => {
    const r = validateActivityInput({ source: 'sms', propose: 'x', dailyCap: 0, enabled: 'yes', schedule: { everyMin: 3 }, filter: { senders: 'a' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it('merges a patch over an existing activity', () => {
    const base = { ...defaultActivity('gmail'), propose: 'p', enabled: true };
    const r = validateActivityInput({ schedule: { everyMin: 60 }, filter: { unreadOnly: true } }, base);
    expect(r.ok && r.value).toMatchObject({ source: 'gmail', enabled: true, propose: 'p', schedule: { everyMin: 60, days: [], window: null }, filter: { unreadOnly: true, senders: [] } });
  });
  it('trims and dedups the word lists', () => {
    const r = validateActivityInput({ source: 'outlook', propose: 'p', filter: { senders: [' Anna ', 'anna', ''], subjectWords: ['Bug'] } });
    expect(r.ok && r.value.filter).toMatchObject({ senders: ['Anna'], subjectWords: ['Bug'] });
  });
  it('every template is valid', () => {
    for (const t of activityTemplates()) expect(validateActivityInput(t.input).ok).toBe(true);
  });
});

describe('validateSchedule', () => {
  it('takes 5..720 minutes, days 1..7, a window from < to', () => {
    expect(validateSchedule({ everyMin: 5 }).ok).toBe(true);
    expect(validateSchedule({ everyMin: 720 }).ok).toBe(true);
    for (const bad of [{ everyMin: 4 }, { everyMin: 721 }, { everyMin: 7.5 }, { days: [0] }, { days: [8] }, { window: { from: '19:00', to: '08:00' } }, { window: { from: '8:00', to: '19:00' } }]) expect(validateSchedule(bad).ok).toBe(false);
  });
  it('sorts the days and reads all seven as «every day»', () => {
    expect(validateSchedule({ days: [5, 1, 1, 3] })).toMatchObject({ ok: true, value: { days: [1, 3, 5] } });
    expect(validateSchedule({ days: [1, 2, 3, 4, 5, 6, 7] })).toMatchObject({ ok: true, value: { days: [] } });
  });
  it('null window clears it', () => {
    expect(validateSchedule({ window: null }, { everyMin: 30, days: [], window: { from: '08:00', to: '19:00' } })).toMatchObject({ ok: true, value: { window: null } });
  });
});

describe('describeSchedule', () => {
  it('says it in words', () => {
    expect(describeSchedule({ everyMin: 30, days: [], window: null })).toBe('ogni 30 min');
    expect(describeSchedule({ everyMin: 60, days: [1, 2, 3, 4, 5], window: { from: '08:00', to: '19:00' } })).toBe('ogni ora · lun-ven · 08:00-19:00');
    expect(describeSchedule({ everyMin: 120, days: [1, 3], window: null })).toBe('ogni 2 ore · lun, mer');
  });
});

describe('nextRunAt', () => {
  const work = { everyMin: 30, days: [1, 2, 3, 4, 5], window: { from: '08:00', to: '19:00' } };
  it('a first run is now when the schedule allows it', () => {
    expect(nextRunAt(work, null, at(30, 10))).toBe(at(30, 10));
  });
  it('the next run is the last one plus the interval', () => {
    expect(nextRunAt(work, at(30, 10), at(30, 10, 5))).toBe(at(30, 10, 30));
  });
  it('never before now', () => {
    expect(nextRunAt(work, at(30, 9), at(30, 12))).toBe(at(30, 12));
  });
  it('after the window it waits for the next morning', () => {
    expect(nextRunAt(work, at(30, 18, 45), at(30, 18, 50))).toBe(new Date(2026, 11, 1, 8).getTime());
  });
  it('on Friday evening it waits for Monday', () => {
    expect(nextRunAt(work, null, new Date(2026, 11, 4, 20).getTime())).toBe(new Date(2026, 11, 7, 8).getTime());
  });
  it('before the window it waits for its start', () => {
    expect(nextRunAt(work, null, at(30, 6))).toBe(at(30, 8));
  });
  it('a day-only schedule starts at midnight of an allowed day', () => {
    expect(nextRunAt({ everyMin: 60, days: [2], window: null }, null, at(30, 10))).toBe(new Date(2026, 11, 1).getTime());
  });
  it('inSchedule: the window end is exclusive', () => {
    expect(inSchedule(work, at(30, 19))).toBe(false);
    expect(inSchedule(work, at(30, 18, 59))).toBe(true);
    expect(inSchedule(work, new Date(2026, 11, 5, 10).getTime())).toBe(false);
  });
});

describe('the filter', () => {
  it('no-reply senders', () => {
    for (const s of ['noreply', 'No-Reply Mailer', 'do-not-reply', 'donotreply notifications']) expect(isNoReply(s)).toBe(true);
    for (const s of ['Anna Rossi', 'Reply Team']) expect(isNoReply(s)).toBe(false);
  });
  it('an empty filter lets everything through', () => {
    expect(passesFilter(item('1', 1, { unread: false }), defaultFilter())).toBe(true);
  });
  it('each rule narrows', () => {
    const f = { ...defaultFilter() };
    expect(passesFilter(item('1', 1, { unread: false }), { ...f, unreadOnly: true })).toBe(false);
    expect(passesFilter(item('1', 1), { ...f, mentionsOnly: true })).toBe(false);
    expect(passesFilter(item('1', 1, { mentionsMe: true }), { ...f, mentionsOnly: true })).toBe(true);
    expect(passesFilter(item('1', 1, { from: 'noreply mailer' }), { ...f, excludeNoReply: true })).toBe(false);
    expect(passesFilter(item('1', 1), { ...f, senders: ['ANNA ro'] })).toBe(true);
    expect(passesFilter(item('1', 1), { ...f, senders: ['bruno'] })).toBe(false);
    expect(passesFilter(item('1', 1), { ...f, subjectWords: ['urgente', 'FATTURA'] })).toBe(true);
    expect(passesFilter(item('1', 1), { ...f, subjectWords: ['urgente'] })).toBe(false);
  });
});

describe('selectNew', () => {
  const cursor0 = { at: 0, keys: [] as string[] };
  it('the first read keeps what passes, oldest first, and moves the cursor over everything read', () => {
    const items = [item('b', 20), item('a', 10), item('c', 30, { unread: false })];
    const r = selectNew(items, cursor0, { ...defaultFilter(), unreadOnly: true });
    expect(r.kept.map(i => i.key)).toEqual(['a', 'b']);
    expect(r.newCount).toBe(3);
    expect(r.cursor.at).toBe(30);
    expect(r.cursor.keys.sort()).toEqual(['a', 'b', 'c']);
  });
  it('a second read of the same items finds nothing new', () => {
    const items = [item('a', 10), item('b', 20)];
    const first = selectNew(items, cursor0, defaultFilter());
    expect(selectNew(items, first.cursor, defaultFilter()).kept).toEqual([]);
  });
  it('an item with the same time as the cursor is new only if its key was not seen', () => {
    const first = selectNew([item('a', 10)], cursor0, defaultFilter());
    const r = selectNew([item('a', 10), item('b', 10), item('old', 5)], first.cursor, defaultFilter());
    expect(r.kept.map(i => i.key)).toEqual(['b']);
  });
  it('keeps the key list bounded', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`k${i}`, i + 1));
    expect(selectNew(items, cursor0, defaultFilter(), 4).cursor.keys).toHaveLength(4);
  });
});

describe('clipForTriage', () => {
  it('takes the newest 15 and says how many were left out', () => {
    const kept = Array.from({ length: 20 }, (_, i) => item(`k${i}`, i));
    const r = clipForTriage(kept);
    expect(r.items).toHaveLength(TRIAGE_MAX_ITEMS);
    expect(r.dropped).toBe(5);
    expect(r.items[0]!.key).toBe('k19');
  });
  it('cuts each item to 300 characters in all', () => {
    const r = clipForTriage([item('a', 1, { from: 'x'.repeat(200), title: 'y'.repeat(500), text: 'z'.repeat(2000) })]);
    const i = r.items[0]!;
    expect(i.from.length + i.title.length + i.text.length).toBeLessThanOrEqual(TRIAGE_ITEM_CHARS);
  });
});

describe('history and cost', () => {
  it('keeps the newest 20 runs', () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(`r${i}`, i));
    const t = trimHistory(runs);
    expect(t).toHaveLength(ACTIVITY_HISTORY_MAX);
    expect(t[0]!.id).toBe('r29');
  });
  it('counts today\'s model runs only', () => {
    const now = at(30, 12);
    expect(triageToday([run('a', at(30, 9), { usedModel: true }), run('b', at(30, 10)), run('c', at(29, 23), { usedModel: true })], now)).toBe(1);
    expect(dayKey(now)).toBe('2026-11-30');
  });
  it('sums the measured costs; none measured is null', () => {
    expect(sumCost([run('a', 1), run('b', 2)])).toBeNull();
    expect(sumCost([run('a', 1, { costUsd: 0.01 }), run('b', 2), run('c', 3, { costUsd: 0.02 })])).toBeCloseTo(0.03);
  });
  it('Gmail reads at zero tokens only with the app\'s own connector', () => {
    expect(readsAtZeroTokens('gmail', false)).toBe(false);
    expect(readsAtZeroTokens('gmail', true)).toBe(true);
    expect(readsAtZeroTokens('outlook', false)).toBe(true);
  });
});

describe('the contract', () => {
  it('carries the activities channels and no removed schedule/flow channel', () => {
    for (const c of ['activities:state', 'activities:save', 'activities:enable', 'activities:remove', 'activities:pause', 'activities:run', 'activities:history']) expect(INVOKE_CHANNELS as readonly string[]).toContain(c);
    expect(EVENT_CHANNELS as readonly string[]).toContain('activities:changed');
  });
});
