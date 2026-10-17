// Pure agent read model over existing session/ledger observations. No persistence, account/model calls or new rates.
import type { AgentOwnerSnapshot } from '../../shared/agents';
import type { LedgerRow } from '../brain/cursor-ledger';
import { listUsd } from '../brain/cursor-ledger';
import { maskSecrets } from '../brain/procedures';

export type TimingKind = 'execution' | 'user-wait' | 'permission-wait' | 'queue' | 'unknown';
export interface TimingSpan { kind: TimingKind; start: number; end: number }
export interface ObservedProvenance {
  agentId: string | null; agentRevision: number | null; sessionId: string | null; turnId: string | null; itemId: string | null;
  engine: string | null; modelObserved: string | null; effortObserved: string | null; effortSubmitted: string | null;
  source: string | null; at: number | null;
}
export interface AgentSessionObservation {
  sessionKey: string;
  owner: Pick<AgentOwnerSnapshot, 'id' | 'revision' | 'name'>;
  observedAt: number;
  source: string;
  parentSessionKey: string | null;
  childTotals: 'excluded' | 'included' | 'unknown';
  actualUsd: number | null;
  listPriceUsd: number | null;
  /** Calibrated estimates are distinct from both actual charges and uncalibrated list-price equivalents. */
  estimatedUsd: number | null;
  tokens: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null };
  startedAt: number | null;
  endedAt: number | null;
  spans: TimingSpan[];
  completed: boolean;
  taskType: string | null;
  model: string | null;
  effort: string | null;
  /** Event-observed metadata only; legacy/default model/effort above never backfill these fields. */
  provenance?: Partial<ObservedProvenance>;
  modelAttribution?: 'single-model-observed' | 'mixed' | 'unknown';
}
export interface QuotaObservation { id: string; scope: 'account'; window: string; fraction: number; at: number; source: string }
export interface CanonicalInsight {
  id: string; agentId: string | null; kind: 'error' | 'idea' | 'feedback'; text: string;
  sourceId: string; sourceRevision: number; at: number;
  author: { kind: 'human' | 'agent' | 'system'; id: string };
  confirmation: 'confirmed' | 'proposed' | 'unknown';
  confirmationBasis: 'human' | 'reviewed-evidence' | 'self-report' | 'unknown';
  state: 'open' | 'resolved' | 'dismissed'; outcome: 'helpful' | 'unhelpful' | 'unknown';
  origin?: Partial<ObservedProvenance>;
  reporter?: { author: CanonicalInsight['author']; provenance: Partial<ObservedProvenance> };
  responsibleEpisode?: Partial<ObservedProvenance>;
  revisionLineage?: { revision: number; author: CanonicalInsight['author']; provenance: Partial<ObservedProvenance> }[];
}
export interface InsightPolicy { version: 1; revision: number; mode: 'chronological' | 'confirmed-outcomes-first' }
export interface Measure { total: number | null; knownSubtotal: number | null; knownSessions: number; unknownSessions: number }
const kinds: TimingKind[] = ['execution', 'user-wait', 'permission-wait', 'queue', 'unknown'];
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const maybeNumber = (n: unknown) => n === null || valid(n);
function provenance(input: Partial<ObservedProvenance> = {}): ObservedProvenance {
  const result: ObservedProvenance = { agentId: null, agentRevision: null, sessionId: null, turnId: null, itemId: null, engine: null, modelObserved: null, effortObserved: null, effortSubmitted: null, source: null, at: null, ...input };
  for (const key of ['agentId', 'sessionId', 'turnId', 'itemId', 'engine', 'modelObserved', 'effortObserved', 'effortSubmitted', 'source'] as const) if (result[key] !== null && (typeof result[key] !== 'string' || !result[key] || result[key]!.length > 200)) throw new Error('Invalid observed provenance');
  if (!maybeNumber(result.at) || (result.agentRevision !== null && (!Number.isSafeInteger(result.agentRevision) || result.agentRevision < 0))) throw new Error('Invalid observed provenance');
  return result;
}
// A conversation's single-model rows do not prove the models of included/unknown descendant costs.
const modelOf = (s: AgentSessionObservation) => s.childTotals === 'excluded' && s.modelAttribution === 'single-model-observed' ? provenance(s.provenance).modelObserved : null;
const median = (numbers: number[]): number | null => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
function measure(values: (number | null)[]): Measure {
  const known = values.filter((v): v is number => v !== null);
  const subtotal = known.length ? known.reduce((sum, n) => sum + n, 0) : null;
  return { total: known.length === values.length ? subtotal : null, knownSubtotal: subtotal, knownSessions: known.length, unknownSessions: values.length - known.length };
}

