// The credit rule on the app's live data (ADR 0354): the owner's real case (six limit errors in 3 minutes on
// OpenCode/OpenAI, a 24-hour pause, the next morning 5h 0% · 7d 31% and Sol still skipped), the book of facts
// (main/agents/credits.ts CreditBook), the live wiring (main/agents/credit-live.ts), the usage monitor's per-pool
// readings and its shared, throttled «read now» (main/brain/usage.ts), the pick's reasons and the user's own model for
// a piece of work. A fake clock and fake readers: never a real engine, network or timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreditBook, FRESH_WAIT_MS } from '../../../src/main/agents/credits';
import { KICK_MS, creditLive, readingOf, type CreditUsage } from '../../../src/main/agents/credit-live';
import { GRACE_MS, creditWaitWatch } from '../../../src/main/agents/credit-wait';
import { inheritUserModel } from '../../../src/main/agents/catalog';
import { UsageMonitor, READ_MIN_MS, accountHash } from '../../../src/main/brain/usage';
import { SHORT_PAUSE_MS, type CreditReading } from '../../../src/shared/credit-rule';
import { pickInLevel, pickLines, roomOf, type LevelModel } from '../../../src/shared/model-levels';
import type { ChatSummary, HarnessUsage, HarnessUsageWindow } from '../../../src/shared/contract';

const MIN = 60e3, HOUR = 60 * MIN;
const T = Date.UTC(2026, 10, 24, 21, 0);
const LIMIT = 'You have hit your usage limit';
const dirs: string[] = [];
const hm = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-credit-truth-')); dirs.push(d); return path.join(d, 'credits.json'); };

const win = (label: string, usedPercent: number, resetsAt: number | null): HarnessUsageWindow => ({ kind: label === '5h' ? 'five-hour' : 'weekly', label, usedPercent, resetsAt });
const read = (pool: string, at: number, windows: HarnessUsageWindow[], account = 'aaaa1111'): CreditReading => ({ at, ok: true, pool, account, windows });

/** a book whose readings are set by the test, on a clock the test moves */
function bookOf(o: { file?: string | null; readable?: boolean; read?: (pools: readonly string[]) => Promise<void> } = {}) {
  const clock = { t: T };
  const readings = new Map<string, CreditReading>();
  const book = new CreditBook(o.file ?? null, { reading: p => readings.get(p) ?? null, readable: () => o.readable ?? true, ...(o.read ? { read: o.read } : {}), now: () => clock.t });
  return { book, clock, readings };
}
const SOL = 'openai/gpt-5.5', OTHER = 'zen/kimi';
const levelOf = (): LevelModel[] => [{ engine: 'opencode', model: SOL }, { engine: 'opencode', model: OTHER }, { engine: 'claude', model: 'claude-sonnet' }];
const pick = (book: CreditBook, now: number) => pickInLevel(levelOf(), () => null, x => roomOf(book.verdict(x.engine === 'opencode' ? `opencode:${x.model!.startsWith('zen/') ? 'zen' : 'openai'}` : x.engine, x.model)), { now, fmt: at => `@${Math.round((at - T) / MIN)}m` });

describe('the owner\'s real case', () => {
  it('1. six limit errors in about 3 minutes open one short pause, not a doubled one', () => {
    const { book, clock } = bookOf();
    for (let i = 0; i < 6; i++) { clock.t = T + i * 36e3; book.observe('opencode', SOL, LIMIT, true, clock.t - 20e3); }
    expect(book.facts('opencode:openai')!.error).toMatchObject({ pauseFrom: T, pauseMs: SHORT_PAUSE_MS });
    expect(book.verdict('opencode:openai', SOL)).toMatchObject({ state: 'out', until: T + SHORT_PAUSE_MS, source: 'error' });
  });
  it('2. the old 24-hour pause saved in credits.json and a fresh 5h 0% · 7d 31% reading: Sol is picked', () => {
    const file = tmp();
    fs.writeFileSync(file, JSON.stringify({ version: 1, pools: [{ pool: 'opencode:openai', status: 'exhausted', at: T, resetsAt: null, coolMs: 86400000 }] }));
    const { book, clock, readings } = bookOf({ file });
    // before (the old code): Sol skipped for a day. Now the saved pause is recomputed to the short one
    expect(book.facts('opencode:openai')!.error).toMatchObject({ pauseMs: SHORT_PAUSE_MS });
    clock.t = T + 11 * HOUR; // the next morning
    readings.set('opencode:openai', read('opencode:openai', clock.t - MIN, [win('5h', 0, clock.t + 5 * HOUR), win('7g', 31, clock.t + 80 * HOUR)]));
    expect(book.verdict('opencode:openai', SOL).state).toBe('free');
    const p = pick(book, clock.t)!;
    expect(p.chosen.model).toBe(SOL);
    expect(p.skipped).toEqual([]);
  });
});

