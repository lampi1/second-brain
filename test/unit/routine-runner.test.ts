// The app-owned routine runner (ADR 0154) end to end in the main process: a manual start on one work item goes
// through the approved rule and reaches step 2 with no Orchestrator open; a newer revision of a running item updates
// that run instead of queueing a second; «Svuota coda» discards exactly the counted events; a test script runs by
// itself with a receipt while a prod step only waits for the user's «Esegui» (the exact command, recomputed); a
// dry run of the deploy-prod example executes nothing; a run restarts from a step after its routine got a new version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';
import type { FlowDefinition, FlowDryRun, FlowRun, FlowStep } from '../../src/shared/flows';
import { createFlowRuntime, type FlowRuntimeOptions, type FlowWorkerRequest } from '../../src/main/flows/runtime';
import type { DevOpsItem } from '../../src/main/flows/devops-detector';
import type { CommandResult, ResolvedCommand } from '../../src/main/flows/executor';

const worlds: { root: string; stop(): void }[] = [];
afterEach(() => { for (const w of worlds.splice(0)) { w.stop(); fs.rmSync(w.root, { recursive: true, force: true }); } });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

const agent = (id: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, title: id, kind: 'agent', instructions: `Do ${id} on the fixture.`, inputs: ['workspace'], workspaceInput: 'workspace', evidence: ['proof'], timeoutMs: 600000, maxAttempts: 2, effect: 'read-only', ...extra });
const command = (id: string, kind: 'script' | 'query', ref: string, extra: Partial<FlowStep> = {}): FlowStep => ({ id, title: id, kind: 'check', instructions: `Run ${ref}.`, inputs: [], evidence: [], timeoutMs: 60000, maxAttempts: 1, effect: 'read-only', action: { kind, ref }, env: 'test', ...extra });
const item = (id: number, revision = 3, tags = ['ai-ok']): DevOpsItem => ({ id, revision, title: `Bug ${id}`, type: 'Bug', state: 'New', project: 'ProjectA', areaPath: 'Team', iterationPath: 'Sprint 1', tags, url: `https://dev.azure.com/ab/ProjectA/_workitems/edit/${id}` });

function world(definition: Omit<FlowDefinition, 'id' | 'title' | 'description' | 'aliases' | 'scope'> & { scope?: FlowDefinition['scope'] }, files: Record<string, string> = {}, extra: Partial<FlowRuntimeOptions> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-')), brain = path.join(root, 'brain'), work = path.join(root, 'work');
  fs.mkdirSync(brain); fs.mkdirSync(work);
  for (const [file, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(brain, file)), { recursive: true }); fs.writeFileSync(path.join(brain, file), body); }
  // no Orchestrator at all: the app runs routines by itself
  const rows: ChatSummary[] = [];
  let count = 0;
  const create = vi.fn(async (request: FlowWorkerRequest): Promise<ChatSummary> => {
    const id = `worker-${++count}`, chat = { id, state: 'idle', run: { runId: `${id}-run`, taskVersion: 1, agentId: request.roleId, scope: { brainRoot: brain, projectRoot: request.workspace } } } as ChatSummary;
    rows.push(chat); return chat;
  });
  const sendWorker = vi.fn(async (id: string, _prompt: string, authorize: () => void) => { authorize(); rows.find(row => row.id === id)!.state = 'running'; });
  const send = vi.fn(async () => {});
  const run = vi.fn(async (_command: ResolvedCommand, _options: { env?: Record<string, string> }): Promise<CommandResult> => ({ exitCode: 0, output: 'ok' }));
  const readItem = vi.fn(async (_org: string, _project: string, id: number) => item(id));
  const detect = vi.fn(async () => ({ cursor: { revision: '1' }, summary: 'none', items: [] as { key: string; title: string; inputs: Record<string, string> }[] }));
  const runtime = createFlowRuntime({ userData: path.join(root, 'data'), brainRoot: () => brain, chats: () => rows, changed: () => {}, createWorker: create, sendWorker, discardWorker: async () => {}, stopChat: async () => {}, send, run, readItem, detect, ...extra });
  worlds.push({ root, stop: () => runtime.stop() });
  const flow = runtime.service();
  flow.propose({ expectedRevision: 0, definition: { id: 'fix', title: 'Fix', description: 'Fixture routine.', aliases: [], scope: { project: 'ProjectA', areaPath: 'Team' }, ...definition } });
  flow.decideDefinition({ id: 'fix', expectedRevision: 1, answer: 'yes' });
  const report = (id: string) => {
    const chat = rows.find(row => row.id === id)!; chat.state = 'idle';
    chat.run!.report = { at: 42, via: 'agent_report', outcome: 'done', verified: 'yes', blocking: 0, summary: 'done', canonical: { runId: chat.run!.runId, taskVersion: 1, outcome: 'done', doneWhen: [{ criterion: 'proof', met: true, evidence: 'Fixture result' }] } } as NonNullable<ChatSummary['run']>['report'];
    expect(runtime.reportReady(id)).toBe(true);
  };
  return { root, brain, work, rows, runtime, flow, create, sendWorker, send, run, readItem, detect, report };
}
const config = (work: string, trigger: Partial<Extract<FlowAutomationConfig['trigger'], { kind: 'devops' }>> = {}): FlowAutomationConfig => ({ flowId: 'fix', flowVersion: 1, scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: { workspace: work }, priority: 'normal',
  trigger: { kind: 'devops', everyMinutes: 1, organization: 'ab', project: 'ProjectA', areaPath: 'Team', workItemType: 'Bug', states: ['New'], includeExisting: true, includeTags: ['ai-ok'], excludeTags: ['ai-needs-human'], ...trigger } });
