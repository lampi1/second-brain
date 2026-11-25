// The user's engine and model for a whole work tree, and a limit that stops one model (ADR 0359): the tree's record is
// read at every launch at any depth (routingFor), an excluded engine is never picked nor a fallback and a launch with
// nothing left is refused with why (catalog.resolve exclude), the tree's pick for a role needs not be on the card's
// levels, a limit error that does not say «account» pauses that model only (credits.ts), the provider's own reset time is
// the pause, a probe frees the model, and the user's explicit pick skips an assumed pause once (credit-rule ignoreError).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService, routingFor } from '../../../src/main/agents/catalog';
import { CreditBook } from '../../../src/main/agents/credits';
import { creditMove } from '../../../src/main/agents/credit-wait';
import { routingOf } from '../../../src/main/agents/discovery';
import { SHORT_PAUSE_MS, accountWideLimit, providerPauseMs } from '../../../src/shared/credit-rule';
import type { AgentModelChoice } from '../../../src/shared/agents';
import type { ChatSummary } from '../../../src/shared/contract';

const HOUR = 3600e3, T = Date.UTC(2026, 10, 25, 12, 0);
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const SOL = 'openai/gpt-6.2-sol', ASTRA = 'openai/gpt-6.2-astra', MODEL_LIMIT = 'The usage limit has been reached';

describe('routingFor: the tree\'s record at any depth', () => {
  const chats: Parameters<typeof routingFor>[1] = [
    { id: 'root', parentId: null, routing: { picks: { scout: { engine: 'opencode', model: SOL } }, exclude: ['cursor'] } },
    { id: 'strat', parentId: 'root', routing: { picks: { scout: { engine: 'codex', model: 'gpt-x' }, artisan: { engine: 'claude', model: 'm' } }, exclude: ['antigravity', 'cursor'] } },
    { id: 'kid', parentId: 'strat' },
  ];
  it('a grandchild reads the chain: the nearest record per role, every excluded engine once', () => {
    const r = routingFor('kid', chats);
    expect(r.picks.scout).toMatchObject({ model: 'gpt-x' });
    expect(r.picks.artisan).toMatchObject({ model: 'm' });
    expect(r.exclude).toEqual(['antigravity', 'cursor']);
    expect(routingFor('root', chats).picks.scout).toMatchObject({ model: SOL });
  });
  it('it is read at each launch: a change on the root holds for the next chat, and a chat without ancestors has none', () => {
    const live = chats.map(c => ({ ...c }));
    expect(routingFor('root', live).exclude).toEqual(['cursor']);
    live[0]!.routing = { exclude: ['codex'] } as never;
    expect(routingFor('strat', live)).toMatchObject({ picks: { scout: { model: 'gpt-x' } }, exclude: ['antigravity', 'cursor', 'codex'] });
    expect(routingFor(null, chats)).toEqual({ picks: {}, exclude: [] });
  });
});

const engine = (id: string, ids: string[]): AgentModelChoice => ({ engine: id, label: id, enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed',
  models: ids.map(m => ({ id: m, name: m })), installed: true, authenticated: true });