describe('the book of facts', () => {
  it('9. a clean turn that started after the last error frees the pool during the pause; one started before does not', () => {
    const { book, clock } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T - 10e3);
    clock.t = T + MIN;
    book.observe('opencode', SOL, null, false, T - 5e3);
    expect(book.verdict('opencode:openai', SOL).state).toBe('out');
    book.observe('opencode', SOL, null, false, T + 30e3);
    expect(book.verdict('opencode:openai', SOL).state).toBe('free');
  });
  it('8. a probe that fails after the pause doubles it; on a pool the app cannot read the cap is a day', () => {
    const { book, clock } = bookOf({ readable: false });
    book.observe('opencode', SOL, LIMIT, true, T);
    clock.t = T + SHORT_PAUSE_MS + MIN;
    book.claim('opencode:openai', 'chat-1');
    book.observe('opencode', SOL, LIMIT, true, T + SHORT_PAUSE_MS + 10e3);
    expect(book.facts('opencode:openai')!.error!.pauseMs).toBe(2 * SHORT_PAUSE_MS);
    expect(book.facts('opencode:openai')!.probe).toBeNull();
  });
  it('7. only one chat starts on probation: the first claim owns it', () => {
    const { book, clock } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T);
    clock.t = T + SHORT_PAUSE_MS + 1;
    book.claim('opencode:openai', 'chat-1');
    expect(book.verdict('opencode:openai', SOL, 'chat-1').state).toBe('probation');
    expect(book.verdict('opencode:openai', SOL, 'chat-2').state).toBe('out');
    book.claim('opencode:openai', 'chat-2');
    expect(book.facts('opencode:openai')!.probe!.owner).toBe('chat-1');
  });
  it('another account, or a new login after a signed-out reading, drops the old pause', () => {
    const { book, readings } = bookOf();
    readings.set('codex', read('codex', T - MIN, [win('5h', 10, T + HOUR)], 'aaaa1111'));
    book.observe('codex', null, LIMIT, true, T);
    expect(book.verdict('codex', null).state).toBe('out');
    book.onReading('codex', { account: 'aaaa1111', status: 'ok' });
    expect(book.facts('codex')!.error).not.toBeNull();
    book.onReading('codex', { account: 'bbbb2222', status: 'ok' });
    expect(book.facts('codex')!.error).toBeNull();
    book.observe('codex', null, LIMIT, true, T);
    book.relogged('codex');
    expect(book.facts('codex')!.error).toBeNull();
  });
  it('12. two OpenCode providers: a limit on OpenAI never stops Zen', () => {
    const { book } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T);
    expect(book.verdict('opencode:openai', SOL).state).toBe('out');
    expect(book.verdict('opencode:zen', OTHER).state).toBe('unknown');
    const p = pick(book, T)!;
    expect(p.chosen.model).toBe(OTHER);
    expect(p.skipped[0]).toMatchObject({ engine: 'opencode', model: SOL, kind: 'credit', state: 'out', until: T + SHORT_PAUSE_MS });
  });
  it('10. five launches on a stopped pool read it once, shared', async () => {
    const reads = vi.fn(async () => {});
    const { book } = bookOf({ read: reads });
    book.observe('opencode', SOL, LIMIT, true, T);
    await Promise.all(Array.from({ length: 5 }, () => book.fresh(['opencode:openai'])));
    expect(reads).toHaveBeenCalledTimes(1);
  });
  it('11. a read that hangs never blocks a launch: it goes on after a short wait with what is known', async () => {
    vi.useFakeTimers();
    const { book } = bookOf({ read: () => new Promise<void>(() => {}) });
    book.observe('opencode', SOL, LIMIT, true, T);
    let done = false;
    void book.fresh(['opencode:openai']).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(FRESH_WAIT_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });
  it('«Riprova ora»: a pool stopped by an error goes to probation now; one stopped by a spent window stays out', async () => {
    const { book, readings } = bookOf({ read: async () => {} });
    book.observe('opencode', SOL, LIMIT, true, T);
    expect((await book.retry('opencode:openai')).state).toBe('probation');
    readings.set('claude', read('claude', T, [win('5h', 100, T + 2 * HOUR)]));
    expect((await book.retry('claude')).state).toBe('out');
  });
  it('16. every model of the level out: the pick says so and names the nearest return', () => {
    const { book, readings } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T);
    readings.set('opencode:zen', read('opencode:zen', T, [win('5h', 100, T + 3 * HOUR)]));
    readings.set('claude', read('claude', T, [win('5h', 100, T + 2 * HOUR)]));
    const p = pick(book, T)!;
    expect(p.allOut).toBe(true);
    expect(p.reason).toMatch(/il primo torna alle @5m/);
    expect(pickLines({ chosen: `${SOL} (opencode)`, skipped: p.skipped, allOut: true }, T)).toMatch(/aspetta il rinnovo/);
  });
});

