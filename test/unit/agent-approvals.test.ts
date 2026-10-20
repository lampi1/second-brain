// The "Da approvare" inbox (ADR 0083): it gathers an open trial (with the loop's advice and its numbers) and the tier
// suggestions, maps each click to its one channel, reports a failing source without hiding the others, and renders the
// cards as text without deciding anything on render.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCatalog, AgentProfile, VersionMetrics } from '../../src/shared/agents';
import type { AgentLifecycleProposal, AgentLifecycleSnapshot } from '../../src/shared/agent-lifecycle';
import { decideApproval, gatherApprovals, type ApprovalsClient } from '../../src/renderer/lib/agent-approvals';
import { AgentApprovalsView } from '../../src/renderer/components/AgentApprovalCards';

const role = (id: string, extra: Partial<AgentProfile> = {}): AgentProfile => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), purpose: 'Scopo', instructions: 'i', engine: 'claude', model: null, avatar: { kind: 'character', value: 'artisan' },
  tools: { allow: ['read'] }, permissionCeiling: 'default', tier: 'mid', tierMax: 'top', launches: [], skills: [], scope: 'role',
  version: 2, activeVersion: 2, createdAt: 1, updatedAt: 100, lastEditedBy: 'default', userLocked: false, ...extra,
} as AgentProfile);
const metric = (value: number | null, n = 3) => ({ value, n, coverage: n ? 0.75 : null });
const vm = (agentId: string, version: number, success: number): VersionMetrics => ({
  agentId, version, ended: 4, successRate: metric(success), opinion: { value: null, n: 0 }, selfReport: { value: null, n: 0 },
  correctionsPerRun: metric(1), aiErrorsPerRun: metric(0), reworkRate: metric(0), costPerRun: { median: metric(0.42), p90: null },
  tokensPerRun: {} as VersionMetrics['tokensPerRun'], contextPeak: { median: metric(null, 0), max: null, ofWindow: null },
  timeToDone: { elapsed: metric(180_000), execution: metric(null, 0) }, questionsPerRun: metric(2), permissionsPerRun: metric(0), commandsPerRun: metric(0), reviews: [],
});
const tier: AgentLifecycleProposal = { key: 'tier:artisan:top:["air-test"]', kind: 'tier', agentIds: ['artisan'], tier: 'top', skills: ['air-test'], reason: 'Su air-test il livello alto riesce nel 85% contro 45%.', evidence: [], at: 300, state: 'pending' };

function fixture(over: { lifecycle?: Partial<AgentLifecycleSnapshot>; failLifecycle?: boolean; failMetrics?: boolean } = {}) {
  const profiles = [role('artisan'), role('sentinel', { trial: { version: 3, baseline: 2, startedAt: 50 }, activeVersion: 3, version: 3 }), role('pulse', { scope: 'background', trial: { version: 2, baseline: 1, startedAt: 1 } })];
  const catalog = { profiles, models: [], problem: null } as AgentCatalog;
  const calls: [string, unknown][] = [];
  const answers: Record<string, unknown> = {
    'agents:list': catalog, 'agents:metrics': [{ agentId: 'sentinel', versions: [vm('sentinel', 2, 0.5), vm('sentinel', 3, 0.8)], all: null, open: 0 }],
    'agents:trialDecide': role('sentinel'), 'agents:lifecycleDecide': { proposals: [], evaluations: [], feedback: [], problem: null },
  };
  const client: ApprovalsClient = {
    invoke: vi.fn(async (channel: string, payload: unknown) => {
      calls.push([channel, payload]);
      if (channel === 'agents:metrics' && over.failMetrics) throw new Error('down');
      return answers[channel];
    }) as unknown as ApprovalsClient['invoke'],
    lifecycle: { read: async () => { if (over.failLifecycle) throw new Error('down'); return { proposals: [tier], evaluations: [], feedback: [], problem: null, ...over.lifecycle }; } },
  };
  return { client, calls };
}

describe('gatherApprovals', () => {
  it('lists the open trial first with its numbers, then the tier suggestion; never a background job', async () => {
    const s = await gatherApprovals(fixture().client);
    expect(s.items.map(i => i.type)).toEqual(['trial', 'lifecycle']);
    const trial = s.items[0]!;
    expect(trial.type === 'trial' && [trial.agent.id, trial.before?.version, trial.after?.version]).toEqual(['sentinel', 2, 3]);
    expect(s.items[1]).toMatchObject({ key: `life:${tier.key}`, agents: [{ id: 'artisan' }] });
    expect(s.problems).toEqual([]);
  });
  it('the trial card carries the loop\'s advice and its reason', async () => {
    const advice: AgentLifecycleProposal = { key: 'trial:sentinel:3', kind: 'keep', agentIds: ['sentinel'], reason: 'Miglioramento misurato', evidence: [], at: 60, state: 'pending' };
    const s = await gatherApprovals(fixture({ lifecycle: { proposals: [advice] } }).client);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ type: 'trial', advice: { kind: 'keep' }, reason: 'Miglioramento misurato' });
  });
  it('a failing source is reported and the others still show', async () => {
    const s = await gatherApprovals(fixture({ failLifecycle: true, failMetrics: true }).client);
    expect(s.problems).toEqual(['lifecycle', 'metrics']);
    expect(s.items.map(i => i.type)).toEqual(['trial']);
  });
});

describe('decideApproval', () => {
  it('maps each click to its one channel', async () => {
    const f = fixture(), s = await gatherApprovals(f.client);
    await decideApproval(f.client, s.items[0]!, { type: 'trial', decision: 'rollback' });
    await decideApproval(f.client, s.items[1]!, { type: 'queue', decision: 'approve' });
    expect(f.calls.filter(([c]) => c.endsWith('Decide'))).toEqual([['agents:trialDecide', { id: 'sentinel', decision: 'rollback' }], ['agents:lifecycleDecide', { key: tier.key, decision: 'approve' }]]);
    await expect(decideApproval(f.client, s.items[0]!, { type: 'queue', decision: 'dismiss' })).rejects.toThrow(/No queue entry/);
    await expect(decideApproval(f.client, s.items[1]!, { type: 'trial', decision: 'keep' })).rejects.toThrow(/does not match/);
  });
});

describe('cards', () => {
  it('render what changes, why and the numbers, with no decision taken on render', async () => {
    const f = fixture(), state = await gatherApprovals(f.client);
    const onDecide = vi.fn();
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { state, error: false, busy: null, done: null, failure: null, onDecide, onDismiss: () => {}, onRefresh: () => {} }));
    expect(html).toContain('Da approvare');
    expect(html).toContain('Versione in prova');
    expect(html).toContain('Livello di modello');
    expect(html).toContain('air-test');
    expect(html).toContain(tier.reason);
    expect(html).toContain('Avvia la prova');
    expect(html).toContain('Torna a v2');
    expect(onDecide).not.toHaveBeenCalled();
    expect(f.calls.some(([c]) => c.endsWith('Decide'))).toBe(false);
  });
  it('render nothing when there is nothing to decide', () => {
    const html = renderToStaticMarkup(createElement(AgentApprovalsView, { state: { items: [], problems: ['metrics'], lifecycleProblem: null }, error: false, busy: null, done: null, failure: null, onDecide: () => {}, onDismiss: () => {}, onRefresh: () => {} }));
    expect(html).toBe('');
  });
});
