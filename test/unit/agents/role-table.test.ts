// agents/role-table.ts (issue #99, ADR 0091): a role with no model of its own takes the routing table's row on its own
// engine (model and effort), so e.g. Sentinel's reviews can run claude-opus-5-5 at low effort; a row on another engine,
// no row, or the defaults never count; exploration and the API switch never apply.
import { describe, expect, it } from 'vitest';
import { roleTableModel } from '../../../src/main/agents/role-table';
import { routeChat, type RouteRequest } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';
import type { RoutingRow, RoutingTable, Settings } from '../../../src/shared/contract';

const row = (p: Partial<RoutingRow>): RoutingRow => ({ kind: '*', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'w', since: '2026-10-13', evidence: 'e', ...p });
const table = (routes: RoutingRow[]): RoutingTable => ({ version: 1, appliedAt: null, by: null, exploration: 0.5, costWeight: 7, routes });
const settings = { orchestratorChats: { harness: 'claude', claudeModel: '', cursorModel: '', claudeEffort: 'high' } } as unknown as Pick<Settings, 'orchestratorChats'>;
const brain = (t: RoutingTable | null, seen: RouteRequest[] = []) => ({
  // like brain/index.ts route(): exploration counts and the API engine are filled unless the request sets them
  route: (req: RouteRequest) => { seen.push(req); return routeChat({ counts: () => new Map(), rnd: () => 0, api: 'api', ...req }, t, REG, null); },
  settings: () => settings,
});

describe('role table model', () => {
  it('takes the matching row on the role engine with its effort', () => {
    const t = table([row({ kind: 'review', model: 'claude-opus-5-5', effort: 'low' })]);
    expect(roleTableModel(brain(t), 'claude', { title: 'Ordini · Code review', prompt: 'review the diff' })).toEqual({ model: 'claude-opus-5-5', effort: 'low' });
  });
  it('matches on the launch\'s explicit kind and app code, as the route the chat records does', () => {
    const t = table([row({ kind: 'review', model: 'claude-opus-5-5', effort: 'low' })]);
    const req = { title: 'Ordini · Controllo', prompt: 'look at the branch' };
    expect(roleTableModel(brain(t), 'claude', req)).toBeNull();
    expect(roleTableModel(brain(t), 'claude', { ...req, routeHint: { kind: 'review' } })).toEqual({ model: 'claude-opus-5-5', effort: 'low' });
    const seen: RouteRequest[] = [];
    const app = table([row({ kind: '*', area: 'App', model: 'claude-opus-5-5', effort: 'high' })]);
    expect(roleTableModel(brain(app, seen), 'claude', req)).toBeNull();
    expect(roleTableModel(brain(app, seen), 'claude', { ...req, routeHint: { appCode: true } })).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
    expect(seen.at(-1)).toMatchObject({ appCode: true });
  });
  it('never explores and never moves to the API engine', () => {
    const seen: RouteRequest[] = [];
    const t = table([row({ kind: '*', effort: 'low', onApi: true })]);
    expect(roleTableModel(brain(t, seen), 'claude', { title: 'x', prompt: 'y' })).toEqual({ model: 'claude-opus-5-5', effort: 'low' });
    expect(seen[0]).toMatchObject({ counts: undefined, api: null, ask: { harness: 'claude' } });
  });
  it('ignores a row on another engine, no row and an empty table', () => {
    expect(roleTableModel(brain(table([row({ harness: 'cursor', model: 'grok-4.7', effort: null })])), 'claude', { title: 'x', prompt: 'y' })).toBeNull();
    expect(roleTableModel(brain(table([])), 'claude', { title: 'x', prompt: 'y' })).toBeNull();
    expect(roleTableModel(brain(null), 'claude', { title: 'x', prompt: 'y' })).toBeNull();
  });
  it('a failing router is no row', () => {
    expect(roleTableModel({ route: () => { throw new Error('boom'); }, settings: () => settings }, 'claude', { title: 'x' })).toBeNull();
  });
});
