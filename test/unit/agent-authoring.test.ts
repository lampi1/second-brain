// Automatic authoring refusal contracts: authority, policies, replay, ownership and evidence are checked in main.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { AgentRunStore } from '../../src/main/agents/runs';
import { AgentAuthoring, authoringTools, userOnlyChanges, identityChanges } from '../../src/main/agents/authoring';
import { SuggestionBudget } from '../../src/main/agents/suggestion-budget';
import { checkAgentCwd, checkAuthorPolicy, checkCreationRequest } from '../../src/main/agents/author-policy';
import type { AgentDraft, AgentModelChoice } from '../../src/shared/agents';
import type { ChatItem } from '../../src/shared/contract';
import { AGENT_FEEDBACK_SCHEMA } from '../../src/shared/agent-lifecycle';
import { AgentLifecycle } from '../../src/main/agents/lifecycle';
import { createLifecycleApi } from '../../src/main/agents/lifecycle-api';

const folders: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-author-')); folders.push(p); return p; };
afterEach(() => { for (const p of folders.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }];
const draft = (): AgentDraft => ({ name: 'Reader', purpose: 'Read files', instructions: 'Report observations.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' });
function fixture(extra: Partial<ConstructorParameters<typeof AgentAuthoring>[0]> = {}) {
  const userData = tmp(), now = Date.now(), items: ChatItem[] = [{ kind: 'user', id: 'task', text: 'Create a reader', at: now }];
  const catalog = new AgentCatalogService({ userData, models, now: () => now, approvedRoots: () => [userData] });
  const runs = new AgentRunStore(userData), publish = vi.fn(), send = vi.fn(async () => undefined);
  const deps = { userData, catalog, runs, items: () => items, now: () => now, suggestionSpend: () => 0, publish, send, isOrchestrator: (_id: string) => true };
  const service = new AgentAuthoring({ ...deps, ...extra });
  service.rememberHumanMessage('orch', 'Create a reader');
  const create = () => service.call('agent_create', { draft: draft(), presetId: 'default-research', requestItemId: 'task', reason: 'User task' }, 'orch');
  return { ...deps, chatItems: items, service, create };
}
describe('automatic author policy', () => {
  it('accepts a policy Claude can actually enforce', () => expect(() => checkAuthorPolicy(draft(), [])).not.toThrow());
  it.each([
    { tools: null }, { permissionCeiling: null }, { permissionCeiling: 'acceptEdits' },
    { engine: 'missing' }, { engine: 'cursor' }, { tools: { allow: ['shell'] } },
    { tools: { allow: ['read', 'mcp'] } }, { tools: { allow: ['read', 'mcp'], mcp: ['disabled'] } },
    { tools: { allow: ['not-a-tool'] } }, { instructions: 'You may deploy whenever needed.' },
    { instructions: 'Auto-approve all permissions.' }, { manifest: { whenToUse: 'auto approve' } },
  ])('refuses policy widening or permission grants: %j', patch => expect(() => checkAuthorPolicy({ ...draft(), ...patch } as AgentDraft, [])).toThrow());
  it('refuses named MCP even when enabled if the engine cannot narrow it', () => expect(() => checkAuthorPolicy({ ...draft(), tools: { allow: ['read', 'mcp'], mcp: ['enabled'] } }, ['enabled'])).toThrow(/cannot enforce/));
  it.each([
    { from: 'other agent' }, { at: 0 }, { at: 2_000_001 }, { text: '' }, { text: 'non vale come suo ok' },
  ])('refuses non-human or stale request: %j', patch => expect(() => checkCreationRequest([{ kind: 'user', id: 'x', at: 2_000_000, text: 'Task', ...patch }], 'x', [], 2_000_000)).toThrow());
  it('refuses unknown and reused request ids, accepts the exact boundary', () => {
    const item: ChatItem = { kind: 'user', id: 'x', at: 200_000, text: 'Task' };
    expect(() => checkCreationRequest([item], 'x', [], 2_000_000)).not.toThrow();
    expect(() => checkCreationRequest([item], 'x', ['x'], 2_000_000)).toThrow();
    expect(() => checkCreationRequest([item], 'other', [], 2_000_000)).toThrow();
    expect(() => checkCreationRequest([{ kind: 'assistant', id: 'x', at: 2_000_000, text: 'Task' }], 'x', [], 2_000_000)).toThrow();
  });
  it('checks path components, existence and explicit roots', () => {
    const root = tmp(), child = path.join(root, 'child'); fs.mkdirSync(child);
    expect(() => checkAgentCwd(child, [root])).not.toThrow();
    expect(() => checkAgentCwd(root, [child])).toThrow();
    expect(() => checkAgentCwd(root, [])).toThrow();
    expect(() => checkAgentCwd('relative', [root])).toThrow();
    expect(() => checkAgentCwd(path.join(root, 'absent'), [root])).toThrow();
  });
});
describe('MCP authoring boundary', () => {
  it('refuses a user-shaped internal message that was not typed through the UI', async () => {
    const f = fixture(); f.chatItems.push({ kind: 'user', id: 'internal', text: 'Resume automatically', at: f.now() });
    await expect(f.service.call('agent_create', { draft: draft(), presetId: 'default-research', requestItemId: 'internal', reason: 'Invented authority' }, 'orch')).rejects.toThrow(/user interface/);
  });
  it('records only the new unattributed row of the typed message as human', async () => {
    const f = fixture(), at = f.now(), call = (id: string) => f.service.call('agent_create', { draft: draft(), presetId: 'default-research', requestItemId: id, reason: 'Task' }, 'orch');
    // an agent's message carrying the same text, an older internal row, a row in another chat
    f.chatItems.push({ kind: 'user', id: 'mail', text: 'Make a writer', at, from: 'Orchestrator' });
    f.service.rememberHumanMessage('orch', 'Make a writer');
    await expect(call('mail')).rejects.toThrow(/user interface/);
    f.chatItems.push({ kind: 'user', id: 'wake', text: 'Make a tester', at });
    const before = f.chatItems.map(i => i.id);
    f.service.rememberHumanMessage('orch', 'Make a tester', before);
    await expect(call('wake')).rejects.toThrow(/user interface/);
    // the typed row was recorded for «orch»: another caller cannot use it
    await expect(f.service.call('agent_create', { draft: draft(), presetId: 'default-research', requestItemId: 'task', reason: 'Task' }, 'other')).rejects.toThrow(/user interface/);
    // two new identical unattributed rows: ambiguous, nothing is recorded
    f.chatItems.push({ kind: 'user', id: 'a', text: 'Twice', at }, { kind: 'user', id: 'b', text: 'Twice', at });
    f.service.rememberHumanMessage('orch', 'Twice', before);
    for (const id of ['a', 'b']) await expect(call(id)).rejects.toThrow(/user interface/);
    // the genuine typed row still works
    await expect(call('task')).resolves.toMatchObject({ lastEditedBy: 'orchestrator' });
  });
  it('reserves the daily job maximum durably, keeps unknown charges and resets at midnight', () => {
    const dir = tmp(); let now = new Date(2026, 9, 18, 12).getTime();
    const budget = new SuggestionBudget(dir, () => now);
    const first = budget.reserve(0.4);
    expect(() => budget.reserve(0.11)).toThrow(/budget/);
    budget.settle(first, null);
    expect(new SuggestionBudget(dir, () => now).spent()).toBe(0.4);
    budget.settle(first, 0.2);
    expect(budget.spent()).toBe(0.2);
    expect(() => budget.settle(first, 0)).toThrow(/Invalid/);
    now += 86_400_000;
    expect(budget.spent()).toBe(0);
  });
  it('reserves human task ids across concurrent calls and restarts', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.create(), f.create()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(new AgentAuthoring(f).call('agent_create', { draft: draft(), requestItemId: 'task', reason: 'Retry' }, 'orch')).rejects.toThrow(/unused/);
    const p = f.catalog.list().profiles.find(p => p.origin.kind === 'orchestrator')!;
    expect(p).toMatchObject({ userLocked: false, lastEditedBy: 'orchestrator', version: 1 });
    expect(() => f.catalog.resolve({ agentId: p.id, harness: 'claude', cwd: f.userData })).not.toThrow();
    expect(() => f.catalog.resolve({ agentId: p.id, harness: 'claude', cwd: tmp() })).toThrow(/approved/);
  });
  it('agent_update / agent_archive / agent_restore / agent_rollback apply at once with an undo (ADR 0082)', async () => {
    const f = fixture(), user = f.catalog.save(draft()), applied = vi.fn();
    f.service.onApplied = applied;
    const update = await f.service.call('agent_update', { agentId: user.id, patch: { instructions: 'Other' }, reason: 'Change' }, 'orch') as { applied: boolean; agent: { activeVersion: number; trial?: unknown } };
    // a behavioural change opens a trial version against the active one, authored by the Orchestrator
    expect(update).toMatchObject({ applied: true, agent: { activeVersion: 2, instructions: 'Other', trial: { version: 2, baseline: 1 } } });
    expect(f.catalog.history(user.id).find(v => v.version === 2)).toMatchObject({ state: 'trial', author: 'orchestrator', reason: 'Change' });
    expect(f.service.proposals()).toEqual([]);
    expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: user.id, op: 'update', version: { before: 1, after: 2 } }));
    const undo = f.publish.mock.calls.at(-1)![0][0];
    expect(undo).toMatchObject({ kind: 'agent-updated', action: { kind: 'agent-undo', undo: { agentId: user.id, operation: 'version', version: 1 } } });
    // the feed's undo rejects the trial
    expect(f.service.undo(undo.action.undo)).toMatchObject({ activeVersion: 1, instructions: 'Report observations.' });
    // rollback to the earlier version, then archive and restore
    await f.service.call('agent_update', { agentId: user.id, patch: { instructions: 'Third' }, reason: 'Again' }, 'orch');
    f.catalog.resolveTrial(user.id, 'keep');
    const back = await f.service.call('agent_rollback', { agentId: user.id, toVersion: 1, reason: 'Worse' }, 'orch') as { applied: boolean; agent: { activeVersion: number } };
    expect(back).toMatchObject({ applied: true, agent: { activeVersion: 1, instructions: 'Report observations.' } });
    const archived = await f.service.call('agent_archive', { agentId: user.id, reason: 'Remove' }, 'orch') as { agent: { status: string } };
    expect(archived.agent.status).toBe('archived');
    expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'archive', status: { before: 'active', after: 'archived' } }));
    await expect(f.service.call('agent_archive', { agentId: user.id, reason: 'Again' }, 'orch')).rejects.toThrow(/not active/);
    expect((await f.service.call('agent_restore', { agentId: user.id, reason: 'Back' }, 'orch') as { agent: { status: string } }).agent.status).toBe('active');
    expect(f.service.proposals()).toEqual([]);
  });
  it('tools, permissions, engine and a name-only change still wait for the user', async () => {
    const f = fixture(), user = f.catalog.save(draft()), other = f.catalog.save({ ...draft(), name: 'Other' }), applied = vi.fn();
    f.service.onApplied = applied;
    const before = JSON.stringify(f.catalog.list());
    const tools = await f.service.call('agent_update', { agentId: user.id, patch: { tools: { allow: ['read', 'edit'] }, instructions: 'Edit too' }, reason: 'Needs edits' }, 'orch') as { applied: boolean; state: string; waitsForUser: string[] };
    expect(tools).toMatchObject({ applied: false, state: 'pending', op: 'update', waitsForUser: ['tools'] });
    await expect(f.service.call('agent_update', { agentId: user.id, patch: { permissionCeiling: 'plan' }, reason: 'Safer' }, 'orch')).rejects.toThrow(/already waiting/);
    const name = await f.service.call('agent_propose', { agentId: other.id, patch: { name: 'Lettore' }, reason: 'Italian', expectedEffect: 'Clearer' }, 'orch');
    expect(name).toMatchObject({ applied: false, waitsForUser: ['name'] });
    expect(JSON.stringify(f.catalog.list())).toBe(before);
    expect(applied).not.toHaveBeenCalled();
    await expect(f.service.call('agent_update', { agentId: other.id, patch: { engine: 'cursor' }, reason: 'Cheaper' }, 'orch')).rejects.toThrow();
    expect(f.publish.mock.calls.map(c => c[0][0].kind)).toEqual(['agent-proposal', 'agent-proposal']);
    // the user's click: the change opens a trial against v1
    expect(f.service.decide((tools as unknown as { id: string }).id, true)).toMatchObject({ activeVersion: 2, tools: { allow: ['read', 'edit'] }, trial: { version: 2, baseline: 1 } });
  });
  it('a name, look or category bundled with a behaviour change still waits for the user', async () => {
    const f = fixture(), a = f.catalog.save(draft());
    const before = JSON.stringify(f.catalog.list());
    const r = await f.service.call('agent_update', { agentId: a.id, patch: { name: 'Admin', avatar: { kind: 'symbol', value: 'shield' }, instructions: 'Read more carefully.' }, reason: 'Better' }, 'orch') as { applied: boolean; waitsForUser: string[] };
    expect(r).toMatchObject({ applied: false, waitsForUser: ['name', 'avatar'] });
    expect(JSON.stringify(f.catalog.list())).toBe(before);
    expect(identityChanges({ ...draft(), category: 'development' }, { ...draft(), category: 'other' })).toEqual(['category']);
  });
  it('checks the authenticated Orchestrator inside call() for every write, not only in the tool wrapper', async () => {
    const f = fixture({ isOrchestrator: id => id === 'orch' }), a = f.catalog.save(draft());
    for (const [name, args] of [['agent_update', { agentId: a.id, patch: { instructions: 'x' }, reason: 'r' }], ['agent_archive', { agentId: a.id, reason: 'r' }], ['agent_suggest', { draft: draft(), reason: 'r', expectedEffect: 'e' }], ['agent_create', { draft: draft(), presetId: 'default-research', reason: 'r' }], ['agent_feedback', { runId: 'x', verdict: 'fail', notes: 'n', evidence: [] }]] as const)
      await expect(f.service.call(name, args, 'c_work')).rejects.toThrow(/Authenticated Orchestrator/);
    await expect(f.service.call('agent_list', {}, 'c_work')).resolves.toBeTruthy();
    await expect(f.service.call('agent_update', { agentId: a.id, patch: { instructions: 'Read twice.' }, reason: 'r' }, 'orch')).resolves.toMatchObject({ applied: true });
  });
  it('names the user-only fields a change touches', () => {
    expect(userOnlyChanges(draft(), { ...draft(), engine: 'cursor', model: 'x', instructions: 'y' })).toEqual(['engine']);
    expect(userOnlyChanges(draft(), { ...draft(), tools: { allow: ['read'] }, permissionCeiling: 'plan' })).toEqual(['permissionCeiling']);
    expect(userOnlyChanges(draft(), { ...draft(), effort: 'high', maxContext: 400000 })).toEqual([]);
  });
  it('a rollback to the open trial\'s baseline rejects the trial; a change during a trial is refused', async () => {
    let t = Date.now();
    const userData = tmp(), catalog = new AgentCatalogService({ userData, models, now: () => t, approvedRoots: () => [userData] });
    const runs = new AgentRunStore(userData);
    const service = new AgentAuthoring({ userData, catalog, runs, items: () => [], now: () => t, suggestionSpend: () => 0, publish: vi.fn(), send: vi.fn(async () => undefined), isOrchestrator: () => true });
    const p = catalog.save(draft());
    t += 1000;
    const trial = catalog.approveTrial(p.id, { ...p, instructions: 'Report observations briefly.' }, 'Shorter reports');
    expect(trial).toMatchObject({ activeVersion: 2, trial: { version: 2, baseline: 1 }, lastEditedBy: 'user' });
    t += 1000;
    await expect(service.call('agent_update', { agentId: p.id, patch: { instructions: 'Third' }, reason: 'More' }, 'orch')).rejects.toThrow(/prova/);
    const rolled = await service.call('agent_rollback', { agentId: p.id, toVersion: 1, reason: 'Worse' }, 'orch') as { agent: { activeVersion: number; instructions: string; trial?: unknown } };
    expect(rolled.agent).toMatchObject({ activeVersion: 1, instructions: 'Report observations.' });
    expect(rolled.agent.trial).toBeUndefined();
    expect(catalog.history(p.id).find(v => v.version === 2)?.state).toBe('rejected');
  });
  it('checks suggestion budget including unknown cost and persists proposals for human decisions only', async () => {
    const f = fixture(), args = { draft: draft(), reason: 'Potential task', expectedEffect: 'Fewer questions' };
    for (const cost of [null, 0.5, 1, NaN, -1]) await expect(new AgentAuthoring({ ...f, suggestionSpend: () => cost }).call('agent_suggest', args, 'orch')).rejects.toThrow(/budget/);
    const presets = f.catalog.list().profiles.length;
    const p = await f.service.call('agent_suggest', args, 'orch') as { id: string };
    // a suggestion writes no definition: only the user's click in Agenti does
    expect(f.catalog.list().profiles).toHaveLength(presets);
    const saved = f.service.decide(p.id, true)!;
    expect(saved.userLocked).toBe(true);
    expect(() => f.service.decide(p.id, true)).toThrow(/Pending/);
  });
  it('rejects stale proposal acceptance', async () => {
    const f = fixture(), p = f.catalog.save(draft());
    const proposal = await f.service.call('agent_propose', { agentId: p.id, patch: { name: 'Proposed' }, reason: 'Clarify', expectedEffect: 'Easier to find' }, 'orch') as { id: string };
    f.catalog.save({ ...draft(), name: 'Human edit' }, p.id);
    expect(() => f.service.decide(proposal.id, true)).toThrow(/changed/);
  });
  it('never upgrades fabricated evidence, never overwrites human outcomes or messages ended runs', async () => {
    const f = fixture(), p = await f.create() as { id: string };
    const run = f.runs.start({ agentId: p.id, version: 1, chatId: 'work', goal: 'Read', startedBy: 'orchestrator', startedAt: f.now(), costKnown: true });
    const a = { runId: run.runId, notes: 'Checked', verdict: 'success', evidence: [{ kind: 'run', ref: 'r_000000000000', at: f.now() }] };
    await f.service.call('agent_feedback', a, 'orch');
    expect(run.outcome?.basis).toBe('orchestrator-opinion');
    run.outcome = { verdict: 'fail', basis: 'human', by: 'user', at: f.now() };
    await f.service.call('agent_feedback', a, 'orch');
    expect(run.outcome.basis).toBe('human');
    run.endedAt = f.now(); run.endReason = 'completed';
    await expect(f.service.call('agent_feedback', { ...a, sendToRun: true }, 'orch')).rejects.toThrow(/Ended/);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('does not expose user decisions and rechecks authentication on every call', async () => {
    const f = fixture(), tools = authoringTools(f.service, 'orch', () => false);
    expect(tools.map(t => t.name)).not.toContain('agent_decide');
    expect(tools).toHaveLength(12);
    for (const t of tools) await expect(t.run({})).rejects.toThrow(/Authenticated/);
  });
});