/** Only explicit, nonoverlapping state intervals are timing evidence. Empty/partial history is never guessed zero. */
function timing(s: AgentSessionObservation) {
  const spans = [...s.spans].sort((a, b) => a.start - b.start);
  let previousEnd: number | null = null;
  for (const span of spans) {
    if (!kinds.includes(span.kind) || !valid(span.start) || !valid(span.end) || span.end < span.start || (previousEnd !== null && span.start < previousEnd) || (s.startedAt !== null && span.start < s.startedAt) || (s.endedAt !== null && span.end > s.endedAt)) throw new Error('Invalid/overlapping timing evidence');
    previousEnd = span.end;
  }
  const elapsed = s.startedAt !== null && s.endedAt !== null ? s.endedAt - s.startedAt : null;
  if (elapsed !== null && elapsed < 0) throw new Error('Invalid observed session interval');
  const complete = elapsed !== null && !spans.some(span => span.kind === 'unknown' && span.end > span.start) && (elapsed === 0 || (spans[0]?.start === s.startedAt && spans.at(-1)?.end === s.endedAt && spans.every((span, i) => i === 0 || span.start === spans[i - 1]!.end)));
  const result = Object.fromEntries(kinds.map(kind => {
    const selected = spans.filter(span => span.kind === kind);
    return [kind, selected.length ? selected.reduce((sum, span) => sum + span.end - span.start, 0) : complete ? 0 : null];
  })) as Record<TimingKind, number | null>;
  return { complete, elapsed, durations: result };
}

