// «Balanced mode» (main/agents/balanced-mode.ts, ADR 0218): picks spread over the pools in proportion to the credit left
// over the time to renewal, an exhausted pool and a model under the quality floor left out, the same input giving the
// same pick, batch picks counted before their chats exist, the effort of the role or its tier, the suggested role, and
// the setting off = nothing chosen; a fresh cache = no check at all.
import { describe, expect, it, vi } from 'vitest';
import { BalancedMode, QUALITY_FLOOR, TIER_EFFORT, balancedAskOf, balancedDecision, balancedStats, pickRoute, poolWeight, suggestRole, type BalancedInput, type BalancedRun } from '../../../src/main/agents/balanced-mode';
import { CreditBook, type PoolState } from '../../../src/main/agents/credits';
import type { Harness } from '../../../src/shared/contract';

const HOUR = 3600e3, DAY = 24 * HOUR, NOW = 1000 * DAY;
const st = (pool: string, p: Partial<PoolState>): PoolState => ({ pool, status: 'ok', left: null, resetsAt: null, periodMs: 7 * DAY, source: 'limits', at: NOW, ...p });
const run = (model: string, verdict: 'success' | 'fail', costUsd = 1): BalancedRun => ({ model, costUsd, endedAt: 1, counters: { reopened: 0 }, outcome: { verdict, basis: 'human', at: 1, by: 'x' } }) as unknown as BalancedRun;
const input = (states: Record<string, PoolState>, p: Partial<BalancedInput> = {}): BalancedInput => ({
  roleId: 'artisan', tier: 'mid', roleEffort: null, roleEngine: 'claude',
  candidates: [{ engine: 'claude', model: 'sonnet' }, { engine: 'cursor', model: 'gpt-5' }, { engine: 'opencode', model: 'openai/gpt-5.1' }],
  state: pool => states[pool] ?? null, runs: [], history: [], now: NOW, ...p });

