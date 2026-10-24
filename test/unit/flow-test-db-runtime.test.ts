// Synthetic test DB runtime checks exercise grants, binding races and durable evidence; no database is contacted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowRuntime } from '../../src/main/flows/runtime';
import { testDbReadTools } from '../../src/main/flows/test-db-tool';
import { FlowService } from '../../src/main/flows/service';
import type { FlowDefinition } from '../../src/shared/flows';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';
import type { TestDbDriverInput, TestDbDriver } from '../../src/main/flows/test-db-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowTestDbEvidence } from '../../src/renderer/components/FlowDefinition';

// Prevent even loading a real transport dependency in these host authorization tests.
vi.mock('../../src/main/flows/test-db-driver', () => ({ runTestDbQuery: vi.fn(() => { throw new Error('Real transport forbidden in tests'); }) }));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: vi.fn(), on: vi.fn() } }));
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
async function setup(mode: 'adapter' | 'capability' | 'dual' | 'plain' = 'adapter') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-testdb-runtime-')); folders.push(folder);
  const brain = path.join(folder, 'brain'), otherBrain = path.join(folder, 'other-brain'); fs.mkdirSync(brain); fs.mkdirSync(otherBrain);
  let selected = brain, observe: (() => void) | undefined;
  fs.writeFileSync(path.join(folder, 'test-db-targets.json'), JSON.stringify({ schema: 1, targets: [{ id: 'fixture-test', server: 'test.invalid', database: 'FixtureTest' }] }));
  const rows = [{ id: 'o', isOrchestrator: true, state: 'idle' }] as ChatSummary[];
  const driver = vi.fn<TestDbDriver>(async (_input: TestDbDriverInput) => ({ columns: ['result'], rows: [[1]], rowCount: 1, truncated: false }));
  const runtime = createFlowRuntime({ userData: folder, brainRoot: () => selected, chats: () => rows, changed: () => observe?.(), send: vi.fn(async () => {}), detect: vi.fn(async () => ({ cursor: { item: '1' }, summary: 'Fixture', items: [{ key: '1', title: 'Fixture', inputs: { 'work-item-id': '1' } }] })), testDbRead: { driver, env: name => name === 'SQLCMD_TEST_RO_USER' ? 'fixture-reader' : 'fixture-password' } });
  const flow = runtime.service(), auto = runtime.automation();
  const definition: FlowDefinition = { id: 'inspect', title: 'Inspect', description: 'Fixture', aliases: [], scope: {}, steps: [
    { id: 'query', title: 'Query', kind: 'agent' as const, instructions: 'Inspect fixture data', inputs: ['workspace'], workspaceInput: 'workspace', evidence: [], effect: mode === 'dual' ? 'external-write' : 'read-only', ...(mode === 'adapter' ? { adapter: 'test-db-read' as const } : mode === 'plain' ? {} : { testDbRead: true as const, ...(mode === 'dual' ? { adapter: 'devops-write' as const } : {}) }), maxAttempts: 2, timeoutMs: 600000 }] };
  if (mode === 'dual') definition.scope = { project: 'FixtureProject', areaPath: 'FixtureArea' };
  flow.propose({ expectedRevision: 0, definition }); flow.decideDefinition({ id: 'inspect', expectedRevision: 1, answer: 'yes' });
  const config: FlowAutomationConfig = { flowId: 'inspect', flowVersion: 1, scope: {}, inputs: { workspace: brain }, priority: 'normal', trigger: { kind: 'interval', everyMinutes: 1 }, testDbRead: { targetIds: ['fixture-test'] } };
  if (mode === 'dual') { config.scope = definition.scope; config.trigger = { kind: 'devops', everyMinutes: 1, organization: 'fixture-org', project: 'FixtureProject', areaPath: 'FixtureArea', workItemType: 'Bug', states: ['New'], includeExisting: true }; config.devopsWrite = { organization: 'fixture-org', projects: ['FixtureProject'], ops: ['comment'], fields: [] }; }
  const rule = auto.propose({ config, expectedRevision: 0 }, 'o'); auto.decide({ id: rule.id, expectedRevision: 1, answer: 'yes' });
  await auto.tick(); const run = auto.startEvent(auto.snapshot().events[0]!.id, 'o');
  rows.push({ id: 'worker', state: 'running', run: { runId: 'wr', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  rows.push({ id: 'intruder', state: 'running', run: { runId: 'ir', taskVersion: 1, scope: { brainRoot: brain, projectRoot: brain } } } as ChatSummary);
  flow.bindAgent(run.id, run.revision, 'query', runtime.resolveBinding('worker', 'o', brain)!, 'o');
  return { runtime, auto, flow, run, rule, rows, driver, config, definition, folder,
    switchBrain: () => { selected = otherBrain; }, observe: (callback: () => void) => { observe = callback; } };
}
const request = { targetId: 'fixture-test', query: 'SELECT 1 AS result' };
describe('test DB flow runtime', () => {
  it('authenticates the endpoint and persists every executed query without credentials or result rows', async () => {
    const s = await setup(), tool = testDbReadTools((id, req, sig) => s.runtime.testDbRead(id, req, sig))[0]!;
    expect(tool.name).toBe('flow_test_db_query');
    await expect(tool.run(request, { params: {} } as never)).rejects.toThrow('own endpoint');
    const result = JSON.parse(await tool.run(request, { params: { chatId: 'worker' } } as never) as string);
    expect(result.rows).toEqual([[1]]); expect(result.evidenceId).toEqual(expect.any(String));
    const run = s.flow.snapshot().runs[0]!;
    expect(run.testDbEvidence).toEqual([expect.objectContaining({ id: result.evidenceId, targetId: 'fixture-test', database: 'FixtureTest', runId: run.id, queryHash: createHash('sha256').update(request.query).digest('hex'), stepId: 'query', chatRunId: 'wr', taskVersion: 1, status: 'ok', rowCount: 1 })]);
    const context = s.flow.snapshot().contextKey, file = path.join(s.folder, 'flows', context, 'state.json'), saved = fs.readFileSync(file, 'utf8');
    expect(saved).not.toContain('fixture-password'); expect(saved).not.toContain('fixture-reader'); expect(saved).not.toContain('test.invalid'); expect(saved).not.toContain(request.query); expect(saved).not.toContain('"rows"');
    const restored = new FlowService({ file, contextKey: context }).snapshot(); expect(restored.storageError).toBeUndefined(); expect(restored.runs[0]!.testDbEvidence).toEqual(run.testDbEvidence);
    const html = renderToStaticMarkup(createElement(FlowTestDbEvidence, { run, stepId: 'query' })); expect(html).toContain(run.testDbEvidence![0]!.queryHash); expect(html).toContain('FixtureTest'); expect(html).not.toContain(request.query); expect(html).toContain('fixture-test'); expect(html).not.toContain('flows.testDb');
  });
  it('hashes exact SQL without persisting or rendering its literals and rejects corrupt stored hashes', async () => {
    const s = await setup(), sql = "SELECT 'sensitive-fixture-value' AS result  ";
    await s.runtime.testDbRead('worker', { ...request, query: sql });
    const snap = s.flow.snapshot(), run = snap.runs[0]!, evidence = run.testDbEvidence![0]!;
    expect(evidence.queryHash).toBe(createHash('sha256').update(sql).digest('hex'));
    expect(JSON.stringify(run)).not.toContain('sensitive-fixture-value');
    expect(renderToStaticMarkup(createElement(FlowTestDbEvidence, { run, stepId: 'query' }))).not.toContain('sensitive-fixture-value');
    const file = path.join(s.folder, 'flows', snap.contextKey, 'state.json'), stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.runs[0].testDbEvidence[0].queryHash = 'invalid'; fs.writeFileSync(file, JSON.stringify(stored));
    expect(new FlowService({ file, contextKey: snap.contextKey }).snapshot().storageError).toBeDefined();
  });
  it.each(['capability', 'dual'] as const)('queries only from the explicit %s step capability, preserving other adapter grants', async mode => {
    const s = await setup(mode);
    expect(s.flow.snapshot().runs[0]!.steps[0]!.status).toBe('running');
    const result = await s.runtime.testDbRead('worker', request); expect(result.rowCount).toBe(1);
    if (mode === 'dual') expect(s.auto.grantFor(s.flow.snapshot().runs[0]!)).not.toBeNull();
    const missing = structuredClone(s.config); delete missing.testDbRead;
    expect(() => s.auto.propose({ config: missing, expectedRevision: 1 }, 'o')).toThrow('grant');
    if (mode === 'dual') { const missingWrite = structuredClone(s.config); delete missingWrite.devopsWrite; expect(() => s.auto.propose({ config: missingWrite, expectedRevision: 1 }, 'o')).toThrow('adapter'); }
  });
  it('does not give every agent in a granted automatic flow test DB access', async () => {
    const s = await setup('plain');
    await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('capability binding');
    expect(s.driver).not.toHaveBeenCalled();
  });
  it('refuses strangers, widened target, stale worker and revoked rules before driver execution', async () => {
    const s = await setup();
    await expect(s.runtime.testDbRead('intruder', request)).rejects.toThrow('binding');
    await expect(s.runtime.testDbRead('o', request)).rejects.toThrow('not running');
    await expect(s.runtime.testDbRead('worker', { ...request, targetId: 'other-test' })).rejects.toThrow('grant');
    s.rows[1]!.run!.taskVersion = 2; await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('binding'); s.rows[1]!.run!.taskVersion = 1;
    s.auto.pause({ id: s.rule.id, expectedRevision: 1, paused: true }); await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('grant');
    s.auto.pause({ id: s.rule.id, expectedRevision: 1, paused: false });
    s.auto.propose({ config: s.config, expectedRevision: 1 }, 'o'); await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('grant');
    expect(s.driver).not.toHaveBeenCalled();
  });
  it('rejects production adapter shapes, manual runs and an obsolete activated version', async () => {
    const s = await setup();
    expect(() => s.flow.propose({ definition: { ...s.definition, steps: [{ ...s.definition.steps[0]!, effect: 'production' }] }, expectedRevision: 1 })).toThrow();
    const manual = s.flow.start({ flowId: 'inspect', flowVersion: 1, subjectKey: 'manual', scope: {}, inputs: s.config.inputs }, 'o'); expect(manual.status).toBe('blocked');
    s.flow.propose({ definition: s.definition, expectedRevision: 1 }); s.flow.decideDefinition({ id: 'inspect', expectedRevision: 2, answer: 'yes' });
    await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('binding'); expect(s.driver).not.toHaveBeenCalled();
  });
  it('never dispatches a query whose evidence cannot be durably saved', async () => {
    const s = await setup(), write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    try { await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('Test DB read failed'); }
    finally { write.mockRestore(); }
    expect(s.driver).not.toHaveBeenCalled(); expect(s.flow.snapshot().runs[0]!.testDbEvidence).toBeUndefined();
  });
  it('records a sanitized failure even when a driver error contains credentials', async () => {
    const s = await setup(); s.driver.mockRejectedValueOnce(new Error('fixture-password test.invalid FixtureTest'));
    await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('Test DB read failed');
    expect(s.flow.snapshot().runs[0]!.testDbEvidence![0]!.status).toBe('error');
    expect(JSON.stringify(s.flow.snapshot())).not.toContain('fixture-password');
  });
  it.each(['pause', 'revision', 'task', 'brain', 'owner'] as const)('withholds in-flight rows after %s changes and records the attempt', async kind => {
    const s = await setup();
    s.driver.mockImplementationOnce(async input => {
      if (kind === 'pause') s.auto.pause({ id: s.rule.id, expectedRevision: 1, paused: true });
      if (kind === 'revision') s.auto.propose({ config: s.config, expectedRevision: 1 }, 'o');
      if (kind === 'task') s.rows[1]!.run!.taskVersion = 2;
      if (kind === 'brain') s.switchBrain();
      if (kind === 'owner') s.rows[0]!.closedAt = Date.now();
      input.authorize?.();
      return { columns: ['secret'], rows: [['withheld']], rowCount: 1, truncated: false };
    });
    await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('Test DB read failed');
    expect(s.flow.snapshot().runs[0]!.testDbEvidence![0]!.status).toBe('error');
  });
  it('persists before execution and rechecks synchronous observer revocation before dispatch and delivery', async () => {
    const s = await setup();
    let revoked = false;
    s.observe(() => { if (!revoked && s.flow.snapshot().runs[0]?.testDbEvidence?.some(e => e.status === 'pending')) { revoked = true; s.auto.pause({ id: s.rule.id, expectedRevision: 1, paused: true }); } });
    await expect(s.runtime.testDbRead('worker', request)).rejects.toThrow('Test DB read failed'); expect(s.driver).not.toHaveBeenCalled();
    const other = await setup(); let paused = false;
    other.observe(() => { if (!paused && other.flow.snapshot().runs[0]?.testDbEvidence?.some(e => e.status === 'ok')) { paused = true; other.auto.pause({ id: other.rule.id, expectedRevision: 1, paused: true }); } });
    await expect(other.runtime.testDbRead('worker', request)).rejects.toThrow('Test DB read failed');
    expect(other.flow.snapshot().runs[0]!.testDbEvidence![0]!.status).toBe('ok');
  });
});
