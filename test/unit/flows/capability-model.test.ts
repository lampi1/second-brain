// Capability-based activation, trigger-independent grants and crash-safe connector receipts, without external effects.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowService } from '../../../src/main/flows/service';
import { FlowAutomationService } from '../../../src/main/flows/automation';
import type { FlowDefinition, FlowStep } from '../../../src/shared/flows';
import type { FlowAutomationConfig } from '../../../src/shared/flow-automation';
import { healable } from '../../../src/shared/routine';
import { executionChecks } from '../../../src/shared/flow-execution';
import { validateDefinition } from '../../../src/main/flows/schema';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(p => fs.rmSync(p, { recursive: true, force: true })));
const connector = (): FlowStep => ({ id: 'write', title: 'Publish a test note', kind: 'check', effect: 'external-write', instructions: 'Call the approved test connector', inputs: [], evidence: ['connector'], timeoutMs: 1000, maxAttempts: 3,
  connector: { serverId: 'qa', tool: 'add_note', serverHash: 'a'.repeat(64), toolHash: 'b'.repeat(64), role: 'artisan', arguments: { note: 'fixture' } } });
const definition = (steps: FlowStep[]): FlowDefinition => ({ id: 'sample', title: 'Sample', description: 'Fixture', aliases: [], scope: { project: 'Project' }, steps });
function fixture(step = connector()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-cap-')); roots.push(root); let now = 1000;
  const options = { file: path.join(root, 'state.json'), contextKey: 'brain', now: () => now, validateConnector: () => {}, adapterGranted: (r: Parameters<FlowAutomationService['grantFor']>[0]) => !!auto?.grantFor(r) };
  const flow = new FlowService(options); const def = definition([step]);
  flow.propose({ definition: def, expectedRevision: 0 }); flow.decideDefinition({ id: def.id, expectedRevision: 1, answer: 'yes' });
  const detect = vi.fn(async () => ({ cursor: {}, items: [], summary: 'none' })), dispatch = vi.fn(async () => true);
  const auto: FlowAutomationService = new FlowAutomationService({ file: path.join(root, 'auto.json'), flow: () => flow, detect, dispatch, now: () => now });
  const start = () => flow.start({ flowId: def.id, flowVersion: 1, subjectKey: 'fixture', scope: def.scope, inputs: {} }, 'owner');
  return { flow, auto, options, def, start, detect, dispatch, advance: () => { now += 2000; } };
}
it('prevents unsupported routes at activation, while retaining an inert editable draft', () => {
  const f = fixture(), draft = definition([{ ...connector(), connector: undefined, kind: 'agent', workspaceInput: 'workspace', inputs: ['workspace'] }]);
  f.flow.propose({ definition: draft, expectedRevision: 1 });
  expect(f.flow.preflight(draft).executable).toBe(false);
  expect(() => f.flow.decideDefinition({ id: draft.id, expectedRevision: 2, answer: 'yes' })).toThrow('Choose an agent');
  expect(f.flow.snapshot().active.sample).toBe(1);
});
it.each(['external-write', 'production'] as const)('manual %s gates activate, wait for the user and survive reload', effect => {
  const f = fixture({ ...connector(), connector: undefined, kind: 'manual', effect, evidence: [] }), run = f.start();
  expect(run.status).toBe('approval'); expect(new FlowService(f.options).snapshot().storageError).toBeUndefined();
  f.flow.decide({ runId: run.id, expectedRevision: run.revision, stepId: 'write', answer: 'yes', feedback: 'Verified manually by the user' });
  expect(new FlowService(f.options).snapshot().runs[0]?.status).toBe('completed');
});
it.each(['manual', 'interval'] as const)('DevOps grants work with %s scheduling and retain exact event provenance', async kind => {
  const f = fixture({ ...connector(), connector: undefined, kind: 'agent', adapter: 'devops-write', workspaceInput: 'workspace', inputs: ['workspace'], evidence: [] });
  const config: FlowAutomationConfig = { flowId: 'sample', flowVersion: 1, trigger: kind === 'manual' ? { kind } : { kind, everyMinutes: 1 }, scope: { project: 'Project' }, inputs: { workspace: '/fixture', 'work-item-id': '42' }, priority: 'normal', devopsWrite: { organization: 'example', projects: ['Project'], ops: ['comment'], fields: [] } };
  const proposed = f.auto.propose({ config, expectedRevision: 0 }, 'owner'); f.auto.decide({ id: proposed.id, expectedRevision: 1, answer: 'yes' });
  await f.auto.tick(); expect(f.detect).not.toHaveBeenCalled();
  if (kind === 'manual') expect(f.auto.snapshot().events).toEqual([]);
  const run = kind === 'manual' ? f.auto.startManual(proposed.id, { key: 'fixture', title: 'Fixture', inputs: {} }) : f.auto.startEvent(f.auto.snapshot().events[0]!.id, 'owner');
  expect(run.status).toBe('active'); expect(f.auto.grantFor(run)?.workItemId).toBe(42);
  expect(f.auto.grantFor({ ...run, id: 'forged' })).toBeNull();
  expect(() => f.auto.startManual(proposed.id, { key: 'duplicate', title: 'Duplicate', inputs: {} })).toThrow('run attiva');
  f.auto.pause({ id: proposed.id, expectedRevision: 1, paused: true }); expect(f.auto.grantFor(run)).toBeNull();
});
it('ready, running and completed connector calls round-trip and retain their host receipt', () => {
  const f = fixture(), run = f.start(); expect(new FlowService(f.options).snapshot().storageError).toBeUndefined();
  const receipt = f.flow.beginConnector(run.id, run.revision, 'write'); f.flow.connectorDispatched(run.id, receipt.id);
  const interrupted = new FlowService(f.options).snapshot(); expect(interrupted.storageError).toBeUndefined();
  expect(interrupted.runs[0]?.connectorReceipts?.[0]?.outcome).toBe('unknown'); expect(healable(interrupted.runs[0]!, f.def)).toBe(false);
  f.flow.finishConnector(run.id, receipt.id, 'done', 'Saved\u0000 note');
  const loaded = new FlowService(f.options).snapshot(); expect(loaded.storageError).toBeUndefined(); expect(loaded.runs[0]?.status).toBe('completed'); expect(loaded.runs[0]?.connectorReceipts?.[0]?.summary).toBe('Saved note');
});
it('pre-dispatch refusal stays not-done and may retry; dispatched timeout never retries or rewinds', () => {
  const f = fixture(), run = f.start(), receipt = f.flow.beginConnector(run.id, run.revision, 'write');
  let blocked = f.flow.finishConnector(run.id, receipt.id, 'not-done', 'Missing credential'); expect(healable(blocked, f.def)).toBe(true);
  const retried = f.flow.hostRetry(run.id, blocked.revision, 'write', 'Retry');
  const second = f.flow.beginConnector(run.id, retried.revision, 'write'); f.flow.connectorDispatched(run.id, second.id); f.advance();
  blocked = f.flow.status(run.id, 'owner'); expect(blocked.status).toBe('blocked');
  blocked = f.flow.finishConnector(run.id, second.id, 'unknown', 'Timed out after dispatch');
  expect(healable(blocked, f.def)).toBe(false); expect(() => f.flow.hostRetry(run.id, blocked.revision, 'write', 'retry')).toThrow('explicit user');
  expect(new FlowService(f.options).snapshot().storageError).toBeUndefined();
});
it('cancel retains pending host interruption and reload recovers its ambiguous receipt', () => {
  const f = fixture(), run = f.start(), receipt = f.flow.beginConnector(run.id, run.revision, 'write'); f.flow.connectorDispatched(run.id, receipt.id);
  const live = f.flow.status(run.id, 'owner'), cancelled = f.flow.cancel({ runId: live.id, expectedRevision: live.revision }, 'owner');
  expect(cancelled.cancellation?.interruption).toBe('pending');
  const loaded = new FlowService(f.options).snapshot(); expect(loaded.storageError).toBeUndefined(); expect(loaded.runs[0]?.connectorReceipts?.[0]?.outcome).toBe('unknown');
});
it('new connector recipes cannot claim production or certify arbitrary agent/test evidence', () => {
  expect(() => validateDefinition(definition([{ ...connector(), effect: 'production' }]))).toThrow('non-production');
  expect(() => validateDefinition(definition([{ ...connector(), evidence: ['tests passed'] }]))).toThrow('connector evidence');
  expect(executionChecks(definition([connector()]))[0]).toMatchObject({ capability: 'connector', state: 'configuration' });
});

