// Impostazioni → Avanzate, the worktree pool rows (WorktreeSettings.tsx, ADR 0227): the limits read from the
// settings with their defaults and ranges (settings-schema.ts worktreeLimits), the space as the rows show it
// (lib/settings-page.ts fmtSize) and the demo's made-up usage before and after «Pulisci ora» (demo-worktrees.ts).
import { describe, expect, it } from 'vitest';
import { WORKTREE_DEFAULTS, worktreeLimits } from '../../src/main/brain/settings-schema';
import { demoWorktreePool, demoWorktreeUsage } from '../../src/main/demo-worktrees';
import { fmtSize } from '../../src/renderer/lib/settings-page';

describe('worktree pool settings', () => {
  it('reads the limits, falling back to the defaults outside their ranges', () => {
    expect(worktreeLimits({})).toEqual(WORKTREE_DEFAULTS);
    expect(WORKTREE_DEFAULTS).toEqual({ perRepo: 6, total: 20, diskGb: 40 });
    expect(worktreeLimits({ worktreePoolPerRepo: 2, worktreePoolTotal: 9, worktreeDiskCapGb: 100 })).toEqual({ perRepo: 2, total: 9, diskGb: 100 });
    expect(worktreeLimits({ worktreePoolPerRepo: 0, worktreePoolTotal: 201, worktreeDiskCapGb: 1.5 })).toEqual(WORKTREE_DEFAULTS);
  });

  it('shows the space in GB from 1 GB, else MB; unmeasured as a dash', () => {
    expect(fmtSize(null)).toBe('—');
    expect(fmtSize(300 * 1024 ** 2)).toBe('300 MB');
    expect(fmtSize(58.4 * 1024 ** 3)).toBe('58.4 GB');
  });

  it('the demo pool answers made-up repositories; its cleanup keeps the worktrees that hold work', async () => {
    const before = demoWorktreeUsage(false, 0);
    expect(fmtSize(before.totalBytes)).toBe('45.6 GB');
    expect(before.repos.flatMap(r => r.reported.map(x => x.why)).sort()).toEqual(['changes', 'unpushed']);
    const pool = demoWorktreePool();
    const after = await pool.cleanup();
    expect(fmtSize(after.totalBytes)).toBe('11.1 GB');
    expect(after.lastCleanup?.removed).toBe(33);
    expect(after.repos.flatMap(r => r.reported)).toHaveLength(2);
    expect((await pool.usage()).totalBytes).toBe(after.totalBytes);
  });
});
