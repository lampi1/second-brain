// Explicit selection and predictable byte budgeting for the existing Improve coordinator; no model/tool calls.
import { it, expect } from 'vitest';
import { buildImproveEvidence } from '../../src/main/improve/evidence';
import { aggregateAgentUsage, buildAgentReadModel } from '../../src/main/agents/analytics';
import { ImproveService, appRegiaPrompt } from '../../src/main/improve/service';

it('leaves empty selections empty', () => {
  const report = buildImproveEvidence(aggregateAgentUsage([]), { agentIds: [], budgetBytes: 4096 });
  expect(report.text).toBe('');
  expect(report.publication).toBe('existing-human-reviewed-flow-only');
});

it('passes only selected canonical insights with original model and reviewer lineage, never auto-confirms them', () => {
  const analytics = buildAgentReadModel([], [], [{ id: 'idea', agentId: 'agent-a', kind: 'idea', text: 'Synthetic idea', sourceId: 'synthetic-ledger', sourceRevision: 1, at: 10, author: { kind: 'agent', id: 'agent-a' }, confirmation: 'proposed', confirmationBasis: 'self-report', state: 'open', outcome: 'unknown', origin: { modelObserved: 'synthetic-model', effortSubmitted: 'high', effortObserved: null } }], { from: 0, to: 20 }, { version: 1, revision: 0, mode: 'chronological' });
  const packet = buildImproveEvidence(analytics, { agentIds: [], insightRefs: ['synthetic-ledger/idea'], budgetBytes: 4096 });
  expect(JSON.parse(packet.text).insights[0]).toMatchObject({ confirmation: 'proposed', origin: { modelObserved: 'synthetic-model', effortObserved: null, effortSubmitted: 'high' } });
  expect(buildImproveEvidence(analytics, { agentIds: [], budgetBytes: 4096 }).text).toBe('');
});

it('rejects unavailable selection and reports whole-object budget omissions without inventing friction', () => {
  const analytics = buildAgentReadModel([], [], [{ id: 'idea', agentId: 'agent-a', kind: 'idea', text: 'Synthetic idea', sourceId: 'synthetic-ledger', sourceRevision: 1, at: 10, author: { kind: 'agent', id: 'agent-a' }, confirmation: 'proposed', confirmationBasis: 'self-report', state: 'open', outcome: 'unknown', origin: { modelObserved: 'synthetic-model', effortSubmitted: 'high', effortObserved: null } }], { from: 0, to: 20 }, { version: 1, revision: 0, mode: 'chronological' });
  expect(() => buildImproveEvidence(analytics, { agentIds: ['missing'], budgetBytes: 4096 })).toThrow('unavailable');
  const report = buildImproveEvidence(analytics, { agentIds: [], insightRefs: ['synthetic-ledger/idea'], budgetBytes: 256 });
  expect(report.bytes).toBeLessThanOrEqual(256);
  expect(report.omitted).toEqual(['insight/synthetic-ledger/idea']);
  expect(report.text).toBe('');
});

it('connects the Regia adapter to selected evidence and explains observation and publication limits', () => {
  // evidence is read-only and requires none of the lifecycle constructor dependencies.
  const service = Object.create(ImproveService.prototype) as ImproveService;
  const packet = service.evidence(aggregateAgentUsage([]), { agentIds: [], budgetBytes: 4096 });
  expect(packet.text).toBe('');
  expect(packet.guidance).toContain('Untrusted'); expect(packet.guidance).toContain('explicit PR confirmation');
  expect(appRegiaPrompt('/synthetic-product')).toContain('app_improve_evidence');
});
