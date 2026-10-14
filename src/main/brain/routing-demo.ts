// The model routing of the demo (SB_DEMO=1): a registry like the brain's harness/models.json (Claude auto, Cursor
// manual) and a small table kept in memory, with the real hard rules (checkTable) and the real resolution (routeChat),
// so the settings editor and app_create_chat behave as with a brain, with no files and no tokens. Used by demo.ts;
// e2e/settings-routing.spec.ts screenshots the editor on it.
import type { ModelRegistry, RoutingChange, RoutingInfo, RoutingRow, RoutingTable } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { agentLimits, checkCostWeight, checkExploration, checkTable, COST_WEIGHT, isAgent, routeChat, type RouteRequest, type RouteResult } from './routing';

const p = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number) => ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output });
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEMO_REGISTRY: ModelRegistry = {
  harnesses: { claude: { routing: 'auto' }, cursor: { routing: 'manual' }, api: { routing: 'manual' } },
  defaultModel: 'claude-opus-5-5', modifiers: { usGeo: 1.1, webSearchPerRequest: 0.01 }, appChats: { model: 'claude-opus-5-5', effort: 'medium' },
  models: [
    { id: 'claude-fable-5-1', harness: 'claude', provider: 'anthropic', aliases: ['fable'], routing: 'auto', tier: 'top', price: p(10, 12.5, 20, 0.25, 50), efforts: [...ALL], defaultEffort: 'high' },
    { id: 'claude-opus-5-5', harness: 'claude', provider: 'anthropic', aliases: ['opus'], routing: 'auto', tier: 'strong', fastFactor: 2, price: p(4, 5, 8, 0.2, 20), efforts: [...ALL], defaultEffort: 'medium' },
    { id: 'claude-sonnet-5-5', harness: 'claude', provider: 'anthropic', aliases: ['sonnet'], routing: 'auto', tier: 'mid', price: p(2, 2.5, 4, 0.1, 10), efforts: [...ALL], defaultEffort: 'high' },
    { id: 'claude-haiku-5-5', harness: 'claude', provider: 'anthropic', aliases: ['haiku'], routing: 'auto', tier: 'fast', price: p(0.1, 0.125, 0.2, 0.01, 0.5), efforts: [...ALL], defaultEffort: 'medium' },
    { id: 'grok-4.7', harness: 'cursor', provider: 'xai', routing: 'manual', price: p(3, 3, 3, 0.75, 15), efforts: [], defaultEffort: null },
  ],
};
const ROUTES: RoutingRow[] = [
  { kind: '*', area: ['App', 'Pers · App'], harness: 'claude', model: 'claude-opus-5-5', effort: 'medium', why: 'chat sull’app: solo Claude Opus, sforzo medio', since: '2026-10-12', evidence: 'regola dell’utente' },
  { kind: 'triage', harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', why: 'smistare messaggi: basta Sonnet', since: '2026-10-11', evidence: '31 chat, stesso esito, −58% di costo' },
  { kind: 'ops-read', harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', why: 'letture di log: veloce ed economico', since: '2026-10-10', evidence: '24 chat, nessuna correzione' },
  { kind: 'bug-fix', harness: 'claude', model: 'claude-opus-5-5', effort: 'high', why: 'fix con causa da trovare: sforzo alto', since: '2026-10-09', evidence: 'stima senza dati', locked: true },
];

export class DemoRouting {
  private table: RoutingTable;
  /** every version kept, as in the brain's v<N>.json, and its changes (audit.jsonl), oldest first */
  private versions = new Map<number, RoutingTable>();
  private changes: RoutingChange[];
  constructor(at: string) {
    this.table = { version: 3, appliedAt: at, by: 'utente (Impostazioni)', exploration: 0, costWeight: COST_WEIGHT, routes: structuredClone(ROUTES) };
    this.versions.set(3, this.table);
    const earlier = new Date(Date.parse(at) - 86_400_000).toISOString();
    this.changes = [
      { at: earlier, from: 1, to: 2, by: 'agente: Regia dell’app', reason: 'smistamento su Sonnet', evidence: '31 chat, stesso esito, −58% di costo', stored: false },
      { at, from: 2, to: 3, by: 'utente (Impostazioni)', reason: 'fix di bug: sforzo alto', evidence: null, stored: true },
    ];
  }
  info(): RoutingInfo { return { table: structuredClone(this.table), registry: DEMO_REGISTRY, kinds: TASK_KINDS, error: null, history: [...this.changes].reverse() }; }
  save(routes: RoutingRow[], at: string, o: { by: string; reason?: string | null; evidence?: string | null; base?: number; exploration?: number; costWeight?: number } = { by: 'utente (Impostazioni)' }): RoutingInfo {
    if (o.base !== undefined && o.base !== this.table.version) throw new Error(`tabella non salvata: è cambiata (ora versione ${this.table.version}, la tua modifica parte dalla ${o.base}): ricarica e rifai la modifica`);
    const errors = [...checkTable(routes, DEMO_REGISTRY), checkExploration(o.exploration), checkCostWeight(o.costWeight),
      ...(isAgent(o.by) ? agentLimits(this.table, routes, o.costWeight) : [])].filter(e => e !== null);
    if (errors.length) throw new Error(`tabella non salvata: ${errors.join('; ')}`);
    const was = this.table, x = o.exploration ?? was.exploration, cw = o.costWeight ?? was.costWeight;
    const clean = routes.map(r => { const { locked, ...rest } = r; return locked === true ? { ...rest, locked: true } : rest; });
    this.table = { version: Math.max(...this.versions.keys()) + 1, appliedAt: at, by: o.by, exploration: x, costWeight: cw, routes: structuredClone(clean) };
    this.versions.set(this.table.version, this.table);
    this.changes.push({ at, from: was.version, to: this.table.version, by: o.by, reason: o.reason ?? null, evidence: o.evidence ?? null,
      ...(x !== was.exploration ? { exploration: { from: was.exploration, to: x } } : {}), ...(cw !== was.costWeight ? { costWeight: { from: was.costWeight, to: cw } } : {}), stored: true });
    return this.info();
  }
  restore(version: number, at: string, by = 'utente (Impostazioni)'): RoutingInfo {
    const t = this.versions.get(version);
    if (!t) throw new Error(`versione ${version} non trovata`);
    return this.save(t.routes, at, { by, reason: `ripristino della versione ${version}`, exploration: t.exploration, ...(isAgent(by) ? {} : { costWeight: t.costWeight }) });
  }
  route(req: RouteRequest, now: number): RouteResult { return routeChat(req, this.table, DEMO_REGISTRY, null, now); }
}
