// Demo data for Impostazioni → Avanzate's worktree rows (WorktreeSettings.tsx, ADR 0227): the demo has no real
// repositories, so its pool answers 'worktrees:usage' and 'worktrees:cleanup' with three made-up ones (one with a
// worktree that holds work, as the cleanup reports it). Nothing on disk is read or removed. Who: demo-wiring.ts.
import type { WorktreeUsage } from '../shared/contract';
import { WorktreePool } from './agents/worktree-pool';
import { WORKTREE_DEFAULTS } from './brain/settings-schema';

const GB = 1024 ** 3;

/** The demo's usage: before «Pulisci ora» and after it (the clean free copies over the limits gone). */
export function demoWorktreeUsage(cleaned: boolean, now = Date.now()): WorktreeUsage {
  const repos = [
    { repo: 'C:/dev/shop-api', name: 'shop-api', worktrees: cleaned ? 7 : 31, app: cleaned ? 6 : 30, pool: cleaned ? 5 : 6, inUse: 1, bytes: Math.round((cleaned ? 9.8 : 41.6) * GB),
      reported: [{ path: 'C:/dev/.second-brain-delegate-q7Lm2x', why: 'unpushed' as const }] },
    { repo: 'C:/dev/shop-web', name: 'shop-web', worktrees: cleaned ? 4 : 12, app: cleaned ? 4 : 12, pool: cleaned ? 3 : 4, inUse: 1, bytes: Math.round((cleaned ? 1.2 : 3.9) * GB),
      reported: [{ path: 'C:/dev/.second-brain-delegate-Rb4k9T', why: 'changes' as const }] },
    { repo: 'C:/dev/notes', name: 'notes', worktrees: 2, app: 2, pool: 2, inUse: 0, bytes: Math.round(0.1 * GB), reported: [] },
  ];
  return {
    repos, totalBytes: repos.reduce((n, r) => n + r.bytes, 0), limits: WORKTREE_DEFAULTS, at: now,
    lastCleanup: cleaned ? { removed: 33, at: now } : { removed: 0, at: now - 6 * 3600_000 }, auto: cleaned, running: false,
  };
}

/** A pool for the demo: no repository is known, usage and cleanup answer the made-up data above. */
export function demoWorktreePool(): WorktreePool {
  let cleaned = false;
  const pool = new WorktreePool({ limits: () => WORKTREE_DEFAULTS, inUse: () => false, knownCwds: () => [] });
  pool.usage = async () => demoWorktreeUsage(cleaned);
  pool.cleanup = async () => { cleaned = true; return demoWorktreeUsage(true); };
  return pool;
}