function catalog(room: (engine: string, model: string | null, asker?: string, o?: { ignoreError?: boolean }) => { state: 'ok' | 'out'; why: string; resetsAt: number | null } = () => ({ state: 'ok', why: '', resetsAt: null })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routing-tree-')); roots.push(dir);
  return new AgentCatalogService({ userData: dir, models: () => [engine('claude', ['m-mid']), engine('codex', ['gpt-x']), engine('cursor', ['comp']), engine('opencode', [SOL, ASTRA])],
    tierModel: () => 'm-mid', room });
}
const LEVELS = { base: [{ engine: 'claude', model: 'm-mid' }, { engine: 'codex', model: 'gpt-x' }, { engine: 'cursor', model: 'comp' }] };
const withLevels = (c: AgentCatalogService) => { const p = c.list().profiles.find(x => x.id === 'scout')!; c.save({ instructions: p.instructions, engine: p.engine, model: p.model, tools: p.tools, permissionCeiling: p.permissionCeiling, tier: p.tier, tierMax: p.tierMax, launches: p.launches, skills: p.skills, levels: LEVELS } as never, 'scout'); return c; };
const start = (c: AgentCatalogService, extra: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => c.resolve({ harness: 'claude', cwd: os.tmpdir(), roleId: 'scout', ...extra } as never, o);

describe('a launch under a tree\'s record', () => {
  it('the tree\'s pick for a role starts that model even when the card\'s levels do not list it', () => {
    const c = catalog();
    expect(() => start(c, { userModel: { engine: 'opencode', model: SOL } })).toThrow(/non è tra i modelli dei suoi livelli/);
    const r = start(c, { userModel: { engine: 'opencode', model: SOL } }, { freePick: true });
    expect([r.request.harness, r.request.model]).toEqual(['opencode', SOL]);
  });
  it('an excluded engine is never picked: the card moves to its next model, never to the excluded one', () => {
    const c = withLevels(catalog());
    const r = start(c, {}, { exclude: ['claude'] });
    expect(r.request.harness).toBe('codex');
    expect(r.presetChoice?.skipped?.[0]).toMatchObject({ engine: 'claude', kind: 'off' });
    expect(() => start(c, {}, { exclude: ['claude', 'codex', 'cursor'] })).toThrow(/escluso dall’utente/);
  });
  it('with nothing left the launch is refused and says why; the user\'s pick on an excluded engine too', () => {
    const c = catalog();
    const all = ['claude', 'codex', 'cursor', 'opencode'];
    expect(() => start(c, {}, { exclude: all })).toThrow(/escluso dall’utente per questo lavoro/);
    expect(() => start(c, { userModel: { engine: 'opencode', model: SOL } }, { freePick: true, exclude: ['opencode'] })).toThrow(/opencode è escluso dall’utente/);
  });
});

describe('a limit that stops one model (credit book)', () => {
  const book = (readable = false) => {
    const clock = { t: T };
    return { clock, b: new CreditBook(null, { reading: () => null, readable: () => readable, now: () => clock.t }, () => clock.t) };
  };
  it('words that do not say «account» pause that model; Sol still answers, the pool is not out', () => {
    const { b, clock } = book();
    b.observe('opencode', ASTRA, MODEL_LIMIT, true, T - 1000);
    expect(b.verdict('opencode:openai', ASTRA)).toMatchObject({ state: 'out', until: T + SHORT_PAUSE_MS });
    expect(b.verdict('opencode:openai', SOL).state).not.toBe('out');
    expect(b.verdict('opencode:openai', null).state).not.toBe('out');
    clock.t = T + 2 * HOUR;
    expect(b.verdict('opencode:openai', SOL).state).not.toBe('out');
  });
  it('an account-wide text pauses the whole pool', () => {
    const { b } = book();
    b.observe('opencode', ASTRA, 'You have hit your usage limit', true, T - 1000);
    expect(b.verdict('opencode:openai', SOL).state).toBe('out');
    expect(accountWideLimit('Your credit balance is too low')).toBe(true);
    expect(accountWideLimit(MODEL_LIMIT)).toBe(false);
  });
  it('the provider\'s reset time is the pause (at least the short pause, at most a day)', () => {
    expect(providerPauseMs('usage limit reached, try again in 2 hours', T)).toBe(2 * HOUR);
    expect(providerPauseMs('retry after 90 seconds', T)).toBe(90e3);
    expect(providerPauseMs('limit, resets 2026-11-25T15:00:00Z', T)).toBe(3 * HOUR);
    expect(providerPauseMs(MODEL_LIMIT, T)).toBeNull();
    const { b } = book();
    b.observe('opencode', ASTRA, 'The usage limit has been reached, try again in 2 hours', true, T - 1000);
    expect(b.verdict('opencode:openai', ASTRA)).toMatchObject({ state: 'out', until: T + 2 * HOUR });
    b.observe('opencode', SOL, 'The usage limit has been reached, retry after 10 seconds', true, T - 1000);
    expect(b.verdict('opencode:openai', SOL).until).toBe(T + SHORT_PAUSE_MS);
  });
  it('probe recovery: after the pause one chat tries; its clean turn frees the model, a failed one doubles the pause', () => {
    const { b, clock } = book();
    b.observe('opencode', ASTRA, MODEL_LIMIT, true, T - 1000);
    clock.t = T + SHORT_PAUSE_MS + 1;
    expect(b.verdict('opencode:openai', ASTRA, 'chat-1').state).toBe('probation');
    b.claim('opencode:openai', 'chat-1', ASTRA);
    expect(b.verdict('opencode:openai', ASTRA, 'chat-2').state).toBe('out');
    expect(b.verdict('opencode:openai', ASTRA, 'chat-1').state).toBe('probation');
    // the probe fails: the pause doubles
    const failedAt = clock.t + 1000;
    clock.t = failedAt;
    b.observe('opencode', ASTRA, MODEL_LIMIT, true, T + SHORT_PAUSE_MS + 500);
    expect(b.verdict('opencode:openai', ASTRA)).toMatchObject({ state: 'out', until: failedAt + 2 * SHORT_PAUSE_MS });
    // later the probe works
    clock.t = failedAt + 2 * SHORT_PAUSE_MS + 1;
    b.claim('opencode:openai', 'chat-3', ASTRA);
    b.observe('opencode', ASTRA, null, false, clock.t);
    expect(['free', 'unknown']).toContain(b.verdict('opencode:openai', ASTRA).state);
    expect(b.verdict('opencode:openai', ASTRA).state).not.toBe('out');
  });
  it('the models survive a restart of the book', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-credits-')), 'credits.json'); roots.push(path.dirname(file));
    const clock = { t: T };
    const a = new CreditBook(file, { reading: () => null, now: () => clock.t }, () => clock.t);
    a.observe('opencode', ASTRA, MODEL_LIMIT, true, T - 1000);
    const b = new CreditBook(file, { reading: () => null, now: () => clock.t }, () => clock.t);
    expect(b.verdict('opencode:openai', ASTRA).state).toBe('out');
    expect(b.verdict('opencode:openai', SOL).state).not.toBe('out');
  });
});

