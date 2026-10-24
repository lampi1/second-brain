// Exact native approval, automatic event provenance and read-only step shape gate every test DB grant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowDefinition } from '../../src/shared/flows';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';
import { FlowService } from '../../src/main/flows/service';
import { FlowAutomationService } from '../../src/main/flows/automation';
import { validateDefinition } from '../../src/main/flows/schema';
import { FlowAutomationSummary } from '../../src/renderer/components/FlowAutomationSummary';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });
const definition = (): FlowDefinition => ({ id: 'inspect', title: 'Inspect', description: 'Synthetic fixture', aliases: [], scope: {}, steps: [
  { id: 'query', title: 'Query', kind: 'agent', instructions: 'Inspect test data', inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], effect: 'read-only', adapter: 'test-db-read', maxAttempts: 2, timeoutMs: 60000 },
] });
const config = (): FlowAutomationConfig => ({ flowId: 'inspect', flowVersion: 1, scope: {}, inputs: { workspace: '/fixture' }, priority: 'normal',
  trigger: { kind: 'interval', everyMinutes: 1 }, testDbRead: { targetIds: ['fixture-test'] } });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-testdb-grant-')); dirs.push(dir);
  const flow = new FlowService({ file: path.join(dir, 'flows.json'), contextKey: 'brain', adapterGranted: run => auto.testDbGrantFor(run) !== null });
  flow.propose({ definition: definition(), expectedRevision: 0 }); flow.decideDefinition({ id: 'inspect', expectedRevision: 1, answer: 'yes' });
  const auto: FlowAutomationService = new FlowAutomationService({ file: path.join(dir, 'automation.json'), flow: () => flow, detect: vi.fn(), dispatch: vi.fn(async () => true) });
  const enable = () => { const rule = auto.propose({ config: config(), expectedRevision: 0 }, 'orch'); return auto.decide({ id: rule.id, expectedRevision: rule.revision, answer: 'yes' }); };
  const start = async () => { await auto.tick(); return auto.startEvent(auto.snapshot().events[0]!.id, 'orch'); };
  return { dir, flow, auto, enable, start };
}
describe('test DB grant', () => {
  it('accepts only a read-only agent adapter without an executable action', () => {
    expect(validateDefinition(definition()).steps[0]!.adapter).toBe('test-db-read');
    for (const patch of [{ effect: 'production' }, { effect: 'external-write' }, { kind: 'manual' }, { action: { kind: 'query', ref: 'raw-query' } }]) {
      const invalid = definition(); Object.assign(invalid.steps[0]!, patch); expect(() => validateDefinition(invalid)).toThrow();
    }
  });
  it('requires an explicit per-step capability and preserves production and unsupported-write bans', () => {
    const read = definition(); delete read.steps[0]!.adapter; read.steps[0]!.testDbRead = true;
    expect(validateDefinition(read).steps[0]!.testDbRead).toBe(true);
    for (const patch of [{ effect: 'production' }, { effect: 'code' }, { effect: 'external-write' }, { kind: 'manual' }, { testDbRead: false }]) {
      const invalid = structuredClone(read); Object.assign(invalid.steps[0]!, patch); expect(() => validateDefinition(invalid)).toThrow();
    }
    const dual = structuredClone(read); dual.steps[0]!.effect = 'external-write'; dual.steps[0]!.adapter = 'devops-write';
    expect(validateDefinition(dual).steps[0]).toMatchObject({ adapter: 'devops-write', testDbRead: true });
  });
  it('denies missing or widened grants and never authorizes an inert proposal', async () => {
    const { flow, auto } = setup();
    const missing = config(); delete missing.testDbRead;
    expect(() => auto.propose({ config: missing, expectedRevision: 0 }, 'orch')).toThrow('grant');
    for (const grant of [{ targetIds: [] }, { targetIds: ['fixture-test', 'fixture-test'] }, { targetIds: ['../fixture'] }, { targetIds: ['fixture-test'], server: 'override' }]) {
      expect(() => auto.propose({ config: { ...config(), testDbRead: grant }, expectedRevision: 0 }, 'orch')).toThrow();
    }
    auto.propose({ config: config(), expectedRevision: 0 }, 'orch'); await auto.tick(); expect(auto.snapshot().events).toEqual([]);
    const run = flow.start({ flowId: 'inspect', flowVersion: 1, subjectKey: 'manual', scope: {}, inputs: { workspace: '/fixture' } }, 'orch');
    expect(run.status).toBe('blocked'); expect(auto.testDbGrantFor(run)).toBeNull();
  });
  it('binds consent to the real event, run, inputs, owner and enabled exact revision', async () => {
    const { auto, flow, enable, start } = setup(); const rule = enable(), run = await start();
    expect(run.status).toBe('active'); expect(auto.testDbGrantFor(run)).toEqual({ targetIds: ['fixture-test'] });
    for (const patch of [{ id: 'copied' }, { ownerOrchestratorId: 'other' }, { inputs: { workspace: '/other' } }, { flowVersion: 2 }, { scope: { project: 'elsewhere' } }]) expect(auto.testDbGrantFor({ ...run, ...patch })).toBeNull();
    expect(() => flow.start({ flowId: run.flowId, flowVersion: 1, subjectKey: run.subjectKey, scope: run.scope, inputs: run.inputs }, 'orch')).toThrow('reserved');
    auto.pause({ id: rule.id, expectedRevision: rule.revision, paused: true }); expect(auto.testDbGrantFor(run)).toBeNull();
    auto.pause({ id: rule.id, expectedRevision: rule.revision, paused: false }); expect(auto.testDbGrantFor(run)).not.toBeNull();
    auto.control({ expectedRevision: auto.snapshot().revision, paused: true }); expect(auto.testDbGrantFor(run)).toBeNull();
    auto.control({ expectedRevision: auto.snapshot().revision, paused: false });
    auto.propose({ config: config(), expectedRevision: rule.revision }, 'orch'); expect(auto.testDbGrantFor(run)).toBeNull();
  });
  it('shows the explicit target grant or deny-all text in the native decision summary', () => {
    const html = renderToStaticMarkup(createElement(FlowAutomationSummary, { config: config() }));
    expect(html).toContain('data-testid="flow-auto-test-db-read"'); expect(html).toContain('fixture-test'); expect(html).not.toContain('flows.testDbRead');
    const missing = config(); delete missing.testDbRead;
    expect(renderToStaticMarkup(createElement(FlowAutomationSummary, { config: missing }))).toMatch(/data-testid="flow-auto-test-db-read">[^<]+</);
  });
});
