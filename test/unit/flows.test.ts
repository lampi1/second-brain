// Governed flow regression tests: revisions, authority, trusted evidence, durable restart and fail-closed storage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FlowDefinition, FlowRun, FlowStep, FlowVerifiedReport } from '../../src/shared/flows';
import { FlowService } from '../../src/main/flows/service';
import { validateDefinition } from '../../src/main/flows/schema';
import { flowTools } from '../../src/main/flows/tools';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const step = (id: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, title: id, kind: 'agent', instructions: 'Follow the explicitly configured task.', inputs: !extra.kind || extra.kind === 'agent' ? ['workspace'] : [], ...(!extra.kind || extra.kind === 'agent' ? { workspaceInput: 'workspace' } : {}), evidence: ['result'], timeoutMs: 10_000, maxAttempts: 2, effect: 'read-only', ...extra });
const definition = (steps: FlowStep[] = [step('work')], extra: Partial<FlowDefinition> = {}): FlowDefinition => ({ id: 'sample', title: 'Sample', description: 'User-defined test fixture.', aliases: ['sample task'], scope: { project: 'Project', areaPath: 'Team' }, steps, ...extra });
function setup(resolveReport?: (binding: { chatId: string; chatRunId: string; taskVersion: number }, reportId: string) => FlowVerifiedReport | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-flows-')); dirs.push(dir); const file = path.join(dir, 'state.json'); let now = 1000;
  const options = { file, contextKey: 'brain-1', now: () => now, resolveReport };
  const service = new FlowService(options);
  return { service, file, options, advance: (ms: number) => { now += ms; } };
}
function activate(service: FlowService, def = definition(), expectedRevision = 0) {
  const draft = service.propose({ definition: def, expectedRevision }); service.decideDefinition({ id: def.id, expectedRevision: draft.revision, answer: 'yes' });
}
function start(service: FlowService, subjectKey = 'subject'): FlowRun { return service.start({ flowId: 'sample', flowVersion: service.snapshot().active.sample!, subjectKey, scope: { project: 'Project', areaPath: 'Team/Area' }, inputs: { workspace: '/workspace/project' } }, 'orch'); }
function bound(service: FlowService, run: FlowRun, chatId = 'worker'): FlowRun { return service.bindAgent(run.id, run.revision, run.steps[run.currentStep]!.stepId, { chatId, chatRunId: `${chatId}-run`, taskVersion: 1 }, 'orch'); }
function report(binding: { chatId: string; chatRunId: string; taskVersion: number }, id: string): FlowVerifiedReport { return { ...binding, id, completed: true, summary: 'Reported result', evidence: ['result: recorded output'] }; }
function finish(service: FlowService, run: FlowRun): FlowRun { return service.report({ runId: run.id, expectedRevision: run.revision, stepId: run.steps[run.currentStep]!.stepId, reportId: 'recorded-report' }, 'orch'); }
describe('flow definitions and matching', () => {
  it('starts empty and requires exact user activation of every immutable version', () => {
    const { service } = setup(); expect(service.snapshot().drafts).toEqual([]);
    const draft = service.propose({ definition: definition(), expectedRevision: 0 });
    expect(() => start(service)).toThrow();
    service.propose({ definition: definition([step('updated')]), expectedRevision: draft.revision });
    expect(() => service.decideDefinition({ id: 'sample', expectedRevision: draft.revision, answer: 'yes' })).toThrow('stale');
    service.decideDefinition({ id: 'sample', expectedRevision: 2, answer: 'yes' }); expect(start(service).steps[0]!.stepId).toBe('updated');
  });
  it('persists no/other definition feedback without activating', () => {
    const { service, options } = setup(); service.propose({ definition: definition(), expectedRevision: 0 });
    service.decideDefinition({ id: 'sample', expectedRevision: 1, answer: 'other', feedback: 'Use another scope' });
    const snapshot = new FlowService(options).snapshot(); expect(snapshot.active).toEqual({}); expect(snapshot.drafts[0]).toMatchObject({ status: 'rejected', feedback: 'Use another scope' });
  });
  it('matches token boundaries, scoped descendants and ambiguity deterministically', () => {
    const { service } = setup(); activate(service); activate(service, definition([step('other')], { id: 'second', aliases: ['sample task'] }));
    expect(service.match('a sample task', { project: 'Project', areaPath: 'Team/Child' }).status).toBe('ambiguous');
    expect(service.match('samples', { project: 'Project', areaPath: 'Team' }).status).toBe('none');
    expect(service.match('sample', { project: 'Pro-ject', areaPath: 'Team' }).status).toBe('none');
    expect(service.match('sample', { project: 'Other', areaPath: 'Team' }).status).toBe('none');
    expect(service.match('sample', { project: 'Project', areaPath: 'Teamwork' }).status).toBe('none');
    expect(service.match('sample').status).toBe('match');
    expect(() => service.start({ flowId: 'sample', flowVersion: 1, subjectKey: 'x', scope: {}, inputs: {} }, 'orch')).toThrow('scope');
  });
  it('rejects unknown executable fields, unsafe builtins, invalid references and limits', () => {
    expect(() => validateDefinition(definition([step('missing', { workspaceInput: undefined })]))).toThrow('workspaceInput');
    expect(() => validateDefinition(definition(undefined, { aliases: ['***'] }))).toThrow('letter');
    expect(() => validateDefinition({ ...definition(), command: 'echo unsafe' })).toThrow('unknown field');
    expect(() => validateDefinition(definition([step('a', { kind: 'check', action: { kind: 'builtin', ref: 'shell' } })]))).toThrow('builtin');
    expect(() => validateDefinition(definition([step('a', { reviewOf: 'later' }), step('later')]))).toThrow('earlier');
    expect(() => validateDefinition(definition([step('a', { maxAttempts: 100 })]))).toThrow('maxAttempts');
  });
});
describe('flow execution authority', () => {
  it('pins approved versions and deduplicates owned version/scope/subjects', () => {
    const { service } = setup(); activate(service); const run = start(service); expect(start(service).id).toBe(run.id);
    expect(() => service.start({ flowId: 'sample', flowVersion: 1, subjectKey: 'subject', scope: run.scope, inputs: { workspace: '/workspace/project' } }, 'another')).toThrow('another Orchestrator');
    activate(service, definition([step('changed')]), 1); expect(service.status(run.id, 'orch').flowVersion).toBe(1); expect(service.status(run.id, 'orch').steps[0]!.stepId).toBe('work');
    expect(start(service).flowVersion).toBe(2);
    const snapshot = service.snapshot(); snapshot.versions[0]!.definition.steps[0]!.title = 'tampered'; expect(service.snapshot().versions[0]!.definition.steps[0]!.title).toBe('work');
  });
  it('will not accept unbound or fabricated report evidence and guards concurrent revisions', () => {
    const { service } = setup(() => null); activate(service); const initial = start(service);
    expect(() => finish(service, initial)).toThrow('bound'); const run = bound(service, initial);
    expect(() => bound(service, initial)).toThrow('changed'); expect(() => finish(service, run)).toThrow('host-linked'); expect(service.status(run.id, 'orch').steps[0]!.receipt).toBeUndefined();
    expect(() => service.report({ runId: run.id, expectedRevision: run.revision, stepId: 'work', reportId: 'x' }, 'another')).toThrow('another Orchestrator');
  });
  it('never reuses an agent run/task across subjects, completed steps or restart retries', () => {
    const { service, options } = setup(report); activate(service); const first = bound(service, start(service, 'first'));
    const second = start(service, 'second'); expect(() => bound(service, second)).toThrow('already bound');
    finish(service, first); expect(() => bound(service, second)).toThrow('already bound');
    const running = service.bindAgent(second.id, second.revision, 'work', { chatId: 'worker2', chatRunId: 'second-run', taskVersion: 1 }, 'orch');
    const restarted = new FlowService(options), blocked = restarted.status(running.id, 'orch');
    const retry = restarted.decide({ runId: blocked.id, expectedRevision: blocked.revision, stepId: 'work', answer: 'yes' });
    expect(() => restarted.bindAgent(retry.id, retry.revision, 'work', { chatId: 'worker2', chatRunId: 'second-run', taskVersion: 1 }, 'orch')).toThrow('already bound');
    expect(restarted.bindAgent(retry.id, retry.revision, 'work', { chatId: 'worker2', chatRunId: 'second-run', taskVersion: 2 }, 'orch').steps[0]!.status).toBe('running');
  });
  it('accepts only linked completed reports with every configured evidence label', () => {
    let evidence = ['something else']; const { service } = setup((binding, id) => ({ ...report(binding, id), evidence })); activate(service); const run = bound(service, start(service));
    expect(() => finish(service, run)).toThrow('missing required'); evidence = ['result: actual report evidence']; const done = finish(service, run);
    expect(done.status).toBe('completed'); expect(done.steps[0]!.receipt).toMatchObject({ kind: 'agent-report', reportId: 'recorded-report', chatId: 'worker' });
  });
  it('enforces independent Sentinel review of the exact implementation run', () => {
    let reviewOf = 'wrong-run'; const { service } = setup((binding, id) => ({ ...report(binding, id), roleId: 'sentinel', reviewOf }));
    activate(service, definition([step('work'), step('review', { reviewOf: 'work' })])); let run = finish(service, bound(service, start(service)));
    expect(() => service.bindAgent(run.id, run.revision, 'review', { chatId: 'worker', chatRunId: 'another-run', taskVersion: 1 }, 'orch')).toThrow('different chat'); run = bound(service, run, 'reviewer'); expect(() => finish(service, run)).toThrow('review');
    reviewOf = 'worker-run'; expect(finish(service, run).status).toBe('completed');
  });
  it('requires user gate decisions and manual evidence, preserving no/other feedback', () => {
    const { service } = setup(); activate(service, definition([step('gate', { kind: 'approval', evidence: [] }), step('manual', { kind: 'manual', evidence: [] })])); let run = start(service);
    expect(run.status).toBe('approval'); expect(() => finish(service, run)).toThrow('bound');
    run = service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'gate', answer: 'other', feedback: 'Inspect this first' }); expect(run.status).toBe('blocked'); expect(run.steps[0]!.reason).toBe('Inspect this first'); expect(run.steps[0]!.decisionPending).toBe(false);
    run = service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'gate', answer: 'yes' }); expect(run.status).toBe('approval');
    run = service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'gate', answer: 'yes' });
    expect(() => service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'manual', answer: 'yes' })).toThrow('evidence note');
    expect(service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'manual', answer: 'yes', feedback: 'User checked result' }).status).toBe('completed');
  });
  it.each(['external-write', 'production'] as const)('never executes or approves away unsupported %s', effect => {
    const { service } = setup(); activate(service, definition([step('danger', { effect, kind: 'manual' })])); const run = start(service);
    expect(run.status).toBe('blocked'); expect(() => service.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'danger', answer: 'yes', feedback: 'go' })).toThrow('adapter');
    expect(service.status(run.id, 'orch').steps[0]!.receipt).toBeUndefined();
  });
  it('keeps unconfigured action references blocked', () => {
    const { service } = setup(); activate(service, definition([step('ref', { kind: 'check', action: { kind: 'action', ref: 'saved-reference' } })])); expect(start(service).status).toBe('blocked');
  });
  // ADR 0153: a script/query step pins the brain file's content hash on propose; a file the brain lacks cannot be proposed
  it.each(['script', 'query'] as const)('refuses a %s reference the brain does not have', kind => {
    const { service } = setup(); expect(() => service.propose({ definition: definition([step('ref', { kind: 'check', action: { kind, ref: 'saved-reference' } })]), expectedRevision: 0 })).toThrow('non trovat');
  });
  it('runs allowlisted host metadata checks without claiming real tests', () => {
    const { service } = setup(); activate(service, definition([step('metadata', { kind: 'check', action: { kind: 'builtin', ref: 'scope-present' }, evidence: ['metadata'] })])); const run = start(service);
    expect(run.status).toBe('completed'); expect(run.steps[0]!.receipt?.evidence[0]).toContain('no test suite');
  });
  it('reconciles hung workers on snapshot and status without a report or duplicate notification', () => {
    const { service, options, advance } = setup(report); activate(service); const run = bound(service, start(service)); advance(11_000);
    const expired = service.snapshot().runs[0]!; expect(expired.status).toBe('blocked'); expect(expired.revision).toBe(run.revision + 1); expect(expired.steps[0]!.decisionPending).toBe(true);
    expect(service.status(run.id, 'orch').revision).toBe(expired.revision); expect(new FlowService(options).status(run.id, 'orch').status).toBe('blocked');
  });
  it('blocks timed-out reports and bounds user retries', () => {
    const { service, advance } = setup(report); activate(service, definition([step('work', { maxAttempts: 1 })])); const run = bound(service, start(service)); advance(11_000);
    const blocked = finish(service, run); expect(blocked.status).toBe('blocked'); expect(() => service.decide({ runId: blocked.id, expectedRevision: blocked.revision, stepId: 'work', answer: 'yes' })).toThrow('Retry limit');
  });
});
describe('flow persistence and tool boundary', () => {
  it('restart blocks interrupted work without rerunning or retaining valid old revision', () => {
    const { service, options } = setup(report); activate(service); const run = bound(service, start(service)); const restarted = new FlowService(options); const recovered = restarted.status(run.id, 'orch');
    expect(recovered.status).toBe('blocked'); expect(recovered.revision).toBe(run.revision + 1); expect(recovered.steps[0]!.attempts).toBe(1);
    expect(() => finish(restarted, run)).toThrow('changed'); const ready = restarted.decide({ runId: recovered.id, expectedRevision: recovered.revision, stepId: 'work', answer: 'yes' }); expect(ready.steps[0]!.status).toBe('ready');
  });
  it.each(['json', 'version', 'receipt', 'status', 'ready-kind'])('preserves corrupt %s storage and disables mutations', mode => {
    const { service, file, options } = setup(report); activate(service); finish(service, bound(service, start(service))); const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (mode === 'version') data.versions[0]!.definition.title = 'tampered';
    if (mode === 'receipt') delete data.runs[0].steps[0]!.receipt;
    if (mode === 'status') data.runs[0].status = 'active';
    if (mode === 'ready-kind') { data.runs[0].status = 'active'; data.runs[0].currentStep = 0; data.runs[0].steps[0].status = 'ready'; }
    const corrupted = mode === 'json' ? '{' : JSON.stringify(data); fs.writeFileSync(file, corrupted); const restarted = new FlowService(options);
    expect(restarted.snapshot().storageError).toBeTruthy(); expect(() => restarted.propose({ definition: definition(), expectedRevision: 0 })).toThrow('storage'); expect(fs.readFileSync(file, 'utf8')).toBe(corrupted);
  });
  it('has no approval tool and rejects stale brain context or fabricated chat bindings', async () => {
    const { service } = setup(); const tools = flowTools({ service: () => service, ownerId: 'orch', resolveBinding: () => null });
    expect(tools.map(t => t.name).join(' ')).not.toMatch(/approve|activate|decide/);
    expect(() => tools.find(t => t.name === 'app_flow_propose')!.run({ contextKey: 'other-brain', definition: definition(), expectedRevision: 0 })).toThrow('context changed');
    activate(service); const run = start(service);
    expect(() => tools.find(t => t.name === 'app_flow_bind')!.run({ contextKey: 'brain-1', runId: run.id, expectedRevision: run.revision, stepId: 'work', chatId: 'arbitrary' })).toThrow('eligible');
    expect(flowTools({ service: () => service, ownerId: '', resolveBinding: () => null })).toEqual([]);
  });
  it('passes the pinned step workspace to the host binding resolver', () => {
    const { service } = setup(); activate(service); const run = start(service); let observed = '';
    const tool = flowTools({ service: () => service, ownerId: 'orch', resolveBinding: (chatId, ownerId, workspace) => { observed = `${ownerId}:${workspace}`; return { chatId, chatRunId: 'fresh', taskVersion: 1 }; } }).find(t => t.name === 'app_flow_bind')!;
    tool.run({ contextKey: 'brain-1', runId: run.id, expectedRevision: run.revision, stepId: 'work', chatId: 'worker' });
    expect(observed).toBe('orch:/workspace/project');
  });
  it('does not confuse independent brains or permit failed saves to advance memory', () => {
    const { service, file } = setup(); const other = setup().service; activate(service); expect(other.snapshot().versions).toEqual([]);
    fs.rmSync(file); fs.mkdirSync(file); expect(() => start(service)).toThrow(); expect(service.snapshot().runs).toEqual([]);
  });
});