describe('pickRoute', () => {
  it('spreads picks in proportion to the credit left over the time to renewal', () => {
    const states = {
      claude: st('claude', { left: 0.8, resetsAt: NOW + 3.5 * DAY }),        // 0.8 / 0.5 = 1.6
      cursor: st('cursor', { left: 0.2, resetsAt: NOW + 15 * DAY, periodMs: 30 * DAY }), // 0.2 / 0.5 = 0.4
      'opencode:openai': st('opencode:openai', { status: 'unknown', source: 'none' }), // 0.5 / 0.5 = 1.0
    };
    const history: string[] = [];
    for (let i = 0; i < 300; i++) history.push(pickRoute(input(states, { history })).pick!.pool);
    const count = (p: string) => history.filter(x => x === p).length;
    expect(count('claude')).toBeGreaterThanOrEqual(159); expect(count('claude')).toBeLessThanOrEqual(161); // 1.6 / 3.0 × 300 = 160
    expect(count('opencode:openai')).toBeGreaterThanOrEqual(99); expect(count('opencode:openai')).toBeLessThanOrEqual(101);
    expect(count('cursor')).toBeGreaterThanOrEqual(39); expect(count('cursor')).toBeLessThanOrEqual(41);
  });

  it('a pool near renewal weighs more than the same credit far from it', () => {
    const soon = poolWeight(st('a', { left: 0.5, resetsAt: NOW + 0.7 * DAY }), NOW)!;
    const late = poolWeight(st('b', { left: 0.5, resetsAt: NOW + 6.3 * DAY }), NOW)!;
    expect(soon).toBeGreaterThan(late);
    expect(poolWeight(st('c', { status: 'exhausted', left: 0 }), NOW)).toBeNull();
    expect(poolWeight(st('d', { status: 'probation' }), NOW)!).toBeLessThan(poolWeight(st('e', { status: 'unknown' }), NOW)!);
  });

  it('leaves out an exhausted pool and a model under the quality floor, and says why', () => {
    const states = { claude: st('claude', { status: 'exhausted', left: 0, note: 'finestra di 5 ore' }), cursor: st('cursor', { left: 0.9 }), 'opencode:openai': st('opencode:openai', { left: 0.9 }) };
    const runs = [...Array(4).fill(0).map(() => run('gpt-5', 'fail')), run('gpt-5', 'success')];
    const r = pickRoute(input(states, { runs }));
    expect(QUALITY_FLOOR).toBe(0.5);
    expect(r.pick).toMatchObject({ engine: 'opencode', model: 'openai/gpt-5.1', pool: 'opencode:openai' });
    expect(r.pick!.skipped.map(s => s.pool)).toEqual(['claude', 'cursor']);
    expect(r.pick!.reason).toMatch(/^Balanced mode, scelta della formula: opencode:openai .* esclusi: claude \(crediti finiti/);
    expect(r.pick!.reason.length).toBeLessThanOrEqual(300);
  });

  it('nothing left: no pick, the role\'s card stays', () => {
    const r = pickRoute(input({ claude: st('claude', { status: 'exhausted' }) }, { candidates: [{ engine: 'claude', model: 'sonnet' }] }));
    expect(r.pick).toBeNull();
    expect(r.pick === null && r.reason).toMatch(/resta il motore del ruolo/);
  });

  it('is deterministic; ties go to the role\'s engine, then success, then cost', () => {
    const same = { claude: st('claude', { left: 0.5 }), cursor: st('cursor', { left: 0.5 }) };
    const two = input(same, { candidates: [{ engine: 'cursor', model: 'gpt-5' }, { engine: 'claude', model: 'sonnet' }] });
    expect(pickRoute(two)).toEqual(pickRoute(two));
    expect(pickRoute(two).pick!.engine).toBe('claude');
    expect(pickRoute({ ...two, roleEngine: 'opencode' as Harness, runs: [run('gpt-5', 'success')] }).pick!.engine).toBe('cursor');
  });

  it('effort: the role\'s, else its tier\'s, within what the model takes', () => {
    const one = input({ claude: st('claude', { left: 0.5 }) }, { candidates: [{ engine: 'claude', model: 'sonnet', efforts: ['low', 'medium', 'high'] }] });
    expect(pickRoute(one).pick!.effort).toBe(TIER_EFFORT.mid);
    expect(pickRoute({ ...one, tier: 'top' }).pick!.effort).toBe('high');
    expect(pickRoute({ ...one, roleEffort: 'low' }).pick!.effort).toBe('low');
    expect(pickRoute({ ...one, candidates: [{ engine: 'claude', model: 'sonnet', efforts: [] }] }).pick!.effort).toBeNull();
  });
});

describe('suggestRole', () => {
  it('maps the kind of work to a role', () => {
    expect(suggestRole('review', 'x')).toBe('sentinel');
    expect(suggestRole('investigation', 'x')).toBe('scout');
    expect(suggestRole('writing', 'x')).toBe('herald');
    expect(suggestRole('bug-fix', 'x')).toBe('artisan');
    expect(suggestRole('bug-fix', 'Piano della migrazione')).toBe('strategist');
  });
});

describe('BalancedMode', () => {
  const engines = () => [
    { engine: 'claude' as Harness, enabled: true, trusted: true, models: [{ id: 'sonnet', name: 'S', efforts: ['low', 'medium', 'high'] as never }] },
    { engine: 'cursor' as Harness, enabled: true, trusted: true, models: [] },
    { engine: 'codex' as Harness, enabled: false, trusted: true, models: [] },
  ];
  const make = (on: boolean, book: CreditBook) => new BalancedMode({ on: () => on, book,
    role: () => ({ engine: 'claude', model: null, effort: null, tier: 'mid', tierMax: 'top' }),
    engines, tierModel: (e, t) => `${e}-${t}`, runs: () => [], now: () => NOW });

  it('off: nothing chosen, no check', async () => {
    const book = new CreditBook(null, {}, () => NOW);
    const refresh = vi.spyOn(book, 'refresh');
    expect(await make(false, book).choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: () => true })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('on: picks among the engines that may run, checks once, then reads only the cache', async () => {
    const claudeLimits = vi.fn(() => ({ fiveHourPct: 10, fiveHourResetsAt: NOW + HOUR, weekPct: 20, weekResetsAt: NOW + 3.5 * DAY, at: NOW }));
    const book = new CreditBook(null, { claudeLimits }, () => NOW);
    const auto = make(true, book);
    const a = await auto.choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: h => h !== 'cursor' });
    expect(a!.balancedRoute).toMatchObject({ engine: 'claude', model: 'claude-mid', pool: 'claude' });
    expect(a!.balanced).toMatchObject({ pool: 'claude' });
    expect(claudeLimits).toHaveBeenCalledTimes(1);
    auto.record(a);
    await auto.choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: () => true });
    expect(claudeLimits).toHaveBeenCalledTimes(1);
    expect(book.recentPicks()).toEqual(['claude']);
  });

  it('a batch counts its earlier picks (pending) before their chats exist', async () => {
    const book = new CreditBook(null, {}, () => NOW);
    const auto = make(true, book);
    const first = await auto.choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: () => true });
    const second = await auto.choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: () => true, pending: [first!.balancedRoute!.pool] });
    expect(second!.balancedRoute!.pool).not.toBe(first!.balancedRoute!.pool);
  });

  it('suggests another role when the work fits it, in the reason and the route', async () => {
    const auto = make(true, new CreditBook(null, {}, () => NOW));
    const c = await auto.choose({ roleId: 'artisan', title: 'Piano del rilascio', prompt: 'p', canRun: () => true });
    expect(c!.suggestedRole).toBe('strategist');
    expect(c!.reason).toMatch(/ruolo suggerito: strategist$/);
    const d = balancedDecision(c!, { roleId: 'artisan', version: 1, title: 'Piano del rilascio', prompt: 'p', now: NOW });
    expect(d).toMatchObject({ source: 'agent', agent: { id: 'artisan', chosenBy: 'parent' }, balanced: { by: 'formula', suggestedRole: 'strategist' } });
  });

  it('the formula\'s pick says so in the reason and in route.balanced.by', async () => {
    const c = await make(true, new CreditBook(null, {}, () => NOW)).choose({ roleId: 'artisan', title: 't', prompt: 'p', canRun: () => true });
    expect(c!.reason).toMatch(/^Balanced mode, scelta della formula: /);
    expect(c!.balanced!.by).toBe('formula');
  });
});

