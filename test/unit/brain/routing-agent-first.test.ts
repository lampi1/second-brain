// Role-first routing (ADR 0083, issue #72): a role chat takes the engine, model and effort the role resolved to and the
// table never overrides it; a row's reason is refreshed from the ledger's counts; a role run's verdict becomes the known
// outcome of its chat's ledger line and survives the next measured line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentStatsLine, freshReason, knownOutcome, predictionLine, routeChat, Routing, statsLine, validRoute, type AgentChoice, type RouteRequest } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';
import type { RoutingRow, RoutingTable } from '../../../src/shared/contract';

const row = (p: Partial<RoutingRow>): RoutingRow => ({ kind: '*', harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'w', since: '2026-10-13', evidence: 'e', ...p });
const table = (routes: RoutingRow[]): RoutingTable => ({ version: 4, appliedAt: null, by: null, exploration: 0.5, costWeight: 7, routes });
const base: RouteRequest = { title: 'Ordini · Fix totale', prompt: 'fix the bug', kind: 'bug-fix', ask: {}, defaults: { harness: 'claude', models: { claude: null, cursor: null }, effort: 'high' }, counts: () => new Map(), rnd: () => 0 };
const agent = (p: Partial<AgentChoice> = {}): AgentChoice => ({ id: 'artisan', name: 'Artisan', version: 3, harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', chosenBy: 'orchestrator', ...p });

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-first-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('role first', () => {
  const t = table([row({ kind: 'bug-fix', model: 'claude-opus-5-5', effort: 'high', why: 'scelta di Alex, nessun dato ancora' })]);

  it('takes the resolved role as it is: no override, no exploration, no reason asked', () => {
    const r = routeChat({ ...base, agent: agent({ stats: '12 run, 9 con esito, 78% riuscite' }) }, t, REG, null);
    expect(r).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', route: { source: 'agent', version: null, agent: { id: 'artisan', version: 3, chosenBy: 'orchestrator', modelFrom: 'role' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toContain('ruolo Artisan v3');
    expect(r.route.reason).toContain('78% riuscite');
    // a role with max effort is the user's own choice: no reason needed
    expect(routeChat({ ...base, agent: agent({ effort: 'max' }) }, t, REG, null)).toMatchObject({ effort: 'max', route: { source: 'agent' } });
  });

  it('records the tier, and never fills a missing model from the table', () => {
    const r = routeChat({ ...base, agent: agent({ tier: 'top', chosenBy: 'parent' }) }, t, REG, null);
    expect(r).toMatchObject({ model: 'claude-sonnet-5-5', route: { agent: { modelFrom: 'tier', tier: 'top', chosenBy: 'parent' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toMatch(/avviato dal suo genitore · livello top/);
    expect(routeChat({ ...base, agent: agent({ model: null, effort: null }) }, t, REG, null)).toMatchObject({ harness: 'claude', model: null, route: { agent: { modelFrom: 'engine' } } });
  });
  it('records a model the catalog took from the table row (issue #99)', () => {
    const r = routeChat({ ...base, agent: agent({ model: 'claude-opus-5-5', effort: 'low', tier: 'top', modelFrom: 'table' }) }, t, REG, null);
    expect(r).toMatchObject({ model: 'claude-opus-5-5', effort: 'low', route: { source: 'agent', agent: { modelFrom: 'table' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toContain('modello dalla tabella');
    expect(validRoute(r.route)?.agent?.modelFrom).toBe('table');
  });

  it('refuses a role whose model belongs to another engine', () => {
    expect(routeChat({ ...base, agent: agent({ harness: 'cursor', model: 'claude-opus-5-5', effort: null }) }, t, REG, null)).toHaveProperty('error');
  });

  it('keeps the role on the route read back from chats.json, and drops a malformed one', () => {
    const r = routeChat({ ...base, agent: agent({ tier: 'mid' }) }, t, REG, null);
    if ('error' in r) throw new Error(r.error);
    expect(validRoute(JSON.parse(JSON.stringify(r.route)))).toEqual(r.route);
    expect(validRoute({ ...r.route, agent: { id: 'BAD ID', version: 1, chosenBy: 'orchestrator' } })).not.toHaveProperty('agent');
    expect(validRoute({ ...r.route, agent: { id: 'scout', version: 1, chosenBy: 'somebody' } })).not.toHaveProperty('agent');
  });
});

describe('fresh reasons (#72)', () => {
  it('writes the counts and drops a stale "nessun dato ancora"', () => {
    expect(statsLine({ chats: 0, known: 0, ok: 0 })).toBeNull();
    expect(statsLine({ chats: 5, known: 0, ok: 0 })).toBe('5 chat, nessuna con esito');
    expect(statsLine({ chats: 16, known: 10, ok: 7 })).toBe('16 chat, 10 con esito, 70% riuscite');
    expect(freshReason('scelta di Alex, nessun dato ancora', { chats: 16, known: 10, ok: 7 })).toBe('scelta di Alex · 16 chat, 10 con esito, 70% riuscite');
    expect(freshReason('scelta di Alex, nessun dato ancora', { chats: 0, known: 0, ok: 0 })).toBe('scelta di Alex, nessun dato ancora');
    expect(agentStatsLine({ ended: 12, successRate: { value: 0.78, n: 9 } })).toBe('12 run, 9 con esito, 78% riuscite');
    // a share from one outcome says nothing (#159)
    expect(agentStatsLine({ ended: 49, successRate: { value: 1, n: 1 } })).toBe('49 run, 1 con esito (troppo pochi per una percentuale)');
    expect(agentStatsLine({ ended: 49, successRate: { value: 0.8, n: 5 } })).toBe('49 run, 5 con esito, 80% riuscite');
    expect(statsLine({ chats: 9, known: 4, ok: 4 })).not.toContain('%');
    expect(agentStatsLine({ ended: 0, successRate: { value: null, n: 0 } })).toBeNull();
  });

  it('routes a table chat with the refreshed reason', () => {
    const t = table([row({ kind: 'bug-fix', why: 'scelta di Alex, nessun dato ancora' })]);
    const r = routeChat({ ...base, counts: undefined, stats: () => ({ chats: 20, known: 12, ok: 9 }) }, t, REG, null);
    expect(r).toMatchObject({ route: { source: 'table', reason: 'scelta di Alex · 20 chat, 12 con esito, 75% riuscite' } });
  });
});

describe('verdicts in the ledger (#72)', () => {
  it('maps verdicts that count and skips the rest', () => {
    const run = (verdict: string, basis: string) => ({ runId: 'r1', outcome: { verdict, basis, at: 5 } });
    expect(knownOutcome(run('success', 'human'))).toEqual({ known: true, success: true, source: 'agent-user', runId: 'r1', at: 5 });
    expect(knownOutcome(run('partial', 'reviewed-evidence'))).toEqual({ known: true, success: false, partial: true, source: 'agent-review', runId: 'r1', at: 5 });
    expect(knownOutcome(run('fail', 'orchestrator-opinion'))).toMatchObject({ success: false, source: 'agent-orchestrator' });
    expect(knownOutcome(run('success', 'self-report'))).toBeNull();
    expect(knownOutcome(run('unknown', 'human'))).toBeNull();
    expect(knownOutcome({ runId: 'r2' })).toBeNull();
  });

  it('writes a known outcome with the last actuals, keeps it on later measured lines, and counts it per kind', () => {
    const root = tmp(), r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 1, source: 'agent' as const, reason: null, kind: 'bug-fix' as const, area: 'Ordini', at: 1 };
    const measured = (usd: number) => ({ id: 'app:c1', domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    r.observe(predictionLine(route, { id: 'app:c1', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(predictionLine({ ...route, kind: 'writing' }, { id: 'app:c2', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(measured(0.5));
    expect(r.kindStats('bug-fix')).toEqual({ chats: 1, known: 0, ok: 0 });
    r.observeOutcome('app:c1', knownOutcome({ runId: 'r1', outcome: { verdict: 'success', basis: 'human', at: 2 } })!);
    r.observe(measured(0.9));
    const lines = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { outcome?: { known: boolean }; actual?: { usd: number } });
    expect(lines.at(-2)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.5 } });
    expect(lines.at(-1)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.9 } });
    expect(r.kindStats('bug-fix')).toEqual({ chats: 1, known: 1, ok: 1 });
    // a new process reads the known outcome back from the file
    const again = new Routing(() => root);
    again.observe(measured(1.2));
    expect(again.kindStats('bug-fix')).toEqual({ chats: 1, known: 1, ok: 1 });
    expect(again.kindStats('writing')).toEqual({ chats: 1, known: 0, ok: 0 });
    expect(again.info().kindStats).toEqual({ 'bug-fix': { chats: 1, known: 1, ok: 1 }, writing: { chats: 1, known: 0, ok: 0 } });
  });

  it('carries an outcome the brain settled after the app read the ledger, and folds proxy and human lines (issue #110)', () => {
    const root = tmp(), r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 1, source: 'agent' as const, reason: null, kind: 'bug-fix' as const, area: 'Ordini', at: 1 };
    const measured = (id: string, usd: number) => ({ id, domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    const file = path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl');
    r.observe(predictionLine(route, { id: 'app:c1', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(predictionLine(route, { id: 'app:c2', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(measured('app:c1', 0.5)); // the app has read the ledger now
    // the brain's loop settles both chats in the same file (ADR 0047)
    fs.appendFileSync(file, `${JSON.stringify({ id: 'app:c1', domain: 'routing', outcome: { known: true, success: true, source: 'proxy' } })}\n`);
    fs.appendFileSync(file, `${JSON.stringify({ id: 'app:c2', domain: 'routing', outcome: { known: true, success: false, source: 'human' } })}\n`);
    fs.appendFileSync(file, `${JSON.stringify({ id: 'app:c2', domain: 'routing', outcome: { known: true, success: true, source: 'proxy' } })}\n`);
    r.observe(measured('app:c1', 0.9)); // the chat goes on: its next measured line must carry the brain's outcome
    const last = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1)!) as { outcome: { known: boolean; source: string } };
    expect(last.outcome).toMatchObject({ known: true, success: true, source: 'proxy' });
    // any known outcome counts in the kind's stats; a proxy line never replaces the human verdict before it
    expect(r.kindStats('bug-fix')).toEqual({ chats: 2, known: 2, ok: 1 });
    // a stale measured line (written by an older build) never undoes a known outcome either
    fs.appendFileSync(file, `${JSON.stringify(measured('app:c2', 1))}\n`);
    expect(r.kindStats('bug-fix')).toEqual({ chats: 2, known: 2, ok: 1 });
  });

});
