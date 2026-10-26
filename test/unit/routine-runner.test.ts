// The app-owned routine runner (ADR 0155) end to end in the main process: a manual start on one work item goes
// through the approved rule and reaches step 2 with no Orchestrator open; a newer human revision stays queued
// behind that run without mutating its inputs; «Svuota coda» discards exactly the counted events; a test script runs by
// itself with a receipt while a prod step only waits for the user's «Esegui» (the exact command, recomputed); a
// dry run of the deploy-prod example executes nothing; a run restarts from a step after its routine got a new version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import type { FlowAutomationConfig } from '../../src/shared/flow-automation';
import type { FlowDefinition, FlowDryRun, FlowRun, FlowStep } from '../../src/shared/flows';
import { flowTools } from '../../src/main/flows/tools';
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
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'routine-')), brain = path.join(root, 'brain'), work = path.join(root, 'work');
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
  it('starts a configured on-demand routine without a work item through its approved host event', async () => {
    const w = world({ steps: [agent('analyze')] }), auto = w.runtime.automation();
    const cfg = { ...config(w.work), trigger: { kind: 'manual' as const } };
    const proposal = auto.propose({ config: cfg, expectedRevision: 0 }, 'o');
    auto.decide({ id: proposal.id, expectedRevision: proposal.revision, answer: 'yes' });
    const run = await w.runtime.startItem({ flowId: 'fix' }) as FlowRun;
    expect(run.subjectKey).toMatch(/^auto:/);
    expect(auto.executionAllowed(run)).toBe(true);
    expect(run.inputs.workspace).toBe(w.work);
    await w.runtime.tick(); expect(w.create).toHaveBeenCalledOnce();
    expect(w.readItem).not.toHaveBeenCalled();
  });
  it('returns an actionable paused result through the host tool without reading DevOps or retrying', async () => {
    const w = world({ steps: [agent('analyze')] }), rule = enable(w), auto = w.runtime.automation();
    auto.pause({ id: rule.id, expectedRevision: auto.snapshot().rules[0]!.revision, paused: true });
    const tool = flowTools({ ownerId: 'o', service: () => w.flow, resolveBinding: () => null, startItem: input => w.runtime.startItem(input) }).find(t => t.name === 'app_flow_start_item')!;
    const result = await tool.run({ contextKey: w.flow.snapshot().contextKey, flowId: 'fix', workItem: '42' });
    expect(result).toMatchObject({ status: 'blocked', code: 'trigger-paused', started: false, flowId: 'fix' });
    expect(w.readItem).not.toHaveBeenCalled(); expect(w.create).not.toHaveBeenCalled();
    expect(auto.snapshot().rules[0]!.status).toBe('paused');
    const broken = flowTools({ ownerId: 'o', service: () => w.flow, resolveBinding: () => null, startItem: async () => { throw new Error('storage failure'); } }).find(t => t.name === 'app_flow_start_item')!;
    await expect(broken.run({ contextKey: w.flow.snapshot().contextKey, flowId: 'fix' })).rejects.toThrow('storage failure');
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
  it('keeps a human revision queued behind the occupied run without changing its approved inputs', async () => {
    const w = world({ steps: [agent('analyze')] }); enable(w);
    const started = await w.runtime.startItem({ flowId: 'fix', workItem: '42' }) as FlowRun;
    w.detect.mockResolvedValueOnce({ cursor: { revision: '2' }, summary: 'one', items: [{ key: 'ab/42:5', title: 'Bug 42', inputs: { 'work-item-id': '42', 'work-item-revision': '5' } }] });
    await w.runtime.automation().tick();
    expect(w.runtime.automation().snapshot().events.filter(e => !e.manual)).toHaveLength(1);
    expect(w.runtime.automation().snapshot().events.filter(e => !e.manual)[0]?.inputs['work-item-revision']).toBe('5');
    expect(w.flow.snapshot().runs.find(r => r.id === started.id)!.inputs['work-item-revision']).toBe('3');
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

describe('review fixes', () => {
  const files = { 'scripts/move.js': 'console.log(1)\n', 'queries/check.sql': 'SELECT 1\n' };
  it('refuses a production script without env prod, and a query whose target comes from an input', () => {
    const w = world({ steps: [agent('a')] }, files), base = w.flow.snapshot().versions[0]!.definition, revision = w.flow.snapshot().drafts[0]!.revision;
    expect(() => w.flow.propose({ expectedRevision: revision, definition: { ...base, steps: [command('x', 'script', 'move.js', { effect: 'production' })] } })).toThrow(/declares env: prod/);
    expect(() => w.flow.propose({ expectedRevision: revision, definition: { ...base, steps: [command('x', 'query', 'check.sql', { args: { server: '{{server}}', database: 'Air' } })] } })).toThrow(/literally/);
  });
  it('refuses a start through a paused trigger even without a work item', async () => {
    const w = world({ steps: [agent('a')] }), rule = enable(w), auto = w.runtime.automation();
    auto.pause({ id: rule.id, expectedRevision: auto.snapshot().rules[0]!.revision, paused: true });
    await expect(w.runtime.startItem({ flowId: 'fix' })).rejects.toThrow(/in pausa/);
  });
  it('closes a prod receipt the app lost mid-run and stops for the user instead of offering «Esegui» again', async () => {
    const w = world({ steps: [command('prod', 'script', 'move.js', { env: 'prod', effect: 'production' })] }, files);
    const started = await w.runtime.startItem({ flowId: 'fix' }) as FlowRun; await w.runtime.tick(); await settle(); await w.runtime.tick(); await settle();
    const run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    // the click started the command, then the app died before it finished
    w.flow.beginCommand(run.id, run.revision, 'prod', { stepId: 'prod', kind: 'script', ref: 'move.js', command: run.awaitingUser!.command, args: {}, sha256: 'a'.repeat(64), env: 'prod', by: 'user' });
    await w.runtime.tick(); await settle();
    const after = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    expect(after.receipts?.[0]).toMatchObject({ exitCode: null }); expect(after.receipts?.[0]?.output).toContain('interrotto');
    expect(after.status).toBe('blocked'); expect(after.awaitingUser).toBeUndefined(); expect(w.run).not.toHaveBeenCalled();
  });
  it('stops a waiting prod command when its script changes, instead of failing every click', async () => {
    const w = world({ steps: [command('prod', 'script', 'move.js', { env: 'prod', effect: 'production' })] }, files);
    const started = await w.runtime.startItem({ flowId: 'fix' }) as FlowRun; await w.runtime.tick(); await settle(); await w.runtime.tick(); await settle();
    expect(w.flow.snapshot().runs.find(r => r.id === started.id)!.awaitingUser?.command).toContain('move.js');
    fs.appendFileSync(path.join(w.brain, 'scripts', 'move.js'), '// changed\n'); await w.runtime.tick(); await settle();
    const run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
    expect(run.status).toBe('blocked'); expect(run.steps[0]!.reason).toMatch(/^Da sistemare: .*cambiato/);
  });
});

it('runs a packaged script from its version directory even when the authoring brain is removed', async () => {
  const content = 'console.log("fixture")';
  const w = world({ steps: [command('verify', 'script', 'verify.mjs')], package: { schema: 1, assets: [{ id: 'verify.mjs', kind: 'script', content, sha256: '' }], outputs: [], requiredOps: [] } });
  fs.rmSync(w.brain, { recursive: true, force: true });
  const source = w.flow.start({ flowId: 'fix', flowVersion: 1, subjectKey: 'offline-source', scope: { project: 'ProjectA', areaPath: 'Team' }, inputs: {} }, 'app');
  await w.runtime.tick(); await settle();
  expect(w.flow.status(source.id, 'app').status).toBe('completed');
  const launch = w.run.mock.calls[0]!; expect(launch[1]).toHaveProperty('cwd', path.join(w.root, 'data', 'flows', w.flow.snapshot().contextKey, 'packages', source.definitionDigest));
});

it('executes pinned scripts under a manual grant and keeps production at the user gate', async () => {
  const w = world({ steps: [command('test', 'script', 'move.js'), command('prod', 'script', 'move.js', { env: 'prod', effect: 'production' })] }, { 'scripts/move.js': 'console.log(1)\n' });
  const auto = w.runtime.automation(), proposal = auto.propose({ config: { ...config(w.work), trigger: { kind: 'manual' } }, expectedRevision: 0 }, 'o');
  auto.decide({ id: proposal.id, expectedRevision: proposal.revision, answer: 'yes' });
  const started = await w.runtime.startItem({ flowId: 'fix' }) as FlowRun;
  await w.runtime.tick(); await settle();
  const run = w.flow.snapshot().runs.find(r => r.id === started.id)!;
  expect(w.run).toHaveBeenCalledOnce(); expect(run.status).toBe('approval'); expect(run.steps[run.currentStep]?.stepId).toBe('prod');
});
it('does not restart over an in-flight connector; cancellation waits for its receipt', async () => {
  let complete!: (v: { outcome: 'done'; summary: string }) => void;
  const execute = vi.fn(async (_recipe, _args, _readOnly, _signal, authorize, dispatched) => {
    authorize(); dispatched(); return new Promise<{ outcome: 'done'; summary: string }>(resolve => { complete = resolve; });
  });
  const step: FlowStep = { id: 'publish', title: 'Publish', kind: 'check', instructions: 'Publish test note', effect: 'external-write', inputs: [], evidence: ['connector'], timeoutMs: 60000, maxAttempts: 2,
    connector: { serverId: 'qa', tool: 'note', serverHash: 'a'.repeat(64), toolHash: 'b'.repeat(64), role: 'artisan', arguments: { text: 'fixture' } } };
  const w = world({ steps: [step] }, {}, { connectors: { check: () => {}, execute, catalog: () => [], inspect: vi.fn() } });
  const started = await w.runtime.startItem({ flowId: 'fix' }) as FlowRun;
  await w.runtime.tick(); await settle(); expect(execute).toHaveBeenCalledOnce();
  let live = w.flow.status(started.id, started.ownerOrchestratorId);
  await expect(w.runtime.restart({ runId: live.id, expectedRevision: live.revision, mode: 'from-start', targetVersion: live.flowVersion, targetDigest: live.definitionDigest, acknowledgeEffects: true })).rejects.toThrow('still stopping');
  expect(w.flow.snapshot().runs).toHaveLength(1);
  live = w.flow.status(started.id, started.ownerOrchestratorId);
  await w.runtime.cancel({ runId: live.id, expectedRevision: live.revision });
  expect(w.flow.status(live.id, live.ownerOrchestratorId).cancellation?.interruption).toBe('pending');
  complete({ outcome: 'done', summary: 'Created' }); await settle(); await w.runtime.tick();
  expect(w.flow.status(live.id, live.ownerOrchestratorId).cancellation?.interruption).toBe('confirmed');
  expect(execute).toHaveBeenCalledOnce();
});
