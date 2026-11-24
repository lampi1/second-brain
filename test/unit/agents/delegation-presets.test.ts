// The delegation tools with per-task presets (agents/delegation.ts, ADR 0336): agent_delegate passes preset, presetWhy,
// taskKind and the delegator to the new chat and returns the guards' warnings and the preset the chat started on;
// agent_assign_task hands a reused child's switch to its preset (missing = Base, no effort = the default) to assignTask,
// which applies it after its guards (test/unit/chats/preset-switch.test.ts), refuses a preset on a child of another
// engine, and records the choice on the run.
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { delegationTools, type DelegationChats } from '../../../src/main/agents/delegation';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import type { AgentCatalog, UserTaskEvents } from '../../../src/shared/agents';
import type { TaskAssignmentOptions } from '../../../src/shared/delegation';
import { DELEGATION_DEFAULTS } from '../../../src/shared/roles';
import { choosePreset, stepAsk, type FullPresets, type PresetAsk, type Delegator } from '../../../src/shared/model-presets';
import type { StrategyPlan } from '../../../src/shared/strategy';

const PRESETS: FullPresets = { min: { model: 'm-low', effort: 'low' }, base: { model: 'm-mid' }, max: { model: 'm-top', effort: 'high' } };
const PRICE: Record<string, number> = { 'm-low': 1, 'm-mid': 5, 'm-top': 20 };

function fixture(o: { plan?: StrategyPlan; set?: boolean; childModel?: string; childEffort?: string; childHarness?: string; parentModel?: string; assignFails?: boolean; createdPreset?: string } = {}) {
  const cwd = path.resolve('/repo');
  const parent = { id: 'parent', title: 'Parent', cwd, harness: 'claude', model: o.parentModel ?? 'm-top', state: 'idle', permissionMode: null, pending: 0, agent: { id: 'strategist', source: 'catalog', version: 1 }, run: { runId: 'p', taskVersion: 1 } } as unknown as ChatSummary;
  const child = { id: 'child', title: 'Child', cwd, harness: o.childHarness ?? 'claude', model: o.childModel ?? 'm-mid', ...(o.childEffort ? { effort: o.childEffort } : {}), state: 'closed', closedAt: 1, permissionMode: null, pending: 0, parentId: 'parent', agent: { id: 'scout', source: 'catalog', version: 1 },
    run: { runId: 'old', taskId: 'task', taskVersion: 1 }, ...(o.childHarness ? { route: { balanced: true }, state: 'idle', closedAt: undefined } : {}), delegation: { role: 'scout', goal: 'Old', doneWhen: ['Old'], at: 1, result: { outcome: 'done', summary: 'Old result', at: 2 } } } as unknown as ChatSummary;
  const all = [parent, child];
  const catalog = { profiles: [{ id: 'strategist', name: 'Strategist', launches: ['scout'], activeVersion: 1, engine: 'claude', tools: { allow: ['read'] }, skills: [] },
    { id: 'scout', name: 'Scout', activeVersion: 1, engine: 'claude', tier: 'mid', tools: { allow: ['read'] }, skills: [] }] } as unknown as AgentCatalog;
  const ledger: UserTaskEvents = { events: [], latestSeq: 0, acknowledgedSeq: 0 };
  const assign = vi.fn(async (_id: string, _prompt: string, _options: TaskAssignmentOptions) => { if (o.assignFails) throw new Error('busy'); child.run = { ...child.run!, runId: 'new', taskVersion: 2 }; });
  const created: NewChat[] = [];
  const create = vi.fn(async (req: NewChat) => { created.push(req); return { ...child, id: 'fresh', state: 'running', closedAt: undefined, run: { runId: 'r', taskVersion: 1, ...(o.createdPreset ? { presetChoice: { preset: o.createdPreset } } : {}) } } as unknown as ChatSummary; });
  const set = vi.fn(async (_id: string, _patch: { model?: string; effort?: string }) => ({}));
  const chats: DelegationChats = { list: () => all, create, assignTask: assign, userEvents: () => structuredClone(ledger), agentPolicy: () => ({ tools: { allow: ['read'] }, ceiling: null }),
    reportDelegation: () => ({ parentId: 'parent', delivered: true }), limitNotice: vi.fn(), send: async () => {}, ladderAsk: () => ({ asked: 'x' }), ladderReply: async () => ({ answered: 'x', askUser: false }), ...(o.set === false ? {} : { set }), ...(o.plan ? { planOf: () => structuredClone(o.plan!), planDelegated: () => {} } : {}) };
  const presetChoice = vi.fn((_role: string, ask: PresetAsk, delegator?: Delegator) => choosePreset({ presets: PRESETS, ask, ...(delegator ? { delegator } : {}), price: m => PRICE[m] ?? null }));
  const tools = delegationTools({ chats, roles: () => catalog, settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agent]', runs: () => [], presetChoice });
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await tools.find(t => t.name === name)!.run(args, { params: { chatId: 'parent' } } as never) as string);
  const assignArgs = (extra: Record<string, unknown> = {}) => ({ chatId: 'child', roleId: 'scout', cwd, mode: 'continue', expectedVersion: 1, contract: { goal: 'Follow up', output: 'Evidence', doneWhen: ['New criterion'] }, ...extra });
  const delegateArgs = (extra: Record<string, unknown> = {}) => ({ tasks: [{ role: 'scout', title: 'Ordini · Log', cwd, contract: { goal: 'Look', output: 'Evidence', doneWhen: ['Found'] }, ...extra }] });
  return { child, assign, create, created, set, presetChoice, call, assignArgs, delegateArgs };
}

