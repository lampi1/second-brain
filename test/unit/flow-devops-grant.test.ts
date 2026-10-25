// DevOps write grant (ADR 0145): the step adapter field, the per-flow grant in the automatic configuration (deny-all by
// default), usable() gating external-write steps, and grantFor() tying a run to its own approved rule and event.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowDefinition, FlowRun } from '../../src/shared/flows';
import type { DevOpsWriteGrant, FlowAutomationConfig } from '../../src/shared/flow-automation';
import { FlowService } from '../../src/main/flows/service';
import { FlowAutomationService } from '../../src/main/flows/automation';
import { validateDefinition } from '../../src/main/flows/schema';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const definition = (adapter = true): FlowDefinition => ({ id: 'fix', title: 'Fix', description: 'Fixture', aliases: [], scope: { project: 'ProjectA', areaPath: 'Team' }, steps: [
  { id: 'write', title: 'Write', kind: 'agent', instructions: 'Tag the work item', inputs: ['workspace', 'work-item-id'], workspaceInput: 'workspace', evidence: [], effect: 'external-write', ...(adapter ? { adapter: 'devops-write' as const } : {}), maxAttempts: 1, timeoutMs: 60000 },
] });
const grant: DevOpsWriteGrant = { organization: 'contoso', projects: ['ProjectA'], ops: ['tags', 'comment'], fields: [] };
const config = (devopsWrite: DevOpsWriteGrant | null = grant): FlowAutomationConfig => ({ flowId: 'fix', flowVersion: 1, scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: { workspace: '/project' }, priority: 'normal',
  trigger: { kind: 'devops', everyMinutes: 1, organization: 'contoso', project: 'ProjectA', areaPath: 'Team', workItemType: 'Bug', states: ['New'], includeExisting: true }, ...(devopsWrite ? { devopsWrite } : {}) });

function setup(adapter = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-grant-')); dirs.push(dir);
  const flow = new FlowService({ file: path.join(dir, 'flows.json'), contextKey: 'brain', adapterGranted: (run: FlowRun) => auto.grantFor(run) !== null });
  flow.propose({ definition: definition(adapter), expectedRevision: 0 }); flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  const detect = vi.fn(async () => ({ cursor: { revision: '1' }, summary: 'Read only', items: [{ key: '42', title: 'Bug 42', inputs: { 'work-item-id': '42' } }] }));
  const auto: FlowAutomationService = new FlowAutomationService({ file: path.join(dir, 'automation.json'), flow: () => flow, detect, dispatch: vi.fn(async () => true) });
  const enable = (value = config()) => { const rule = auto.propose({ config: value, expectedRevision: 0 }, 'orch'); return auto.decide({ id: rule.id, expectedRevision: rule.revision, answer: 'yes' }); };
  const started = async () => { await auto.tick(); return auto.startEvent(auto.snapshot().events[0]!.id, 'orch'); };
  return { auto, flow, enable, started };
}