describe('the live wiring', () => {
  function live(readings = new Map<string, HarnessUsage>()) {
    const clock = { t: T };
    const timers: { fn: () => void; at: number }[] = [];
    let onReading: ((pool: string, next: HarnessUsage, prev: HarnessUsage | undefined) => void) | null = null;
    let decorate: ((u: never) => unknown) | null = null;
    const usage: CreditUsage = {
      usageReading: p => readings.get(p),
      usageReadNow: vi.fn(async () => {}),
      onUsageReading: fn => { onReading = fn; },
      decorateUsage: fn => { decorate = fn as never; },
    };
    const changed = vi.fn();
    const c = creditLive({ file: null, usage, changed, now: () => clock.t, later: (fn, ms) => { const row = { fn, at: clock.t + ms }; timers.push(row); return { cancel: () => { timers.splice(timers.indexOf(row), 1); } }; } });
    return { c, clock, timers, usage, changed, readings, fire: () => { const due = timers.splice(0); for (const x of due) { clock.t = Math.max(clock.t, x.at); x.fn(); } }, reading: (p: string, n: HarnessUsage, prev?: HarnessUsage) => onReading!(p, n, prev), decorate: (u: unknown) => decorate!(u as never) };
  }
  const usage = (pool: string, at: number, windows: HarnessUsageWindow[], more: Partial<HarnessUsage> = {}): HarnessUsage =>
    ({ harness: pool.split(':')[0] as never, status: 'ok', source: 'oauth', at, windows, pool, account: 'aaaa1111', ...more } as HarnessUsage);

  it('a reading of the panel only (OpenCode\'s log, no pool) is never a reading of the rule', () => {
    expect(readingOf({ harness: 'opencode', status: 'exhausted', source: 'log', at: T, windows: [] } as unknown as HarnessUsage)).toBeNull();
    expect(readingOf(usage('opencode:openai', T, []))).toMatchObject({ pool: 'opencode:openai', ok: true });
  });
  it('15. a spent window ends with the app open: the engine is read again at its reset and the waiting chats are told', async () => {
    const f = live();
    f.readings.set('claude', usage('claude', T, [win('5h', 100, T + 2 * HOUR)]));
    f.c.schedule();
    expect(f.timers).toHaveLength(1);
    expect(f.timers[0]!.at).toBe(T + 2 * HOUR + 1000);
    f.readings.set('claude', usage('claude', T + 2 * HOUR + 1000, [win('5h', 0, T + 7 * HOUR)]));
    f.fire(); await new Promise(r => setImmediate(r));
    expect(f.usage.usageReadNow).toHaveBeenCalledWith(['claude']);
    expect(f.changed).toHaveBeenCalled();
    expect(f.c.verdict('claude', null).state).toBe('free');
  });
  it('15b. after a restart past the reset: read again, and until then one chat tries', () => {
    const f = live();
    f.readings.set('claude', usage('claude', T - 3 * HOUR, [win('5h', 100, T - HOUR)]));
    expect(f.c.verdict('claude', null)).toMatchObject({ state: 'probation', reread: true });
  });
  it('a new reading of another account drops the pause, and a limit error reads the pool now', async () => {
    const f = live();
    f.c.observe('codex', null, LIMIT, true, T);
    expect(f.usage.usageReadNow).toHaveBeenCalledWith(['codex']);
    f.reading('codex', usage('codex', T + MIN, [win('5h', 10, T + HOUR)], { account: 'bbbb2222' }), usage('codex', T - MIN, [], { account: 'aaaa1111' }));
    expect(f.c.book.facts('codex')!.error).toBeNull();
    expect(f.changed).toHaveBeenCalled();
  });
  it('the limits panel never shows only green for an engine the app skips', () => {
    const f = live();
    f.readings.set('opencode:zen', usage('opencode:zen', T, [win('5h', 10, T + HOUR)]));
    f.c.observe('opencode', SOL, LIMIT, true, T);
    const u = f.decorate({ harnesses: [{ harness: 'opencode', pool: 'opencode:zen', status: 'ok', windows: [] }] }) as { harnesses: { credit?: { state: string; pool: string } }[] };
    expect(u.harnesses[0]!.credit).toMatchObject({ state: 'out', pool: 'opencode:openai' });
  });
});

