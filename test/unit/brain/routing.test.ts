// Model choice of a new chat (brain/routing.ts, ADR 0032; ADR 0210 removed the routing table): resolve() on the user's
// defaults with overrides and the hard rules, the task kind from the brain's rules, routeChat's kind and area, a route
// read back from chats.json (an old table route still loads), the model registry and the shared ledger's lines; the
// old table files in a brain are ignored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { modelRow, predictionLine, resolve, routeChat, Routing, taskOf, validRoute, type RouteDefaults } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';

const DEF: RouteDefaults = { harness: 'claude', models: { claude: null, cursor: 'grok-4.7' }, effort: 'high' };
const TASKS: [string, string, string][] = [['triage', String.raw`\b(triage|smista\w*|novita)\b`, 'i'], ['bug-fix', String.raw`\b(fix|bug)\b`, 'i'], ['nope', '(', '']];

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routing-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('routing: the registry', () => {
  it('finds a model by id, alias, [1m] or dated id', () => {
    expect(modelRow('opus', REG)?.id).toBe('claude-opus-5-5');
    expect(modelRow('claude-opus-5-5[1m]', REG)?.id).toBe('claude-opus-5-5');
    expect(modelRow('haiku-5-5', REG)?.id).toBe('claude-haiku-5-5');
    expect(modelRow('nope', REG)).toBeNull();
    expect(modelRow('opus', null)).toBeNull();
  });
});