const enable = (w: ReturnType<typeof world>, trigger: Parameters<typeof config>[1] = {}) => {
  const auto = w.runtime.automation(), rule = auto.propose({ config: config(w.work, trigger), expectedRevision: 0 }, 'o');
  return auto.decide({ id: rule.id, expectedRevision: rule.revision, answer: 'yes' });
};

describe('manual start on one work item', () => {
  it('goes through the approved rule and reaches step 2 with no Orchestrator open', async () => {
    const w = world({ steps: [agent('analyze'), agent('fix')] }); enable(w);
    const preview = await w.runtime.previewItem('fix', 'https://dev.azure.com/ab/ProjectA/_workitems/edit/42');
    expect(preview).toMatchObject({ id: 42, matches: true, why: [], blocking: [] });
    const started = await w.runtime.startItem({ flowId: 'fix', workItem: '42' }) as FlowRun;
    expect(started.subjectKey).toMatch(/^auto:/); expect(started.inputs).toMatchObject({ 'work-item-id': '42', 'work-item-revision': '3', workspace: w.work });
    await w.runtime.tick(); expect(w.create).toHaveBeenCalledTimes(1);
    w.report('worker-1'); await w.runtime.tick();
    const run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    expect(run.currentStep).toBe(1); expect(run.steps[1]!.status).toBe('running'); expect(w.create).toHaveBeenCalledTimes(2); expect(w.send).not.toHaveBeenCalled();
  });
  it('says why an item misses the filters, refuses a second run on the same item and a paused trigger', async () => {
    const w = world({ steps: [agent('analyze')] }), rule = enable(w);
    w.readItem.mockResolvedValueOnce(item(7, 1, ['ai-needs-human']));
    expect((await w.runtime.previewItem('fix', '7')).why).toEqual(['manca il tag «ai-ok»', 'ha il tag escluso «ai-needs-human»']);
    await w.runtime.startItem({ flowId: 'fix', workItem: '42' });
    expect((await w.runtime.previewItem('fix', '42')).blocking).toEqual(['ha già una run attiva di questa routine']);
    await expect(w.runtime.startItem({ flowId: 'fix', workItem: '42' })).rejects.toThrow(/run attiva/);
    const auto = w.runtime.automation(); auto.pause({ id: rule.id, expectedRevision: auto.snapshot().rules[0]!.revision, paused: true });
    await expect(w.runtime.startItem({ flowId: 'fix', workItem: '43' })).rejects.toThrow(/in pausa/);
  });
});