describe('agent_delegate with a preset', () => {
  it('passes preset, presetWhy, taskKind and the delegator (its role and own model) to the new chat', async () => {
    const f = fixture();
    await f.call('agent_delegate', f.delegateArgs({ preset: 'max', presetWhy: 'migrazione delicata', taskKind: 'migration' }));
    expect(f.created[0]).toMatchObject({ preset: 'max', presetWhy: 'migrazione delicata', taskKind: 'migration', delegator: { role: 'strategist', model: 'm-top' } });
    expect(f.presetChoice).toHaveBeenCalledWith('scout', { preset: 'max', presetWhy: 'migrazione delicata', taskKind: 'migration' }, { role: 'strategist', model: 'm-top' });
  });
  it('returns the preset the chat really started on (its run), not only the one asked', async () => {
    const f = fixture({ createdPreset: 'min' });
    const r = await f.call('agent_delegate', f.delegateArgs());
    expect(r.children[0].preset).toBe('min');
  });
  it('returns the guards\' warnings (no reason: Base)', async () => {
    const f = fixture();
    const r = await f.call('agent_delegate', f.delegateArgs({ preset: 'max' }));
    expect(JSON.stringify(r)).toMatch(/without presetWhy: base used/);
  });
  it('refuses a preset that is not one of the three, before any chat starts', async () => {
    const f = fixture();
    await expect(f.call('agent_delegate', f.delegateArgs({ preset: 'huge' }))).rejects.toThrow(/preset: one of min \| base \| max/);
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe('agent_assign_task with a preset', () => {
  it('missing preset = Base: a child already on Base keeps its model', async () => {
    const f = fixture();
    await f.call('agent_assign_task', f.assignArgs());
    expect(f.set).not.toHaveBeenCalled();
    expect(f.assign.mock.calls[0]![2].preset).toEqual({ choice: { preset: 'base', delegatorRole: 'strategist' }, model: 'm-mid' });
  });
  it('hands the switch to assignTask (after its guards), never switching the child itself, and says so', async () => {
    const f = fixture();
    const r = await f.call('agent_assign_task', f.assignArgs({ preset: 'max', presetWhy: 'serve ragionare', taskKind: 'design' }));
    expect(f.set).not.toHaveBeenCalled();
    expect(f.assign.mock.calls[0]![2].preset?.switchTo).toEqual({ model: 'm-top', effort: 'high' });
    expect(f.assign.mock.calls[0]![2].preset?.choice).toMatchObject({ preset: 'max', effort: 'high', presetWhy: 'serve ragionare', taskKind: 'design' });
    expect(JSON.stringify(r)).toMatch(/the child switches to preset max/);
  });
  it('caps at the delegator\'s own model', async () => {
    const f = fixture({ parentModel: 'm-mid' });
    await f.call('agent_assign_task', f.assignArgs({ preset: 'max', presetWhy: 'x' }));
    expect(f.set).not.toHaveBeenCalled();
    expect(f.assign.mock.calls[0]![2].preset?.choice).toMatchObject({ preset: 'base', asked: 'max' });
  });
  it('a refused assignment never switches the child (the switch lives inside assignTask)', async () => {
    const f = fixture({ assignFails: true });
    await expect(f.call('agent_assign_task', f.assignArgs({ preset: 'max', presetWhy: 'x' }))).rejects.toThrow(/busy/);
    expect(f.set).not.toHaveBeenCalled();
  });
  it('back to Base after Massimo: the effort goes back to the default (null)', async () => {
    const f = fixture({ childModel: 'm-mid', childEffort: 'high' });
    await f.call('agent_assign_task', f.assignArgs());
    expect(f.assign.mock.calls[0]![2].preset?.switchTo).toEqual({ model: 'm-mid', effort: null });
  });
  it('a child on another engine (an old Balanced chat, mode removed 2026-11-23) is never reused: a fresh chat', async () => {
    const f = fixture({ childHarness: 'codex', childModel: 'gpt-x' });
    await expect(f.call('agent_assign_task', f.assignArgs({ preset: 'max', presetWhy: 'x' }))).rejects.toThrow(/Role configuration changed/);
    await expect(f.call('agent_assign_task', f.assignArgs())).rejects.toThrow(/Role configuration changed/);
    expect(f.set).not.toHaveBeenCalled();
    expect(f.assign).not.toHaveBeenCalled();
  });
});

// ADR 0346 (issue #462): the plan names a preset, never a model; the part that starts a step takes the step's preset
// when it names none, and the model behind it is the role card's at that moment (presetChoice reads the card)
describe('a part of an approved plan takes its step\'s preset', () => {
  const plan: StrategyPlan = { phase: 'running', at: 1, clarified: [], steps: [{ title: 'Cerco', role: 'scout', state: 'todo', preset: 'max' }, { title: 'Riassumo', role: 'scout', state: 'todo' }] };
  it('stepAsk: the part\'s own preset wins, a step on Base or no step changes nothing', () => {
    expect(stepAsk({}, 'max')).toEqual({ preset: 'max', presetWhy: 'the preset of the approved plan step' });
    expect(stepAsk({ presetWhy: 'serve' }, 'min')).toEqual({ preset: 'min', presetWhy: 'serve' });
    expect(stepAsk({ preset: 'min', presetWhy: 'basta poco' }, 'max')).toEqual({ preset: 'min', presetWhy: 'basta poco' });
    expect(stepAsk({}, 'base')).toEqual({});
    expect(stepAsk({ taskKind: 'log search' }, undefined)).toEqual({ taskKind: 'log search' });
  });
  it('agent_delegate with step and no preset starts the chat on the step\'s preset, read from the card now', async () => {
    const f = fixture({ plan });
    await f.call('agent_delegate', f.delegateArgs({ step: 1 }));
    expect(f.created[0]).toMatchObject({ preset: 'max', presetWhy: 'the preset of the approved plan step' });
    expect(f.presetChoice).toHaveBeenCalledWith('scout', { preset: 'max', presetWhy: 'the preset of the approved plan step' }, { role: 'strategist', model: 'm-top' });
    // no model travels with the step: the new chat's request names the preset only
    expect(f.created[0]).not.toHaveProperty('model');
  });
  it('a step without a preset stays on Base, and the part\'s own preset wins over the step\'s', async () => {
    const f = fixture({ plan });
    await f.call('agent_delegate', f.delegateArgs({ step: 2 }));
    expect(f.created[0]).not.toHaveProperty('preset');
    await f.call('agent_delegate', f.delegateArgs({ step: 1, preset: 'min', presetWhy: 'basta poco' }));
    expect(f.created[1]).toMatchObject({ preset: 'min', presetWhy: 'basta poco' });
  });
  it('agent_assign_task with step and no preset moves the reused child to the step\'s preset', async () => {
    const f = fixture({ plan });
    const r = await f.call('agent_assign_task', f.assignArgs({ step: 1 }));
    expect(r.preset).toBe('max');
    expect(f.assign.mock.calls[0]![2].preset).toMatchObject({ model: 'm-top', switchTo: { model: 'm-top', effort: 'high' } });
  });
});
