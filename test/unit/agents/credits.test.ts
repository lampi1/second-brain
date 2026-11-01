// The credit book (main/agents/credits.ts, ADR 0218): pools per engine and per OpenCode provider, when a local check
// is due (missing, stale, costly, exhausted past its cool-down), limit signals with a doubling cool-down, probation and
// recovery, Claude's binding window, OpenCode's log, the persisted cache, and no probe at all while the cache is fresh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOL_MIN_MS, COSTLY_STALE_MS, CreditBook, STALE_MS, claudeState, limitSignal, opencodeState, poolOf, readOpencodeLog } from '../../../src/main/agents/credits';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const tmpFile = () => { const dir = path.join(os.tmpdir(), `sb-credits-${randomUUID()}`); roots.push(dir); return path.join(dir, 'credits.json'); };
const HOUR = 3600e3;

describe('pools', () => {
  it('one per engine; OpenCode split by provider prefix', () => {
    expect(poolOf('claude', 'claude-opus-5-5')).toBe('claude');
    expect(poolOf('cursor', 'gpt-5')).toBe('cursor');
    expect(poolOf('opencode', 'openai/gpt-5.1')).toBe('opencode:openai');
    expect(poolOf('opencode', 'opencode/grok-code')).toBe('opencode:zen');
    expect(poolOf('opencode', 'anthropic/claude')).toBe('opencode:anthropic');
    expect(poolOf('opencode', null)).toBe('opencode:default');
  });
  it('a limit text is a signal; a network error is not', () => {
    expect(limitSignal('You have hit your usage limit')).toBe(true);
    expect(limitSignal('Error 429 Too Many Requests')).toBe(true);
    expect(limitSignal('insufficient_quota')).toBe(true);
    expect(limitSignal('ECONNRESET while rate limit check')).toBe(false);
    expect(limitSignal('the model refused')).toBe(false);
    expect(limitSignal(null)).toBe(false);
  });
});

describe('claudeState', () => {
  it('the binding window decides left and renewal', () => {
    const now = 1_000_000;
    expect(claudeState({ fiveHourPct: 20, fiveHourResetsAt: now + HOUR, weekPct: 60, weekResetsAt: now + 48 * HOUR, at: now }, now)).toMatchObject({ status: 'ok', left: 0.4, resetsAt: now + 48 * HOUR, periodMs: 7 * 24 * HOUR, source: 'limits' });
    expect(claudeState({ fiveHourPct: 90, fiveHourResetsAt: now + HOUR, weekPct: 30, weekResetsAt: now + 48 * HOUR, at: now }, now)).toMatchObject({ status: 'low', resetsAt: now + HOUR, periodMs: 5 * HOUR });
    expect(claudeState({ fiveHourPct: 100, fiveHourResetsAt: now + HOUR, weekPct: 30, weekResetsAt: null, at: now }, now).status).toBe('exhausted');
    expect(claudeState(null, now)).toMatchObject({ status: 'unknown', source: 'none' });
  });
});

describe('OpenCode log', () => {
  const line = (iso: string, rest: string) => `timestamp=${iso} ${rest}`;
  it('reads the last limit error and stream per provider', () => {
    const text = [
      line('2026-11-01T10:00:00.000Z', 'level=INFO service=llm providerID=openai message=stream'),
      line('2026-11-01T10:00:30.000Z', 'level=ERROR service=llm providerID=openai message=stream error error.error=You have hit your usage limit'),
      line('2026-11-01T09:00:00.000Z', 'level=INFO service=llm providerID=opencode message=stream'),
    ].join('\n');
    const facts = readOpencodeLog(text);
    const now = Date.parse('2026-11-01T11:00:00.000Z');
    expect(opencodeState('opencode:openai', facts.get('openai'), now)).toMatchObject({ status: 'exhausted', at: Date.parse('2026-11-01T10:00:30.000Z') });
    expect(opencodeState('opencode:zen', facts.get('opencode'), now)).toMatchObject({ status: 'ok', source: 'log' });
    expect(opencodeState('opencode:x', undefined, now)).toBeNull();
  });
  it('a stream well after the limit error means it works again', () => {
    const facts = { limitAt: 1_000_000, streamAt: 1_000_000 + 10 * 60e3 };
    expect(opencodeState('opencode:openai', facts, 1_000_000 + 20 * 60e3)?.status).toBe('ok');
  });
});

