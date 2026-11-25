// The one credit rule (ADR 0354, src/shared/credit-rule.ts): the precedence table of the owner's spec, the pause rules
// (one pause for errors of turns started before it ended, doubling only on a failed probe, caps), the probe of one chat,
// and what makes a reading valid. A fake clock only: every time is a number.
import { describe, expect, it } from 'vitest';
import { PAUSE_CAP_BLIND_MS, PAUSE_CAP_READ_MS, PROBE_TTL_MS, READING_FRESH_MS, SHORT_PAUSE_MS, creditVerdict, nextError, validReading, type CreditFacts, type CreditReading } from '../../../src/shared/credit-rule';
import type { HarnessUsageWindow } from '../../../src/shared/contract';

const MIN = 60e3, HOUR = 60 * MIN;
const T = Date.UTC(2026, 10, 25, 8, 0);
const fmt = (at: number) => `@${(at - T) / MIN}m`;
const w = (label: string, usedPercent: number, resetsAt: number | null, more: Partial<HarnessUsageWindow> = {}): HarnessUsageWindow =>
  ({ kind: label === '5h' ? 'five-hour' : 'weekly', label, usedPercent, resetsAt, ...more });
const reading = (at: number, windows: HarnessUsageWindow[], more: Partial<CreditReading> = {}): CreditReading => ({ at, ok: true, pool: 'opencode:openai', account: 'aaaa1111', windows, ...more });
const facts = (more: Partial<CreditFacts> = {}): CreditFacts => ({ pool: 'opencode:openai', account: 'aaaa1111', reading: null, error: null, workedFrom: null, ...more });
const v = (f: CreditFacts, now: number, asker?: string) => creditVerdict(f, now, { fmt, ...(asker ? { asker } : {}) });

describe('a spent window (≥98%) stops the plan until its reset', () => {
  it('3. out until the reset; several spent windows: until the farthest', () => {
    expect(v(facts({ reading: reading(T, [w('5h', 100, T + 2 * HOUR), w('7g', 31, T + 90 * HOUR)]) }), T + MIN)).toMatchObject({ state: 'out', until: T + 2 * HOUR, source: 'reading', why: '5h al 100%, torna alle @120m' });
    expect(v(facts({ reading: reading(T, [w('5h', 99, T + 2 * HOUR), w('7g', 98, T + 50 * HOUR)]) }), T + MIN)).toMatchObject({ state: 'out', until: T + 50 * HOUR });
    // 97% is not spent (the 98% threshold is unchanged)
    expect(v(facts({ reading: reading(T, [w('5h', 97, T + 4 * HOUR + 50 * MIN)]) }), T + MIN).state).not.toBe('out');
  });
  it('4. no reset: out until a new reading drops below 98%; a stale one asks to read again', () => {
    expect(v(facts({ reading: reading(T, [w('5h', 100, null)]) }), T + MIN)).toMatchObject({ state: 'out', until: null });
    expect(v(facts({ reading: reading(T, [w('5h', 100, null)]) }), T + MIN).reread).toBeUndefined();
    expect(v(facts({ reading: reading(T, [w('5h', 100, null)]) }), T + READING_FRESH_MS + MIN)).toMatchObject({ state: 'out', reread: true });
    expect(v(facts({ reading: reading(T + 10 * MIN, [w('5h', 20, null)]) }), T + 11 * MIN).state).toBe('free');
  });
  it('4b. the reset is past: read again, one chat tries; a turn that worked after it frees the pool', () => {
    const f = facts({ reading: reading(T, [w('5h', 100, T + HOUR)]) });
    expect(v(f, T + HOUR + MIN)).toMatchObject({ state: 'probation', reread: true });
    expect(v({ ...f, workedFrom: T + HOUR + 30e3 }, T + HOUR + MIN).state).toBe('free');
  });
  it('5. a spend window never stops the plan; a window of one model stops only that model', () => {
    expect(v(facts({ reading: reading(T, [w('On-demand', 100, T + HOUR, { kind: 'spend' })]) }), T + MIN).state).toBe('free');
    const sonnet = facts({ reading: reading(T, [w('7g · Sonnet', 100, T + 40 * HOUR, { model: 'sonnet' }), w('7g', 20, T + 40 * HOUR)]) });
    expect(v({ ...sonnet, model: 'claude-sonnet-4-6' }, T + MIN).state).toBe('out');
    expect(v({ ...sonnet, model: 'claude-opus-4-8' }, T + MIN).state).toBe('free');
  });
});

