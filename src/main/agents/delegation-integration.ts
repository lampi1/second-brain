// Stages app-owned delegated changes for review in one fresh detached worktree. Used by integration tools;
// never moves a branch or writes the parent's checkout, and never treats whitespace checks as tests or approval.
import type { ChatSummary } from '../../shared/contract';
import type { DelegationIntegration } from '../../shared/delegation';
import { cleanRepository, createIsolatedWorktree, requiredGit, worktreeGit, type IsolatedDelegation } from './worktrees';

export function stageDelegatedChanges(owned: IsolatedDelegation, parent: ChatSummary, child: ChatSummary): Promise<DelegationIntegration> {
  return stageDelegatedChangesMany([{ owned, child }], parent);
}

/** Only host allocations are accepted. Resolve every source before any apply; order by stable child ID so a caller's
 * ordering cannot hide an overlap. The one union tree is the object subsequent check/review chats must verify. */
export async function stageDelegatedChangesMany(children: readonly { owned: IsolatedDelegation; child: ChatSummary }[], parent: ChatSummary): Promise<DelegationIntegration> {
  const blocked = (reason: string): DelegationIntegration => ({ status: 'blocked', reason, checksRequired: true, parentUnchanged: true });
  if (!children.length || children.length > 10 || new Set(children.map(x => x.child.id)).size !== children.length) return blocked('Choose 1 to 10 distinct completed child chats.');
  let stagingCwd: string | undefined;
  try {
    const target = await cleanRepository(parent.cwd);
    const pinned: { chatId: string; childHead: string; baseHead: string; root: string; patch: string }[] = [];
    for (const { owned, child } of [...children].sort((a, b) => a.child.id < b.child.id ? -1 : a.child.id > b.child.id ? 1 : 0)) {
      if (owned.childId !== child.id || owned.parentId !== parent.id || child.parentId !== parent.id || owned.parentRunId !== parent.run?.runId || owned.parentTaskVersion !== parent.run?.taskVersion) return blocked('Child ownership does not match this parent assignment.');
      if (!child.delegation?.result || child.delegation.result.noReport || child.state === 'running' || child.state === 'starting') return blocked(`Child ${child.id} must finish and report before integration.`);
      const source = await cleanRepository(owned.root);
      if (source.common !== owned.common || target.common !== owned.common) return blocked('Repository identity changed.');
      if (await requiredGit(owned.root, ['symbolic-ref', '--short', 'HEAD']) !== owned.branch) return blocked('A child left its app-owned feature branch.');
      const ancestor = await worktreeGit(owned.root, ['merge-base', '--is-ancestor', owned.base, source.head]);
      if (ancestor.exit !== 0) return blocked('A child rewrote or replaced its original baseline.');
      if (source.head === owned.base) return blocked(`No committed changes for child ${child.id}; commit the completed work first.`);
      const patch = await worktreeGit(owned.root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', owned.base, source.head, '--']);
      if (patch.exit !== 0 || !patch.out) return blocked('No bounded committed change could be read.');
      pinned.push({ chatId: child.id, childHead: source.head, baseHead: owned.base, root: owned.root, patch: patch.out });
    }
    const stage = await createIsolatedWorktree(target, 'integration'); stagingCwd = stage.root;
    const sources = pinned.map(({ chatId, childHead, baseHead }) => ({ chatId, childHead, baseHead }));
    const appliedChildIds: string[] = [];
    const common = { appliedChildIds, cwd: stage.root, parentHead: target.head, sources,
      ...(sources.length === 1 ? { childHead: sources[0]!.childHead, baseHead: sources[0]!.baseHead } : {}),
      checksRequired: true as const, parentUnchanged: true as const };
    for (const source of pinned) {
      const result = await worktreeGit(stage.root, ['apply', '--3way', '--index', '--whitespace=nowarn', '-'], source.patch);
      if (result.exit !== 0) {
        const conflicts = await worktreeGit(stage.root, ['diff', '--name-only', '--diff-filter=U', '-z']);
        return { ...common, status: conflicts.exit === 0 && conflicts.out ? 'conflict' : 'blocked',
          reason: `Child ${source.chatId} did not apply cleanly. Resolve only in the staging worktree; the parent checkout is unchanged.`,
          conflicts: conflicts.out.split('\0').filter(Boolean) };
      }
      appliedChildIds.push(source.chatId);
    }
    // This receipt is deliberately whitespace-only. No repository script, hook, test or custom driver runs.
    const check = await worktreeGit(stage.root, ['diff', '--cached', '--check']);
    const tree = await requiredGit(stage.root, ['write-tree']);
    if ((await cleanRepository(parent.cwd)).head !== target.head) return { ...common, status: 'blocked', reason: 'Parent changed during integration; this staging result is stale.' };
    for (const source of pinned) if ((await cleanRepository(source.root)).head !== source.childHead) return { ...common, status: 'blocked', reason: 'A child changed during integration; this staging result is stale.' };
    return { ...common, status: 'staged', tree,
      reason: 'Committed child changes are combined in one detached worktree. Run repository checks and independent review on this union tree through a normal permitted chat. No semantic verification, merge or push has occurred.',
      whitespace: { command: 'git diff --cached --check', exit: check.exit, at: Date.now(), tree } };
  } catch (error) {
    return { ...blocked(error instanceof Error ? error.message : 'Integration could not be prepared safely.'), ...(stagingCwd ? { cwd: stagingCwd } : {}) };
  }
}
