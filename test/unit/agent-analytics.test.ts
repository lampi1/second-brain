// Conservative offline agent metrics fixtures: identity, null semantics, timing cohorts, child dedup and ledger reuse.
import { it, expect } from 'vitest';
import { aggregateAgentUsage, buildAgentReadModel, cursorLedgerObservations } from '../../src/main/agents/analytics';
import type { AgentSessionObservation, CanonicalInsight } from '../../src/main/agents/analytics';

const session = (sessionKey: string, agentId = 'agent-a'): AgentSessionObservation => ({ sessionKey, owner: { id: agentId, revision: 1, name: 'Original name' }, observedAt: 100, source: 'synthetic-observed-events', parentSessionKey: null, childTotals: 'excluded', actualUsd: null, listPriceUsd: 2, estimatedUsd: null, tokens: { input: 100, output: 20, cacheRead: null, cacheWrite: null }, startedAt: 0, endedAt: 100, spans: [{ kind: 'execution', start: 0, end: 40 }, { kind: 'permission-wait', start: 40, end: 70 }, { kind: 'user-wait', start: 70, end: 90 }, { kind: 'queue', start: 90, end: 100 }], completed: true, taskType: 'synthetic-review', model: 'synthetic-model', effort: 'medium', provenance: { agentId, agentRevision: 1, sessionId: sessionKey, engine: 'synthetic-engine', modelObserved: 'synthetic-model', effortObserved: 'medium', effortSubmitted: 'high', source: 'synthetic-observed-events', at: 100 }, modelAttribution: 'single-model-observed' });

it('groups stable profile identity across names/revisions and replaces session snapshots without summing twice', () => {
  const a = session('one');
  const updated = { ...a, observedAt: 101, owner: { ...a.owner, name: 'Renamed', revision: 2 }, provenance: { ...a.provenance, agentRevision: 2 }, listPriceUsd: 3 };
  const second = { ...session('two'), owner: { ...a.owner, name: 'Renamed', revision: 2 }, provenance: { ...session('two').provenance, agentRevision: 2 } };
  const report = aggregateAgentUsage([a, updated, second]);
  expect(report.agents).toHaveLength(1);
  expect(report.agents[0]).toMatchObject({ agentId: 'agent-a', name: 'Renamed', sessions: 2, costs: { actualUsd: { total: null }, listPriceUsd: { total: 5 } } });
  expect(report.agents[0]!.tokens.input.total).toBe(200);
  expect(report.agents[0]!.tokens.cacheRead.total).toBeNull();
  // No catalog lookup: deleted profiles remain in historical ownership evidence.
  expect(report.agents[0]!.evidence).toHaveLength(2);
});

it('separates execution, permission/user wait, queue and elapsed with comparable cohort samples only', () => {
  const a = session('one'), b = session('two');
  const unmatched = { ...session('three'), model: null, spans: [], provenance: undefined, modelAttribution: 'unknown' as const };
  const report = aggregateAgentUsage([a, b, unmatched]);
  expect(report.agents[0]!.timing.execution).toMatchObject({ total: null, knownSubtotal: 80, unknownSessions: 1, medianMs: 40 });
  expect(report.agents[0]!.timing['permission-wait'].medianMs).toBe(30);
  expect(report.agents[0]!.timing['user-wait'].medianMs).toBe(20);
  expect(report.agents[0]!.timing.queue.medianMs).toBe(10);
  expect(report.agents[0]!.elapsed.medianMs).toBe(100);
  expect(report.cohorts).toEqual([expect.objectContaining({ samples: 2, medianExecutionMs: 40, model: 'synthetic-model', effortObserved: 'medium', ownerRevision: 1 })]);
});