describe('CreditBook', () => {
  it('needsCheck: missing, stale, costly on an old state, exhausted only once recovered', async () => {
    let now = 10 * HOUR;
    const book = new CreditBook(null, {}, () => now);
    expect(book.needsCheck('cursor')).toBe(true);
    await book.refresh(['cursor']);
    expect(book.state('cursor')).toMatchObject({ status: 'unknown', source: 'none' });
    expect(book.needsCheck('cursor')).toBe(false);
    now += COSTLY_STALE_MS + 1;
    expect(book.needsCheck('cursor')).toBe(false);
    expect(book.needsCheck('cursor', { costly: true })).toBe(true);
    now += STALE_MS;
    expect(book.needsCheck('cursor')).toBe(true);
    book.signal('cursor', 'usage limit reached');
    expect(book.needsCheck('cursor')).toBe(false);
    now += COOL_MIN_MS;
    expect(book.needsCheck('cursor')).toBe(true);
    expect(book.state('cursor')!.status).toBe('probation');
  });

  it('a failure on probation doubles the cool-down; a clean turn brings it back', () => {
    let now = 10 * HOUR;
    const book = new CreditBook(null, {}, () => now);
    book.observe('cursor', 'gpt-5', 'You have hit your usage limit', true);
    expect(book.state('cursor')).toMatchObject({ status: 'exhausted', coolMs: COOL_MIN_MS });
    now += COOL_MIN_MS;
    expect(book.state('cursor')!.status).toBe('probation');
    book.observe('cursor', 'gpt-5', 'usage limit reached', true);
    expect(book.state('cursor')).toMatchObject({ status: 'exhausted', coolMs: 2 * COOL_MIN_MS });
    now += 2 * COOL_MIN_MS;
    book.observe('cursor', 'gpt-5', 'done', false);
    expect(book.state('cursor')).toMatchObject({ status: 'ok', source: 'turn' });
  });

  it('a reply that only talks about limits is no signal; a clean turn keeps an ok state as read', () => {
    const now = 10 * HOUR;
    const book = new CreditBook(null, { claudeLimits: () => ({ fiveHourPct: 10, fiveHourResetsAt: now + HOUR, weekPct: 40, weekResetsAt: now + 24 * HOUR, at: now }) }, () => now);
    book.observe('claude', null, 'the usage limit of the API is documented here', false);
    expect(book.state('claude')).toMatchObject({ status: 'ok', source: 'turn', left: null });
    return book.refresh(['claude'], { costly: true }).then(() => {
      // fresh by the turn: no check
      expect(book.state('claude')!.source).toBe('turn');
    });
  });

  it('reads Claude and OpenCode locally; a fresh cache calls no probe', async () => {
    let now = Date.parse('2026-11-01T12:00:00.000Z');
    const claudeLimits = vi.fn(() => ({ fiveHourPct: 10, fiveHourResetsAt: now + HOUR, weekPct: 30, weekResetsAt: now + 24 * HOUR, at: now }));
    const opencodeLog = vi.fn(async () => 'timestamp=2026-11-01T11:50:00.000Z level=ERROR service=llm providerID=openai message=stream error error.error=insufficient_quota');
    const book = new CreditBook(null, { claudeLimits, opencodeLog }, () => now);
    await book.refresh(['claude', 'opencode:openai', 'opencode:zen', 'cursor']);
    expect(book.state('claude')).toMatchObject({ status: 'ok', left: 0.7, source: 'limits' });
    expect(book.state('opencode:openai')!.status).toBe('exhausted');
    expect(book.state('opencode:zen')).toMatchObject({ status: 'unknown', source: 'none' });
    expect(book.state('cursor')!.status).toBe('unknown');
    claudeLimits.mockClear(); opencodeLog.mockClear();
    now += 60e3;
    await book.refresh(['claude', 'opencode:zen', 'cursor']);
    expect(claudeLimits).not.toHaveBeenCalled();
    expect(opencodeLog).not.toHaveBeenCalled();
  });

  it('a limit error newer than the windows wins until they are read again', async () => {
    let now = 10 * HOUR;
    const read = now - 60e3;
    const book = new CreditBook(null, { claudeLimits: () => ({ fiveHourPct: 10, fiveHourResetsAt: null, weekPct: 30, weekResetsAt: null, at: read }) }, () => now);
    book.signal('claude', 'usage limit reached');
    now += COOL_MIN_MS;
    await book.refresh(['claude']);
    expect(book.state('claude')!.status).toBe('probation');
  });

  it('keeps states and picks across a restart; picks older than 24 h drop out', () => {
    let now = 100 * HOUR;
    const file = tmpFile();
    const a = new CreditBook(file, {}, () => now);
    a.recordPick('claude'); a.recordPick('cursor');
    a.signal('cursor', 'quota exceeded');
    const b = new CreditBook(file, {}, () => now);
    expect(b.recentPicks()).toEqual(['claude', 'cursor']);
    expect(b.state('cursor')).toMatchObject({ status: 'exhausted', source: 'signal' });
    now += 25 * HOUR;
    expect(b.recentPicks()).toEqual([]);
  });

  it('a broken file is an empty cache', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(new CreditBook(file).list()).toEqual([]);
  });
});