describe('trigger queue', () => {
  it('updates the running run with a newer revision of its item instead of queueing a second run', async () => {
    const w = world({ steps: [agent('analyze')] }); enable(w);
    const started = await w.runtime.startItem({ flowId: 'fix', workItem: '42' }) as FlowRun;
    w.detect.mockResolvedValueOnce({ cursor: { revision: '2' }, summary: 'one', items: [{ key: 'ab/42:5', title: 'Bug 42', inputs: { 'work-item-id': '42', 'work-item-revision': '5' } }] });
    await w.runtime.automation().tick();
    expect(w.runtime.automation().snapshot().events.filter(e => !e.manual)).toEqual([]);
    expect(w.flow.snapshot().runs.find(r => r.id === started.id)!.inputs['work-item-revision']).toBe('5');
  });
  it('«Svuota coda» discards exactly the counted waiting events', async () => {
    const w = world({ steps: [agent('analyze')] }), rule = enable(w), auto = w.runtime.automation();
    w.runtime.automation().control({ expectedRevision: auto.snapshot().revision, paused: false });
    w.detect.mockResolvedValueOnce({ cursor: { revision: '2' }, summary: 'three', items: [1, 2, 3].map(id => ({ key: `contoso/${id}:1`, title: `Bug ${id}`, inputs: { 'work-item-id': String(id), 'work-item-revision': '1' } })) });
    // the queue fills while nothing can start (two routines at most): pause the rule's dispatch by holding the runner
    await auto.tick();
    const waiting = auto.snapshot().events.filter(e => e.ruleId === rule.id && ['pending', 'notified', 'blocked'].includes(e.status)).length;
    expect(() => auto.clearQueue({ id: rule.id, count: waiting + 1 })).toThrow(/cambiata/);
    expect(auto.clearQueue({ id: rule.id, count: waiting })).toBe(waiting);
    expect(auto.snapshot().events.filter(e => e.ruleId === rule.id && e.status === 'pending')).toEqual([]);
  });
});

