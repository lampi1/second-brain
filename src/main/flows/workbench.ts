// Host-observed readiness and retrospective evaluation, without executing tasks or manufacturing quality scores.
import fs from 'node:fs';
import type { FlowSnapshot, FlowVersion, FlowRun } from '../../shared/flows';
import type { RoutineCheck, RoutineComparison, RoutineEvalResult, RoutineEvalSuite, RoutineReadiness, RoutineWorkbenchRequest, RoutineWorkbenchResult } from '../../shared/routine-workbench';
import { checkParams, digest, identifier, integer, keys, object, text, validateInputs } from './schema';
import { hash } from '../components/bundle';
import { atomicWrite, read } from '../rules/storage';
import type { TestDeployTarget } from '../../shared/flow-automation';
import { deploymentHash } from './test-deployment';
const terminal = (r: FlowRun) => ['completed', 'cancelled'].includes(r.status);
export function readiness(snapshot: FlowSnapshot, version: FlowVersion, values: Record<string, string>, targets: readonly TestDeployTarget[], directory: (p: string) => boolean, now = Date.now()): RoutineReadiness {
  const definition = version.definition, checks: RoutineCheck[] = [];
  const add = (id: string, state: RoutineCheck['state'], detail: string, stepId?: string) => checks.push({ id, state, detail, ...(stepId ? { stepId } : {}) });
  try { add('integrity', digest(definition) === version.digest ? 'pass' : 'fail', 'Stored definition and package digest'); } catch { add('integrity', 'fail', 'Stored definition no longer passes validation'); }
  add('sealed', definition.package ? 'pass' : 'unknown', definition.package ? 'Runtime content is embedded in this version' : 'Legacy routine may depend on ambient brain files');
  const rules = snapshot.automation?.rules.filter(r => r.config.flowId === definition.id && r.config.flowVersion === version.version && r.approvedRevision === r.revision && r.status === 'enabled') ?? [];
  const rule = rules.length === 1 ? rules[0] : undefined;
  const inputs = { ...(rule?.config.inputs ?? {}), ...values }, params = checkParams(definition.params, inputs);
  Object.assign(inputs, params.values);
  for (const p of params.problems) add('parameter', 'fail', p);
  for (const op of definition.package?.requiredOps ?? []) add(`grant:${op}`, rule?.config.devopsWrite?.ops.includes(op as never) ? 'pass' : 'fail', `Current approved operation: ${op}`);
  for (const step of definition.steps) {
    const addStep = (id: string, state: RoutineCheck['state'], detail: string) => add(id, state, detail, step.id);
    const missing = step.inputs.filter(k => !inputs[k]?.trim()); addStep('inputs', missing.length ? 'fail' : 'pass', missing.length ? `Missing inputs: ${missing.join(', ')}` : 'Declared input values supplied');
    if (step.workspaceInput) { const workspace = inputs[step.workspaceInput]; addStep('workspace', workspace && directory(workspace) ? 'pass' : 'fail', 'Configured workspace must be an existing directory'); }
    if (step.kind === 'agent') {
      const engine = snapshot.engines?.find(e => e.id === step.engine), role = step.role && snapshot.roles?.[step.role];
      addStep('model', !snapshot.engines ? 'unknown' : engine?.models.includes(step.model ?? '') ? 'pass' : 'fail', 'Exact engine/model availability');
      addStep('role', role ? 'pass' : 'unknown', 'Role and permission ceiling are resolved by the launch host');
    }
    if (step.testDbRead || step.adapter === 'test-db-read') { addStep('test-db-grant', rule?.config.testDbRead?.targetIds.length ? 'pass' : 'fail', 'Current approved read-only test DB targets'); addStep('test-db-connection', 'unknown', 'Dedicated credentials and live DB access are checked at query time; no query is run by Doctor'); }
    if (step.adapter === 'devops-write') addStep('devops-grant', rule?.config.devopsWrite ? 'pass' : 'fail', 'Approved DevOps write configuration for this version');
    if (step.testEnvironment) {
      const local = targets.find(t => t.id === step.testEnvironment), approved = rule?.config.devopsWrite?.deployTargets?.find(t => t.id === step.testEnvironment);
      addStep('test-target', local && approved && deploymentHash(local) === deploymentHash(approved) && rule!.config.devopsWrite!.ops.includes('test-environment') ? 'pass' : 'fail', 'Exact test target and environment operation registered and included in the approved grant');
    }
    if (step.effect === 'production' || step.env === 'prod' || ['approval', 'manual'].includes(step.kind)) addStep('user-gate', 'user', 'The run intentionally stops for the existing user decision');
    if (step.action && step.action.kind !== 'builtin') addStep('interpreter', 'unknown', 'Interpreter, executable content and hash must also pass the existing dry-run and effect-time checks');
    if (step.reviewOf) addStep('independent-review', 'pass', 'Independent Sentinel report requirement is declared and enforced at completion');
  }
  if (rules.length > 1) add('rule-selection', 'unknown', 'Multiple approved configurations: inspect the intended trigger before starting');
  return { flowId: definition.id, version: version.version, digest: version.digest, at: now, checks, ready: !checks.some(c => ['fail', 'unknown'].includes(c.state)), coverage: ['Read-only snapshot, not execution authorization or a guarantee.', 'Remote drift, credentials, CLI availability and actual results remain effect-time checks.'] };
}
export function versionComparison(snapshot: FlowSnapshot, flowId: string): RoutineComparison {
  const versions = snapshot.versions.filter(v => v.definition.id === flowId).map(v => {
    const runs = snapshot.runs.filter(r => r.flowId === flowId && r.flowVersion === v.version && r.definitionDigest === v.digest), ended = runs.filter(terminal);
    return { version: v.version, digest: v.digest, runs: runs.length, completed: runs.filter(r => r.status === 'completed' && !r.disposition).length, blocked: runs.filter(r => r.status === 'blocked').length,
      cancelled: runs.filter(r => r.status === 'cancelled' && !r.disposition).length, skipped: runs.filter(r => r.disposition?.kind === 'skipped').length, needsHuman: runs.filter(r => r.disposition?.kind === 'needs-human').length,
      retries: runs.reduce((n, r) => n + r.steps.reduce((sum, s) => sum + Math.max(0, s.attempts - 1), 0), 0), observedDecisions: runs.reduce((n, r) => n + (r.trace?.filter(e => e.kind === 'decision').length ?? 0), 0),
      terminalElapsedMs: ended.length ? ended.reduce((n, r) => n + Math.max(0, r.updatedAt - r.createdAt), 0) / ended.length : null,
      completeEvidence: runs.filter(r => r.status === 'completed' && !r.disposition && v.definition.steps.every(s => { const receipt = r.steps.find(x => x.stepId === s.id)?.receipt; return !!receipt && s.evidence.every(label => receipt.evidence.some(e => e.startsWith(`${label}: `) && e.length > label.length + 2)); })).length };
  });
  const subjects = new Map<string, Set<number>>();
  for (const r of snapshot.runs.filter(r => r.flowId === flowId)) { const key = hash(JSON.stringify([r.subjectKey, r.scope, Object.entries(r.inputs).sort()])), set = subjects.get(key) ?? new Set<number>(); set.add(r.flowVersion); subjects.set(key, set); }
  return { flowId, versions, comparableSubjects: [...subjects.values()].filter(s => s.size > 1).length, caveats: ['Descriptive observations, not causal evidence that one version is better.', 'Completed means host completion, not an independent measure of product correctness.', 'Elapsed time includes waits; cost and model latency are not inferred.', 'Comparable subjects require identical recorded inputs and scope; environment/code drift is still uncontrolled.'] };
}
export function evaluateSuite(suite: RoutineEvalSuite, version: FlowVersion, runs: readonly FlowRun[], now = Date.now()): RoutineEvalResult {
  return { suiteId: suite.id, suiteDigest: suite.digest, flowVersion: version.version, definitionDigest: version.digest, at: now, cases: suite.cases.map(c => {
    const candidates = runs.filter(r => r.flowId === suite.flowId && r.flowVersion === version.version && r.definitionDigest === version.digest && r.subjectKey === c.subjectKey).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const run = candidates[0]; if (!run) return { id: c.id, split: c.split, state: 'unknown' as const, reasons: ['No matching host run for this exact version'] };
    if (!terminal(run) && run.status !== 'blocked') return { id: c.id, split: c.split, state: 'unknown' as const, runId: run.id, reasons: ['Run has not reached an assessable outcome'] };
    const observed = run.disposition?.kind ?? run.status, reasons: string[] = [];
    if (observed !== c.expected) reasons.push(`Expected ${c.expected}; observed ${observed}`);
    for (const required of c.evidence) if (!run.steps.find(s => s.stepId === required.stepId)?.receipt?.evidence.some(e => e.startsWith(`${required.label}: `) && e.length > required.label.length + 2)) reasons.push(`Missing evidence: ${required.stepId}/${required.label}`);
    return { id: c.id, split: c.split, state: reasons.length ? 'fail' as const : 'pass' as const, runId: run.id, reasons };
  }), coverage: ['Retrospective deterministic checks of host receipts, not a new paid execution.', 'Latest run per subject is shown; all runs remain available in history.', 'Evidence labels establish presence, not truth of every agent claim; inspect linked reports and tests.'] };
}
export class RoutineWorkbench {
  constructor(private readonly directory: string, private readonly snapshot: () => FlowSnapshot, private readonly targets: () => readonly TestDeployTarget[]) { fs.mkdirSync(directory, { recursive: true }); }
  private suites(): RoutineEvalSuite[] { const raw = read(this.directory, 'evaluations.json'); if (!raw) return []; const value: unknown = JSON.parse(raw); if (!Array.isArray(value) || value.length > 40) throw new Error('Invalid routine evaluations'); return value.map(s => this.suite(s, true)); }
  private suite(value: unknown, saved = false): RoutineEvalSuite {
    const raw = object(value, 'suite'); keys(raw, ['id', 'flowId', 'cases', ...(saved ? ['digest', 'createdAt'] : [])], 'suite');
    if (!Array.isArray(raw.cases) || !raw.cases.length || raw.cases.length > 100) throw new Error('A suite requires 1–100 cases');
    const cases = raw.cases.map(value => { const c = object(value, 'case'); keys(c, ['id', 'subjectKey', 'expected', 'evidence', 'split'], 'case');
      if (!['completed', 'needs-human', 'skipped', 'blocked'].includes(c.expected as string) || !['tuning', 'holdout'].includes(c.split as string) || !Array.isArray(c.evidence) || c.evidence.length > 60) throw new Error('Invalid evaluation case');
      return { id: identifier(c.id, 'case id'), subjectKey: text(c.subjectKey, 'subjectKey', 500), expected: c.expected as RoutineEvalSuite['cases'][number]['expected'], split: c.split as 'tuning' | 'holdout', evidence: c.evidence.map(value => { const e = object(value, 'evidence'); keys(e, ['stepId', 'label'], 'evidence'); return { stepId: identifier(e.stepId, 'stepId'), label: text(e.label, 'label', 200) }; }) }; });
    if (new Set(cases.map(c => c.id)).size !== cases.length || new Set(cases.map(c => c.subjectKey)).size !== cases.length) throw new Error('Duplicate evaluation case/subject');
    const base = { id: identifier(raw.id, 'suite id'), flowId: identifier(raw.flowId, 'flowId'), cases }, calculated = hash(JSON.stringify(base));
    if (saved && calculated !== raw.digest) throw new Error('Evaluation suite digest mismatch');
    return { ...base, digest: calculated, createdAt: saved ? integer(raw.createdAt, 'createdAt') : Date.now() };
  }
  perform(request: RoutineWorkbenchRequest, ownerId?: string): RoutineWorkbenchResult {
    const snap = this.snapshot(); if (ownerId) snap.runs = snap.runs.filter(r => r.ownerOrchestratorId === ownerId || r.ownerOrchestratorId === 'app');
    const fields: Record<RoutineWorkbenchRequest['op'], string[]> = { readiness: ['flowId', 'version', 'inputs'], compare: ['flowId'], suites: ['flowId'], 'suite-save': ['suite'], evaluate: ['suiteId', 'version'] };
    const raw = object(request, 'workbench request'); if (!(request.op in fields)) throw new Error('Unknown workbench operation'); keys(raw, ['op', ...fields[request.op]], 'workbench request');
    if (request.op === 'compare') return { comparison: versionComparison(snap, identifier(request.flowId, 'flowId')) };
    if (request.op === 'suites') return { suites: this.suites().filter(s => s.flowId === request.flowId) };
    if (request.op === 'suite-save') {
      const next = this.suite(request.suite), suites = this.suites();
      if (suites.length >= 40 || suites.some(s => s.id === next.id)) throw new Error('Use a new suite version id; existing cases are immutable');
      for (const old of suites.filter(s => s.flowId === next.flowId)) for (const c of next.cases) if (old.cases.some(p => p.subjectKey === c.subjectKey && p.split !== c.split)) throw new Error('A subject cannot cross tuning/holdout splits');
      const content = JSON.stringify([...suites, next]); if (Buffer.byteLength(content) > 2_000_000) throw new Error('Evaluation archive is full');
      atomicWrite(this.directory, 'evaluations.json', content); return { suites: [...suites, next] };
    }
    const suite = request.op === 'evaluate' ? this.suites().find(s => s.id === request.suiteId) : undefined;
    if (request.op === 'evaluate' && !suite) throw new Error('Unknown evaluation suite');
    const flowId = request.op === 'readiness' ? request.flowId : suite!.flowId, version = snap.versions.find(v => v.definition.id === flowId && v.version === integer(request.version, 'version', 1));
    if (!version) throw new Error('Unknown routine version');
    return request.op === 'evaluate' ? { evaluation: evaluateSuite(suite!, version, snap.runs) } : { readiness: readiness(snap, version, validateInputs(request.inputs ?? {}), this.targets(), p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) };
  }
}
