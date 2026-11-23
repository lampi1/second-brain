// Processes no cleanup of the app may kill: those of the shared environments the brain's lease tool holds (a local
// stack an agent started and another chat uses). The tool writes <brain>/ops/state/envs.json: one entry per
// environment, `holder.pids` = the processes bound to the lease, freed when the lease is. An agent's stack is born in
// its engine's Job Object, so closing that chat used to end it for everyone (owner, 2026-11-23: never touch leased
// processes). Read at each kill, never cached: a lease taken or released a second ago counts. No brain, no file or
// an unreadable one = nothing leased. Used by proctree.ts (walks), jobguard.ts (jobs); the reader is set by wiring.ts.
import fs from 'node:fs';
import path from 'node:path';

/** The pids bound to a held lease in `<brainRoot>/ops/state/envs.json`. */
export function readLeasedPids(brainRoot: string | null | undefined): Set<number> {
  const out = new Set<number>();
  if (!brainRoot) return out;
  try {
    const envs = JSON.parse(fs.readFileSync(path.join(brainRoot, 'ops', 'state', 'envs.json'), 'utf8')) as Record<string, { holder?: { pids?: unknown } | null } | null>;
    for (const e of Object.values(envs ?? {})) {
      const pids = e?.holder?.pids;
      if (Array.isArray(pids)) for (const p of pids as unknown[]) if (typeof p === 'number' && Number.isInteger(p) && p > 0) out.add(p);
    }
  } catch { /* no lease file: nothing leased */ }
  return out;
}

let reader: () => Set<number> = () => new Set();
export function setLeaseReader(f: () => Set<number>): void { reader = f; }
/** The leased pids right now. */
export function leasedPids(): Set<number> { try { return reader(); } catch { return new Set(); } }

/** Of `list`, the pids that are leased or descend (within the list) from a leased one. */
export function leasedIn(list: readonly { pid: number; ppid: number }[], leased: ReadonlySet<number> = leasedPids()): Set<number> {
  const out = new Set<number>();
  if (!leased.size) return out;
  const byPid = new Map(list.map(p => [p.pid, p]));
  for (const p of list) {
    const seen = new Set<number>();
    for (let up: { pid: number; ppid: number } | undefined = p; up && !seen.has(up.pid); up = byPid.get(up.ppid)) {
      seen.add(up.pid);
      if (leased.has(up.pid)) { out.add(p.pid); break; }
    }
  }
  return out;
}