describe('the user\'s explicit pick during an assumed pause', () => {
  it('skips the pause once; a new refusal sets it again; a spent window of the plan still stops', () => {
    const clock = { t: T };
    const reading = { at: T, ok: true, pool: 'opencode:openai', account: null, windows: [] as never[] };
    let r: typeof reading | null = null;
    const b = new CreditBook(null, { reading: () => r, now: () => clock.t }, () => clock.t);
    b.observe('opencode', ASTRA, MODEL_LIMIT, true, T - 1000);
    expect(b.verdict('opencode:openai', ASTRA).state).toBe('out');
    // the explicit pick ignores it, the others still see it
    expect(b.verdict('opencode:openai', ASTRA, undefined, undefined, true).state).not.toBe('out');
    expect(b.verdict('opencode:openai', ASTRA).state).toBe('out');
    // the picked chat is refused again: the pause is set again
    clock.t = T + 60e3;
    b.observe('opencode', ASTRA, MODEL_LIMIT, true, T + 30e3);
    expect(b.verdict('opencode:openai', ASTRA).state).toBe('out');
    // a window the provider reports as spent is real: the pick does not skip it
    r = { ...reading, at: clock.t, windows: [{ kind: 'five-hour', label: '5h', usedPercent: 100, resetsAt: clock.t + HOUR }] as never };
    expect(b.verdict('opencode:openai', ASTRA, undefined, undefined, true).state).toBe('out');
  });
  it('the catalog launches an explicit pick on a paused model, and the card\'s own pick skips it', () => {
    const c = catalog((e, m, _a, o) => e === 'opencode' && m === SOL && !o?.ignoreError ? { state: 'out', why: 'errore di limite', resetsAt: T + 1 } : { state: 'ok', why: '', resetsAt: null });
    const r = start(c, { userModel: { engine: 'opencode', model: SOL } }, { freePick: true });
    expect([r.request.harness, r.request.model]).toEqual(['opencode', SOL]);
    expect(start(c).request.harness).toBe('claude');
  });
});

describe('a chat that waits on its credits never moves to an excluded engine', () => {
  it('creditMove passes the tree\'s excluded engines to the card', () => {
    const chat = (id: string, extra: Partial<ChatSummary>) => ({ id, state: 'idle', harness: 'claude', agent: { source: 'catalog', id: 'scout' }, ...extra }) as unknown as ChatSummary;
    const root = chat('root', { routing: { exclude: ['cursor'] } });
    const waiting = chat('kid', { parentId: 'root', creditWait: { at: 1, model: 'm-mid', waiting: undefined } as never });
    const seen: unknown[] = [];
    creditMove(waiting, id => id === 'root' ? root : undefined, { card: (_r, _a, o) => { seen.push(o.exclude); return { engine: 'claude', model: 'm-mid', effort: null, preset: 'base', allOut: false, skipped: [], route: '', rooms: [] } as never; } });
    expect(seen).toEqual([['cursor']]);
  });
});

describe('routingOf: what the Orchestrator may record', () => {
  const models = [engine('claude', ['m-mid']), engine('opencode', [SOL])];
  it('checks roles, models and engines; a pick on an excluded engine is a contradiction', () => {
    expect(routingOf({ picks: { scout: { engine: 'opencode', model: SOL } }, exclude: ['claude'] }, models, () => 'claude')).toEqual({ picks: { scout: { engine: 'opencode', model: SOL } }, exclude: ['claude'] });
    expect(() => routingOf({ picks: { orchestrator: { model: SOL } } }, models, () => 'claude')).toThrow(/not a work role/);
    expect(() => routingOf({ exclude: ['kimi'] }, models, () => 'claude')).toThrow(/routing.exclude/);
    expect(() => routingOf({ picks: { scout: { engine: 'opencode', model: SOL } }, exclude: ['opencode'] }, models, () => 'claude')).toThrow(/also exclude/);
    expect(routingOf({}, models, () => 'claude')).toBeUndefined();
  });
});
