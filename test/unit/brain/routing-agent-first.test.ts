// Role-first routing (ADR 0083, issue #72; ADR 0210 removed the table): a role chat takes the engine, model and effort
// the role resolved to and nothing overrides it; a role run's verdict becomes the known
// outcome of its chat's ledger line and survives the next measured line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentStatsLine, foldOutcome, knownOutcome, predictionLine, routeChat, Routing, validRoute, type AgentChoice, type LedgerOutcome, type RouteRequest } from '../../../src/main/brain/routing';
import { DEMO_REGISTRY as REG } from '../../../src/main/brain/routing-demo';
const base: RouteRequest = { title: 'Ordini · Fix totale', prompt: 'fix the bug', kind: 'bug-fix', ask: {}, defaults: { harness: 'claude', models: { claude: null, cursor: null }, effort: 'high' } };
const agent = (p: Partial<AgentChoice> = {}): AgentChoice => ({ id: 'artisan', name: 'Artisan', version: 3, harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', chosenBy: 'orchestrator', ...p });

const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agent-first-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
/** The ledger's outcomes by id, folded as the Classificatori page reads them (later line wins, a proxy never replaces a verified one). */
const folded = (root: string): Map<string, LedgerOutcome> => {
  const m = new Map<string, LedgerOutcome>();
  for (const l of fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n')) {
    const j = JSON.parse(l) as { id: string; outcome?: unknown };
    if (j.outcome) foldOutcome(m, j.id, j.outcome);
  }
  return m;
};

describe('role first', () => {
  it('takes the resolved role as it is: no override, no exploration, no reason asked', () => {
    const r = routeChat({ ...base, agent: agent({ stats: '12 run, 9 con esito, 78% riuscite' }) }, REG, null);
    expect(r).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5', effort: 'low', route: { source: 'agent', version: null, agent: { id: 'artisan', version: 3, chosenBy: 'orchestrator', modelFrom: 'role' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toContain('ruolo Artisan v3');
    expect(r.route.reason).toContain('78% riuscite');
    // a role with max effort is the user's own choice: no reason needed
    expect(routeChat({ ...base, agent: agent({ effort: 'max' }) }, REG, null)).toMatchObject({ effort: 'max', route: { source: 'agent' } });
  });

  it('records the tier; a role without a model runs on the engine\'s default', () => {
    const r = routeChat({ ...base, agent: agent({ tier: 'top', chosenBy: 'parent' }) }, REG, null);
    expect(r).toMatchObject({ model: 'claude-sonnet-5-5', route: { agent: { modelFrom: 'tier', tier: 'top', chosenBy: 'parent' } } });
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).toMatch(/avviato dal suo genitore · livello top/);
    expect(routeChat({ ...base, agent: agent({ model: null, effort: null }) }, REG, null)).toMatchObject({ harness: 'claude', model: null, route: { agent: { modelFrom: 'engine' } } });
  });
  it('reads back an old route whose model came from the table (before ADR 0210)', () => {
    const r = routeChat({ ...base, agent: agent({ tier: 'top' }) }, REG, null);
    if ('error' in r) throw new Error(r.error);
    expect(r.route.reason).not.toContain('tabella');
    expect(validRoute({ ...r.route, agent: { ...r.route.agent!, modelFrom: 'table' } })?.agent?.modelFrom).toBe('table');
  });

  it('refuses a role whose model belongs to another engine', () => {
    expect(routeChat({ ...base, agent: agent({ harness: 'cursor', model: 'claude-opus-5-5', effort: null }) }, REG, null)).toHaveProperty('error');
  });

  it('keeps the role on the route read back from chats.json, and drops a malformed one', () => {
    const r = routeChat({ ...base, agent: agent({ tier: 'mid' }) }, REG, null);
    if ('error' in r) throw new Error(r.error);
    expect(validRoute(JSON.parse(JSON.stringify(r.route)))).toEqual(r.route);
    expect(validRoute({ ...r.route, agent: { id: 'BAD ID', version: 1, chosenBy: 'orchestrator' } })).not.toHaveProperty('agent');
    expect(validRoute({ ...r.route, agent: { id: 'scout', version: 1, chosenBy: 'somebody' } })).not.toHaveProperty('agent');
  });
});

describe('reasons (#72)', () => {
  it('an agent version\'s results line', () => {
    expect(agentStatsLine({ ended: 12, successRate: { value: 0.78, n: 9 } })).toBe('12 run, 9 con esito, 78% riuscite');
    // a share from one outcome says nothing (#159)
    expect(agentStatsLine({ ended: 49, successRate: { value: 1, n: 1 } })).toBe('49 run, 1 con esito (troppo pochi per una percentuale)');
    expect(agentStatsLine({ ended: 49, successRate: { value: 0.8, n: 5 } })).toBe('49 run, 5 con esito, 80% riuscite');
    expect(agentStatsLine({ ended: 0, successRate: { value: null, n: 0 } })).toBeNull();
  });

  it('a chat without a role carries no reason unless the user named something (ADR 0210)', () => {
    expect(routeChat(base, REG, null)).toMatchObject({ route: { source: 'default', reason: null } });
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

  it('writes a known outcome with the last actuals and keeps it on later measured lines', () => {
    const root = tmp(), r = new Routing(() => root);
    const route = { policy: 'routing' as const, version: 1, source: 'agent' as const, reason: null, kind: 'bug-fix' as const, area: 'Ordini', at: 1 };
    const measured = (usd: number) => ({ id: 'app:c1', domain: 'routing' as const, outcome: { known: false as const, source: 'measured' as const }, actual: { usd, minutes: 1, turns: 1, ctxPeak: null, handoffs: 0 } });
    r.observe(predictionLine(route, { id: 'app:c1', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(predictionLine({ ...route, kind: 'writing' }, { id: 'app:c2', harness: 'claude', model: null, effort: null, promptChars: 10 }));
    r.observe(measured(0.5));
    expect(folded(root).get('app:c1')).toBeUndefined();
    r.observeOutcome('app:c1', knownOutcome({ runId: 'r1', outcome: { verdict: 'success', basis: 'human', at: 2 } })!);
    r.observe(measured(0.9));
    const lines = fs.readFileSync(path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as { outcome?: { known: boolean }; actual?: { usd: number } });
    expect(lines.at(-2)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.5 } });
    expect(lines.at(-1)).toMatchObject({ outcome: { known: true, success: true }, actual: { usd: 0.9 } });
    expect(folded(root).get('app:c1')).toMatchObject({ success: true, verified: true });
    // a new process reads the known outcome back from the file
    const again = new Routing(() => root);
    again.observe(measured(1.2));
    expect(folded(root).get('app:c1')).toMatchObject({ success: true, verified: true });
    expect(folded(root).get('app:c2')).toBeUndefined();
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
    // a proxy line never replaces the human verdict before it
    expect(folded(root).get('app:c1')).toMatchObject({ success: true, verified: false });
    expect(folded(root).get('app:c2')).toMatchObject({ success: false, verified: true });
    // a stale measured line (written by an older build) never undoes a known outcome either
    fs.appendFileSync(file, `${JSON.stringify(measured('app:c2', 1))}\n`);
    expect(folded(root).get('app:c2')).toMatchObject({ success: false, verified: true });
  });

});