it('preserves completed connector evidence through two partial restarts and reload', () => {
  const f = fixture(), def = definition([connector(), { ...connector(), connector: undefined, id: 'finish', kind: 'manual', effect: 'read-only', evidence: [] }]);
  f.flow.propose({ definition: def, expectedRevision: 1 }); f.flow.decideDefinition({ id: def.id, expectedRevision: 2, answer: 'yes' });
  let run = f.flow.start({ flowId: def.id, flowVersion: 2, subjectKey: 'multi-restart', scope: def.scope, inputs: {} }, 'owner');
  const receipt = f.flow.beginConnector(run.id, run.revision, 'write'); f.flow.connectorDispatched(run.id, receipt.id);
  f.flow.finishConnector(run.id, receipt.id, 'done', 'Created');
  for (let i = 0; i < 2; i++) {
    run = f.flow.status(run.id, 'owner');
    run = f.flow.restart({ runId: run.id, expectedRevision: run.revision, mode: 'from-step', stepId: 'finish', targetVersion: run.flowVersion, targetDigest: run.definitionDigest, acknowledgeEffects: true });
    expect(new FlowService(f.options).snapshot().storageError).toBeUndefined();
  }
});
it('analysis mention opt-in is validated and preserved only for DevOps agent steps', () => {
  const step = { ...connector(), connector: undefined, kind: 'agent' as const, adapter: 'devops-write' as const, inputs: ['workspace'], workspaceInput: 'workspace', mentionReason: 'analysis' as const };
  expect(validateDefinition(definition([step])).steps[0]?.mentionReason).toBe('analysis');
  expect(() => validateDefinition(definition([{ ...step, adapter: undefined }]))).toThrow('mentionReason');
  expect(() => validateDefinition(definition([{ ...step, mentionReason: 'final' as never }]))).toThrow('mentionReason');
});
