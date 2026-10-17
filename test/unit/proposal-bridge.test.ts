// Offline Git fixture for the proposal bridge: exact ledger checks, isolated chat/worktree and publication gate.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProposalBridge, proposalQuality } from '../../src/main/improve/proposal-bridge';
import { DEFAULTS } from '../../src/main/brain/config';
import { routeChat } from '../../src/main/brain/routing';
import { DEMO_REGISTRY } from '../../src/main/brain/routing-demo';
import type { ChatSummary, NewChat } from '../../src/shared/contract';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-proposal-bridge-'))); dirs.push(dir); return dir; };
const runGit = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=', ...args], { cwd, windowsHide: true, encoding: 'utf8' }).trim();

describe('renderer proposal bridge', () => {
  it('requires an exact commit ledger entry, never an abbreviated or malformed approval', () => {
    const head = 'a'.repeat(40), at = '2026-10-17T00:00:00Z';
    expect(proposalQuality({ [head.slice(0, 7)]: { at, kind: 'full' } }, head)).toBe(false);
    expect(proposalQuality({ [head]: { at, kind: 'light' } }, head)).toBe(true);
    expect(proposalQuality({ [head]: { at: 'bad', kind: 'full' } }, head)).toBe(false);
    expect(proposalQuality(undefined, head)).toBe(false);
  });
  it('creates a separate worktree and resumes one app chat without changing the source branch or permissions', async () => {
    const root = temp(), repo = path.join(root, 'product'), userData = path.join(root, 'profile');
    fs.mkdirSync(repo); fs.mkdirSync(userData); runGit(repo, 'init', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'README.md'), 'Public fixture'); runGit(repo, 'add', 'README.md');
    runGit(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'Fixture');
    const rows: ChatSummary[] = [], requests: NewChat[] = [], focus = vi.fn();
    const settings = structuredClone(DEFAULTS);
    const bridge = new ProposalBridge({ userData, repo: () => repo,
      brain: { settings: () => settings, route: req => routeChat(req, null, DEMO_REGISTRY, null) },
      chats: { list: () => rows, create: async req => { requests.push(req); const row = { id: 'work', ...req } as ChatSummary; rows.push(row); return row; }, reopen: async id => { const row = rows.find(c => c.id === id)!; delete row.closedAt; return row; } },
      emit: vi.fn(), focus });
    expect(await bridge.availability()).toMatchObject({ available: true, publishBlocked: null });
    const proposal = await bridge.create();
    expect(proposal.phase).toBe('editing'); expect(proposal.directory.startsWith(userData + path.sep)).toBe(true);
    expect(requests[0]).toMatchObject({ cwd: proposal.directory, space: 'app' });
    expect(requests[0]).not.toHaveProperty('permissionMode');
    expect(runGit(repo, 'branch', '--show-current')).toBe('main'); expect(runGit(repo, 'status', '--porcelain')).toBe('');
    rows[0]!.closedAt = Date.now(); await bridge.resume(proposal.id); await bridge.resume(proposal.id);
    expect(requests).toHaveLength(1); expect(rows[0]!.closedAt).toBeUndefined(); expect(focus).toHaveBeenCalledTimes(3);
    expect(await bridge.publish({ id: proposal.id, reviewedHead: 'a'.repeat(40) })).toMatchObject({ phase: 'blocked', problem: expect.stringMatching(/Rivedi prima/) });
    expect(runGit(repo, 'remote')).toBe('');
  });
});
