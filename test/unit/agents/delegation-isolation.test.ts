// Real local Git repositories pin writing-child isolation and safe staging. No engine, network, package script or
// e2e runs; regressions must preserve the parent's files, index and branch and never overclaim verification.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, NewChat } from '../../../src/shared/contract';
import { DelegateWorktrees, needsIsolatedWorktree } from '../../../src/main/agents/worktrees';
import { delegationTools, type DelegationDeps } from '../../../src/main/agents/delegation';
import { stageDelegatedChanges, stageDelegatedChangesMany } from '../../../src/main/agents/delegation-integration';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
const commit = (cwd: string, message: string) => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message); };
const writer = { tools: { allow: ['edit' as const, 'shell' as const] }, ceiling: null };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-isolation-'))); roots.push(root);
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  // Checkout bytes must match this fixture's LF writes, independent of the user's Windows Git defaults.
  git(repo, 'config', 'core.autocrlf', 'false'); git(repo, 'config', 'core.eol', 'lf');
  fs.mkdirSync(path.join(repo, 'pkg')); fs.writeFileSync(path.join(repo, 'pkg', 'code.txt'), 'original\n'); commit(repo, 'initial');
  const parent = { id: 'parent', cwd: repo, run: { runId: 'parent-run', taskVersion: 1 } } as ChatSummary;
  const service = new DelegateWorktrees();
  const prepare = async (cwd = repo, childId = 'child') => { const result = await service.prepare(parent, { cwd } as NewChat, writer); result.bind?.(childId); return result; };
  const child = (cwd: string, id = 'child') => ({ id, parentId: parent.id, cwd, state: 'idle', delegation: { result: { outcome: 'done' } } }) as ChatSummary;
  return { root, repo, parent, service, prepare, child };
}

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

  it('gives concurrent writers distinct worktrees at the same baseline and preserves project subfolders', async () => {
    const f = fixture(), head = git(f.repo, 'rev-parse', 'HEAD');
    const [a, b] = await Promise.all([f.prepare(path.join(f.repo, 'pkg')), f.prepare()]);
    expect(a.cwd).not.toBe(b.cwd); expect(path.basename(a.cwd)).toBe('pkg');
    expect(git(a.cwd, 'rev-parse', 'HEAD')).toBe(head); expect(git(b.cwd, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(a.cwd, 'symbolic-ref', '--short', 'HEAD')).toMatch(/^sb\/delegate-/);
    fs.writeFileSync(path.join(a.cwd, 'code.txt'), 'child\n');
    expect(fs.readFileSync(path.join(f.repo, 'pkg', 'code.txt'), 'utf8')).toBe('original\n');
    expect(git(f.repo, 'status', '--porcelain')).toBe('');
    expect(f.service.allocation(f.parent, f.child(b.cwd)).base).toBe(head);
  });

  it('does not execute repository-configured filters or filesystem monitor commands in the host', async () => {
    const f = fixture(), marker = path.join(f.root, 'unexpected-script'), script = path.join(f.root, 'filter.cjs');
    fs.writeFileSync(path.join(f.repo, '.gitattributes'), '*.txt filter=custom\n'); commit(f.repo, 'attributes');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const command = `"${process.execPath}" "${script}"`;
    git(f.repo, 'config', 'filter.custom.smudge', command); git(f.repo, 'config', 'filter.custom.clean', command);
    git(f.repo, 'config', 'filter.custom.required', 'true'); git(f.repo, 'config', 'core.fsmonitor', command);
    const prepared = await f.prepare();
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.readFileSync(path.join(prepared.cwd, 'pkg', 'code.txt'), 'utf8')).toBe('original\n');
  });

  it('blocks partial/promisor lazy fetching before a missing blob can execute an external transport', async () => {
    const f = fixture(), marker = path.join(f.root, 'transport-ran'), script = path.join(f.root, 'transport.cjs');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const blob = git(f.repo, 'rev-parse', 'HEAD:pkg/code.txt');
    fs.unlinkSync(path.join(f.repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    git(f.repo, 'config', 'remote.origin.promisor', 'true');
    git(f.repo, 'config', 'remote.origin.url', `ext::${process.execPath} ${script}`);
    git(f.repo, 'config', 'protocol.ext.allow', 'always');
    await expect(f.prepare()).rejects.toThrow(/Partial\/promisor/);
    expect(fs.existsSync(marker)).toBe(false);
    expect(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    git(f.repo, 'config', '--unset', 'remote.origin.promisor');
    git(f.repo, 'config', 'extensions.partialclone', 'origin');
    await expect(f.prepare()).rejects.toThrow(/Partial\/promisor/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('blocks inactive conditional includes before a new branch can activate filter scripts', async () => {
    const f = fixture(), config = path.join(f.root, 'branch-config'), script = path.join(f.root, 'filter.cjs'), marker = path.join(f.root, 'conditional-filter-ran');
    fs.writeFileSync(path.join(f.repo, '.gitattributes'), '*.txt filter=conditional\n'); commit(f.repo, 'attributes');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const command = `"${process.execPath}" "${script}"`;
    fs.writeFileSync(config, `[filter "conditional"]\n    smudge = ${JSON.stringify(command)}\n`);
    git(f.repo, 'config', 'includeIf.onbranch:sb/**.path', config);
    await expect(f.prepare()).rejects.toThrow(/external or conditional/);
    expect(fs.existsSync(marker)).toBe(false);
    expect(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });

  it('preserves the original delta when a host-authorized successor continues a committed child', async () => {
    const f = fixture(), originalHead = git(f.repo, 'rev-parse', 'HEAD');
    const original = f.child((await f.prepare()).cwd);
    fs.writeFileSync(path.join(original.cwd, 'first.txt'), 'predecessor\n'); commit(original.cwd, 'B');
    const next = await f.service.prepare(f.parent, { cwd: original.cwd } as NewChat, writer, original.id);
    next.bind!('successor'); const successor = f.child(next.cwd, 'successor');
    fs.writeFileSync(path.join(next.cwd, 'second.txt'), 'successor\n'); commit(next.cwd, 'C');
    const allocation = f.service.allocation(f.parent, successor);
    expect(allocation.base).toBe(originalHead);
    const result = await stageDelegatedChanges(allocation, f.parent, successor);
    expect(result.status).toBe('staged');
    expect(fs.readFileSync(path.join(result.cwd!, 'first.txt'), 'utf8')).toBe('predecessor\n');
    expect(fs.readFileSync(path.join(result.cwd!, 'second.txt'), 'utf8')).toBe('successor\n');
    fs.writeFileSync(path.join(successor.cwd, 'unsaved.txt'), 'keep this');
    await expect(f.service.prepare(f.parent, { cwd: successor.cwd } as NewChat, writer, successor.id)).rejects.toThrow(/uncommitted or untracked/);
    await expect(f.service.prepare(f.parent, { cwd: original.cwd } as NewChat, writer, 'forged')).rejects.toThrow(/host-owned/);
  });

  it('blocks dirty, non-Git and foreign sources without a shared writer fallback', async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.repo, 'unsaved.txt'), 'preserve me');
    await expect(f.prepare()).rejects.toThrow(/uncommitted or untracked/);
    expect(fs.readFileSync(path.join(f.repo, 'unsaved.txt'), 'utf8')).toBe('preserve me');
    fs.unlinkSync(path.join(f.repo, 'unsaved.txt'));
    await expect(f.prepare(f.root)).rejects.toThrow(/Git repository/);
    const other = fixture(); await expect(f.prepare(other.repo)).rejects.toThrow(/parent repository/);
    const read = await f.service.prepare(f.parent, { cwd: f.root } as NewChat, { tools: { allow: ['read', 'shell-read'] }, ceiling: 'plan' });
    expect(read.cwd).toBe(f.root);
  });

  it('does not trust forged chat metadata, changed assignments or a restarted service', async () => {
    const f = fixture(), prepared = await f.prepare(), child = f.child(prepared.cwd);
    expect(() => f.service.allocation(f.parent, { ...child, cwd: f.repo })).toThrow(/host-owned/);
    expect(() => f.service.allocation({ ...f.parent, run: { ...f.parent.run!, taskVersion: 2 } }, child)).toThrow(/host-owned/);
    expect(() => new DelegateWorktrees().allocation(f.parent, child)).toThrow(/host-owned/);
    expect(() => f.service.allocation(f.parent, { ...child, id: 'different-child' })).toThrow(/host-owned/);
  });

  it('persists only host-bound ownership across restart and refuses corrupt provenance', async () => {
    const f = fixture(), file = path.join(f.root, 'isolation.json'), service = new DelegateWorktrees(file);
    const prepared = await service.prepare(f.parent, { cwd: f.repo } as NewChat, writer);
    expect(() => service.allocation(f.parent, f.child(prepared.cwd))).toThrow(/host-owned/);
    prepared.bind!('child');
    expect(new DelegateWorktrees(file).allocation(f.parent, f.child(prepared.cwd)).childId).toBe('child');
    fs.writeFileSync(file, JSON.stringify([{ childId: 'child', cwd: f.repo }]));
    expect(() => new DelegateWorktrees(file)).toThrow(/Invalid delegation isolation/);
  });

  it('stages committed changes on the parent tip without moving main, running hooks or claiming tests passed', async () => {
    const f = fixture(), prepared = await f.prepare(), child = f.child(prepared.cwd);
    fs.writeFileSync(path.join(child.cwd, 'pkg', 'code.txt'), 'child change\n'); commit(child.cwd, 'child');
    fs.writeFileSync(path.join(f.repo, 'parent.txt'), 'parent independent\n'); commit(f.repo, 'parent');
    const head = git(f.repo, 'rev-parse', 'HEAD'), index = fs.readFileSync(path.join(f.repo, '.git', 'index'));
    // Repository hooks are never executed by the integration service.
    const hooks = path.join(f.repo, '.git', 'hooks');
    fs.writeFileSync(path.join(hooks, 'post-checkout'), '#!/bin/sh\nexit 123\n', { mode: 0o755 });
    // Reading status must not refresh the parent's index even when file timestamps need revalidation.
    const later = new Date(Date.now() + 2000); fs.utimesSync(path.join(f.repo, 'pkg', 'code.txt'), later, later);
    const result = await stageDelegatedChanges(f.service.allocation(f.parent, child), f.parent, child);
    expect(result).toMatchObject({ status: 'staged', checksRequired: true, parentUnchanged: true, parentHead: head, whitespace: { exit: 0 } });
    expect(result.whitespace?.tree).toBe(result.tree);
    expect(fs.readFileSync(path.join(result.cwd!, 'pkg', 'code.txt'), 'utf8')).toBe('child change\n');
    expect(fs.readFileSync(path.join(result.cwd!, 'parent.txt'), 'utf8')).toBe('parent independent\n');
    expect(git(result.cwd!, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    expect(git(f.repo, 'symbolic-ref', '--short', 'HEAD')).toBe('main'); expect(git(f.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.readFileSync(path.join(f.repo, '.git', 'index'))).toEqual(index);
    expect(fs.readFileSync(path.join(f.repo, 'pkg', 'code.txt'), 'utf8')).toBe('original\n');
    expect(git(f.repo, 'status', '--porcelain')).toBe('');
  });

  // Two host-owned writers plus a detached union require repeated real Git safety/identity checks. Windows CI
  // exceeded the unit default (15 s); bound this integration scenario separately without dropping those checks.
  it('combines parallel siblings in one union stage and keeps both pinned sources', async () => {
    const f = fixture();
    const a = f.child((await f.prepare(f.repo, 'a')).cwd, 'a'), b = f.child((await f.prepare(f.repo, 'b')).cwd, 'b');
    fs.writeFileSync(path.join(a.cwd, 'a.txt'), 'first child\n'); commit(a.cwd, 'first');
    fs.writeFileSync(path.join(b.cwd, 'b.txt'), 'second child\n'); commit(b.cwd, 'second');
    const requested = [b, a].map(child => ({ owned: f.service.allocation(f.parent, child), child }));
    const result = await stageDelegatedChangesMany(requested, f.parent);
    expect(result.status).toBe('staged'); expect(result.sources?.map(x => x.chatId)).toEqual(['a', 'b']);
    expect(fs.readFileSync(path.join(result.cwd!, 'a.txt'), 'utf8')).toBe('first child\n');
    expect(fs.readFileSync(path.join(result.cwd!, 'b.txt'), 'utf8')).toBe('second child\n');
    expect(git(result.cwd!, 'write-tree')).toBe(result.tree);
    expect(git(f.repo, 'status', '--porcelain')).toBe('');
    expect(await stageDelegatedChangesMany([requested[0]!, requested[0]!], f.parent)).toMatchObject({ status: 'blocked' });
  }, 30_000);

  it('reports sibling overlaps and refuses custom merge drivers without executing them', async () => {
    const f = fixture();
    const a = f.child((await f.prepare(f.repo, 'a')).cwd, 'a'), b = f.child((await f.prepare(f.repo, 'b')).cwd, 'b');
    fs.writeFileSync(path.join(a.cwd, 'pkg', 'code.txt'), 'first\n'); commit(a.cwd, 'first');
    fs.writeFileSync(path.join(b.cwd, 'pkg', 'code.txt'), 'second\n'); commit(b.cwd, 'second');
    const requested = [a, b].map(child => ({ owned: f.service.allocation(f.parent, child), child }));
    expect(await stageDelegatedChangesMany(requested, f.parent)).toMatchObject({ status: 'conflict', conflicts: ['pkg/code.txt'], checksRequired: true });
    const marker = path.join(f.root, 'merge-was-run'), script = path.join(f.root, 'merge.cjs');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    git(f.repo, 'config', 'merge.custom.driver', `"${process.execPath}" "${script}"`);
    expect(await stageDelegatedChangesMany(requested, f.parent)).toMatchObject({ status: 'blocked', reason: expect.stringContaining('custom merge driver') });
    await expect(f.prepare()).rejects.toThrow(/custom merge driver/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('contains conflicts in the new staging worktree and blocks uncommitted child edits', async () => {
    const f = fixture(), prepared = await f.prepare(), child = f.child(prepared.cwd), owned = f.service.allocation(f.parent, child);
    fs.writeFileSync(path.join(child.cwd, 'pkg', 'code.txt'), 'child\n');
    expect(await stageDelegatedChanges(owned, f.parent, child)).toMatchObject({ status: 'blocked' });
    commit(child.cwd, 'child');
    fs.writeFileSync(path.join(f.repo, 'pkg', 'code.txt'), 'parent\n'); commit(f.repo, 'parent');
    const result = await stageDelegatedChanges(owned, f.parent, child);
    expect(result).toMatchObject({ status: 'conflict', checksRequired: true, conflicts: ['pkg/code.txt'] });
    expect(fs.readFileSync(path.join(f.repo, 'pkg', 'code.txt'), 'utf8')).toBe('parent\n');
    expect(git(f.repo, 'status', '--porcelain')).toBe('');
  });
});
