// Model routing (brain/routing.ts, ADR 0032): the table's hard rules, the most specific row, resolve() with overrides
// and defaults, the task kind from the brain's rules, versioned saves with an audit line, the shared ledger's lines,
// a route read back from chats.json; and the settings editor's pure helpers (renderer/lib/routing.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentLimits, armKey, checkTable, explore, EXPLORE_MIN, match, modelRow, predictionLine, resolve, routeChat, Routing, taskOf, validRoute, type RouteDefaults } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';
import { apiCapable, blankRow, fromEdit, pickable, routeLine, tableEfforts, toEdit } from '../../../src/renderer/lib/routing';
import type { RouteDecision, RoutingRow } from '../../../src/shared/contract';

const row = (p: Partial<RoutingRow>): RoutingRow => ({ kind: '*', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'w', since: '2026-10-13', evidence: 'e', ...p });
const ROUTES: RoutingRow[] = [
  row({ area: ['App', 'Pers · App'], why: 'app' }),
  row({ kind: 'triage', model: 'claude-sonnet-5-5', why: 'triage' }),
  row({ kind: 'triage', area: 'Magazzino', model: 'claude-haiku-5-5', effort: 'low', why: 'triage Magazzino' }),
];
const DEF: RouteDefaults = { harness: 'claude', models: { claude: null, cursor: 'grok-4.7' }, effort: 'high' };
const TASKS: [string, string, string][] = [['triage', String.raw`\b(triage|smista\w*|novita)\b`, 'i'], ['bug-fix', String.raw`\b(fix|bug)\b`, 'i'], ['nope', '(', '']];

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routing-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('routing: the table', () => {
  it('finds a model by id, alias, [1m] or dated id', () => {
    expect(modelRow('opus', REG)?.id).toBe('claude-opus-5-5');
    expect(modelRow('claude-opus-5-5[1m]', REG)?.id).toBe('claude-opus-5-5');
    expect(modelRow('haiku-5-5', REG)?.id).toBe('claude-haiku-5-5');
    expect(modelRow('nope', REG)).toBeNull();
    expect(modelRow('opus', null)).toBeNull();
  });

  it('checks the hard rules', () => {
    expect(checkTable(ROUTES, REG)).toEqual([]);
    const errs = checkTable([
      row({ kind: 'boh' as never }), row({ model: 'claude-mistero' }), row({ harness: 'cursor', model: 'claude-opus-5-5' }),
      row({ harness: 'cursor', model: 'grok-4.7', effort: null }), row({ effort: 'max' }), row({ why: ' ' }), row({ area: '' }),
    ], REG);
    expect(errs).toEqual([
      expect.stringMatching(/riga 1: tipo «boh» sconosciuto/), expect.stringMatching(/riga 2: .*non è in harness\/models\.json/),
      // a Cursor row with no area would cover the app's chats too
      expect.stringMatching(/riga 3: .*solo su claude/), expect.stringMatching(/riga 3: .*solo manuale/), expect.stringMatching(/riga 3: .*sull’app vanno solo su Claude/),
      expect.stringMatching(/riga 4: .*solo manuale/), expect.stringMatching(/riga 4: .*sull’app vanno solo su Claude/),
      expect.stringMatching(/riga 5: sforzo max/), expect.stringMatching(/riga 7: area vuota/),
      // no "any kind · App, Pers · App" row: a kind-only row would route the app's chats elsewhere
      expect.stringMatching(/manca la riga «qualsiasi tipo · App, Pers · App» su claude-opus-5-5 medium/),
    ]);
    // never Fable (too costly); a row for the app's chats only on the registry's appChats (Opus medium)
    expect(checkTable([row({ model: 'claude-fable-5-1' }), row({ area: 'App', model: 'claude-sonnet-5-5' }), row({ area: 'Pers · App', effort: 'high' })], REG)).toEqual([
      expect.stringMatching(/riga 1: Fable mai/), expect.stringMatching(/riga 2: .*sempre su claude-opus-5-5 medium/), expect.stringMatching(/riga 3: .*sempre su claude-opus-5-5 medium/),
    ]);
    expect(checkTable([row({ area: 'App', model: 'claude-sonnet-5-5' })], { ...REG, appChats: undefined })).toEqual([]);
    // the app row must cover both app areas; an empty table (no routing) is valid
    expect(checkTable([row({ area: 'App' }), row({ kind: 'bug-fix', model: 'claude-haiku-5-5' })], REG)).toEqual([expect.stringMatching(/manca la riga/)]);
    expect(checkTable([], REG)).toEqual([]);
    expect(checkTable('x', REG)).toHaveLength(1);
    expect(checkTable(ROUTES, null)[0]).toMatch(/models\.json/);
  });

  it('picks the most specific row: kind and area > area > kind > any', () => {
    expect(match(ROUTES, { kind: 'triage', area: 'Magazzino' })?.why).toBe('triage Magazzino');
    expect(match(ROUTES, { kind: 'triage', area: 'Ordini' })?.why).toBe('triage');
    expect(match(ROUTES, { kind: 'bug-fix', area: 'App' })?.why).toBe('app');
    // an area row beats a kind-only row: every app chat keeps the App row's model
    expect(match(ROUTES, { kind: 'triage', area: 'App' })?.why).toBe('app');
    expect(match(ROUTES, { kind: 'bug-fix', area: 'Ordini' })).toBeNull();
    expect(match([row({ why: 'any' })], { kind: 'altro', area: 'x' })?.why).toBe('any');
  });

  it('an app chat keeps the app row whatever kind it gets and wherever the kind row sits (table v11, 2026-10-14)', () => {
    // the stable build ranked kind over area: "App · …" read as qa-run went to Sonnet
    const qa = row({ kind: 'qa-run', model: 'claude-sonnet-5-5', why: 'qa' });
    const app = row({ area: ['App', 'Pers · App'], why: 'app' });
    for (const routes of [[app, qa], [qa, app]]) {
      expect(match(routes, { kind: 'qa-run', area: 'App' })?.why).toBe('app');
      expect(match(routes, { kind: 'qa-run', area: 'Pers · App' })?.why).toBe('app');
      expect(match(routes, { kind: 'qa-run', area: 'Ordini' })?.why).toBe('qa');
      const r = routeChat({ title: 'App · Risparmio', prompt: '', kind: 'qa-run', ask: {}, defaults: DEF }, { version: 11, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes }, REG, null);
      expect(r).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', route: { source: 'table', area: 'App', kind: 'qa-run' } });
    }
  });
});