describe('routing: resolve on the user\'s defaults', () => {
  it('nothing named: the defaults; naming the same is no override', () => {
    expect(resolve({}, DEF, REG)).toEqual({ harness: 'claude', model: null, effort: 'high', source: 'default', reason: null });
    expect(resolve({ effort: 'high' }, DEF, REG)).toMatchObject({ source: 'default' });
    expect(resolve({}, { ...DEF, harness: 'cursor' }, REG)).toMatchObject({ harness: 'cursor', model: 'grok-4.7', effort: null, source: 'default' });
  });

  it('naming something else is an override, with its reason when given', () => {
    expect(resolve({ harness: 'cursor' }, DEF, REG)).toEqual({ harness: 'cursor', model: 'grok-4.7', effort: null, source: 'override', reason: null });
    expect(resolve({ model: 'claude-opus-5-5', reason: 'difficile' }, DEF, REG))
      .toEqual({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high', source: 'override', reason: 'difficile' });
  });

  it('the default effort is Claude\'s: a Cursor chat keeps its own reasoning (issue #97)', () => {
    const reg = { ...REG, models: [...REG.models.filter(m => m.id !== 'grok-4.7'), { ...REG.models.find(m => m.id === 'grok-4.7')!, efforts: ['low', 'medium', 'high'] as const, defaultEffort: 'medium' as const }] } as typeof REG;
    expect(resolve({}, { ...DEF, harness: 'cursor' }, reg)).toMatchObject({ harness: 'cursor', effort: null, source: 'default' });
    expect(resolve({ harness: 'cursor' }, DEF, reg)).toMatchObject({ harness: 'cursor', effort: null });
    expect(resolve({}, DEF, reg)).toMatchObject({ harness: 'claude', effort: 'high' });
  });

  it('holds the hard rules for what is named', () => {
    expect(resolve({ harness: 'cursor', model: 'claude-opus-5-5' }, DEF, REG)).toEqual({ error: expect.stringMatching(/solo su claude/) });
    expect(resolve({ harness: 'cursor', model: 'opus-x' }, DEF, REG)).toEqual({ error: expect.stringMatching(/Claude gira solo/) });
    expect(resolve({ harness: 'claude', model: 'claude-mistero' }, DEF, REG)).toEqual({ error: expect.stringMatching(/models\.json/) });
    // Cursor takes an effort too (its model's thought_level option, issue #97) where models.json lists it; an API engine takes none
    expect(resolve({ harness: 'cursor', effort: 'low', reason: 'r' }, DEF, REG)).toEqual({ error: expect.stringMatching(/grok-4\.7 non ha lo sforzo/) });
    expect(resolve({ harness: 'anthropic', effort: 'low' }, DEF, REG)).toEqual({ error: expect.stringMatching(/non vale per Anthropic API/) });
    expect(resolve({ effort: 'max' }, DEF, REG)).toEqual({ error: expect.stringMatching(/max/) });
    expect(resolve({ effort: 'max', reason: 'l’utente lo chiede' }, DEF, REG)).toMatchObject({ effort: 'max', source: 'override' });
    // the user's own default of max is the user's choice
    expect(resolve({}, { ...DEF, effort: 'max' }, REG)).toMatchObject({ effort: 'max', source: 'default' });
  });

  it('an alias of the default model is no override', () => {
    expect(resolve({ model: 'sonnet' }, { ...DEF, models: { claude: 'claude-sonnet-5-5', cursor: null } }, REG)).toMatchObject({ source: 'default' });
  });

  it('an engine the caller may not start now leaves the choice to another one that may', () => {
    const cursorDef: RouteDefaults = { harness: 'cursor', models: { claude: null, cursor: 'grok-4.7' }, effort: null };
    expect(resolve({}, cursorDef, REG, h => h === 'cursor')).toMatchObject({ harness: 'cursor', model: 'grok-4.7', source: 'default' });
    expect(resolve({ harness: 'cursor' }, cursorDef, REG, h => h === 'cursor')).toMatchObject({ harness: 'cursor', source: 'default' });
    expect(resolve({}, DEF, REG, () => false)).toEqual({ error: expect.stringMatching(/Nessun motore/) });
  });

  it('drops an effort nobody named that the model lacks', () => {
    const reg = { ...REG, models: REG.models.map(m => (m.id === 'claude-haiku-5-5' ? { ...m, efforts: ['low' as const] } : m)) };
    expect(resolve({ model: 'claude-haiku-5-5' }, DEF, reg)).toMatchObject({ effort: null });
  });
});

describe('routing: task kind and routeChat', () => {
  it('reads the kind from title, then prompt, accents off; an Orchestrator is its own; no rule matches = the built-in work words, else altro', () => {
    expect(taskOf('Posta · smista la inbox', '', TASKS)).toBe('triage');
    expect(taskOf('Ordini · totale', 'c’è un bug nel totale', TASKS)).toBe('bug-fix');
    expect(taskOf('Posta · novità', '', TASKS)).toBe('triage');
    expect(taskOf('Orchestrator · lavoro', 'fix', TASKS)).toBe('orchestrator');
    expect(taskOf('Ordini · x', 'y', TASKS)).toBe('altro');
    // a topic-only title loses to a prompt that builds or fixes (the brain's estimates.mjs, same rule)
    const OPS: [string, string, string][] = [['ops-read', String.raw`\b(log|telemetr\w*|app ?insights)\b`, 'i'], ...TASKS];
    expect(taskOf('Magazzino · Telemetria ordini', 'Implementa gli eventi su due repo, test e PR', OPS)).toBe('app-feature');
    expect(taskOf('Magazzino · Log', 'leggi i log e correggi il parsing', OPS)).toBe('bug-fix');
    expect(taskOf('Magazzino · Log', 'leggi i log di ieri', OPS)).toBe('ops-read');
    expect(taskOf('Posta · smista', 'apri la PR', TASKS)).toBe('triage');
    expect(taskOf('fix', '', undefined)).toBe('bug-fix');
    expect(taskOf('Ordini · x', 'y', undefined)).toBe('altro');
  });

  it('routes a chat on the defaults: area from the title (the app space is App), kind, no version, time', () => {
    const r = routeChat({ title: 'Magazzino · smista i ticket', prompt: '', ask: {}, defaults: DEF }, REG, { tasks: TASKS }, 42);
    expect(r).toEqual({ harness: 'claude', model: null, effort: 'high', route: { policy: 'routing', version: null, source: 'default', reason: null, kind: 'triage', area: 'Magazzino', at: 42 } });
    const app = routeChat({ title: 'Tema scuro', prompt: '', appCode: true, kind: 'app-feature', ask: {}, defaults: DEF }, REG, null, 1);
    expect(app).toMatchObject({ model: null, route: { area: 'App', kind: 'app-feature', source: 'default' } });
    expect(routeChat({ title: 'x', prompt: '', ask: { effort: 'max' }, defaults: DEF }, REG, null)).toEqual({ error: expect.stringMatching(/max/) });
  });

  it('reads a stored route back only when well formed; a route of the old table still loads (ADR 0210)', () => {
    const ok = { policy: 'routing', version: 2, source: 'override', reason: 'r', kind: 'review', area: 'Magazzino', at: 5 };
    expect(validRoute(ok)).toEqual(ok);
    expect(validRoute({ ...ok, version: 'x' })).toMatchObject({ version: null });
    expect(validRoute({ ...ok, kind: 'boh' })).toBeNull();
    expect(validRoute({ ...ok, source: 'magic' })).toBeNull();
    expect(validRoute(null)).toBeNull();
    expect(validRoute({ ...ok, ledgerId: 'app:c1', handoffs: 2 })).toMatchObject({ ledgerId: 'app:c1', handoffs: 2 });
    expect(validRoute({ ...ok, ledgerId: '../x', handoffs: -1 })).toEqual(ok);
    expect(validRoute({ ...ok, source: 'table' })).toMatchObject({ source: 'table' });
    expect(validRoute({ ...ok, source: 'explore' })).toMatchObject({ source: 'explore' });
  });
});

describe('routing: the brain files', () => {
  const brain = (): string => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(root, 'harness', 'models.json'), JSON.stringify(REG));
    return root;
  };

  it('reads the registry; no brain or no file = null', () => {
    expect(new Routing(brain).registry()?.models.map(m => m.id)).toContain('claude-opus-5-5');
    expect(new Routing(() => null).registry()).toBeNull();
  });

  it('ignores the old routing table left in a brain (ADR 0210): it never reaches a route, nothing crashes', () => {
    const root = brain();
    const dir = path.join(root, 'ops', 'state', 'improve', 'routing');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ version: 1 }));
    fs.writeFileSync(path.join(dir, 'v1.json'), JSON.stringify({ routes: [{ kind: '*', harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', why: 'w' }] }));
    const r = new Routing(() => root);
    expect(routeChat({ title: 'Ordini · smista', prompt: '', ask: {}, defaults: DEF }, r.registry(), { tasks: TASKS })).toMatchObject({ model: null, effort: 'high', route: { source: 'default', version: null } });
  });

  it('reads back the last actuals of a ledger id (totals across a restart or a hand-off)', () => {
    const root = brain();
    const r = new Routing(() => root);
    expect(r.lastActual('app:c1')).toBeNull();
    const line = (usd: number) => ({ id: 'app:c1', domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    r.observe(line(0.1)); r.observe({ ...line(9), id: 'app:c2' }); r.observe(line(0.3));
    expect(r.lastActual('app:c1')).toMatchObject({ usd: 0.3 });
  });

  it('appends prediction and actual lines to the shared ledger', () => {
    const root = brain();
    const r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: null, source: 'agent' as const, reason: 'ruolo Scout v1', kind: 'triage' as const, area: 'Magazzino', at: 9 };
    const pred = predictionLine(route, { id: 'app:c1', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', promptChars: 120 });
    expect(pred).toEqual({ id: 'app:c1', at: 9, domain: 'routing',
      item: { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', area: 'Magazzino', kind: 'triage', promptChars: 120 },
      predicted: { policy: 'routing', version: null, value: { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', source: 'agent', reason: 'ruolo Scout v1' } } });
    expect(r.observe(pred)).toBe(true);
    r.observe({ id: 'app:c1', domain: 'routing', outcome: { known: false, source: 'measured' }, actual: { usd: 0.4, minutes: 3, turns: 2, ctxPeak: 50000, handoffs: 0 } });
    const lines = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ id: 'app:c1', outcome: { known: false }, actual: { usd: 0.4 } });
    expect(new Routing(() => null).observe(pred)).toBe(false);
  });
});