/** Snapshot replacement is by stable native-session key and observation time, never name or avatar. */
export function aggregateAgentUsage(input: AgentSessionObservation[], quotas: QuotaObservation[] = []) {
  if (input.length > 10000 || quotas.length > 1000) throw new Error('Analytics input exceeds bounds');
  const latest = new Map<string, AgentSessionObservation>();
  for (const s of input) {
    if (!s.sessionKey || !s.owner?.id || !Number.isSafeInteger(s.owner.revision) || s.owner.revision < 0 || !valid(s.observedAt) || !s.source || !['excluded', 'included', 'unknown'].includes(s.childTotals) || ![s.actualUsd, s.listPriceUsd, s.estimatedUsd, s.startedAt, s.endedAt, ...Object.values(s.tokens)].every(maybeNumber)) throw new Error('Invalid analytics observation');
    const observed = provenance(s.provenance);
    if ((observed.agentId !== null && observed.agentId !== s.owner.id) || (observed.agentRevision !== null && observed.agentRevision !== s.owner.revision) || (observed.sessionId !== null && observed.sessionId !== s.sessionKey)) throw new Error('Conflicting observed ownership/session provenance');
    if (s.modelAttribution !== undefined && !['single-model-observed', 'mixed', 'unknown'].includes(s.modelAttribution)) throw new Error('Invalid model attribution');
    const previous = latest.get(s.sessionKey);
    if (previous && previous.owner.id !== s.owner.id) throw new Error('Conflicting session ownership');
    if (previous && previous.observedAt === s.observedAt && JSON.stringify(previous) !== JSON.stringify(s)) throw new Error('Conflicting session snapshot');
    if (!previous || s.observedAt > previous.observedAt) latest.set(s.sessionKey, s);
  }
  const sessions = [...latest.values()].sort((a, b) => a.sessionKey.localeCompare(b.sessionKey, 'en'));
  const timings = new Map(sessions.map(s => [s.sessionKey, timing(s)]));
  const coveredBy = (s: AgentSessionObservation): string | null => {
    const seen = new Set([s.sessionKey]); let parent = s.parentSessionKey, covered: string | null = null;
    while (parent) {
      if (seen.has(parent)) throw new Error('Cyclic parent-session evidence');
      seen.add(parent);
      const ancestor = latest.get(parent);
      if (!ancestor) break;
      if (ancestor.childTotals !== 'excluded') covered = parent;
      parent = ancestor.parentSessionKey;
    }
    return covered;
  };
  const coverage = new Map(sessions.map(s => [s.sessionKey, coveredBy(s)]));
  const groups = new Map<string, AgentSessionObservation[]>();
  for (const s of sessions) groups.set(s.owner.id, [...(groups.get(s.owner.id) ?? []), s]);
  const agents = [...groups].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([agentId, owned]) => {
    const latestOwner = [...owned].sort((a, b) => b.observedAt - a.observedAt || b.owner.revision - a.owner.revision)[0]!.owner;
    const monetary = (key: 'actualUsd' | 'listPriceUsd' | 'estimatedUsd') => measure(owned.map(s => coverage.get(s.sessionKey) ? null : s[key]));
    return {
      agentId, name: latestOwner.name, revisions: [...new Set(owned.map(s => s.owner.revision))].sort((a, b) => a - b), sessions: owned.length,
      costs: { actualUsd: monetary('actualUsd'), listPriceUsd: monetary('listPriceUsd'), estimatedUsd: monetary('estimatedUsd') },
      tokens: Object.fromEntries((['input', 'output', 'cacheRead', 'cacheWrite'] as const).map(key => [key, measure(owned.map(s => coverage.get(s.sessionKey) ? null : s.tokens[key]))])) as Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', Measure>,
      timing: Object.fromEntries(kinds.map(kind => [kind, { ...measure(owned.map(s => timings.get(s.sessionKey)!.complete ? timings.get(s.sessionKey)!.durations[kind] : null)), medianMs: median(owned.flatMap(s => { const t = timings.get(s.sessionKey)!; const value = t.complete ? t.durations[kind] : null; return value === null ? [] : [value]; })), observedPartialMs: owned.reduce((total, s) => { const t = timings.get(s.sessionKey)!; return total + (t.complete ? 0 : t.durations[kind] ?? 0); }, 0) }])) as Record<TimingKind, Measure & { medianMs: number | null; observedPartialMs: number }>,
      elapsed: { ...measure(owned.map(s => timings.get(s.sessionKey)!.elapsed)), medianMs: median(owned.flatMap(s => { const value = timings.get(s.sessionKey)!.elapsed; return value === null ? [] : [value]; })) },
      evidence: owned.map(s => ({ sessionKey: s.sessionKey, source: s.source, observedAt: s.observedAt, ownerRevision: s.owner.revision, childTotals: s.childTotals, withheldByAncestor: coverage.get(s.sessionKey), completeTiming: timings.get(s.sessionKey)!.complete, provenance: provenance(s.provenance), modelAttribution: s.modelAttribution ?? 'unknown' })),
    };
  });
  const cohortMap = new Map<string, AgentSessionObservation[]>();
  for (const s of sessions) {
    const observed = provenance(s.provenance);
    if (!s.completed || !s.taskType || !observed.engine || !modelOf(s) || !observed.effortObserved || !timings.get(s.sessionKey)!.complete || timings.get(s.sessionKey)!.durations.unknown !== 0) continue;
    const key = JSON.stringify([s.owner.id, s.owner.revision, s.taskType, observed.engine, modelOf(s), observed.effortObserved]);
    cohortMap.set(key, [...(cohortMap.get(key) ?? []), s]);
  }
  const cohorts = [...cohortMap].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, rows]) => ({
    agentId: rows[0]!.owner.id, ownerRevision: rows[0]!.owner.revision, taskType: rows[0]!.taskType!, engine: provenance(rows[0]!.provenance).engine, model: modelOf(rows[0]!)!, effortObserved: provenance(rows[0]!.provenance).effortObserved!,
    samples: rows.length, medianExecutionMs: median(rows.map(s => timings.get(s.sessionKey)!.durations.execution!)), medianElapsedMs: median(rows.map(s => timings.get(s.sessionKey)!.elapsed!)),
  }));
  for (const q of quotas) if (q.scope !== 'account' || !q.id || !q.source || !q.window || !valid(q.at) || !valid(q.fraction) || q.fraction > 1) throw new Error('Invalid quota observation');
  const modelGroups = new Map<string, AgentSessionObservation[]>();
  for (const s of sessions) { const key = JSON.stringify([provenance(s.provenance).engine, modelOf(s)]); modelGroups.set(key, [...(modelGroups.get(key) ?? []), s]); }
  const byModel = [...modelGroups].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, rows]) => ({
    engine: provenance(rows[0]!.provenance).engine, modelObserved: modelOf(rows[0]!), samples: rows.length,
    actualUsd: measure(rows.map(s => coverage.get(s.sessionKey) ? null : s.actualUsd)), listPriceUsd: measure(rows.map(s => coverage.get(s.sessionKey) ? null : s.listPriceUsd)), estimatedUsd: measure(rows.map(s => coverage.get(s.sessionKey) ? null : s.estimatedUsd)),
  }));
  return { agents, cohorts, byModel, modelCoverage: { sessions: sessions.length, modelKnown: sessions.filter(s => modelOf(s) !== null).length, modelMissingOrMixed: sessions.filter(s => modelOf(s) === null).length, observedModelKnown: sessions.filter(s => provenance(s.provenance).modelObserved !== null).length }, quotaObservations: quotas.map(q => ({ ...q })), note: 'Observed samples only; no fastest-agent ranking. Legacy/default model and effort never backfill event provenance. Mixed/unknown/inclusive session totals remain unallocated by model. Quota is account-scoped, never dollars or agent-attributed. Inclusive/unknown parent totals withhold descendant costs and tokens.' };
}