describe('DevOps write grant', () => {
  it('accepts the adapter only on an external-write agent step without action', () => {
    expect(validateDefinition(definition()).steps[0]!.adapter).toBe('devops-write');
    expect(validateDefinition(definition(false)).steps[0]).not.toHaveProperty('adapter');
    const bad = (patch: Record<string, unknown>) => { const def = definition(); Object.assign(def.steps[0]!, patch); return () => validateDefinition(def); };
    expect(bad({ adapter: 'shell' })).toThrow();
    expect(bad({ effect: 'read-only' })).toThrow();
    expect(bad({ kind: 'manual' })).toThrow();
  });
  it('is deny-all by default: an external-write flow needs an approved grant and a DevOps trigger', () => {
    const { auto } = setup();
    expect(() => auto.propose({ config: config(null), expectedRevision: 0 }, 'orch')).toThrow('adapter');
    const interval = { ...config(null), trigger: { kind: 'interval' as const, everyMinutes: 1 }, devopsWrite: grant };
    expect(() => auto.propose({ config: interval, expectedRevision: 0 }, 'orch')).toThrow('DevOps trigger');
    expect(() => setup(false).auto.propose({ config: config(), expectedRevision: 0 }, 'orch')).toThrow('adapter');
    expect(auto.propose({ config: config(), expectedRevision: 0 }, 'orch').config.devopsWrite).toEqual(grant);
  });
  it('validates the grant against the trigger', () => {
    const { auto } = setup();
    for (const devopsWrite of [{ ...grant, organization: 'fabrikam' }, { ...grant, projects: ['ProjectB'] }, { ...grant, projects: [] }, { ...grant, projects: ['ProjectA', 'projecta'] },
      { ...grant, projects: ['ProjectA', 'a/b'] }, { ...grant, ops: ['delete'] }, { ...grant, ops: [] }, { ...grant, fields: ['System.State'] }, { ...grant, ops: ['fields'], fields: [] },
      { ...grant, ops: ['fields'], fields: ['System.TeamProject'] }, { ...grant, ops: ['fields'], fields: ['bad field'] }, { ...grant, extra: 1 },
      { ...grant, mentions: ['not-a-guid'] }, { ...grant, ops: ['tags'], mentions: ['aaaaaaaa-0000-0000-0000-000000000001'] }, { ...grant, mentions: ['aaaaaaaa-0000-0000-0000-000000000001', 'AAAAAAAA-0000-0000-0000-000000000001'] }])
      expect(() => auto.propose({ config: config(devopsWrite as DevOpsWriteGrant), expectedRevision: 0 }, 'orch')).toThrow();
    expect(auto.propose({ config: config({ ...grant, projects: ['ProjectA', 'ProjectB'], ops: ['fields'], fields: ['System.State'] }), expectedRevision: 0 }, 'orch').status).toBe('proposed');
    expect(auto.propose({ config: config({ ...grant, mentions: ['AAAAAAAA-0000-0000-0000-000000000001'] }), expectedRevision: 1 }, 'orch').config.devopsWrite!.mentions).toEqual(['aaaaaaaa-0000-0000-0000-000000000001']);
  });
  it('grants a run started from its own approved event and lets the step run', async () => {
    const { auto, flow, enable, started } = setup(); enable();
    const run = await started();
    expect(auto.grantFor(run)).toEqual({ grant, workItemId: 42 });
    expect(run.status).not.toBe('blocked');
    const bound = flow.bindAgent(run.id, run.revision, 'write', { chatId: 'worker', chatRunId: 'worker-run', taskVersion: 1 }, 'orch');
    expect(bound.steps[0]!.status).toBe('running');
  });
  it('refuses a run without its rule event, a changed rule or a paused automation', async () => {
    const { auto, flow, enable, started } = setup(); const rule = enable();
    const run = await started();
    // auto: subjects are reserved: a manual start cannot copy one, even the approved event's own subject.
    const start = { flowId: 'fix', flowVersion: 1, scope: { project: 'ProjectA', areaPath: 'Team' } };
    expect(() => flow.start({ ...start, subjectKey: run.subjectKey, inputs: { ...run.inputs } }, 'orch')).toThrow('reserved');
    expect(() => flow.start({ ...start, subjectKey: `auto:${rule.id}:${rule.revision}:${'a'.repeat(64)}`, inputs: { workspace: '/project', 'work-item-id': '7' } }, 'orch')).toThrow('reserved');
    // A run with a copied subject that the host did not start from the event never gets the grant.
    expect(auto.grantFor({ ...run, id: 'copied-run' })).toBeNull();
    expect(auto.grantFor({ ...run, inputs: { ...run.inputs, 'work-item-id': '43' } })).toBeNull();
    expect(auto.grantFor({ ...run, ownerOrchestratorId: 'other' })).toBeNull();
    auto.control({ expectedRevision: auto.snapshot().revision, paused: true, background: false });
    expect(auto.grantFor(run)).toBeNull();
    auto.control({ expectedRevision: auto.snapshot().revision, paused: false, background: false });
    expect(auto.grantFor(run)).not.toBeNull();
    auto.propose({ config: config(), expectedRevision: rule.revision }, 'orch');
    expect(auto.grantFor(run)).toBeNull();
  });
  it('retains original approval for the dossier and permits only host settlement after cancellation', async () => {
    const { auto, flow, enable, started } = setup(); const rule = enable(), run = await started();
    expect(run.approval?.config).toEqual(config());
    const cancelled = flow.cancel({ runId: run.id, expectedRevision: run.revision }, 'orch'); auto.reconcileRuns();
    expect(auto.grantFor(cancelled)).toBeNull(); expect(auto.settlementGrantFor(cancelled)).toEqual({ grant, workItemId: 42 });
    expect(auto.settlementGrantFor({ ...cancelled, id: 'spoofed' })).toBeNull();
    auto.propose({ config: config({ ...grant, ops: ['comment'] }), expectedRevision: rule.revision }, 'orch');
    expect(auto.settlementGrantFor(cancelled)).toBeNull(); expect(auto.approvedConfigFor(cancelled)).toEqual(config());
  });

});
