// Collects bounded native chat-session observations for analytics, without storing conversation text.
// ChatManager supplies live sink events; missing history, billing and child coverage remain unknown.
import path from 'node:path';
import type { ChatItem, ChatSummary, PendingRequest } from '../../shared/contract';
import type { SessionPatch, TokenUsage } from '../chats/session';
import { aggregateAgentUsage, type AgentSessionObservation, type ObservedProvenance, type TimingKind } from './analytics';
import { readLocal, writeLocal } from './local-store';

interface Row { observation: AgentSessionObservation; resultIds: string[]; partialCost: number; costMissing: boolean; partialTokens: TokenUsage; tokensMissing: boolean }
interface Live { kind: TimingKind | null; since: number; pending: Map<string, PendingRequest['type']>; cost: number | null; costKnown: boolean | null; tokens: TokenUsage | null; metrics: boolean; origin: Partial<ObservedProvenance>; result?: Extract<ChatItem, { kind: 'result' }> }
const LIMIT = 1000, EVENT_LIMIT = 2000, SPAN_LIMIT = 2000;
const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export class AgentAnalyticsCollector {
  private readonly file: string;
  private readonly rows = new Map<string, Row>();
  private readonly live = new Map<string, Live>();
  private readonly native = new Set<string>();
  private problem: unknown;
  private readonly started: number;

  constructor(userData: string, private readonly clock: () => number = Date.now) {
    this.file = path.join(userData, 'agent-analytics.json');
    this.started = this.clock();
    try {
    const saved = readLocal(this.file);
    if (saved === undefined) return;
    const data = saved as { version?: unknown; rows?: unknown };
    if (data.version !== 1 || !Array.isArray(data.rows) || data.rows.length > LIMIT) throw new Error('Invalid analytics archive');
    for (const value of data.rows as Row[]) {
      if (!value?.observation || !Array.isArray(value.resultIds) || value.resultIds.length > EVENT_LIMIT || value.resultIds.some(id => typeof id !== 'string') || !finite(value.partialCost) || typeof value.costMissing !== 'boolean' || typeof value.tokensMissing !== 'boolean' || !value.partialTokens || !Object.values(value.partialTokens).every(finite) || value.observation.spans.length > SPAN_LIMIT || this.rows.has(value.observation.sessionKey)) throw new Error('Invalid analytics archive');
      this.rows.set(value.observation.sessionKey, value);
    }
    aggregateAgentUsage([...this.rows.values()].map(row => row.observation));
    } catch (error) { this.problem = error; }
  }

  private current(chat: ChatSummary): { row: Row; live: Live } | null {
    if (this.problem) throw this.problem;
    if (!chat.agent || !chat.sessionId) return null;
    const key = `${chat.harness}:${chat.sessionId}`;
    if (!this.native.has(key)) return null;
    let row = this.rows.get(key);
    if (row && (row.observation.owner.id !== chat.agent.id || row.observation.owner.revision !== chat.agent.revision)) return null;
    if (!row) {
      if (this.rows.size >= LIMIT) return null; // Preserve existing evidence rather than silently evict history.
      row = { observation: { sessionKey: key, owner: { id: chat.agent.id, name: chat.agent.name, revision: chat.agent.revision }, observedAt: this.clock(), source: 'chat-events', parentSessionKey: null, childTotals: 'unknown', actualUsd: null, listPriceUsd: null, estimatedUsd: null, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null }, startedAt: null, endedAt: null, spans: [], completed: false, taskType: null, model: null, effort: null, provenance: { agentId: chat.agent.id, agentRevision: chat.agent.revision, sessionId: key, engine: chat.harness, source: 'chat-events' }, modelAttribution: 'unknown' }, resultIds: [], partialCost: 0, costMissing: false, partialTokens: emptyTokens(), tokensMissing: false };
      this.rows.set(key, row);
    }
    let live = this.live.get(key);
    if (!live) {
      if (row.resultIds.length) {
        row.costMissing = true; row.tokensMissing = true;
        row.observation.listPriceUsd = null;
        row.observation.tokens = { input: null, output: null, cacheRead: null, cacheWrite: null };
      }
      live = { kind: null, since: this.clock(), pending: new Map(), cost: null, costKnown: chat.costKnown === false ? false : null, tokens: null, metrics: false, origin: {} };
      this.live.set(key, live);
    }
    return { row, live };
  }

  private save(row: Row): void {
    row.observation.observedAt = this.clock();
    writeLocal(this.file, { version: 1, rows: [...this.rows.values()] });
  }

  private transition(row: Row, live: Live, kind: TimingKind | null): void {
    const now = this.clock();
    if (live.kind && now > live.since && row.observation.spans.length < SPAN_LIMIT) row.observation.spans.push({ kind: live.kind, start: live.since, end: now });
    live.kind = kind; live.since = now;
  }

  private waiting(live: Live): TimingKind {
    return [...live.pending.values()].includes('permission') ? 'permission-wait' : [...live.pending.values()].includes('question') ? 'user-wait' : 'unknown';
  }

  patch(chat: ChatSummary, p: SessionPatch): void {
    chat = { ...chat, sessionId: p.sessionId ?? chat.sessionId };
    if (p.sessionId && p.sessionId === chat.sessionId) this.native.add(`${chat.harness}:${p.sessionId}`);
    const current = this.current(chat); if (!current) return;
    const { row, live } = current, observation = row.observation;
    if ('modelObserved' in p) {
      const model = p.modelObserved;
      live.origin = { ...live.origin, modelObserved: typeof model === 'string' && model.length > 0 && model.length <= 200 ? model : null, at: this.clock() };
      if (typeof model === 'string' && model.length > 0 && model.length <= 200) {
        const old = observation.provenance?.modelObserved;
        if (old && old !== model) observation.modelAttribution = 'mixed';
        else if (observation.modelAttribution !== 'mixed') observation.modelAttribution = 'single-model-observed';
        observation.provenance = { ...observation.provenance, modelObserved: model, at: this.clock() };
      } else { observation.modelAttribution = 'unknown'; observation.provenance = { ...observation.provenance, modelObserved: null }; }
    }
    if ('effortObserved' in p) observation.provenance = { ...observation.provenance, effortObserved: typeof p.effortObserved === 'string' && p.effortObserved.length <= 200 ? p.effortObserved : null };
    if ('effortSubmitted' in p) observation.provenance = { ...observation.provenance, effortSubmitted: typeof p.effortSubmitted === 'string' && p.effortSubmitted.length <= 200 ? p.effortSubmitted : null };
    if ('effortObserved' in p) live.origin = { ...live.origin, effortObserved: observation.provenance?.effortObserved ?? null, at: this.clock() };
    if ('effortSubmitted' in p) live.origin = { ...live.origin, effortSubmitted: observation.provenance?.effortSubmitted ?? null };
    if (p.costKnown !== undefined) live.costKnown = p.costKnown;
    if ('turnCostUsd' in p) live.cost = live.costKnown !== false && finite(p.turnCostUsd) ? p.turnCostUsd : null;
    if (p.costKnown === false) live.cost = null;
    if (p.turnTokens) live.tokens = Object.values(p.turnTokens).every(finite) ? { ...p.turnTokens } : null;
    if ('turnCostUsd' in p || p.turnTokens) live.metrics = true;
    if (live.result && live.metrics) this.settle(row, live);
    if (p.state) this.transition(row, live, p.state === 'running' ? 'execution' : p.state === 'waiting' ? this.waiting(live) : p.state === 'starting' ? 'unknown' : null);
    this.save(row);
  }

  item(chat: ChatSummary, item: ChatItem, replace: boolean): void {
    if (item.kind !== 'result' || replace || item.at < this.started) return;
    const current = this.current(chat); if (!current) return;
    const { row, live } = current;
    if (row.resultIds.includes(item.id) || row.resultIds.length >= EVENT_LIMIT) return;
    if (live.result?.id === item.id) return;
    if (live.result) this.settle(row, live); // A previous result with no usage is unknown, never silently omitted.
    live.result = item;
    this.transition(row, live, null);
    if (live.metrics) this.settle(row, live);
    this.save(row);
  }

  private settle(row: Row, live: Live): void {
    const item = live.result;
    if (!item || row.resultIds.includes(item.id)) return;
    row.resultIds.push(item.id);
    if (live.cost === null) row.costMissing = true; else row.partialCost += live.cost;
    if (live.tokens === null) row.tokensMissing = true;
    else for (const key of Object.keys(row.partialTokens) as (keyof TokenUsage)[]) row.partialTokens[key] += live.tokens[key];
    row.observation.listPriceUsd = row.costMissing ? null : row.partialCost;
    row.observation.tokens = row.tokensMissing ? { input: null, output: null, cacheRead: null, cacheWrite: null } : { ...row.partialTokens };
    row.observation.provenance = { ...row.observation.provenance, itemId: item.id.length <= 200 ? item.id : null, at: item.at };
    live.cost = null; live.tokens = null; live.metrics = false; delete live.result;
  }

  pending(chat: ChatSummary, req: Omit<PendingRequest, 'chatId'>): void {
    if (req.type === 'command') return;
    const current = this.current(chat); if (!current) return;
    current.live.pending.set(req.id, req.type);
    this.transition(current.row, current.live, this.waiting(current.live));
    this.save(current.row);
  }

  resolved(chat: ChatSummary, id: string): void {
    const current = this.current(chat); if (!current || !current.live.pending.delete(id)) return;
    this.transition(current.row, current.live, current.live.pending.size ? this.waiting(current.live) : 'unknown');
    this.save(current.row);
  }

  end(chat: ChatSummary): void {
    const current = this.current(chat); if (!current) return;
    if (current.live.result) this.settle(current.row, current.live);
    this.transition(current.row, current.live, null);
    this.live.delete(current.row.observation.sessionKey);
    this.save(current.row);
  }

  readModel(): ReturnType<typeof aggregateAgentUsage> {
    if (this.problem) throw this.problem;
    return aggregateAgentUsage([...this.rows.values()].map(row => row.observation));
  }

  origin(chat: ChatSummary): Partial<ObservedProvenance> {
    const key = `${chat.harness}:${chat.sessionId}`;
    if (!chat.sessionId || !this.native.has(key)) return {};
    const observation = this.rows.get(key)?.observation;
    if (!observation || observation.owner.id !== chat.agent?.id) return {};
    return { agentId: observation.owner.id, agentRevision: observation.owner.revision, engine: chat.harness, sessionId: chat.sessionId, ...this.live.get(key)?.origin, itemId: null, source: 'chat-provider-event' };
  }
}
