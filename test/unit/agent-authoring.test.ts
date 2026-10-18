// Automatic authoring refusal contracts: authority, policies, replay, ownership and evidence are checked in main.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { AgentRunStore } from '../../src/main/agents/runs';
import { AgentAuthoring, authoringTools } from '../../src/main/agents/authoring';
import { SuggestionBudget } from '../../src/main/agents/suggestion-budget';
import { checkAgentCwd, checkAuthorPolicy, checkCreationRequest } from '../../src/main/agents/author-policy';
import type { AgentDraft, AgentModelChoice } from '../../src/shared/agents';
import type { ChatItem } from '../../src/shared/contract';

const folders: string[] = [];
const tmp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-author-')); folders.push(p); return p; };
afterEach(() => { for (const p of folders.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }];
const draft = (): AgentDraft => ({ name: 'Reader', purpose: 'Read files', instructions: 'Report observations.', engine: 'claude', model: null, avatar: { kind: 'symbol', value: 'eye' }, tools: { allow: ['read'] }, permissionCeiling: 'default' });
function fixture() {
  const userData = tmp(), now = Date.now(), items: ChatItem[] = [{ kind: 'user', id: 'task', text: 'Create a reader', at: now }];
  const catalog = new AgentCatalogService({ userData, models, now: () => now, approvedRoots: () => [userData] });
  const runs = new AgentRunStore(userData), publish = vi.fn(), send = vi.fn(async () => undefined);
  const deps = { userData, catalog, runs, items: () => items, now: () => now, suggestionSpend: () => 0, publish, send };
  const service = new AgentAuthoring(deps);
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
  it('refuses locked writes, foreign archive and unsupported trials', async () => {
    const f = fixture(), user = f.catalog.save(draft());
    for (const name of ['agent_update', 'agent_archive', 'agent_restore', 'agent_rollback']) await expect(f.service.call(name, { agentId: user.id, patch: { instructions: 'Other' }, reason: 'Change' }, 'orch')).rejects.toThrow(/Protected/);
    await expect(f.service.call('agent_archive', { agentId: 'default-research', reason: 'Remove' }, 'orch')).rejects.toThrow(/owned/);
    const p = await f.create() as { id: string };
    await expect(f.service.call('agent_update', { agentId: p.id, patch: { instructions: 'New' }, reason: 'Change', trial: false }, 'orch')).rejects.toThrow(/trial/);
    await expect(f.service.call('agent_update', { agentId: p.id, patch: { instructions: 'New' }, reason: 'Change' }, 'orch')).rejects.toThrow(/one behavioural/);
  });
  it('undoes an automatic behavioural change from the feed card by rejecting its trial', async () => {
    let t = Date.now();
    const userData = tmp(), items: ChatItem[] = [{ kind: 'user', id: 'task', text: 'Create a reader', at: t }];
    const catalog = new AgentCatalogService({ userData, models, now: () => t, approvedRoots: () => [userData] });
    const runs = new AgentRunStore(userData), publish = vi.fn();
    const service = new AgentAuthoring({ userData, catalog, runs, items: () => items, now: () => t, suggestionSpend: () => 0, publish, send: vi.fn(async () => undefined) });
    service.rememberHumanMessage('orch', 'Create a reader');
    const created = await service.call('agent_create', { draft: draft(), presetId: 'default-research', requestItemId: 'task', reason: 'User task' }, 'orch') as { id: string };
    for (let i = 0; i < 5; i++) {
      const run = runs.start({ agentId: created.id, version: 1, chatId: `work-${i}`, goal: 'Read', startedBy: 'orchestrator', startedAt: t, costKnown: true });
      run.endedAt = t; run.endReason = 'completed'; run.outcome = { verdict: 'success', basis: 'human', by: 'user', at: t };
    }
    t += 86_400_000;
    const updated = await service.call('agent_update', { agentId: created.id, patch: { instructions: 'Report observations briefly.' }, reason: 'Shorter reports' }, 'orch') as { activeVersion: number; trial?: unknown };
    expect(updated).toMatchObject({ activeVersion: 2, trial: { version: 2, baseline: 1 } });
    const card = publish.mock.calls.map(c => c[0][0]).find(e => e.kind === 'agent-updated');
    expect(card.action).toMatchObject({ kind: 'agent-undo', undo: { operation: 'version', version: 1 } });
    t += 1000;
    const undone = service.undo(card.action.undo);
    expect(undone).toMatchObject({ activeVersion: 1, instructions: 'Report observations.', lastEditedBy: 'user', userLocked: true });
    expect(undone.trial).toBeUndefined();
    expect(catalog.history(created.id).find(v => v.version === 2)?.state).toBe('rejected');
    expect(() => service.undo(card.action.undo)).toThrow(/changed/);
  });
  it('checks suggestion budget including unknown cost and persists proposals for human decisions only', async () => {
    const f = fixture(), args = { draft: draft(), reason: 'Potential task', expectedEffect: 'Fewer questions' };
    for (const cost of [null, 0.5, 1, NaN, -1]) await expect(new AgentAuthoring({ ...f, suggestionSpend: () => cost }).call('agent_suggest', args, 'orch')).rejects.toThrow(/budget/);
    const p = await f.service.call('agent_suggest', args, 'orch') as { id: string };
    expect(f.catalog.list().profiles).toHaveLength(6);
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