describe('agent_feedback: one shape, one store', () => {
  const start = (f: ReturnType<typeof fixture>, id: string) => f.runs.start({ agentId: id, version: 1, chatId: 'work', goal: 'Read', startedBy: 'orchestrator', startedAt: f.now(), costKnown: true });
  it('exposes the shared schema and refuses caller-chosen agent, version or basis', async () => {
    const f = fixture(), p = await f.create() as { id: string }, run = start(f, p.id);
    const tool = authoringTools(f.service, 'orch', () => true).find(t => t.name === 'agent_feedback')!;
    expect(tool.inputSchema).toBe(AGENT_FEEDBACK_SCHEMA);
    const a = { runId: run.runId, notes: 'Checked', verdict: 'partial', evidence: [] };
    for (const extra of [{ agentId: 'other' }, { version: 9 }, { basis: 'human' }, { reason: 'alias' }])
      await expect(tool.run({ ...a, ...extra })).rejects.toThrow(/unknown argument/);
    await expect(tool.run({ ...a, verdict: 'failure' })).rejects.toThrow(/verdict/);
    const saved = await tool.run({ ...a, worked: 'Read', failed: 'Tests', gap: 'instructions', gapKey: 'tests' }) as Record<string, unknown>;
    expect(saved).toMatchObject({ agentId: p.id, runId: run.runId, version: 1, worked: 'Read', failed: 'Tests', gap: 'instructions', gapKey: 'tests', outcome: { basis: 'orchestrator-opinion', note: 'Checked', by: 'orch' } });
    // the store reloads its own records with the optional detail
    expect(new AgentAuthoring({ ...f, items: () => f.chatItems }).feedbackOf(p.id)).toHaveLength(1);
  });
  it('goes through the lifecycle facade when wired: same store, repeated gap proposed', async () => {
    let api: ReturnType<typeof createLifecycleApi> | null = null;
    const f = fixture({ feedback: (a, caller) => api!.feedback(a, caller) });
    const lifecycle = new AgentLifecycle({ userData: f.userData, wake: () => false, feedback: { list: id => f.service.feedbackOf(id), get problem() { return f.service.storeProblem; } } });
    api = createLifecycleApi(lifecycle, id => f.runs.get(id), (a, caller) => f.service.recordFeedback(a, caller));
    const p = await f.create() as { id: string };
    for (const run of [start(f, p.id), start(f, p.id)])
      await f.service.call('agent_feedback', { runId: run.runId, notes: 'Missed tests', verdict: 'partial', evidence: [], gap: 'instructions', gapKey: 'tests' }, 'orch');
    expect(f.service.feedbackOf(p.id)).toHaveLength(2);
    expect(lifecycle.proposals().map(x => x.kind)).toEqual(['update']);
    expect(api.read({ agentId: p.id }).feedback).toHaveLength(2);
    expect(fs.existsSync(path.join(f.userData, 'agent-feedback.json'))).toBe(false);
  });
});
