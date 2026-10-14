// The model routing of the demo (SB_DEMO=1): a registry like the brain's harness/models.json (Claude auto, Cursor
// manual) and a small table kept in memory, with the real hard rules (checkTable) and the real resolution (routeChat),
// so the settings editor and app_create_chat behave as with a brain, with no files and no tokens. Used by demo.ts;
// e2e/settings-routing.spec.ts screenshots the editor on it.
import type { ModelRegistry, RoutingInfo, RoutingRow, RoutingTable } from '../../shared/contract';
import { TASK_KINDS } from '../../shared/contract';
import { checkTable, routeChat, type RouteRequest, type RouteResult } from './routing';

const p = (input: number, cacheWrite5m: number, cacheWrite1h: number, cacheRead: number, output: number) => ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output });
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEMO_REGISTRY: ModelRegistry = {
  harnesses: { claude: { routing: 'auto' }, cursor: { routing: 'manual' }, api: { routing: 'manual' } },
  defaultModel: 'claude-opus-5-5', modifiers: { usGeo: 1.1, webSearchPerRequest: 0.01 },
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
  { kind: 'bug-fix', harness: 'claude', model: 'claude-opus-5-5', effort: 'high', why: 'fix con causa da trovare: sforzo alto', since: '2026-10-09', evidence: 'stima senza dati' },
];

export class DemoRouting {
  private table: RoutingTable;
  constructor(at: string) { this.table = { version: 3, appliedAt: at, by: 'utente (Impostazioni)', exploration: 0, routes: structuredClone(ROUTES) }; }
  info(): RoutingInfo { return { table: structuredClone(this.table), registry: DEMO_REGISTRY, kinds: TASK_KINDS, error: null }; }
  save(routes: RoutingRow[], at: string): RoutingInfo {
    const errors = checkTable(routes, DEMO_REGISTRY);
    if (errors.length) throw new Error(`tabella non salvata: ${errors.join('; ')}`);
    this.table = { version: this.table.version + 1, appliedAt: at, by: 'utente (Impostazioni)', exploration: 0, routes: structuredClone(routes) };
    return this.info();
  }
  route(req: RouteRequest, now: number): RouteResult { return routeChat(req, this.table, DEMO_REGISTRY, null, now); }
}