describe('routing: resolve', () => {
  const T = { routes: ROUTES };
  it('the row decides what nobody names; naming the same is no override', () => {
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, {}, DEF, REG)).toEqual({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', source: 'table', reason: 'triage' });
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { model: 'claude-sonnet-5-5', effort: 'medium' }, DEF, REG)).toMatchObject({ source: 'table' });
  });

  it('an override of a row needs a reason, and keeps it', () => {
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { model: 'claude-opus-5-5' }, DEF, REG)).toEqual({ error: expect.stringMatching(/override senza motivo.*claude-sonnet-5-5/) });
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { model: 'claude-opus-5-5', reason: 'difficile' }, DEF, REG))
      .toEqual({ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', source: 'override', reason: 'difficile' });
  });

  it('no row: the user defaults for the engine named, free to name as before', () => {
    expect(resolve(T, { kind: 'bug-fix', area: 'Ordini' }, {}, DEF, REG)).toEqual({ harness: 'claude', model: null, effort: 'high', source: 'default', reason: null });
    expect(resolve(T, { kind: 'bug-fix', area: 'Ordini' }, { harness: 'cursor' }, DEF, REG)).toEqual({ harness: 'cursor', model: 'grok-4.7', effort: null, source: 'override', reason: null });
    expect(resolve(null, { kind: 'bug-fix', area: 'Ordini' }, {}, { ...DEF, harness: 'cursor' }, REG)).toMatchObject({ harness: 'cursor', model: 'grok-4.7', effort: null, source: 'default' });
  });

  it('switching engine from a row takes that engine\'s default model, never the row\'s', () => {
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { harness: 'cursor', reason: 'r' }, DEF, REG)).toMatchObject({ harness: 'cursor', model: 'grok-4.7', effort: null, source: 'override' });
  });

  it('holds the hard rules for what an agent names', () => {
    const it0 = { kind: 'bug-fix' as const, area: 'Ordini' };
    expect(resolve(T, it0, { harness: 'cursor', model: 'claude-opus-5-5' }, DEF, REG)).toEqual({ error: expect.stringMatching(/solo su claude/) });
    expect(resolve(T, it0, { harness: 'cursor', model: 'opus-x' }, DEF, REG)).toEqual({ error: expect.stringMatching(/Claude gira solo/) });
    expect(resolve(T, { kind: 'bug-fix', area: 'Pers · App' }, { harness: 'cursor', reason: 'r' }, DEF, REG)).toEqual({ error: expect.stringMatching(/sull’app vanno solo su Claude/) });
    expect(resolve(T, it0, { harness: 'claude', model: 'claude-mistero' }, DEF, REG)).toEqual({ error: expect.stringMatching(/models\.json/) });
    expect(resolve(T, it0, { harness: 'cursor', effort: 'low' }, DEF, REG)).toEqual({ error: expect.stringMatching(/non vale per Cursor/) });
    expect(resolve(T, it0, { effort: 'max' }, DEF, REG)).toEqual({ error: expect.stringMatching(/max/) });
    expect(resolve(T, it0, { effort: 'max', reason: 'l’utente lo chiede' }, DEF, REG)).toMatchObject({ effort: 'max', source: 'override' });
    // the user's own default of max is the user's choice
    expect(resolve(T, it0, {}, { ...DEF, effort: 'max' }, REG)).toMatchObject({ effort: 'max', source: 'default' });
  });

  it("an alias of the row's model is no override", () => {
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { model: 'sonnet' }, DEF, REG)).toMatchObject({ source: 'table' });
  });

  it('a row on an engine the caller may not start now leaves the choice to the defaults', () => {
    const cursorDef: RouteDefaults = { harness: 'cursor', models: { claude: null, cursor: 'grok-4.7' }, effort: null };
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, {}, cursorDef, REG, h => h === 'cursor')).toMatchObject({ harness: 'cursor', model: 'grok-4.7', source: 'default' });
    expect(resolve(T, { kind: 'triage', area: 'Ordini' }, { harness: 'cursor' }, cursorDef, REG, h => h === 'cursor')).toMatchObject({ harness: 'cursor', source: 'default' });
  });

  it('drops an effort nobody named that the model lacks', () => {
    const reg = { ...REG, models: REG.models.map(m => (m.id === 'claude-haiku-5-5' ? { ...m, efforts: ['low' as const] } : m)) };
    expect(resolve({ routes: [] }, { kind: 'altro', area: 'x' }, { model: 'claude-haiku-5-5' }, DEF, reg)).toMatchObject({ effort: null });
  });
});