describe('the usage monitor: one reading per pool, read now shared and throttled', () => {
  const monitor = (provider: (h: string) => Promise<HarnessUsage[]>, now: () => number) => new UsageMonitor({ root: null, node: {} as never, claudeConfig: null, provider: provider as never, now, onUsage() {} });
  it('12b. OpenCode\'s two providers are two readings; the address is kept only as a hash', async () => {
    const m = monitor(async () => [
      { harness: 'opencode', pool: 'opencode:zen', status: 'ok', source: 'oauth', at: T, windows: [win('5h', 3, T + HOUR)], accountEmail: 'x@example.org' } as HarnessUsage,
      { harness: 'opencode', pool: 'opencode:openai', status: 'ok', source: 'oauth', at: T, windows: [win('5h', 100, T + HOUR)] } as HarnessUsage,
    ], () => T);
    await m.readNow(['opencode']);
    expect(m.reading('opencode:zen')!.windows[0]!.usedPercent).toBe(3);
    expect(m.reading('opencode:openai')!.windows[0]!.usedPercent).toBe(100);
    expect(m.reading('opencode:zen')!.account).toBe(accountHash('x@example.org'));
    expect(m.reading('opencode:zen')!.account).not.toMatch(/@/);
  });
  it('10b. reads of one vendor are shared while one runs, and never closer than its minimum interval', async () => {
    const clock = { t: T };
    const provider = vi.fn(async () => [] as HarnessUsage[]);
    const m = monitor(provider, () => clock.t);
    await Promise.all([m.readNow(['claude']), m.readNow(['claude']), m.readNow(['claude'])]);
    expect(provider).toHaveBeenCalledTimes(1);
    clock.t += READ_MIN_MS.claude! - 1; await m.readNow(['claude']);
    expect(provider).toHaveBeenCalledTimes(1);
    clock.t += 2; await m.readNow(['claude']);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('the user\'s own model for a piece of work (13, 14)', () => {
  const chats = [
    { id: 'orc', parentId: null },
    { id: 'strat', parentId: 'orc', userModel: { engine: 'opencode' as const, model: SOL } },
    { id: 'kid', parentId: 'strat' },
  ];
  it('14. holds for the chats opened under it when their role has that model; never set by an agent itself', () => {
    expect(inheritUserModel({ parentId: 'kid', roleId: 'scout' }, chats, () => true)).toMatchObject({ userModel: { model: SOL } });
    expect(inheritUserModel({ parentId: 'kid', roleId: 'scout' }, chats, () => false).userModel).toBeUndefined();
    expect(inheritUserModel({ parentId: 'orc', roleId: 'scout' }, chats, () => true).userModel).toBeUndefined();
    expect(inheritUserModel({ parentId: 'kid', roleId: 'scout', orchestrator: true }, chats, () => true).userModel).toBeUndefined();
  });
  it('14b. agent_delegate has no userModel field: an agent cannot invent the user\'s pick', async () => {
    const { delegationTools } = await import('../../../src/main/agents/delegation');
    const tools = delegationTools({ chats: {} as never, roles: () => ({ profiles: [], models: [] }) as never, settings: () => ({}) as never, engineRefusal: () => null, label: '', runs: () => [] });
    const schema = tools.find(t => t.name === 'agent_delegate')!.inputSchema as { properties: { tasks: { items: { properties: Record<string, unknown>; additionalProperties: boolean } } } };
    expect(schema.properties.tasks.items.properties.userModel).toBeUndefined();
    expect(schema.properties.tasks.items.additionalProperties).toBe(false);
  });
  it('13. a pick that skipped a model is said in one line: which, why and until when', () => {
    const { book } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T);
    const p = pick(book, T)!;
    expect(pickLines({ chosen: `${p.chosen.model} (${p.chosen.engine})`, skipped: p.skipped }, T)).toBe(`${SOL} (opencode) saltato: credito finito, errore di limite: pausa breve, torna alle ${hm(T + SHORT_PAUSE_MS)} · parte su ${OTHER} (opencode)`);
  });
});

describe('review fixes', () => {
  it('a pick that finds a stopped pool wakes the waiting chats at most once per pool in KICK_MS, never in a loop', async () => {
    const clock = { t: T };
    const later: (() => void)[] = [];
    let calls = 0;
    const ref: { c?: ReturnType<typeof creditLive> } = {};
    const c = creditLive({ file: null, usage: { usageReadNow: async () => {} }, now: () => clock.t, later: (fn, ms) => { if (ms === 0) later.push(fn); return { cancel() {} }; },
      changed: () => { calls++; ref.c!.room('cursor', null); } });
    ref.c = c;
    c.observe('cursor', null, LIMIT, true, T);
    c.room('cursor', null);
    for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); for (const fn of later.splice(0)) fn(); }
    expect(calls).toBeLessThanOrEqual(2);
    clock.t += KICK_MS;
    c.room('cursor', null);
    await new Promise(r => setImmediate(r)); for (const fn of later.splice(0)) fn();
    expect(calls).toBeLessThanOrEqual(3);
  });
  it('a pause starts again from the short one after a clean turn: errors days apart never grow to a day', () => {
    const { book, clock } = bookOf({ readable: false });
    for (let day = 0; day < 10; day++) {
      clock.t = T + day * 24 * HOUR;
      book.observe('cursor', null, LIMIT, true, clock.t - 10e3);
      clock.t += SHORT_PAUSE_MS + MIN;
      book.observe('cursor', null, null, false, clock.t - 10e3);
    }
    expect(book.facts('cursor')!.error!.pauseMs).toBe(SHORT_PAUSE_MS);
  });
  it('a pool on probation after a passed reset gets its one probe too; «Riprova ora» never wipes a probe in flight', async () => {
    const { book, readings, clock } = bookOf({ read: async () => {} });
    readings.set('claude', read('claude', T - 3 * HOUR, [win('5h', 100, T - HOUR)]));
    book.claim('claude', 'chat-1');
    expect(book.verdict('claude', null, 'chat-2').state).toBe('out');
    book.observe('opencode', SOL, LIMIT, true, T);
    clock.t = T + SHORT_PAUSE_MS + 1;
    book.claim('opencode:openai', 'chat-1');
    await book.retry('opencode:openai');
    expect(book.facts('opencode:openai')!.probe!.owner).toBe('chat-1');
  });
  it('the watch claims a probation pool only when the move runs, not while it is announced', async () => {
    const clock = { t: 1000 };
    const claim = vi.fn();
    const chat = { id: 'a', harness: 'claude', model: 'm-old', state: 'idle', agent: { id: 'scout', source: 'catalog' }, creditWait: { at: 1, model: 'm-old', card: 'claude:m-old' } } as unknown as ChatSummary;
    const chats = { list: () => [chat], creditPlan: (_id: string, next: { card: string; at: number }) => { chat.creditWait = { ...chat.creditWait!, next }; },
      creditResume: vi.fn(async () => true), creditContinue: vi.fn(async () => true), creditWaiting() {}, creditHold() {}, creditFailed() {} };
    const watch = creditWaitWatch({ chats, card: () => ({ engine: 'claude', model: 'm-next', effort: null }), claim, now: () => clock.t, later: () => {} });
    watch();
    expect(claim).not.toHaveBeenCalled();
    clock.t += GRACE_MS + 1; watch();
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ model: 'm-next' }), 'a');
  });
});

