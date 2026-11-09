// Real local Git repositories pin writing-child isolation and safe staging. No engine, network, package script or
// e2e runs; regressions must preserve the parent's files, index and branch and never overclaim verification.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.

import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../../../src/shared/contract';
import { needsIsolatedWorktree } from '../../../src/main/agents/worktrees';
import { delegationTools, type DelegationDeps } from '../../../src/main/agents/delegation';

const roots: string[] = [];
// Windows keeps a just-used checkout locked briefly (antivirus, git's index): retry instead of failing with EBUSY.
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };

describe('delegation isolation', () => {
  it('routes integration only for the active owning parent under its current write permission', async () => {
    const parent = { id: 'parent', cwd: '/repo', state: 'idle', agent: { source: 'catalog', id: 'strategist' } } as ChatSummary;
    const child = { id: 'child', parentId: 'parent', cwd: '/worktree' } as ChatSummary;
    const integrate = vi.fn(async () => ({ status: 'blocked' as const, reason: 'No commit', checksRequired: true as const, parentUnchanged: true as const }));
    let policy = writer;
    const integrateMany = vi.fn(async () => ({ status: 'staged' as const, reason: 'union', checksRequired: true as const, parentUnchanged: true as const }));
    const tools = delegationTools({ chats: { list: () => [parent, child], agentPolicy: () => policy }, integrate, integrateMany } as unknown as DelegationDeps);
    const tool = tools.find(t => t.name === 'agent_integrate_child')!;
    const call = (args: Record<string, unknown>) => tool.run(args, { params: { chatId: parent.id } } as never);
    expect(JSON.parse(await call({ chatId: child.id }) as string).status).toBe('blocked');
    expect(integrate).toHaveBeenCalledWith(parent, child);
    const many = tools.find(t => t.name === 'agent_integrate_children')!;
    await many.run({ chatIds: [child.id] }, { params: { chatId: parent.id } } as never);
    expect(integrateMany).toHaveBeenCalledWith(parent, [child]);
    await expect(many.run({ chatIds: [child.id, child.id] }, { params: { chatId: parent.id } } as never)).rejects.toThrow(/distinct/);
    await expect(call({ chatId: 'unrelated' })).rejects.toThrow(/YOUR direct children/);
    await expect(call({ chatId: child.id, command: 'arbitrary' })).rejects.toThrow(/YOUR direct children/);
    policy = { tools: { allow: [] }, ceiling: null };
    await expect(call({ chatId: child.id })).rejects.toThrow(/current permissions/);
    expect(integrate).toHaveBeenCalledTimes(1);
  });

  it.each(['parent-report', 'child-version'])('detects in-place %s changes through shallow ChatManager summaries', async change => {
    const parent = { id: 'parent', cwd: '/repo', state: 'idle', agent: { source: 'catalog', id: 'strategist' }, run: { runId: 'p', taskVersion: 1 } } as ChatSummary;
    const child = { id: 'child', parentId: 'parent', cwd: '/worktree', run: { runId: 'c', taskVersion: 1 } } as ChatSummary;
    const result = { status: 'staged' as const, reason: 'union', cwd: '/stage', checksRequired: true as const, parentUnchanged: true as const };
    let finish!: () => void;
    const integrateMany = () => new Promise<typeof result>(resolve => { finish = () => resolve(result); });
    const tools = delegationTools({ chats: { list: () => [{ ...parent }, { ...child }], agentPolicy: () => writer }, integrateMany } as unknown as DelegationDeps);
    const tool = tools.find(t => t.name === 'agent_integrate_children')!;
    const running = tool.run({ chatIds: [child.id] }, { params: { chatId: parent.id } } as never);
    if (change === 'parent-report') parent.run!.report = { via: 'agent_report' } as NonNullable<ChatSummary['run']>['report'];
    else child.run!.taskVersion = 2;
    finish();
    expect(JSON.parse(await running as string)).toMatchObject({ status: 'blocked', cwd: '/stage', checksRequired: true });
  });

  it('classifies effective tools conservatively, without depending on role or mutable mode', () => {
    expect(needsIsolatedWorktree(null)).toBe(true);
    for (const allow of [['read'], ['read', 'shell-read'], []] as const) expect(needsIsolatedWorktree({ tools: { allow: [...allow] }, ceiling: null })).toBe(false);
    for (const c of ['edit', 'shell', 'brain-write', 'mcp'] as const) expect(needsIsolatedWorktree({ tools: { allow: [c] }, ceiling: 'plan' })).toBe(true);
  });
});
