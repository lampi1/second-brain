// Usage (src/main/brain/usage.ts): the cost.mjs parser on an anonymized fixture of its --json output, the three
// rate-limit shapes (stream event, get_usage answer, Claude Code's cache), the 1-hour cache TTL, expired windows, and
// the monitor with a fake cost.mjs.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../../src/main/brain/node';
import { CACHE_TTL_MS, UsageMonitor, composeUsage, mergeLimits, parseCost, parseRateLimits, readClaudeCache } from '../../../src/main/brain/usage';
import { log } from '../../../src/main/log';
import type { Usage } from '../../../src/shared/contract';
import { FIXTURES, plainNode, tmpDir, until } from './helpers';

const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cost-1day.json'), 'utf8')) as { from: string; cursor: { downloaded: string } };
const day = fixture.from;

describe('usage', () => {
  it('parses cost.mjs: today $, per-chat $ (zero-cost chats dropped), Cursor known when exported today', () => {
    const c = parseCost(fixture, day);
    expect(c.todayUsd).toBe(12.5);
    expect(c.costKnown).toBe(true);
    expect(c.chats.map(x => [x.title, x.usd])).toEqual([['Fix login error', 8.25], ['Orchestrator', 4.25]]);
    expect(c.cursorTodayUsd).toBe(1.5);
    expect(c.cursorNote).toMatch(/fino alle \d\d:\d\d/);
  });

  it('Cursor is unknown (null) when the export is older than today or missing; a bad answer is not a cost', () => {
    const old = { ...fixture, cursor: { ...fixture.cursor, downloaded: '2026-01-01T08:00:00Z' } };
    expect(parseCost(old, day)).toMatchObject({ cursorTodayUsd: null, cursorNote: expect.stringMatching(/sconosciuto \(export del 01\/01\)/) });
    expect(parseCost({ ...fixture, cursor: { total: 0, byDay: {}, byModel: {} } }, day).cursorTodayUsd).toBeNull();
    expect(parseCost('nope', day)).toMatchObject({ costKnown: false, todayUsd: 0 });
  });

  it('reads the plan windows from a stream rate_limit_event (fraction, unix seconds)', () => {
    const l = parseRateLimits({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.83, resetsAt: 1791720000,
      unifiedWindows: { five_hour: { utilization: 0.83, resetsAt: 1791720000 }, seven_day: { utilization: 0.41, resetsAt: 1792000000 } } }, uuid: 'u', session_id: 's' }, 1000)!;
    expect(l).toMatchObject({ fiveHourPct: 83, fiveHourResetsAt: 1791720000000, weekPct: 41, weekResetsAt: 1792000000000, source: 'stream', at: 1000 });
    const single = parseRateLimits({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 1792000000 } })!;
    expect(single).toMatchObject({ fiveHourPct: null, weekPct: 50 });
  });

  it('reads a get_usage answer (0-100, ISO) and Claude Code\'s cache; anything else is null', () => {
    const g = parseRateLimits({ response: { subscription_type: 'max', rate_limits_available: true, rate_limits: { five_hour: { utilization: 37.5, resets_at: '2026-10-11T14:00:00Z' }, seven_day: { utilization: 12, resets_at: '2026-10-15T08:00:00Z' } } } })!;
    expect(g).toMatchObject({ fiveHourPct: 37.5, fiveHourResetsAt: Date.parse('2026-10-11T14:00:00Z'), weekPct: 12, source: 'get_usage' });
    const c = parseRateLimits({ fetchedAtMs: 5, utilization: { five_hour: { utilization: 20, resets_at: '2026-10-11T14:00:00Z' }, seven_day: null } })!;
    expect(c).toMatchObject({ fiveHourPct: 20, weekPct: null, source: 'claude-cache', at: 5 });
    expect(parseRateLimits({ type: 'assistant' })).toBeNull();
    expect(parseRateLimits({ rate_limits: null })).toBeNull();
    expect(parseRateLimits(null)).toBeNull();
  });

  it('trusts Claude Code\'s cache for one hour only, and reads only that key', () => {
    const f = path.join(tmpDir(), '.claude.json');
    const now = Date.parse('2026-10-11T10:00:00Z');
    fs.writeFileSync(f, JSON.stringify({ oauthAccount: { emailAddress: 'x@y' }, cachedUsageUtilization: { fetchedAtMs: now - 10 * 6e4, utilization: { five_hour: { utilization: 44, resets_at: '2026-10-11T12:00:00Z' } } } }));
    expect(readClaudeCache(f, now)).toMatchObject({ fiveHourPct: 44, source: 'claude-cache' });
    expect(readClaudeCache(f, now + CACHE_TTL_MS)).toBeNull();
    expect(readClaudeCache(path.join(tmpDir(), 'missing.json'), now)).toBeNull();
  });

  it('composeUsage: no limits = null with a note; a window past its reset becomes unknown', () => {
    const cost = parseCost(fixture, day);
    const none = composeUsage(cost, null, 0);
    expect(none).toMatchObject({ todayUsd: 12.5, fiveHourPct: null, weekPct: null, limitsSource: null, costKnown: true });
    expect(none.limitsNote).toMatch(/non disponibili/);
    const now = Date.parse('2026-10-11T15:00:00Z');
    const u = composeUsage(cost, { fiveHourPct: 90, fiveHourResetsAt: Date.parse('2026-10-11T14:00:00Z'), weekPct: 30, weekResetsAt: Date.parse('2026-10-15T00:00:00Z'), source: 'stream', at: now - 5 * 6e4 }, now);
    expect(u).toMatchObject({ fiveHourPct: null, fiveHourResetsAt: null, weekPct: 30, limitsSource: 'stream' });
    expect(u.limitsNote).toBe('Da una chat Claude, 5 min fa');
  });

  it('composeUsage: when cost.mjs read and its sessions by cost (for the live total); Cursor\'s unpriced chats', () => {
    const cost = { ...parseCost(fixture, day), at: 1234 };
    const u = composeUsage(cost, null, 0);
    expect(u.costAt).toBe(1234);
    const usd = (u.claudeChats ?? []).map(c => c.usd);
    expect(usd.length).toBe(cost.chats.length);
    expect(usd).toEqual([...usd].sort((a, b) => b - a));
    expect(composeUsage({ ...cost, costKnown: false }, null, 0).costAt).toBeUndefined();
    const cursor = { usd: 1, exact: false, margin: 0.2, turns: 2, unpriced: 1, chats: { a: 1 }, todayChats: { a: 1 }, unpricedChats: ['b'], unpricedModels: ['auto'], note: 'x' };
    expect(composeUsage(cost, null, 0, cursor).cursorUnpriced).toEqual({ chats: ['b'], models: ['auto'] });
    expect(composeUsage(cost, null, 0, { ...cursor, unpricedChats: [], unpricedModels: [] }).cursorUnpriced).toBeUndefined();
  });

  it('the monitor runs the brain\'s cost.mjs, emits usage and spend, and ingests rate limits', async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true });
    const out = { ...fixture, from: '__TODAY__', byDay: { __TODAY__: { usd: 3.25, calls: 1 } } };
    fs.writeFileSync(path.join(root, 'ops', 'tools', 'cost.mjs'),
      `const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());\n` +
      `console.log(${JSON.stringify(JSON.stringify(out))}.replaceAll('__TODAY__', today));\n`);
    const got: Usage[] = [];
    const m = new UsageMonitor({ root, node: plainNode, claudeConfig: null, everyMs: 60e3, onUsage: u => got.push(u) });
    m.start();
    expect(await until(() => got.length > 0, 10000)).toBe(true);
    m.stop();
    // on a failure, why cost.mjs gave no JSON (exit code, error, stderr): tests keep no log file, only log.recent (main
    // red at 100% CPU, 2026-10-16: the script ended in under 2 s without output, cause unknown)
    const why = JSON.stringify(log.recent.filter(e => e.scope === 'brain' && e.lvl === 'warn'));
    expect(got[0], why).toMatchObject({ todayUsd: 3.25, costKnown: true });
    expect(m.spend().claude.dayUsd).toBe(3.25);
    expect(m.ingest({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.5, resetsAt: Math.floor(Date.now() / 1000) + 3600 } })).toBe(true);
    expect(got.at(-1)!.fiveHourPct).toBe(50);
    expect(m.spend().claude.fiveHourPct).toBe(50);
  });

  it('a message about one window keeps the other (get_usage, then a five_hour-only stream event)', () => {
    const m = new UsageMonitor({ root: null, node: plainNode, claudeConfig: null, onUsage: () => {} });
    const soon = new Date(Date.now() + 3600e3).toISOString(), later = new Date(Date.now() + 5 * 864e5).toISOString();
    m.ingest({ rate_limits: { five_hour: { utilization: 40, resets_at: soon }, seven_day: { utilization: 85, resets_at: later } } });
    m.ingest({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.45, resetsAt: Math.floor(Date.parse(soon) / 1000) } });
    expect(m.get()).toMatchObject({ fiveHourPct: 45, weekPct: 85 });
    expect(mergeLimits({ fiveHourPct: null, fiveHourResetsAt: null, weekPct: 10, weekResetsAt: 2, source: 'stream', at: 9 }, null).weekPct).toBe(10);
  });

  it('a brain without cost.mjs gives a placeholder that says so (costKnown false)', async () => {
    const got: Usage[] = [];
    const m = new UsageMonitor({ root: tmpDir(), node: plainNode, claudeConfig: null, onUsage: u => got.push(u) });
    await m.refresh();
    expect(got[0]).toMatchObject({ todayUsd: 0, costKnown: false, costNote: expect.stringMatching(/cost\.mjs/) });
  });
  it('a cost.mjs past its time limit is reported as a timeout, once an hour; a refresh while one runs starts nothing (#184)', async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'ops', 'tools'), { recursive: true });
    const script = path.join(root, 'ops', 'tools', 'cost.mjs'), runs = path.join(root, 'runs.txt');
    fs.writeFileSync(script, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(runs)}, 'x');\nsetTimeout(() => {}, 30000);\n`);
    const killed = await runNode(plainNode, script, [], root, 300);
    expect(killed).toMatchObject({ code: null, killed: true });
    let now = 1_000_000;
    const got: Usage[] = [];
    const m = new UsageMonitor({ root, node: plainNode, claudeConfig: null, costTimeoutMs: 2000, now: () => now, onUsage: u => got.push(u) });
    const warn = vi.spyOn(log, 'warn');
    const timeouts = () => warn.mock.calls.filter(([scope, msg]) => scope === 'brain' && /cost\.mjs timed out after 2 s/.test(msg)).length;
    const before = timeouts();
    fs.writeFileSync(runs, '');
    await Promise.all([m.refresh(), m.refresh()]);
    expect(fs.readFileSync(runs, 'utf8')).toBe('x');
    expect(timeouts() - before).toBe(1);
    expect(got.at(-1)).toMatchObject({ costKnown: false, costNote: expect.stringMatching(/troppo lento/) });
    now += 60e3;
    await m.refresh();
    expect(timeouts() - before).toBe(1);
    now += 3600e3;
    await m.refresh();
    expect(timeouts() - before).toBe(2);
    warn.mockRestore();
  });
});