it.each(['included', 'unknown'] as const)('withholds child money/tokens when parent coverage is %s, without merging quota into dollars', childTotals => {
  const parent = { ...session('parent'), childTotals, actualUsd: 10 };
  const child = { ...session('child', 'agent-b'), parentSessionKey: 'parent', actualUsd: 4 };
  const quota = { id: 'quota-observation', scope: 'account' as const, window: 'five-hour', fraction: 0.4, at: 100, source: 'synthetic-provider-quota' };
  const report = aggregateAgentUsage([parent, child], [quota]);
  expect(report.agents[0]!.costs.actualUsd.total).toBe(10);
  expect(report.agents[1]!.costs.actualUsd.total).toBeNull();
  expect(report.agents[1]!.tokens.input.total).toBeNull();
  expect(report.agents[1]!.evidence[0]!.withheldByAncestor).toBe('parent');
  expect(report.quotaObservations).toEqual([quota]);
});

it('preserves actual zero, rejects overlapping timing and contradictory ownership, and leaves missing evidence null', () => {
  expect(aggregateAgentUsage([{ ...session('one'), actualUsd: 0 }]).agents[0]!.costs.actualUsd.total).toBe(0);
  expect(() => aggregateAgentUsage([session('one'), { ...session('one'), owner: { id: 'other', name: 'Other', revision: 1 } }])).toThrow('ownership');
  expect(() => aggregateAgentUsage([{ ...session('one'), spans: [{ kind: 'execution', start: 0, end: 80 }, { kind: 'user-wait', start: 50, end: 100 }] }])).toThrow('overlapping');
  const unknown = aggregateAgentUsage([{ ...session('unknown'), spans: [{ kind: 'unknown', start: 0, end: 100 }] }]);
  expect(unknown.agents[0]!.timing.execution.total).toBeNull();
  expect(unknown.cohorts).toEqual([]);
  const partial = aggregateAgentUsage([{ ...session('partial'), spans: [{ kind: 'execution', start: 0, end: 40 }, { kind: 'unknown', start: 40, end: 100 }] }]);
  expect(partial.agents[0]!.timing.execution).toMatchObject({ total: null, medianMs: null, observedPartialMs: 40 });
});

it('keeps missing provenance unknown and never attributes mixed-session totals to a current/default model', () => {
  const legacy = { ...session('legacy'), provenance: undefined, modelAttribution: undefined, model: 'current-default-must-not-backfill' };
  const mixed = { ...session('mixed'), modelAttribution: 'mixed' as const };
  const report = aggregateAgentUsage([legacy, mixed]);
  expect(report.modelCoverage).toEqual({ sessions: 2, modelKnown: 0, modelMissingOrMixed: 2, observedModelKnown: 1 });
  expect(report.byModel.every(group => group.modelObserved === null)).toBe(true);
  expect(report.cohorts).toEqual([]);
  expect(report.agents[0]!.evidence[0]!.provenance.modelObserved).toBeNull();
  const revisions = aggregateAgentUsage([session('one'), { ...session('two'), owner: { id: 'agent-a', name: 'New revision', revision: 2 }, provenance: { ...session('two').provenance, agentRevision: 2 } }]);
  expect(revisions.cohorts.map(cohort => cohort.ownerRevision)).toEqual([1, 2]);
});

it('does not attribute inclusive parent charges to the parent model when descendants may use another model', () => {
  const parent = { ...session('parent'), childTotals: 'included' as const, actualUsd: 10 };
  const child = { ...session('child', 'agent-b'), parentSessionKey: 'parent', actualUsd: 4, provenance: { ...session('child', 'agent-b').provenance, modelObserved: 'different-child-model' } };
  const report = aggregateAgentUsage([parent, child]);
  expect(report.byModel.find(group => group.modelObserved === 'synthetic-model')).toBeUndefined();
  expect(report.byModel.find(group => group.modelObserved === null)!.actualUsd.total).toBe(10);
  expect(report.byModel.find(group => group.modelObserved === 'different-child-model')!.actualUsd.total).toBeNull();
  expect(report.agents[0]!.evidence[0]!.provenance.modelObserved).toBe('synthetic-model');
});

