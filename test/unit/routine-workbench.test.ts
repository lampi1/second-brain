// Readiness, retrospective evaluation and no-progress checks preserve unknowns and never execute routines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowDefinition, FlowRun, FlowSnapshot, FlowVersion } from '../../src/shared/flows';
import type { RoutineEvalSuite } from '../../src/shared/routine-workbench';
import { digest } from '../../src/main/flows/schema';
import { evaluateSuite, readiness, RoutineWorkbench, versionComparison } from '../../src/main/flows/workbench';
import { progressFingerprint, repeatedFailure } from '../../src/main/flows/progress';
const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
const definition: FlowDefinition = { id: 'sample', title: 'Sample', description: 'Sample check', aliases: [], scope: {}, package: { schema: 1, assets: [], outputs: [], requiredOps: [] }, steps: [{ id: 'check', title: 'Check', kind: 'check', action: { kind: 'builtin', ref: 'inputs-present' }, instructions: 'Check inputs', inputs: [], evidence: ['metadata'], effect: 'read-only', maxAttempts: 4, timeoutMs: 1000 }] };
const version: FlowVersion = { definition, version: 1, digest: digest(definition), activatedAt: 1, draftRevision: 1 };
const run: FlowRun = { id: 'run', revision: 1, flowId: 'sample', flowVersion: 1, definitionDigest: version.digest, subjectKey: 'case-one', ownerOrchestratorId: 'app', scope: {}, inputs: {}, status: 'completed', createdAt: 1, updatedAt: 5, currentStep: 1, steps: [{ stepId: 'check', status: 'completed', attempts: 1, receipt: { id: 'receipt', at: 5, stepId: 'check', kind: 'check', summary: 'Checked', evidence: ['metadata: present'] } }] };
const snapshot = (runs = [run]): FlowSnapshot => ({ contextKey: 'brain', active: { sample: 1 }, drafts: [], versions: [version], runs });
const suite: RoutineEvalSuite = { id: 'suite-v1', flowId: 'sample', digest: 'a'.repeat(64), createdAt: 1, cases: [{ id: 'one', subjectKey: 'case-one', expected: 'completed', evidence: [{ stepId: 'check', label: 'metadata' }], split: 'holdout' }] };
describe('readiness', () => {
  it('checks package integrity and refuses a changed digest', () => {
    expect(readiness(snapshot(), version, {}, [], () => false).ready).toBe(true);
    const result = readiness(snapshot(), { ...version, digest: 'wrong' }, {}, [], () => true);
    expect(result.ready).toBe(false); expect(result.checks[0]!.state).toBe('fail');
  });
  it('keeps unavailable models, DB credentials and missing inputs visible', () => {
    const v = structuredClone(version); v.definition.steps = [{ ...definition.steps[0]!, kind: 'agent', action: undefined, role: 'scout', tier: 'light', engine: 'test', model: 'unavailable', workspaceInput: 'workspace', inputs: ['workspace'], testDbRead: true, agentPrompt: 'Inspect safely.' }]; v.digest = digest(v.definition);
    const result = readiness(snapshot(), v, {}, [], () => false);
    expect(result.ready).toBe(false); expect(result.checks.find(c => c.id === 'workspace')!.state).toBe('fail');
    expect(result.checks.find(c => c.id === 'test-db-connection')!.state).toBe('unknown');
    expect(result.checks.find(c => c.id === 'model')!.state).toBe('unknown');
  });
  it('reports intentional user gates rather than claiming unattended execution', () => {
    const v = structuredClone(version); v.definition.steps = [{ ...definition.steps[0]!, kind: 'approval', action: undefined, evidence: [] }]; v.digest = digest(v.definition);
    expect(readiness(snapshot(), v, {}, [], () => true).checks.find(c => c.id === 'user-gate')!.state).toBe('user');
  });
});
describe('recorded version evaluation', () => {
  it('missing or in-flight cases stay unknown; wrong digests never count', () => {
    expect(evaluateSuite(suite, version, []).cases[0]!.state).toBe('unknown');
    expect(evaluateSuite(suite, version, [{ ...run, status: 'active' }]).cases[0]!.state).toBe('unknown');
    expect(evaluateSuite(suite, version, [{ ...run, definitionDigest: 'other' }]).cases[0]!.state).toBe('unknown');
  });
  it('requires exact observed outcome and nonempty labelled evidence', () => {
    expect(evaluateSuite(suite, version, [run]).cases[0]!.state).toBe('pass');
    const missing = structuredClone(run); missing.steps[0]!.receipt!.evidence = ['metadata: '];
    expect(evaluateSuite(suite, version, [missing]).cases[0]!.state).toBe('fail');
    expect(evaluateSuite(suite, version, [{ ...run, disposition: { kind: 'skipped', reason: 'not applicable', at: 5, cleanup: 'complete', phase: 0 } }]).cases[0]!.state).toBe('fail');
  });
  it('separates skipped outcomes and empty durations from successful runs', () => {
    const empty = versionComparison(snapshot([]), 'sample').versions[0]!; expect(empty.terminalElapsedMs).toBeNull(); expect(empty.completed).toBe(0);
    const stats = versionComparison(snapshot([run, { ...run, id: 'skip', disposition: { kind: 'skipped', reason: 'not applicable', at: 5, cleanup: 'complete', phase: 0 } }]), 'sample').versions[0]!;
    expect(stats.completed).toBe(1); expect(stats.skipped).toBe(1); expect(stats.completeEvidence).toBe(1);
  });
  it('stores immutable suites, prevents split leakage and filters private owner runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routine-eval-')); dirs.push(dir);
    const workbench = new RoutineWorkbench(dir, () => snapshot([{ ...run, ownerOrchestratorId: 'other' }]), () => []);
    const { digest: _digest, createdAt: _at, ...input } = suite;
    workbench.perform({ op: 'suite-save', suite: input });
    expect(() => workbench.perform({ op: 'suite-save', suite: input })).toThrow('new suite version');
    expect(() => workbench.perform({ op: 'suite-save', suite: { ...input, id: 'suite-v2', cases: input.cases.map(c => ({ ...c, split: 'tuning' })) } })).toThrow('holdout');
    expect(workbench.perform({ op: 'evaluate', suiteId: suite.id, version: 1 }, 'mine').evaluation!.cases[0]!.state).toBe('unknown');
    expect(workbench.perform({ op: 'evaluate', suiteId: suite.id, version: 1 }).evaluation!.cases[0]!.state).toBe('pass');
  });
});
describe('bounded repeated-failure detection', () => {
  const blocked = (): FlowRun => ({ ...structuredClone(run), status: 'blocked', currentStep: 0, steps: [{ stepId: 'check', status: 'blocked', attempts: 3, reason: 'same error', decisionPending: true }] });
  const retries = (r: FlowRun) => { const progress = progressFingerprint(r); r.heal = [1, 2].map(n => ({ at: n, stepId: 'check', action: 'retry', attempt: n + 1, reason: 'same error', progress })); return r; };
  it('stops only after repeated identical failures with observed unchanged evidence', () => {
    const r = retries(blocked()); expect(repeatedFailure(r)).toBe(true); r.steps[0]!.attempts = 2; expect(repeatedFailure(r)).toBe(false);
    expect(repeatedFailure(blocked())).toBe(false);
  });
  it('new evidence, an external operation or a user retry resets the comparison', () => {
    const r = retries(blocked()); expect(repeatedFailure(r, ['new host push receipt'])).toBe(false);
    r.outputs = [{ id: 'lesson', at: 4, content: 'new observation', sha256: 'new-hash' }]; expect(repeatedFailure(r)).toBe(false);
    const resumed = retries(blocked()); resumed.heal![1]!.action = 'resume'; expect(repeatedFailure(resumed)).toBe(false);
  });
  it('does not count new ids or timestamps on identical content as progress', () => {
    const a = structuredClone(run), b = structuredClone(run); b.steps[0]!.receipt!.id = 'other'; b.steps[0]!.receipt!.at = 999;
    expect(progressFingerprint(a)).toBe(progressFingerprint(b));
  });
});