describe('BalancedMode: the agent picks (ADR 0218 §4)', () => {
  const engines = () => [
    { engine: 'claude' as Harness, enabled: true, trusted: true, models: [{ id: 'sonnet', name: 'S', efforts: ['low', 'medium', 'high'] as never }, { id: 'opus', name: 'O' }, { id: 'fable', name: 'F' }] },
    { engine: 'cursor' as Harness, enabled: true, trusted: true, models: [{ id: 'gpt-5', name: 'G' }] },
    { engine: 'codex' as Harness, enabled: false, trusted: true, models: [] },
  ];
  // every model of a tier, the first is the tier's model: a second «top» model (opus) and one in no tier (fable)
  const TIERS: Record<string, Record<string, string[]>> = { claude: { light: ['claude-light'], mid: ['claude-mid', 'sonnet'], top: ['claude-top', 'opus'] }, cursor: { mid: ['cursor-mid', 'gpt-5'] } };
  const rows = [
    { agentId: 'artisan', goal: 'Fix del totale ordini', startedAt: NOW - 30 * 60e3, ...run('sonnet', 'success', 2) },
    { agentId: 'artisan', goal: 'Fix del totale ordini', startedAt: NOW - 90 * 60e3, ...run('sonnet', 'fail', 4) },
    { agentId: 'scout', goal: 'Cerca nei log', startedAt: NOW - 10 * 60e3, ...run('gpt-5', 'success', 1) },
  ].map(r => ({ ...r, endedAt: NOW }));
  const make = (book: CreditBook, on = true) => new BalancedMode({ on: () => on, book,
    role: () => ({ engine: 'claude', model: null, effort: null, tier: 'mid', tierMax: 'mid' }),
    engines, tierModel: (e, t) => `${e}-${t}`, tierModels: (e, t) => TIERS[e]?.[t] ?? [], runs: () => rows as never, now: () => NOW });
  const base = { roleId: 'artisan', title: 't', prompt: 'p', canRun: (h: Harness) => h !== 'opencode' };

  it('takes the agent\'s pick within the limits: by agent, its why and the formula\'s proposal in the reason', async () => {
    const mode = make(new CreditBook(null, {}, () => NOW));
    const c = await mode.choose({ ...base, asked: { engine: 'cursor', model: 'gpt-5', why: 'il Scout va meglio su gpt-5' } });
    expect(c!.balancedRoute).toEqual({ engine: 'cursor', model: 'gpt-5', effort: 'medium', pool: 'cursor' });
    expect(c!.balanced).toMatchObject({ by: 'agent', pool: 'cursor' });
    expect(c!.reason).toMatch(/^Balanced mode, scelta dell'agente: il Scout va meglio su gpt-5 · cursor .* formula proponeva /);
    mode.record(c);
    expect((await mode.choose({ ...base, asked: { engine: 'claude', model: 'sonnet', effort: 'high', why: 'x' } }))!.balancedRoute).toEqual({ engine: 'claude', model: 'sonnet', effort: 'high', pool: 'claude' });
  });

  it('refuses only the hard limits, each with its reason', async () => {
    const book = new CreditBook(null, {}, () => NOW);
    book.signal('cursor', 'usage limit reached');
    const mode = make(book);
    const ask = (engine: string, model: string) => mode.choose({ ...base, asked: { engine: engine as Harness, model, why: 'x' } });
    await expect(ask('codex', 'codex-mid')).rejects.toThrow(/switched off/);
    await expect(ask('opencode', 'openai/gpt-5')).rejects.toThrow(/switched off|may not open/);
    await expect(ask('claude', 'claude-top')).rejects.toThrow(/above the role's tierMax/);
    await expect(ask('claude', 'opus')).rejects.toThrow(/above the role's tierMax/);
    await expect(ask('claude', 'fable')).rejects.toThrow(/in no tier up to/);
    await expect(ask('claude', 'mystery')).rejects.toThrow(/in no tier up to/);
    await expect(ask('cursor', 'gpt-5')).rejects.toThrow(/credit is exhausted/);
  });

  it('off: a pick by the agent is refused', async () => {
    await expect(make(new CreditBook(null, {}, () => NOW), false).choose({ ...base, asked: { engine: 'claude', model: 'sonnet', why: 'x' } })).rejects.toThrow(/only with Balanced mode on/);
  });

  it('status: pools with target and share, stats per role × model × kind, the formula\'s proposal, no network', async () => {
    const claudeLimits = vi.fn(() => ({ fiveHourPct: 10, fiveHourResetsAt: NOW + HOUR, weekPct: 40, weekResetsAt: NOW + 3.5 * DAY, at: NOW }));
    const mode = make(new CreditBook(null, { claudeLimits }, () => NOW));
    const s = await mode.status({ roleId: 'artisan', title: 'Piano del rilascio', canRun: base.canRun });
    expect(s.on).toBe(true);
    expect(s.pools.map(p => p.pool).sort()).toEqual(['claude', 'cursor']);
    const claude = s.pools.find(p => p.pool === 'claude')!;
    expect(claude.left).toBeCloseTo(0.6);
    expect(claude.target! + s.pools.find(p => p.pool === 'cursor')!.target!).toBeCloseTo(1);
    expect(s.stats).toEqual([expect.objectContaining({ roleId: 'artisan', model: 'sonnet', runs: 2, avgCostUsd: 3 })]);
    expect(s.proposal).toMatchObject({ pool: expect.any(String), reason: expect.stringMatching(/^Balanced mode, scelta della formula/) });
    expect(s.suggestedRole).toBe('strategist');
    expect(s.howTo).toMatch(/balanced \{engine, model/);
    await mode.status({ canRun: () => true });
    expect(claudeLimits).toHaveBeenCalledTimes(1);
  });
});

describe('balancedStats and balancedAskOf', () => {
  it('groups the finished runs, the busiest first, and skips running ones', () => {
    const r = (agentId: string, model: string, endedAt?: number) => ({ ...run(model, 'success', 1), agentId, goal: 'Fix del bug', startedAt: 0, endedAt }) as never;
    const s = balancedStats([r('artisan', 'a', 60e3), r('artisan', 'a', 120e3), r('scout', 'b', 60e3), r('artisan', 'a')]);
    expect(s.map(x => [x.roleId, x.model, x.runs])).toEqual([['artisan', 'a', 2], ['scout', 'b', 1]]);
    expect(s[0]!.avgMinutes).toBe(1.5);
    expect(balancedStats([r('artisan', 'a', 1)], 'scout')).toEqual([]);
  });

  it('checks the shape of `balanced`', () => {
    expect(balancedAskOf(undefined, 'balanced')).toBeUndefined();
    expect(balancedAskOf({ engine: 'claude', model: ' sonnet ', why: ' ok ' }, 'balanced')).toEqual({ engine: 'claude', model: 'sonnet', why: 'ok' });
    expect(() => balancedAskOf({ engine: 'claude', model: 'sonnet' }, 'tasks[0].balanced')).toThrow(/^tasks\[0\]\.balanced: /);
    expect(() => balancedAskOf({ engine: 'claude', model: 'sonnet', effort: 'huge', why: 'x' }, 'balanced')).toThrow();
  });
});