describe('a limit error and the readings around it', () => {
  const error = { at: T, pauseFrom: T, pauseMs: SHORT_PAUSE_MS };
  it('a valid reading newer than the error, all under 98%, short pause passed: free', () => {
    expect(v(facts({ error, reading: reading(T + 6 * MIN, [w('5h', 0, T + 5 * HOUR), w('7g', 31, T + 90 * HOUR)]) }), T + 7 * MIN)).toMatchObject({ state: 'free', source: 'reading' });
  });
  it('an error newer than the reading: read again now, meanwhile the short pause', () => {
    expect(v(facts({ error, reading: reading(T - MIN, [w('5h', 10, T + 4 * HOUR)]) }), T + MIN)).toMatchObject({ state: 'out', until: T + SHORT_PAUSE_MS, source: 'error', reread: true, why: 'errore di limite: pausa breve, torna alle @5m' });
  });
  it('an error, then a reading under 98%: the short pause, then probation', () => {
    const f = facts({ error, reading: reading(T + MIN, [w('5h', 10, T + 4 * HOUR)]) });
    expect(v(f, T + 2 * MIN)).toMatchObject({ state: 'out', until: T + SHORT_PAUSE_MS });
    expect(v(f, T + 2 * MIN).reread).toBeUndefined();
    expect(v(f, T + SHORT_PAUSE_MS + 1).state).toBe('probation');
  });
  it('no reading possible: the short pause, then probation', () => {
    expect(v(facts({ error }), T + MIN)).toMatchObject({ state: 'out', until: T + SHORT_PAUSE_MS, reread: true });
    expect(v(facts({ error }), T + SHORT_PAUSE_MS + 1)).toMatchObject({ state: 'probation', reread: true });
  });
  it('6. a stale, failed, other pool or other account reading is not valid: it frees nothing', () => {
    const late = T + SHORT_PAUSE_MS + 1;
    const good = [w('5h', 0, T + 5 * HOUR)];
    expect(validReading(facts({ reading: reading(T + 6 * MIN, good) }), T + 6 * MIN + READING_FRESH_MS + 1)).toBe(false);
    for (const r of [reading(T + 6 * MIN, good, { ok: false }), reading(T + 6 * MIN, good, { pool: 'opencode:zen' }), reading(T + 6 * MIN, good, { account: 'bbbb2222' })])
      expect(v(facts({ error, reading: r }), late + 2 * MIN).state).toBe('probation');
    // stale: past the pause, the reading of 10 minutes ago does not free the pool
    expect(v(facts({ error, reading: reading(T + 6 * MIN, good) }), T + 6 * MIN + READING_FRESH_MS + 1).state).toBe('probation');
  });
  it('7. probation: one chat tries, the others take the next model until it reports or its probe expires', () => {
    const f = facts({ error, probe: { owner: 'chat-1', at: T + 6 * MIN } });
    expect(v(f, T + 7 * MIN, 'chat-1').state).toBe('probation');
    expect(v(f, T + 7 * MIN, 'chat-2')).toMatchObject({ state: 'out', why: 'in prova su un’altra chat: si sa tra poco' });
    expect(v(f, T + 6 * MIN + PROBE_TTL_MS + 1, 'chat-2').state).toBe('probation');
  });
  it('9. a clean turn that started after the last error frees the pool, even during the pause; one started before does not', () => {
    expect(v(facts({ error, workedFrom: T + 30e3 }), T + MIN)).toMatchObject({ state: 'free', source: 'turn' });
    expect(v(facts({ error, workedFrom: T - 30e3 }), T + MIN).state).toBe('out');
  });
  it('a pool never read and never in error: unknown, which a pick takes like free', () => {
    expect(v(facts(), T)).toMatchObject({ state: 'unknown', source: 'none' });
  });
});

describe('the pause after limit errors', () => {
  it('1. errors of turns started before the pause ended count as one: one 5-minute pause', () => {
    let e = nextError(null, T, T - 10e3, true);
    for (let i = 1; i < 6; i++) e = nextError(e, T + i * 36e3, T + i * 36e3 - 20e3, true);
    expect(e).toEqual({ at: T + 5 * 36e3, pauseFrom: T, pauseMs: SHORT_PAUSE_MS });
  });
  it('8. a probe that started after the pause ended and failed doubles it, capped at 1 hour (readable) or a day (blind)', () => {
    let e = nextError(null, T, T, true);
    e = nextError(e, T + 6 * MIN, T + 5 * MIN + 1, true);
    expect(e).toEqual({ at: T + 6 * MIN, pauseFrom: T + 6 * MIN, pauseMs: 2 * SHORT_PAUSE_MS });
    for (let i = 0; i < 10; i++) { const end = e.pauseFrom + e.pauseMs; e = nextError(e, end + MIN, end + 1, true); }
    expect(e.pauseMs).toBe(PAUSE_CAP_READ_MS);
    let b = nextError(null, T, T, false);
    for (let i = 0; i < 12; i++) { const end = b.pauseFrom + b.pauseMs; b = nextError(b, end + MIN, end + 1, false); }
    expect(b.pauseMs).toBe(PAUSE_CAP_BLIND_MS);
  });
});

describe('Antigravity: Gemini and Claude/GPT are two quota pools (ADR 0357)', () => {
  const gem = (p: number) => w('5h', p, T + 2 * HOUR, { scope: 'gemini' });
  const third = (p: number) => w('5h · 3P', p, T + 2 * HOUR, { scope: '3p', model: '3p' });
  const ag = (...ws: HarnessUsageWindow[]) => facts({ pool: 'antigravity', reading: reading(T, ws, { pool: 'antigravity' }) });
  const on = (f: CreditFacts, model: string) => v({ ...f, model }, T + MIN).state;
  it('Gemini spent: its Claude and GPT models still run, the Gemini ones stop', () => {
    const f = ag(gem(100), third(3));
    expect(on(f, 'claude-sonnet-5-5')).toBe('free');
    expect(on(f, 'gpt-oss-120b-medium')).toBe('free');
    expect(on(f, 'gemini-3.8-flash')).toBe('out');
  });
  it('Claude/GPT spent: Gemini still runs, Claude stops', () => {
    const f = ag(gem(3), third(100));
    expect(on(f, 'gemini-3.8-flash')).toBe('free');
    expect(on(f, 'claude-opus-5-5')).toBe('out');
  });
  it('a window without a scope still stops every model (other engines unchanged)', () => {
    expect(on(facts({ reading: reading(T, [w('5h', 100, T + 2 * HOUR)]) }), 'claude-opus-5-5')).toBe('out');
  });
});