describe('a claim the move never used', () => {
  it('is released, so the next chat may try', async () => {
    const clock = { t: 1000 };
    const claim = vi.fn(), release = vi.fn();
    const chat = { id: 'a', harness: 'claude', model: 'm-old', state: 'idle', agent: { id: 'scout', source: 'catalog' }, creditWait: { at: 1, model: 'm-old', card: 'claude:m-old' } } as unknown as ChatSummary;
    const chats = { list: () => [chat], creditPlan: (_id: string, next: { card: string; at: number }) => { chat.creditWait = { ...chat.creditWait!, next }; },
      creditResume: vi.fn(async () => false), creditContinue: vi.fn(async () => true), creditWaiting() {}, creditHold() {}, creditFailed() {} };
    const watch = creditWaitWatch({ chats, card: () => ({ engine: 'claude', model: 'm-next', effort: null }), claim, release, now: () => clock.t, later: () => {} });
    watch(); clock.t += GRACE_MS + 1; watch(); await new Promise(r => setImmediate(r));
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ model: 'm-next' }), 'a');
    const { book, clock: c2 } = bookOf();
    book.observe('opencode', SOL, LIMIT, true, T);
    c2.t = T + SHORT_PAUSE_MS + 1;
    book.claim('opencode:openai', 'chat-1');
    book.release('opencode:openai', 'chat-2');
    expect(book.facts('opencode:openai')!.probe!.owner).toBe('chat-1');
    book.release('opencode:openai', 'chat-1');
    expect(book.verdict('opencode:openai', SOL, 'chat-2').state).toBe('probation');
  });
});
