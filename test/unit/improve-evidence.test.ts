// Explicit selection and predictable byte budgeting for the existing Improve coordinator; no model/tool calls.
import { it, expect } from 'vitest';
import { buildImproveEvidence } from '../../src/main/improve/evidence';
import { aggregateAgentUsage, buildAgentReadModel } from '../../src/main/agents/analytics';
import { loadUserContext } from '../../src/main/brain/user-context';
import canonical from '../fixtures/extensions/context-selection.json';
import { ImproveService, appRegiaPrompt } from '../../src/main/improve/service';

it('includes only selected confirmed facts with source/version/scope and leaves empty selections empty', () => {
  const context = loadUserContext({ ...canonical, revision: 3, scope: 'user' }, [], () => null);
  const analytics = aggregateAgentUsage([]);
  expect(buildImproveEvidence(context, analytics, { factRefs: [], agentIds: [], budgetBytes: 4096 }).text).toBe('');
  const report = buildImproveEvidence(context, analytics, { factRefs: ['essential/z-constraint'], agentIds: [], budgetBytes: 4096 });
  expect(JSON.parse(report.text).facts).toEqual([expect.objectContaining({ key: 'approval', sourceRevision: 3, sourceScope: 'user', confirmation: 'confirmed' })]);
  expect(report.text).not.toContain('Italiano');
  expect(report.publication).toBe('existing-human-reviewed-flow-only');
});

it('passes only selected canonical insights with original model and reviewer lineage, never auto-confirms them', () => {
  const context = loadUserContext(null, [], () => null);
  const analytics = buildAgentReadModel([], [], [{ id: 'idea', agentId: 'agent-a', kind: 'idea', text: 'Synthetic idea', sourceId: 'synthetic-ledger', sourceRevision: 1, at: 10, author: { kind: 'agent', id: 'agent-a' }, confirmation: 'proposed', confirmationBasis: 'self-report', state: 'open', outcome: 'unknown', origin: { modelObserved: 'synthetic-model', effortSubmitted: 'high', effortObserved: null } }], { from: 0, to: 20 }, { version: 1, revision: 0, mode: 'chronological' });
  const packet = buildImproveEvidence(context, analytics, { factRefs: [], agentIds: [], insightRefs: ['synthetic-ledger/idea'], budgetBytes: 4096 });
  expect(JSON.parse(packet.text).insights[0]).toMatchObject({ confirmation: 'proposed', origin: { modelObserved: 'synthetic-model', effortObserved: null, effortSubmitted: 'high' } });
  expect(buildImproveEvidence(context, analytics, { factRefs: [], agentIds: [], budgetBytes: 4096 }).text).toBe('');
});

it('rejects unavailable selection and reports whole-object budget omissions without inventing friction', () => {
  const context = loadUserContext({ ...canonical, revision: 1 }, [], () => null);
  const analytics = aggregateAgentUsage([]);
  expect(() => buildImproveEvidence(context, analytics, { factRefs: ['essential/pending-role'], agentIds: [], budgetBytes: 4096 })).toThrow('unavailable');
  expect(() => buildImproveEvidence(context, analytics, { factRefs: [], agentIds: ['missing'], budgetBytes: 4096 })).toThrow('unavailable');
  const report = buildImproveEvidence(context, analytics, { factRefs: ['essential/z-constraint'], agentIds: [], budgetBytes: 256 });
  expect(report.bytes).toBeLessThanOrEqual(256);
  expect(report.omitted).toEqual(['selected-fact']);
  expect(report.text).toBe('');
  expect(report.pending).toContain('essential/pending-role');
});

it('connects the Regia adapter to selected evidence and explains observation and publication limits', () => {
  // evidence is read-only and requires none of the lifecycle constructor dependencies.
  const service = Object.create(ImproveService.prototype) as ImproveService;
  const context = loadUserContext({ ...canonical, revision: 3 }, [], () => null);
  const packet = service.evidence(context, aggregateAgentUsage([]), { factRefs: ['essential/z-constraint'], agentIds: [], budgetBytes: 4096 });
  expect(packet.text).toContain('z-constraint'); expect(packet.text).not.toContain('Italiano');
  expect(packet.guidance).toContain('Untrusted'); expect(packet.guidance).toContain('explicit PR confirmation');
  expect(appRegiaPrompt('/synthetic-product')).toContain('app_improve_evidence');
  expect(service.evidence(context, aggregateAgentUsage([]), { factRefs: [], agentIds: [], budgetBytes: 4096 }).text).toBe('');
});