describe('routing: task kind and routeChat', () => {
  it('reads the kind from title, then prompt, accents off; a Regia is its own; no rules = altro', () => {
    expect(taskOf('Posta · smista la inbox', '', TASKS)).toBe('triage');
    expect(taskOf('Ordini · totale', 'c’è un bug nel totale', TASKS)).toBe('bug-fix');
    expect(taskOf('Posta · novità', '', TASKS)).toBe('triage');
    expect(taskOf('Regia · lavoro', 'fix', TASKS)).toBe('regia');
    expect(taskOf('Ordini · x', 'y', TASKS)).toBe('altro');
    // a topic-only title loses to a prompt that builds or fixes (the brain's estimates.mjs, same rule)
    const OPS: [string, string, string][] = [['ops-read', String.raw`\b(log|telemetr\w*|app ?insights)\b`, 'i'], ...TASKS];
    expect(taskOf('Magazzino · Telemetria ordini', 'Implementa gli eventi su due repo, test e PR', OPS)).toBe('app-feature');
    expect(taskOf('Magazzino · Log', 'leggi i log e correggi il parsing', OPS)).toBe('bug-fix');
    expect(taskOf('Magazzino · Log', 'leggi i log di ieri', OPS)).toBe('ops-read');
    expect(taskOf('Posta · smista', 'apri la PR', TASKS)).toBe('triage');
    expect(taskOf('fix', '', undefined)).toBe('altro');
  });

  it('routes a chat: area from the title (the app space is App), kind, version, time', () => {
    const table = { version: 5, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes: ROUTES };
    const r = routeChat({ title: 'Magazzino · smista i ticket', prompt: '', ask: {}, defaults: DEF }, table, REG, { tasks: TASKS }, 42);
    expect(r).toEqual({ harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', route: { policy: 'routing', version: 5, source: 'table', reason: 'triage Magazzino', kind: 'triage', area: 'Magazzino', at: 42 } });
    const app = routeChat({ title: 'Tema scuro', prompt: '', appSpace: true, kind: 'app-feature', ask: {}, defaults: DEF }, table, REG, null, 1);
    expect(app).toMatchObject({ model: 'claude-opus-5-5', route: { area: 'App', kind: 'app-feature', source: 'table' } });
    expect(routeChat({ title: 'x', prompt: '', ask: { effort: 'max' }, defaults: DEF }, null, REG, null)).toEqual({ error: expect.stringMatching(/max/) });
  });

  it('reads a stored route back only when well formed', () => {
    const ok = { policy: 'routing', version: 2, source: 'override', reason: 'r', kind: 'review', area: 'Magazzino', at: 5 };
    expect(validRoute(ok)).toEqual(ok);
    expect(validRoute({ ...ok, version: 'x' })).toMatchObject({ version: null });
    expect(validRoute({ ...ok, kind: 'boh' })).toBeNull();
    expect(validRoute({ ...ok, source: 'magic' })).toBeNull();
    expect(validRoute(null)).toBeNull();
    expect(validRoute({ ...ok, ledgerId: 'app:c1', handoffs: 2 })).toMatchObject({ ledgerId: 'app:c1', handoffs: 2 });
    expect(validRoute({ ...ok, ledgerId: '../x', handoffs: -1 })).toEqual(ok);
  });
});

describe('routing: exploration', () => {
  const T = { version: 3, exploration: 0.2, costWeight: 7, routes: ROUTES } as const;
  const item = { kind: 'triage' as const, area: 'Ordini' };
  const base = { harness: 'claude' as const, model: 'claude-sonnet-5-5', effort: 'medium' as const };
  const none = (): Map<string, number> => new Map();
  const yes = (): number => 0.1;

  it('tries the least sampled auto arm, never max, never the arm it would get anyway', () => {
    const counts = new Map([['claude|claude-opus-5-5|low', 3]]);
    expect(explore(T, item, base, REG, () => true, () => counts, yes)).toEqual({ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', samples: 0 });
    const full = new Map<string, number>();
    for (const m of REG.models) for (const e of m.efforts) full.set(`claude|${m.id}|${e}`, EXPLORE_MIN);
    full.set('claude|claude-haiku-5-5|xhigh', 19);
    full.set('claude|claude-haiku-5-5|max', 0);
    expect(explore(T, item, base, REG, () => true, () => full, yes)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'xhigh', samples: 19 });
    full.set('claude|claude-haiku-5-5|xhigh', EXPLORE_MIN);
    expect(explore(T, item, base, REG, () => true, () => full, yes)).toBeNull();
    // the base arm itself (here an alias of sonnet) is no exploration
    const onlyBase = new Map(full); onlyBase.set('claude|claude-sonnet-5-5|medium', 0);
    expect(explore(T, item, { ...base, model: 'sonnet' }, REG, () => true, () => onlyBase, yes)).toBeNull();
    // empty defaults = the registry's default model at its default effort (opus, medium)
    const onlyDefault = new Map(full); onlyDefault.set('claude|claude-opus-5-5|medium', 0);
    expect(explore(T, item, { harness: 'claude', model: null, effort: null }, REG, () => true, () => onlyDefault, yes)).toBeNull();
    expect(explore(T, item, { harness: 'claude', model: null, effort: 'low' }, REG, () => true, () => onlyDefault, yes)).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' });
  });

  it('stays on the engine the chat gets anyway: an app chat tries other Claude models, never Cursor; Cursor only when auto', () => {
    expect(explore(T, { kind: 'bug-fix', area: 'Pers · App' }, base, REG, () => true, none, yes)).toMatchObject({ harness: 'claude' });
    const cursorBase = { harness: 'cursor' as const, model: 'grok-4.7', effort: null };
    // the demo registry keeps Cursor manual: a work chat on Cursor explores nothing (never Claude's tokens)
    expect(explore(T, item, cursorBase, REG, () => true, none, yes)).toBeNull();
    const auto = { ...REG, harnesses: { ...REG.harnesses, cursor: { routing: 'auto' as const } },
      models: [...REG.models.map(m => (m.id === 'grok-4.7' ? { ...m, routing: 'auto' as const } : m)),
        { ...REG.models.find(m => m.id === 'grok-4.7')!, id: 'gpt-5.6-terra', routing: 'auto' as const }] };
    expect(explore(T, item, cursorBase, auto, () => true, none, yes)).toEqual({ harness: 'cursor', model: 'gpt-5.6-terra', effort: null, samples: 0 });
    expect(explore(T, { ...item, area: 'App' }, cursorBase, auto, () => true, none, yes)).toBeNull();
    expect(explore(T, item, base, auto, () => true, none, yes)).toMatchObject({ harness: 'claude' });
  });

  it('stays off at rate 0, past the dice, for a Regia, for an engine the caller may not start', () => {
    expect(explore({ exploration: 0 }, item, base, REG, () => true, none, yes)).toBeNull();
    expect(explore(T, item, base, REG, () => true, none, () => 0.2)).toBeNull();
    expect(explore({ exploration: 9 }, item, base, REG, () => true, none, () => 0.49)).not.toBeNull();
    expect(explore(T, { kind: 'regia', area: 'Ordini' }, base, REG, () => true, none, yes)).toBeNull();
    expect(explore(T, item, base, REG, h => h !== 'claude', none, yes)).toBeNull();
    expect(explore(T, item, base, null, () => true, none, yes)).toBeNull();
  });

  it('routeChat explores only when the agent named nothing, and says so in the route', () => {
    const req = { title: 'Ordini · smista', prompt: '', ask: {}, defaults: DEF, counts: none, rnd: yes };
    expect(routeChat(req, { ...T, appliedAt: null, by: null, routes: [...ROUTES] }, REG, { tasks: TASKS }, 7)).toEqual({ harness: 'claude', model: 'claude-opus-5-5', effort: 'low',
      route: { policy: 'routing', version: 3, source: 'explore', reason: `esplorazione: 0 campioni su ${EXPLORE_MIN} per triage`, kind: 'triage', area: 'Ordini', at: 7 } });
    expect(routeChat({ ...req, ask: { model: 'sonnet' } }, { ...T, appliedAt: null, by: null, routes: [...ROUTES] }, REG, { tasks: TASKS })).toMatchObject({ route: { source: 'table' } });
    expect(routeChat({ ...req, counts: undefined }, { ...T, appliedAt: null, by: null, routes: [...ROUTES] }, REG, { tasks: TASKS })).toMatchObject({ route: { source: 'table' } });
    expect(validRoute({ policy: 'routing', version: 3, source: 'explore', reason: 'r', kind: 'triage', area: 'Ordini', at: 7 })).toMatchObject({ source: 'explore' });
  });
});

describe('routing: the brain files', () => {
  const brain = (): string => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(root, 'harness', 'models.json'), JSON.stringify(REG));
    return root;
  };

  it('counts each job once per arm and kind from the ledger predictions', () => {
    const root = brain();
    const r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 1, source: 'table' as const, reason: null, kind: 'triage' as const, area: 'Ordini', at: 1 };
    const chat = { harness: 'claude' as const, model: 'sonnet', effort: 'medium' as const, promptChars: 1 };
    r.observe(predictionLine(route, { ...chat, id: 'app:a' }));
    r.observe(predictionLine(route, { ...chat, id: 'app:a' }));
    r.observe(predictionLine(route, { ...chat, id: 'app:b', model: 'claude-sonnet-5-5' }));
    r.observe(predictionLine({ ...route, kind: 'review' }, { ...chat, id: 'app:c' }));
    r.observe({ id: 'app:a', domain: 'routing', actual: { usd: 1, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 }, outcome: { known: false, source: 'measured' } });
    // a sub-agent line of the brain (sub:<session>:<agent>) is another unit of work: never a chat's sample
    r.observe({ ...predictionLine(route, { ...chat, id: 'sub:s1:a1', model: 'claude-sonnet-5-5' }), id: 'sub:s1:a1' });
    expect([...r.armCounts('triage')]).toEqual([[armKey(chat, REG), 2]]);
    expect(armKey(chat, REG)).toBe('claude|claude-sonnet-5-5|medium');
    expect(r.armCounts('bug-fix').size).toBe(0);
  });

  it('saves a new version, points current.json at it, appends an audit line; refuses a broken table', () => {
    const root = brain();
    const r = new Routing(() => root);
    expect(r.info()).toMatchObject({ table: null, error: null });
    const info = r.save(ROUTES, 'utente (Impostazioni)', 'prima tabella', Date.UTC(2026, 9, 13));
    expect(info.table).toMatchObject({ version: 1, by: 'utente (Impostazioni)', appliedAt: '2026-10-13T00:00:00.000Z' });
    expect(info.table!.routes[0]).toMatchObject({ area: ['App', 'Pers · App'], model: 'claude-opus-5-5' });
    r.save([ROUTES[0]!, ROUTES[1]!], 'utente (Impostazioni)', null);
    const dir = path.join(root, 'ops', 'state', 'improve');
    expect(fs.readdirSync(path.join(dir, 'routing')).sort()).toEqual(['current.json', 'v1.json', 'v2.json']);
    expect(r.table()).toMatchObject({ version: 2, routes: [{ kind: '*' }, { kind: 'triage' }] });
    const audit = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    expect(audit).toEqual([
      expect.objectContaining({ domain: 'routing', from: null, to: 1, reason: 'prima tabella' }),
      expect.objectContaining({ domain: 'routing', from: 1, to: 2, reason: null }),
    ]);
    expect(() => r.save([row({ effort: 'max' })], 'utente', null)).toThrow(/non salvata: riga 1: sforzo max/);
    expect(r.table()!.version).toBe(2);
  });

  it('saves the exploration rate like the rows: a new version, its change in the audit line; kept when omitted', () => {
    const root = brain();
    const r = new Routing(() => root);
    r.save(ROUTES, 'u', null);
    expect(r.save(ROUTES, 'u', 'più dati', 1, { exploration: 0.1 }).table).toMatchObject({ version: 2, exploration: 0.1 });
    expect(r.save([ROUTES[0]!, ROUTES[1]!], 'u', null).table).toMatchObject({ version: 3, exploration: 0.1 });
    expect(r.save(ROUTES, 'u', null, 1, { exploration: 0.123 }).table!.exploration).toBe(0.12);
    for (const bad of [0.6, -0.1, Number.NaN]) expect(() => r.save(ROUTES, 'u', null, 1, { exploration: bad })).toThrow(/non salvata: esplorazione: da 0 a 50%/);
    expect(r.table()!.version).toBe(4);
    const audit = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    expect(audit.map(a => a.exploration ?? null)).toEqual([null, { from: 0, to: 0.1 }, null, { from: 0.1, to: 0.12 }]);
  });

  it('an agent saves with its name, reason and data; the history lists every change, newest first; restore is a new version', () => {
    const root = brain();
    const r = new Routing(() => root);
    r.save(ROUTES, 'utente (Impostazioni)', 'prima', 1);
    r.save([ROUTES[0]!, ROUTES[1]!], 'agente: Regia dell’app', 'triage su Sonnet', 2, { exploration: 0.2, evidence: '31 chat, −58% di costo' });
    const info = r.restore(1, 'utente (Impostazioni)', 3);
    expect(info.table).toMatchObject({ version: 3, exploration: 0, routes: ROUTES.map(x => expect.objectContaining({ kind: x.kind, model: x.model })) });
    expect(info.history).toEqual([
      expect.objectContaining({ to: 3, from: 2, by: 'utente (Impostazioni)', reason: 'ripristino della versione 1', exploration: { from: 0.2, to: 0 }, stored: true }),
      expect.objectContaining({ to: 2, by: 'agente: Regia dell’app', reason: 'triage su Sonnet', evidence: '31 chat, −58% di costo', exploration: { from: 0, to: 0.2 } }),
      expect.objectContaining({ to: 1, from: null, evidence: null }),
    ]);
    expect(() => r.restore(9, 'u')).toThrow(/versione 9 non trovata/);
    // a version that breaks today's rules is not brought back
    fs.writeFileSync(path.join(root, 'ops', 'state', 'improve', 'routing', 'v1.json'), JSON.stringify({ version: 1, routes: [row({ model: 'claude-fable-5-1' })] }));
    expect(() => r.restore(1, 'u')).toThrow(/Fable mai/);
    expect(r.table()!.version).toBe(3);
  });

  it('the user\'s switches: an agent never changes, removes, locks or unlocks a locked row, nor the cost weight; the user does', () => {
    const root = brain();
    const r = new Routing(() => root);
    const locked = { ...ROUTES[1]!, locked: true };
    r.save([ROUTES[0]!, locked, ROUTES[2]!], 'utente (Impostazioni)', 'blocco il triage', 1, { costWeight: 7 });
    expect(r.table()).toMatchObject({ version: 1, costWeight: 7, routes: [{ kind: '*' }, { kind: 'triage', locked: true }, expect.not.objectContaining({ locked: true })] });
    const agent = 'agente: Regia';
    expect(() => r.save([ROUTES[0]!, { ...locked, model: 'claude-haiku-5-5' }, ROUTES[2]!], agent, 'r', 2)).toThrow(/riga «triage» è bloccata dall’utente: l’AI non la cambia/);
    expect(() => r.save([ROUTES[0]!, ROUTES[2]!], agent, 'r', 2)).toThrow(/l’AI non la toglie/);
    expect(() => r.save([ROUTES[0]!, ROUTES[1]!, ROUTES[2]!], agent, 'r', 2)).toThrow(/non la cambia/); // unlocking is a change
    expect(() => r.save([ROUTES[0]!, locked, { ...ROUTES[2]!, locked: true }], agent, 'r', 2)).toThrow(/solo l’utente blocca una riga \(«triage · Magazzino»\)/);
    expect(() => r.save([ROUTES[0]!, locked, ROUTES[2]!], agent, 'r', 2, { costWeight: 3 })).toThrow(/il peso del costo lo decide l’utente/);
    // an unlocked row is the agent's to change; the cost weight is kept
    expect(r.save([ROUTES[0]!, locked, { ...ROUTES[2]!, model: 'claude-sonnet-5-5' }], agent, 'r', 2, { evidence: 'dati' }).table).toMatchObject({ version: 2, costWeight: 7 });
    // the user changes all of it; the cost weight's change goes in the audit line and the history
    const u = r.save([ROUTES[0]!, ROUTES[1]!], 'utente (Impostazioni)', null, 3, { costWeight: 4 });
    expect(u.table).toMatchObject({ version: 3, costWeight: 4 });
    expect(u.history[0]).toMatchObject({ to: 3, costWeight: { from: 7, to: 4 } });
    for (const bad of [11, -1, Number.NaN]) expect(() => r.save(ROUTES, 'u', null, 4, { costWeight: bad })).toThrow(/peso del costo: da 0 a 10/);
    // an agent's restore may not lock a row either (v1 had triage locked); the user's brings v1 back whole, its weight too
    expect(() => r.restore(1, agent, 5)).toThrow(/solo l’utente blocca una riga \(«triage»\)/);
    expect(r.table()).toMatchObject({ version: 3, costWeight: 4 });
    expect(r.restore(1, 'utente (Impostazioni)', 5).table).toMatchObject({ version: 4, costWeight: 7, routes: [{}, { kind: 'triage', locked: true }, {}] });
    expect(agentLimits(null, [ROUTES[0]!])).toEqual([]);
    // the user may leave a row's "perché" out (the AI writes it later); an agent never
    expect(r.save([ROUTES[0]!, { ...ROUTES[1]!, why: '' }], 'utente (Impostazioni)', null, 6).table!.routes[1]!.why).toBe('');
    expect(agentLimits(null, [ROUTES[0]!, { ...ROUTES[1]!, why: ' ' }])).toEqual(['riga 2: manca il perché (l’AI lo scrive sempre)']);
  });

  it("an agent never takes a locked row's chats with a more specific or an earlier row; a row that already had them stays", () => {
    const lockedT = { ...ROUTES[1]!, locked: true }, prev = { routes: [ROUTES[0]!, lockedT] };
    const steal = /prenderebbe le chat della riga bloccata «triage»/;
    expect(agentLimits(prev, [ROUTES[0]!, lockedT, row({ kind: 'triage', area: 'Ordini', model: 'claude-haiku-5-5', why: 'x' })]).join()).toMatch(steal);
    expect(agentLimits(prev, [ROUTES[0]!, lockedT, row({ area: 'Ordini', model: 'claude-haiku-5-5', why: 'x' })]).join()).toMatch(steal);
    expect(agentLimits(prev, [ROUTES[0]!, lockedT, row({ kind: 'review', model: 'claude-haiku-5-5', why: 'x' })])).toEqual([]);
    // the Magazzino row already won its triage chats before the lock: the agent may still change it
    const had = { routes: [ROUTES[0]!, lockedT, ROUTES[2]!] };
    expect(agentLimits(had, [ROUTES[0]!, lockedT, { ...ROUTES[2]!, model: 'claude-sonnet-5-5' }])).toEqual([]);
    // equally specific: placed before the locked row it wins the ties, after it it does not
    const lockedArea = row({ area: 'Ordini', model: 'claude-sonnet-5-5', why: 'o', locked: true }), wide = row({ area: ['Ordini', 'Magazzino'], model: 'claude-haiku-5-5', why: 'x' });
    const p2 = { routes: [ROUTES[0]!, lockedArea] };
    expect(agentLimits(p2, [ROUTES[0]!, wide, lockedArea]).join()).toMatch(/prenderebbe le chat della riga bloccata «qualsiasi tipo · Ordini»/);
    expect(agentLimits(p2, [ROUTES[0]!, lockedArea, wide])).toEqual([]);
    // two locked rows swapped: the chats move from one of the user's choices to the other
    const lockedWide = { ...wide, locked: true }, p3 = { routes: [ROUTES[0]!, lockedArea, lockedWide] };
    expect(agentLimits(p3, [ROUTES[0]!, lockedWide, lockedArea]).join()).toMatch(/prenderebbe le chat della riga bloccata «qualsiasi tipo · Ordini»/);
    expect(agentLimits(p3, [ROUTES[0]!, lockedArea, lockedWide])).toEqual([]);
    // an empty area list matches no chat: never in a table
    expect(checkTable([ROUTES[0]!, { ...ROUTES[1]!, area: [] }], REG).join()).toMatch(/riga 2: area vuota/);
  });

  it('exploration leaves the chats of a locked row alone', () => {
    const req = { title: 'Ordini · smista', prompt: '', ask: {}, defaults: DEF, counts: () => new Map<string, number>(), rnd: () => 0 };
    const t = { version: 3, appliedAt: null, by: null, exploration: 0.5, costWeight: 7, routes: ROUTES };
    expect(routeChat(req, t, REG, { tasks: TASKS })).toMatchObject({ route: { source: 'explore' } });
    expect(routeChat(req, { ...t, routes: ROUTES.map(x => (x.kind === 'triage' ? { ...x, locked: true } : x)) }, REG, { tasks: TASKS })).toMatchObject({ model: 'claude-sonnet-5-5', route: { source: 'table' } });
  });

  it('after a rollback (only current.json moves back) a save never overwrites a later version', () => {
    const root = brain();
    const r = new Routing(() => root);
    r.save(ROUTES, 'u', null); r.save([ROUTES[0]!, ROUTES[1]!], 'u', null); r.save([ROUTES[0]!, ROUTES[2]!], 'u', null);
    const dir = path.join(root, 'ops', 'state', 'improve', 'routing');
    const v3 = fs.readFileSync(path.join(dir, 'v3.json'), 'utf8');
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ version: 2, appliedAt: null, by: 'rollback' }));
    expect(r.save(ROUTES, 'u', null).table!.version).toBe(4);
    expect(fs.readFileSync(path.join(dir, 'v3.json'), 'utf8')).toBe(v3);
  });

  it('a table on disk that breaks a hard rule is ignored for routing, shown with the reason in the editor', () => {
    const root = brain();
    const r = new Routing(() => root);
    r.save(ROUTES, 'u', null);
    const f = path.join(root, 'ops', 'state', 'improve', 'routing', 'v1.json');
    fs.writeFileSync(f, JSON.stringify({ version: 1, routes: [row({ effort: 'max' })] })); // written by hand or by an agent
    expect(r.table()).toBeNull();
    expect(r.stored()!.routes[0]!.effort).toBe('max');
    expect(r.info().error).toMatch(/tabella ignorata.*sforzo max/);
  });

  it('reads back the last actuals of a ledger id (totals across a restart or a hand-off)', () => {
    const root = brain();
    const r = new Routing(() => root);
    expect(r.lastActual('app:c1')).toBeNull();
    const line = (usd: number) => ({ id: 'app:c1', domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    r.observe(line(0.1)); r.observe({ ...line(9), id: 'app:c2' }); r.observe(line(0.3));
    expect(r.lastActual('app:c1')).toMatchObject({ usd: 0.3 });
  });

  it('no brain or no registry: says why, saves nothing', () => {
    expect(new Routing(() => null).info().error).toMatch(/nessun cervello/);
    expect(() => new Routing(() => null).save(ROUTES, 'u', null)).toThrow(/nessun cervello/);
    const empty = tmp();
    expect(new Routing(() => empty).info().error).toMatch(/models\.json/);
    expect(() => new Routing(() => empty).save(ROUTES, 'u', null)).toThrow(/models\.json/);
  });

  it('appends prediction and actual lines to the shared ledger', () => {
    const root = brain();
    const r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 3, source: 'table' as const, reason: 'triage', kind: 'triage' as const, area: 'Magazzino', at: 9 };
    const pred = predictionLine(route, { id: 'app:c1', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', promptChars: 120 });
    expect(pred).toEqual({ id: 'app:c1', at: 9, domain: 'routing',
      item: { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', area: 'Magazzino', kind: 'triage', promptChars: 120 },
      predicted: { policy: 'routing', version: 3, value: { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', source: 'table', reason: 'triage' } } });
    expect(r.observe(pred)).toBe(true);
    r.observe({ id: 'app:c1', domain: 'routing', outcome: { known: false, source: 'measured' }, actual: { usd: 0.4, minutes: 3, turns: 2, ctxPeak: 50000, handoffs: 0 } });
    const lines = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ id: 'app:c1', outcome: { known: false }, actual: { usd: 0.4 } });
    expect(new Routing(() => null).observe(pred)).toBe(false);
  });
});

describe('routing: the settings editor helpers', () => {
  it('offers only the models the table may pick, plus one a row already names', () => {
    expect(pickable(REG).map(m => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(pickable(REG, ['grok-4.7']).map(m => m.id)).toContain('grok-4.7');
    expect(pickable(null)).toEqual([]);
    const takes = (h: string) => h === 'claude'; // as app:info's caps say today
    expect(tableEfforts(REG.models[1], takes)).toEqual(['low', 'medium', 'high', 'xhigh']);
    // a row on an engine without the effort cap (Cursor) runs at the model's own effort
    expect(tableEfforts({ ...REG.models[4]!, efforts: ['low', 'high'] }, takes)).toEqual([]);
  });

  it('turns rows into text and back (area list, the model\'s own harness, today for a new row)', () => {
    const e = toEdit(ROUTES[0]!);
    expect(e).toMatchObject({ area: 'App, Pers · App', effort: 'medium' });
    expect(fromEdit(e, REG, '2026-10-14')).toEqual(ROUTES[0]);
    expect(fromEdit({ ...e, area: ' ', effort: '', since: '' }, REG, '2026-10-14')).toEqual({ ...ROUTES[0], area: undefined, effort: null, since: '2026-10-14' });
    expect(fromEdit({ ...e, area: 'Magazzino' }, REG, 'd').area).toBe('Magazzino');
    expect(blankRow(REG, '2026-10-14', h => h === 'claude')).toEqual({ kind: '*', area: '', model: 'claude-opus-5-5', effort: 'medium', why: '', evidence: '', since: '2026-10-14', ai: true, onApi: false });
    // «L'AI può cambiarla» off = the row's locked flag, and back
    expect(e.ai).toBe(true);
    expect(toEdit({ ...ROUTES[0]!, locked: true }).ai).toBe(false);
    expect(fromEdit({ ...e, ai: false }, REG, 'd').locked).toBe(true);
  });
});

describe('routing: «Sui crediti API» (ADR 0052)', () => {
  const W = row({ kind: 'writing', why: 'scrittura', onApi: true });
  const table = (routes: RoutingRow[]) => ({ version: 3, appliedAt: null, by: null, exploration: 0, costWeight: 7, routes });
  const ask = { title: 'Posta · mail', prompt: '', kind: 'writing' as const, ask: {}, defaults: DEF };

  it('is allowed only on a writing row with an Anthropic model', () => {
    expect(checkTable([ROUTES[0]!, W], REG)).toEqual([]);
    expect(checkTable([ROUTES[0]!, { ...W, kind: 'review' }], REG)).toEqual([expect.stringMatching(/solo sulle righe Scrittura/)]);
    expect(checkTable([{ ...W, harness: 'cursor', model: 'grok-4.7', effort: null }], REG)).toEqual(expect.arrayContaining([expect.stringMatching(/solo con un modello Anthropic/)]));
  });

  it('sends a writing chat to the API engine with the row’s model and no effort, only when that engine may run', () => {
    expect(routeChat({ ...ask, api: 'anthropic' }, table([W]), REG, null, 9)).toEqual({ harness: 'anthropic', model: 'claude-opus-5-5', effort: null,
      route: { policy: 'routing', version: 3, source: 'table', reason: 'scrittura · sui crediti API', kind: 'writing', area: 'Posta', at: 9 } });
    // engine off or without a key (api null), or not startable by this caller: the row as it is
    const plain = { harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' };
    expect(routeChat({ ...ask, api: null }, table([W]), REG, null, 9)).toMatchObject(plain);
    expect(routeChat({ ...ask, api: 'anthropic', canRun: h => h === 'claude' }, table([W]), REG, null, 9)).toMatchObject(plain);
    // the switch off (the default), another kind, or a model the user named: no API
    expect(routeChat({ ...ask, api: 'anthropic' }, table([{ ...W, onApi: undefined }]), REG, null, 9)).toMatchObject(plain);
    expect(routeChat({ ...ask, kind: 'review', api: 'anthropic' }, table([W, row({ kind: 'review' })]), REG, null, 9)).toMatchObject(plain);
    expect(routeChat({ ...ask, ask: { model: 'claude-sonnet-5-5', reason: 'più veloce' }, api: 'anthropic' }, table([W]), REG, null, 9)).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5' });
  });

  it('counts only where the user saved it: a brain file an agent wrote by hand does not turn it on', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(root, 'harness', 'models.json'), JSON.stringify(REG));
    const apiFile = path.join(tmp(), 'routing-api.json');
    const r = new Routing(() => root, apiFile);
    r.save([ROUTES[0]!, { ...W, onApi: undefined }], 'utente (Impostazioni)', null);
    // an agent edits the version in force by hand
    const v = path.join(root, 'ops', 'state', 'improve', 'routing', `v${r.stored()!.version}.json`);
    const j = JSON.parse(fs.readFileSync(v, 'utf8')) as { routes: RoutingRow[] };
    j.routes[1]!.onApi = true;
    fs.writeFileSync(v, JSON.stringify(j));
    expect(r.table()!.routes[1]!.onApi).toBeUndefined();
    // the user's own save turns it on, and an agent's later save keeps it
    r.save([ROUTES[0]!, W], 'utente (Impostazioni)', null);
    expect(r.table()!.routes[1]!.onApi).toBe(true);
    expect(JSON.parse(fs.readFileSync(apiFile, 'utf8'))).toEqual({ rows: ['writing|'] });
    r.save([ROUTES[0]!, { ...W, why: 'nuovo perché' }], 'agente: loop', 'perché');
    expect(r.table()!.routes[1]!.onApi).toBe(true);
  });

  it('is the user’s switch: an agent neither turns it on or off nor removes such a row', () => {
    const off = { ...W, onApi: undefined };
    expect(agentLimits(table([off]), [{ ...off, why: 'nuovo perché' }])).toEqual([]);
    expect(agentLimits(table([off]), [W])).toEqual([expect.stringMatching(/lo cambia solo l’utente/)]);
    expect(agentLimits(table([W]), [off])).toEqual([expect.stringMatching(/lo cambia solo l’utente/)]);
    expect(agentLimits(table([W]), [])).toEqual([expect.stringMatching(/solo l’utente la toglie/)]);
    expect(agentLimits(table([]), [W])).toEqual([expect.stringMatching(/lo cambia solo l’utente/)]);
  });

  it('the editor keeps it only where it can work', () => {
    const opus = REG.models[0], grok = REG.models.find(m => m.id === 'grok-4.7');
    expect(apiCapable({ kind: 'writing' }, opus)).toBe(true);
    expect(apiCapable({ kind: 'review' }, opus)).toBe(false);
    expect(apiCapable({ kind: 'writing' }, grok)).toBe(false);
    expect(toEdit(W).onApi).toBe(true);
    expect(fromEdit(toEdit(W), REG, 'd')).toEqual(W);
    expect(fromEdit({ ...toEdit(W), kind: 'review' }, REG, 'd').onApi).toBeUndefined();
  });
});

describe('routing: "Nuova chat"’s line', () => {
  const at = 1, eng = (h: string) => (h === 'claude' ? 'Claude' : 'Cursor');
  const p = (source: RouteDecision['source'], o: Partial<RouteDecision> = {}) => ({ harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' as const,
    route: { policy: 'routing' as const, version: 11, source, reason: 'chat sull’app', kind: 'bug-fix' as const, area: 'App', at, ...o } });
  it('says what starts and why', () => {
    expect(routeLine(null, eng)).toBeNull();
    expect(routeLine(p('table'), eng)).toEqual({ what: 'Claude · Opus 5.5 · ragionamento media', why: 'dalla tabella (Fix di bug · App): chat sull’app', error: false });
    expect(routeLine(p('override'), eng)?.why).toBe('scelto da te: vince sulla tabella');
    expect(routeLine(p('default', { kind: 'altro', area: 'altro' }), eng)?.why).toBe('nessuna riga per Altro: i tuoi predefiniti');
    expect(routeLine({ ...p('table'), harness: 'cursor', model: null, effort: null }, eng)?.what).toBe('Cursor · Cursor (predefinito)');
    expect(routeLine({ error: 'Cursor è spento' }, eng)).toEqual({ what: 'Non parte', why: 'Cursor è spento', error: true });
  });
});