/** Reuse readLedger's deduplicated events and existing listUsd prices. Actual charges/quota remain unknown. */
export function cursorLedgerObservations(rows: LedgerRow[], sessions: Omit<AgentSessionObservation, 'actualUsd' | 'listPriceUsd' | 'estimatedUsd' | 'tokens' | 'source'>[]) {
  const observations: AgentSessionObservation[] = [];
  const owners = new Set(sessions.map(s => s.sessionKey));
  if (owners.size !== sessions.length) throw new Error('Duplicate ledger session ownership');
  for (const session of sessions) {
    const events = rows.filter(row => row.conversationId === session.sessionKey);
    const prices = events.map(listUsd);
    const sum = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') => events.length ? events.reduce((total, row) => total + row[key], 0) : null;
    const observedModels = [...new Set(events.map(event => event.model))];
    const singleModel = observedModels.length === 1 && observedModels[0] !== null;
    observations.push({ ...session, actualUsd: null, estimatedUsd: null, listPriceUsd: prices.length && prices.every(p => p !== null) ? prices.reduce<number>((total, p) => total + p!, 0) : null, tokens: { input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite') }, source: 'cursor-ledger:listUsd', provenance: { agentId: session.owner.id, agentRevision: session.owner.revision, sessionId: session.sessionKey, turnId: events.length === 1 ? events[0]!.generationId : null, engine: events.length ? 'cursor' : null, modelObserved: singleModel ? observedModels[0]! : null, effortObserved: null, effortSubmitted: session.provenance?.effortSubmitted ?? null, at: events.length ? Math.max(...events.map(event => event.at)) : null, source: events.length ? 'cursor-ledger' : null }, modelAttribution: singleModel ? 'single-model-observed' : observedModels.length > 1 ? 'mixed' : 'unknown' });
  }
  return { observations, unattributedRows: rows.filter(row => !row.conversationId || !owners.has(row.conversationId)).length };
}

/** Same read model, with canonical events supplied by existing ledgers. Policy selection is explicit and reversible. */
export function buildAgentReadModel(sessions: AgentSessionObservation[], quotas: QuotaObservation[], events: CanonicalInsight[], period: { from: number; to: number }, policy: InsightPolicy) {
  if (!valid(period.from) || !valid(period.to) || period.to < period.from || events.length > 10000 || policy.version !== 1 || !Number.isSafeInteger(policy.revision) || policy.revision < 0 || !['chronological', 'confirmed-outcomes-first'].includes(policy.mode)) throw new Error('Invalid read-model period/policy');
  const seen = new Set<string>();
  const insights = events.filter(event => event.at >= period.from && event.at < period.to).map(event => {
    const key = `${event.sourceId}/${event.id}`;
    if (!event.id || !event.sourceId || !Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0 || !valid(event.at) || !event.author?.id || !['human', 'agent', 'system'].includes(event.author.kind) || !['error', 'idea', 'feedback'].includes(event.kind) || !['confirmed', 'proposed', 'unknown'].includes(event.confirmation) || !['human', 'reviewed-evidence', 'self-report', 'unknown'].includes(event.confirmationBasis) || !['open', 'resolved', 'dismissed'].includes(event.state) || !['helpful', 'unhelpful', 'unknown'].includes(event.outcome) || typeof event.text !== 'string' || event.text.length > 2000 || seen.has(key)) throw new Error('Invalid canonical insight');
    seen.add(key);
    // Only trusted canonical human/review evidence can confirm an assertion; a model's self-report cannot.
    const verified = event.confirmation === 'confirmed' && ['human', 'reviewed-evidence'].includes(event.confirmationBasis);
    const validAuthor = (author: CanonicalInsight['author']) => author && ['human', 'agent', 'system'].includes(author.kind) && typeof author.id === 'string' && author.id.length > 0 && author.id.length <= 200;
    if ((event.revisionLineage?.length ?? 0) > 20 || (event.reporter && !validAuthor(event.reporter.author)) || (event.revisionLineage ?? []).some(revision => !Number.isSafeInteger(revision.revision) || revision.revision < 0 || !validAuthor(revision.author))) throw new Error('Invalid insight revision lineage/reporter');
    const safeText = maskSecrets(event.text);
    return { ...event, text: safeText.text, redacted: safeText.masked > 0, author: { ...event.author }, origin: provenance(event.origin), reporter: event.reporter ? { author: { ...event.reporter.author }, provenance: provenance(event.reporter.provenance) } : null, responsibleEpisode: event.responsibleEpisode ? provenance(event.responsibleEpisode) : null, revisionLineage: (event.revisionLineage ?? []).map(revision => ({ ...revision, author: { ...revision.author }, provenance: provenance(revision.provenance) })), confirmation: verified ? 'confirmed' as const : event.confirmation === 'unknown' ? 'unknown' as const : 'proposed' as const, outcome: verified ? event.outcome : 'unknown' as const };
  });
  const outcomeOrder = (insight: typeof insights[number]) => insight.confirmation === 'confirmed' && insight.outcome === 'helpful' ? 0 : insight.confirmation === 'confirmed' && insight.outcome === 'unhelpful' ? 2 : 1;
  insights.sort((a, b) => (policy.mode === 'confirmed-outcomes-first' ? outcomeOrder(a) - outcomeOrder(b) : 0) || b.at - a.at || a.sourceId.localeCompare(b.sourceId, 'en') || a.id.localeCompare(b.id, 'en'));
  const errorGroups = new Map<string, { engine: string | null; modelObserved: string | null; samples: number; confirmed: number; proposedOrUnknown: number }>();
  for (const insight of insights.filter(insight => insight.kind === 'error')) {
    const engine = insight.responsibleEpisode?.engine ?? null, modelObserved = insight.responsibleEpisode?.modelObserved ?? null;
    const key = JSON.stringify([engine, modelObserved]);
    const group = errorGroups.get(key) ?? { engine, modelObserved, samples: 0, confirmed: 0, proposedOrUnknown: 0 };
    group.samples++; if (insight.confirmation === 'confirmed') group.confirmed++; else group.proposedOrUnknown++;
    errorGroups.set(key, group);
  }
  return { ...aggregateAgentUsage(sessions, quotas), period: { ...period }, periodScope: 'canonical-insights-only' as const, insightPolicy: { ...policy }, insightSamples: insights.length, insights: insights.slice(0, 50), omittedInsights: Math.max(0, insights.length - 50), insightModelCoverage: { samples: insights.length, originModelKnown: insights.filter(insight => insight.origin.modelObserved !== null).length, originModelMissing: insights.filter(insight => insight.origin.modelObserved === null).length }, errorsByResponsibleModel: [...errorGroups].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, group]) => group), insightNote: 'Canonical observations or explicit entries only. Metric totals retain their session evidence timestamps, not inferred period spend. Proposed errors and ambiguous feedback are not confirmed facts. Selection policy changes no source event, rule, permission or model budget.' };
}