describe('scripts, queries and prod', () => {
  const files = { 'scripts/move.js': 'console.log(process.argv.slice(2).join(" "))\n', 'queries/check.sql': 'SELECT 1\n' };
  const steps = (): FlowStep[] => [
    command('test-move', 'script', 'move.js', { args: { Env: 'test', From: '{{from}}', List: '{{attachment:list.txt}}' } }),
    command('prod-move', 'script', 'move.js', { env: 'prod', effect: 'production', args: { Env: 'prod', From: '{{from}}', List: '{{attachment:list.txt}}' } }),
  ];
  it('pins each script/query by content hash and refuses one that is not in the brain', () => {
    const w = world({ steps: steps(), params: [{ name: 'from', type: 'string', required: true }] }, files);
    const version = w.flow.snapshot().versions[0]!;
    expect(version.definition.steps[0]!.action!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => w.flow.propose({ expectedRevision: w.flow.snapshot().drafts[0]!.revision, definition: { ...version.definition, steps: [command('x', 'script', 'missing.ps1')] } })).toThrow(/non trovato nel brain/);
  });
  it('validates typed params before a run exists', async () => {
    const w = world({ steps: steps(), params: [{ name: 'from', type: 'string', required: true }, { name: 'n', type: 'int' }] }, files);
    await expect(w.runtime.startItem({ flowId: 'fix', params: { n: 'tre' } })).rejects.toThrow(/obbligatorio.*numero intero/);
    expect(w.flow.snapshot().runs).toEqual([]);
  });
  it('runs a test script by itself with a receipt; a prod step only waits for «Esegui» and runs the exact command shown', async () => {
    const w = world({ steps: steps(), params: [{ name: 'from', type: 'string', required: true }] }, files);
    const started = await w.runtime.startItem({ flowId: 'fix', params: { from: 'Team Air' }, attachments: [{ name: 'list.txt', content: 'a\nb\n' }] }) as FlowRun;
    expect(started.attachments?.[0]).toMatchObject({ name: 'list.txt', lines: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await w.runtime.tick(); await settle(); await w.runtime.tick(); await settle();
    expect(w.run).toHaveBeenCalledTimes(1);
    const [first, opts] = w.run.mock.calls[0]!;
    expect(first.env).toBe('test'); expect(first.args).toEqual(expect.arrayContaining(['--From', 'Team Air'])); expect(opts.env).toMatchObject({ SB_ROUTINE_ENV: 'test' });
    expect(fs.readFileSync(first.values.List!, 'utf8')).toBe('a\nb\n');
    let run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    expect(run.receipts?.[0]).toMatchObject({ stepId: 'test-move', by: 'runner', env: 'test', exitCode: 0 });
    // the prod step: never launched by the runner, the command waits for the user
    expect(run.status).toBe('approval'); expect(run.awaitingUser?.command).toContain('--Env prod');
    await w.runtime.tick(); await settle(); expect(w.run).toHaveBeenCalledTimes(1);
    await expect(w.runtime.runUserCommand(run.id, run.revision, 'prod-move', `${run.awaitingUser!.command} --extra`)).rejects.toThrow(/cambiato/);
    expect(w.run).toHaveBeenCalledTimes(1);
    run = await w.runtime.runUserCommand(run.id, run.revision, 'prod-move', run.awaitingUser!.command);
    expect(w.run).toHaveBeenCalledTimes(2); expect(w.run.mock.calls[1]![1].env).toMatchObject({ SB_ROUTINE_ENV: 'prod' });
    expect(run.receipts?.at(-1)).toMatchObject({ stepId: 'prod-move', by: 'user', env: 'prod', exitCode: 0 });
    expect(run.status).toBe('completed');
  });
  it('refuses a prod command whose script changed after approval', async () => {
    const w = world({ steps: steps(), params: [{ name: 'from', type: 'string', required: true }] }, files);
    const started = await w.runtime.startItem({ flowId: 'fix', params: { from: 'A' }, attachments: [{ name: 'list.txt', content: 'a' }] }) as FlowRun;
    await w.runtime.tick(); await settle(); await w.runtime.tick(); await settle();
    const run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    fs.appendFileSync(path.join(w.brain, 'scripts', 'move.js'), '// changed\n');
    await expect(w.runtime.runUserCommand(run.id, run.revision, 'prod-move', run.awaitingUser!.command)).rejects.toThrow(/cambiato dopo l'approvazione/);
    expect(w.run).toHaveBeenCalledTimes(1);
  });
  it('a dry run of the deploy-prod example executes nothing and shows every prod command for the user', async () => {
    const w = world({ steps: [
      command('pre', 'query', 'check.sql', { env: 'prod', effect: 'production', args: { server: 'prod-sql', database: 'Air' } }),
      command('release', 'script', 'move.js', { env: 'prod', effect: 'production', args: { Env: 'prod' } }),
    ] }, files);
    const dry = await w.runtime.startItem({ flowId: 'fix', dryRun: true }) as FlowDryRun;
    expect(dry.problems).toEqual([]);
    expect(dry.steps.map(s => [s.prod, s.auto])).toEqual([[true, false], [true, false]]);
    expect(dry.steps[0]!.command).toContain('sqlcmd -S prod-sql -d Air -E -b');
    await w.runtime.tick(); await settle();
    expect(w.run).not.toHaveBeenCalled(); expect(w.flow.snapshot().runs).toEqual([]);
  });
});

describe('controls', () => {
  it('restarts a run from a step after the routine got a new version (engine/model pick)', async () => {
    const w = world({ steps: [agent('analyze'), agent('fix', { maxAttempts: 1 })] }), rule = enable(w);
    const started = await w.runtime.startItem({ flowId: 'fix', workItem: '42' }) as FlowRun;
    await w.runtime.tick(); w.report('worker-1'); await w.runtime.tick();
    w.runtime.editStepModel({ flowId: 'fix', version: 1, stepId: 'fix', engine: 'codex', model: 'gpt-5-codex' });
    expect(w.flow.snapshot().active.fix).toBe(2);
    const live = w.flow.snapshot().runs.find(r => r.id === started.id)!, next = w.flow.snapshot().versions.find(v => v.version === 2)!;
    await w.runtime.cancel({ runId: live.id, expectedRevision: live.revision });
    const cancelled = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    const again = await w.runtime.restart({ runId: cancelled.id, expectedRevision: cancelled.revision, mode: 'from-step', stepId: 'fix', targetVersion: next.version, targetDigest: next.digest, acknowledgeEffects: true, automationRule: { id: rule.id, revision: w.runtime.automation().snapshot().rules[0]!.revision } });
    // the run moved to the new version (the step before is unchanged) and its fix step runs with the user's pick
    expect(again).toMatchObject({ flowVersion: 2, currentStep: 1 }); expect(again.steps[0]!.status).toBe('completed');
    await w.runtime.tick(); expect(w.create).toHaveBeenLastCalledWith(expect.objectContaining({ stepId: 'fix', engine: 'codex', model: 'gpt-5-codex' }));
  });
});
