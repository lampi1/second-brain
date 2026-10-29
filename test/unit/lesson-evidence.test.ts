// Evidence gates exercise live host outcomes, reload/tampering and fail-closed approval without a model or engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentPackLearning, agentLearnTool } from '../../src/main/agents/pack/learning';
import type { AgentPackFlows } from '../../src/main/agents/pack/flows';
import type { AgentRun } from '../../src/shared/agents';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-evidence-')); roots.push(root);
  const flows = { profile: () => ({}), root: () => root } as unknown as AgentPackFlows;
  const runs: AgentRun[] = [{ runId: 'r_example', chatId: 'c_example', agentId: 'artisan', version: 1, goal: 'Validate the output',
    startedBy: 'user', startedAt: 1, endedAt: 2, scope: { brainRoot: root, projectRoot: root },
    counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: null, tokens: null,
    outcome: { verdict: 'fail', basis: 'human', at: 3, by: 'user' } }];
  const service = new AgentPackLearning(flows, root); service.evidenceRuns = () => runs;
  return { root, flows, runs, service, propose: () => service.propose('artisan', 'Check the output before delivery.', 'run:r_example') };
}
describe('host evidence before lesson approval', () => {
  it('retains negative verified evidence without claiming effect or granting approval', () => {
    const w = world(), p = w.propose();
    expect(p.assessment).toMatchObject({ state: 'supported', causal: false, sources: [{ runId: 'r_example', verdict: 'fail', basis: 'human' }] });
    expect(w.service.pending()).toEqual([]);
    w.service.review(p.id, true);
    expect(w.service.pending()).toMatchObject([{ id: p.id, userApproved: true }]);
    const reloaded = new AgentPackLearning(w.flows, w.root); reloaded.evidenceRuns = () => w.runs;
    expect(reloaded.pending()).toHaveLength(1);
    w.runs[0]!.outcome!.verdict = 'success';
    expect(reloaded.pending()).toEqual([]);
    expect(reloaded.waiting()[0]!.assessment!.state).toBe('insufficient');
    expect(() => reloaded.settle(p.id, 'approved', 'applied')).toThrow(/evidence-backed/);
  });
  it.each(['missing', 'running', 'self-report', 'wrong-role', 'wrong-brain', 'unknown-scope'] as const)('refuses %s evidence even when the prose claims success', kind => {
    const w = world(), run = w.runs[0]!;
    if (kind === 'missing') w.runs.length = 0;
    if (kind === 'running') delete run.endedAt;
    if (kind === 'self-report') run.outcome!.basis = 'self-report';
    if (kind === 'wrong-role') run.agentId = 'scout';
    if (kind === 'wrong-brain') run.scope!.brainRoot += '-other';
    if (kind === 'unknown-scope') delete run.scope;
    const p = w.propose();
    expect(p.assessment!.state).toBe('insufficient');
    expect(() => w.service.review(p.id, true)).toThrow(/evidence/);
    expect(w.service.review(p.id, false).status).toBe('discarded');
  });
  it('binds user approval to the exact proposed rule and handles legacy proposals visibly', () => {
    const w = world(), p = w.propose(); w.service.review(p.id, true);
    const file = path.join(w.root, 'agent-learn-proposals.json'), store = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.proposals[0].rule = 'A different rule'; fs.writeFileSync(file, JSON.stringify(store));
    const reloaded = new AgentPackLearning(w.flows, w.root); reloaded.evidenceRuns = () => w.runs;
    expect(reloaded.pending()).toEqual([]); expect(reloaded.waiting()).toHaveLength(1);
    delete store.proposals[0].assessment; fs.writeFileSync(file, JSON.stringify(store));
    const legacy = new AgentPackLearning(w.flows, w.root); legacy.evidenceRuns = () => w.runs;
    expect(legacy.pending()).toEqual([]); expect(legacy.waiting()).toHaveLength(1);
    expect(() => legacy.review(p.id, true)).toThrow(/evidence/);
  });
  it('hands the Apprendimento page only each lesson\'s date and status (ADR 0186)', () => {
    const w = world(), p = w.propose();
    expect(w.service.stubs()).toEqual([{ createdAt: p.createdAt, status: 'pending' }]);
  });
  it('does not accept a model-supplied evidence assessment', () => {
    const w = world(), tool = agentLearnTool(w.service);
    expect(() => tool.run({ agentId: 'artisan', rule: 'Check output.', evidence: 'run:r_example', assessment: { state: 'supported' } }, {} as never)).toThrow(/Invalid lesson/);
    const p = w.propose(); w.runs[0]!.outcome!.basis = 'self-report';
    expect(() => w.service.review(p.id, true)).toThrow(/evidence/);
  });
});
