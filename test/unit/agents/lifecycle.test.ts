// Lifecycle acceptance: feedback persistence, approval-only suggestions, comparable trials and batched idle work.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import { repeatedGap } from '../../../src/main/agents/feedback';
import type { AgentFeedback } from '../../../src/shared/agent-lifecycle';
import { AgentLifecycle } from '../../../src/main/agents/lifecycle';
import { evaluateTrial, TRIAL_DAYS } from '../../../src/main/agents/trials';
import { suggestAgents, instructionOverlap, type SuggestionInput } from '../../../src/main/agents/suggestions';
import { lifecycleInput } from '../../../src/main/agents/lifecycle-input';

const dirs: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lifecycle-test-')); dirs.push(p); return p; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({ id: 'reviewer', name: 'Reviewer', role: 'Review', purpose: 'Review', category: 'development',
  instructions: 'Review changes for errors', engine: 'claude', model: 'large', avatar: { kind: 'symbol', value: 'eye' }, tools: null, permissionCeiling: null,
  origin: { kind: 'user' }, userLocked: true, status: 'active', lastEditedBy: 'user', version: 2, activeVersion: 2, createdAt: 0, updatedAt: 1000,
  trial: { version: 2, baseline: 1, startedAt: 1000 }, ...over });
const run = (id: number, over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${id.toString(16).padStart(12, '0')}`, chatId: `chat-${id}`, agentId: 'reviewer', version: 1,
  goal: 'Review', startedBy: 'user', startedAt: 100, endedAt: 200, endReason: 'completed', costUsd: 1, tokens: null,
  outcome: { verdict: 'success', basis: 'human', by: 'user', at: 200 }, counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
  corrections: { tagged: 2, afterReport: 0 }, ...over });
const baseline = () => Array.from({ length: 10 }, (_, i) => run(i));
const trial = () => Array.from({ length: 5 }, (_, i) => run(i + 20, { version: 2, startedAt: 1100, endedAt: 1200, corrections: { tagged: 1, afterReport: 0 } }));
/** A stored record as the authoring store writes it (agent/version from the run, basis from main). */
const fb = (id: number, over: Partial<AgentFeedback> = {}): AgentFeedback => ({ id: `f${id}-${Math.random()}`, at: id, agentId: 'reviewer', runId: run(id).runId, version: 1,
  outcome: { verdict: 'partial', basis: 'orchestrator-opinion', by: 'regia', at: id, note: 'Missed tests' }, worked: 'Read', failed: 'Missed tests',
  gap: 'instructions', gapKey: 'test-contract', evidence: [{ kind: 'run', ref: 'r_000000000001', at: 1 }], ...over });
const empty = (): SuggestionInput => ({ agents: [], runs: [], work: [], models: [] });

describe('feedback', () => {
  it('does not count retries, unclear goals or old versions as repeated defects', () => {
    const rows: AgentFeedback[] = [fb(1), fb(1)];
    expect(repeatedGap(rows)).toBeNull();
    rows.push(fb(2, { gapKey: '  Test-Contract ' }));
    const p = repeatedGap(rows);
    expect(p?.kind).toBe('update'); expect(p?.key).toBe('gap:reviewer:1:instructions:test-contract');
    expect(p?.evidence.map(e => e.kind)).toEqual(['feedback', 'feedback', 'feedback']);
    rows.push(fb(3, { gap: 'unclear-goal' }));
    expect(repeatedGap(rows)).toBeNull();
    rows.push(fb(4, { version: 2 }));
    expect(repeatedGap(rows)).toBeNull();
  });
  it('ignores records without a version or a gap (older records, feedback that names no gap)', () => {
    const { version: _v, ...old } = fb(1);
    expect(repeatedGap([old, { ...fb(2), version: undefined }])).toBeNull();
    const { gap: _g, gapKey: _k, ...plain } = fb(3);
    expect(repeatedGap([fb(2), plain])).toBeNull();
  });
  it('turns a stored repeated gap into one pending proposal, read from the one store', () => {
    const rows: AgentFeedback[] = [fb(1)];
    const lifecycle = new AgentLifecycle({ userData: tmp(), wake: () => false, feedback: { list: id => rows.filter(f => f.agentId === id), problem: null } });
    lifecycle.onFeedback(rows[0]!);
    expect(lifecycle.proposals()).toEqual([]);
    rows.push(fb(2)); lifecycle.onFeedback(rows[1]!); rows.push(fb(3)); lifecycle.onFeedback(rows[2]!);
    expect(lifecycle.proposals()).toHaveLength(1);
    expect(lifecycle.proposals()[0]!.state).toBe('pending');
  });
});
describe('trials', () => {
  it('keeps measured improvement, never mutates the locked definition', () => {
    const a = agent(), before = structuredClone(a);
    expect(evaluateTrial(a, [...baseline(), ...trial()], 2000, () => true).decision).toBe('keep');
    expect(a).toEqual(before);
  });
  it('waits for five runs but reverts inconclusive at 21 days', () => {
    expect(evaluateTrial(agent(), baseline(), 2000, () => true).decision).toBe('wait');
    expect(evaluateTrial(agent(), baseline(), 1000 + TRIAL_DAYS, () => true).decision).toBe('revert');
  });
  it('separates new work and unknown routing, never counts either in improvement', () => {
    const result = evaluateTrial(agent(), [...baseline(), ...trial()], 2000, r => r.runId === run(20).runId ? null : false);
    expect(result.decision).toBe('revert'); expect(result.comparable).toBe(0); expect(result.otherRuns).toBe(4); expect(result.unknownRouting).toBe(1);
  });
  it.each(['cost', 'time', 'questions', 'unknown', 'no-improvement'] as const)('reverts failing %s guard', kind => {
    const runs = trial().map(r => ({ ...r,
      ...(kind === 'cost' ? { costUsd: 1.26 } : {}), ...(kind === 'time' ? { endedAt: 1226 } : {}),
      ...(kind === 'questions' ? { counters: { ...r.counters, questions: 1 } } : {}),
      ...(kind === 'unknown' ? { outcome: { ...r.outcome!, basis: 'self-report' as const } } : {}),
      ...(kind === 'no-improvement' ? { corrections: { tagged: 2, afterReport: 0 } } : {}),
    }));
    expect(evaluateTrial(agent(), [...baseline(), ...runs], 2000, () => true).decision).toBe('revert');
  });
  it('excludes post-start baseline outcomes and v0', () => {
    const b = baseline().map(r => ({ ...r, endedAt: 2000 }));
    expect(evaluateTrial(agent(), [...b, ...trial()], 3000, () => true).before).toBeNull();
  });
});
describe('suggestions and scheduling', () => {
  it('adapts tagged Generale runs without inventing areas or missing models', () => {
    const runs = [run(1, { agentId: 'default-general', tags: { app: 'App', repo: null, skills: [] } }), run(2, { agentId: 'default-general' })];
    const data = lifecycleInput([], runs, [], () => undefined);
    expect(data.work).toHaveLength(1); expect(data.work[0]!.area).toBe('App'); expect(data.models).toHaveLength(0);
  });
  it('proposes overlap only above 70 percent', () => {
    expect(instructionOverlap('', '')).toBe(0);
    expect(suggestAgents({ ...empty(), agents: [agent(), agent({ id: 'other' })] }, 2000)[0]!.kind).toBe('merge');
  });
  it('requires three distinct recent Generale references', () => {
    const work = [1, 2, 3].map(i => ({ kind: 'review', area: 'app', source: 'general' as const, at: 1000, ref: { kind: 'run' as const, ref: String(i), at: 1000 } }));
    expect(suggestAgents({ ...empty(), work }, 2000)[0]!.kind).toBe('create');
    expect(suggestAgents({ ...empty(), work: [work[0]!, work[0]!, work[0]!] }, 2000)).toHaveLength(0);
  });
  it.each(['error', 'retired'] as const)('proposes a role after two %s references', source => {
    const work = [1, 2].map(i => ({ kind: 'review', area: 'app', source, at: 1000, ref: { kind: 'chat' as const, ref: String(i), at: 1000 } }));
    expect(suggestAgents({ ...empty(), work }, 2000)[0]!.kind).toBe('create');
  });
  it('proposes cheaper models only in the same role and cohort with confirmed samples', () => {
    const base = { agentId: 'reviewer', cohort: 'review/sql', model: 'large', success: 0.8, known: 5, ended: 5, costPerSuccess: 5, evidence: [] };
    const cheaper = { ...base, model: 'small', costPerSuccess: 1 };
    const make = (other: typeof cheaper) => suggestAgents({ ...empty(), agents: [agent()], models: [base, other] }, 2000);
    expect(make(cheaper)[0]!.kind).toBe('model-trial');
    expect(make({ ...cheaper, cohort: 'other' })).toHaveLength(0);
    expect(make({ ...cheaper, success: 0.7 })).toHaveLength(0);
    expect(make({ ...cheaper, known: 4 })).toHaveLength(0);
  });
  it('reports both split cohorts with sample sizes and coverage', () => {
    const runs = [...baseline(), ...Array.from({ length: 10 }, (_, i) => run(i + 50, { tags: { skills: ['sql'], app: null, repo: null }, outcome: { verdict: 'fail', basis: 'human', at: 200, by: 'user' } }))];
    const p = suggestAgents({ ...empty(), agents: [agent()], runs }, 2000)[0]!;
    expect(p.kind).toBe('split'); expect(p.metrics?.after?.successRate).toEqual({ value: 0, n: 10, coverage: 1 });
  });
  it('batches actual run ends durably, retries failed delivery and excludes oneshots', async () => {
    let now = 1000; const dir = tmp(), wake = vi.fn().mockResolvedValue(false);
    let service = new AgentLifecycle({ userData: dir, wake, now: () => now });
    service.onRunEnded(run(1)); service.onRunEnded(run(2)); service.onRunEnded(run(1));
    service.onRunEnded(run(3, { source: 'oneshot' }));
    await service.flushWake(); expect(wake).not.toHaveBeenCalled(); now += 30_000;
    service = new AgentLifecycle({ userData: dir, wake, now: () => now });
    await service.flushWake(); expect(wake).toHaveBeenCalledWith([run(1).runId, run(2).runId]);
    wake.mockResolvedValue(true); await service.flushWake(); await service.flushWake(); expect(wake).toHaveBeenCalledTimes(2);
  });
  it('reads daily evidence only after 18:00 while idle, once across restarts, without model calls', () => {
    let now = new Date(2026, 9, 18, 17, 59).getTime(); const dir = tmp(), read = vi.fn(empty);
    const deps = { userData: dir, wake: () => true, now: () => now };
    const service = new AgentLifecycle(deps);
    expect(service.daily(true, read)).toBe(false); now += 60_000;
    expect(service.daily(false, read)).toBe(false); expect(read).not.toHaveBeenCalled();
    expect(service.daily(true, read)).toBe(true);
    expect(new AgentLifecycle(deps).daily(true, read)).toBe(false); expect(read).toHaveBeenCalledTimes(1);
  });
});