it('keeps the responsible episode separate from reviewer model and preserves origin through revision lineage', () => {
  const event: CanonicalInsight = { id: 'reviewed-error', agentId: 'agent-a', kind: 'error', text: 'Synthetic confirmed error', sourceId: 'synthetic-review', sourceRevision: 2, at: 100, author: { kind: 'agent', id: 'origin-agent' }, confirmation: 'confirmed', confirmationBasis: 'reviewed-evidence', state: 'open', outcome: 'unknown', origin: { modelObserved: 'origin-model', engine: 'origin-engine', turnId: 'origin-turn' }, reporter: { author: { kind: 'agent', id: 'reviewer' }, provenance: { modelObserved: 'reviewer-model', engine: 'reviewer-engine', itemId: 'review-item' } }, responsibleEpisode: { modelObserved: 'responsible-model', engine: 'responsible-engine', agentRevision: 1 }, revisionLineage: [{ revision: 2, author: { kind: 'agent', id: 'reviewer' }, provenance: { modelObserved: 'reviewer-model' } }] };
  const report = buildAgentReadModel([], [], [event], { from: 0, to: 200 }, { version: 1, revision: 0, mode: 'chronological' });
  expect(report.insights[0]).toMatchObject({ author: { id: 'origin-agent' }, origin: { modelObserved: 'origin-model' }, reporter: { provenance: { modelObserved: 'reviewer-model' } }, responsibleEpisode: { modelObserved: 'responsible-model' }, revisionLineage: [{ author: { id: 'reviewer' } }] });
  expect(report.errorsByResponsibleModel).toEqual([{ engine: 'responsible-engine', modelObserved: 'responsible-model', samples: 1, confirmed: 1, proposedOrUnknown: 0 }]);
});

it('adapts existing deduplicated ledger rows without fabricating rates, actual charges or unowned attribution', () => {
  const base = session('conversation');
  const { observations, unattributedRows } = cursorLedgerObservations([
    { at: 10, source: 'hook', conversationId: 'conversation', generationId: 'turn-one', model: 'unknown-unpriced-model', input: 123, output: 45, cacheRead: 0, cacheWrite: 0 },
    { at: 20, source: 'hook', conversationId: 'unowned', generationId: 'turn-two', model: null, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  ], [base]);
  expect(observations[0]).toMatchObject({ actualUsd: null, listPriceUsd: null, estimatedUsd: null, tokens: { input: 123, output: 45, cacheRead: 0 } });
  expect(unattributedRows).toBe(1);
});

it('retains authors/provenance, downgrades self-reported errors and reversibly selects confirmed outcomes', () => {
  const event: CanonicalInsight = { id: 'self-report', agentId: 'agent-a', kind: 'error', text: 'Synthetic self-reported error', sourceId: 'synthetic-ledger', sourceRevision: 1, at: 200, author: { kind: 'agent', id: 'agent-a' }, confirmation: 'confirmed', confirmationBasis: 'self-report', state: 'open', outcome: 'helpful' };
  const confirmed = { ...event, id: 'human-idea', kind: 'idea' as const, at: 100, author: { kind: 'human' as const, id: 'synthetic-user' }, confirmationBasis: 'human' as const };
  const chronological = buildAgentReadModel([], [], [event, confirmed], { from: 0, to: 300 }, { version: 1, revision: 0, mode: 'chronological' });
  expect(chronological.insights[0]).toMatchObject({ id: 'self-report', confirmation: 'proposed', outcome: 'unknown' });
  const adjusted = buildAgentReadModel([], [], [event, confirmed], { from: 0, to: 300 }, { version: 1, revision: 1, mode: 'confirmed-outcomes-first' });
  expect(adjusted.insights[0]).toMatchObject({ id: 'human-idea', sourceRevision: 1, author: { kind: 'human' } });
  expect(buildAgentReadModel([], [], [event, confirmed], { from: 0, to: 300 }, chronological.insightPolicy).insights).toEqual(chronological.insights);
  expect(event.confirmation).toBe('confirmed'); // source record is never rewritten by selection
  expect(adjusted.insightSamples).toBe(2);
});
