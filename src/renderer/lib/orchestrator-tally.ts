// What the Orchestrator's card says about its own work (#153): the chats it started today counted by state, with the
// same counters as a parent's children (chat-tree.ts kidCounts, #152), and the cost apart: its own turns, and the chats
// it started with everything they delegated. A chat it started is a root role chat whose run says startedBy
// 'orchestrator'; one that reported (or completed its assignment) is done, one idle without its report and not waiting
// for a person is stopped. Pure; used by OrchestratorTile.tsx, pinned by test/unit/orchestrator-tally.test.ts.
import type { ChatSummary } from '@shared/contract';
import { kidCounts, type ChildState } from './chat-tree';

export interface OrchestratorTally { started: number; counts: ReturnType<typeof kidCounts>; startedUsd: number }

/** midnight of `now`'s day, local time */
const dayStart = (now: number): number => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

function stateOf(c: ChatSummary): ChildState {
  if (c.run?.report || c.work?.status === 'completed') return 'done';
  if (c.closedAt || c.state === 'closed') return 'closed';
  if (c.state === 'waiting' || c.pending > 0 || c.waitsOn) return 'wait';
  if (c.state === 'error') return 'err';
  if (c.state === 'running') return 'run';
  if (c.state === 'starting') return 'start';
  if (c.queued) return 'queued';
  return 'stall';
}

export function orchestratorTally(chats: readonly ChatSummary[], now = Date.now()): OrchestratorTally {
  const since = dayStart(now);
  const roots = chats.filter(c => !c.isOrchestrator && !c.parentId && c.run?.startedBy === 'orchestrator' && c.run.startedAt >= since);
  const ids = new Set(roots.map(c => c.id)), byId = new Map(chats.map(c => [c.id, c]));
  // a chat belongs to a started root when its parent chain reaches one (a cycle in broken data stops the walk)
  const under = (c: ChatSummary): boolean => {
    const seen = new Set<string>();
    for (let x: ChatSummary | undefined = c; x && !seen.has(x.id); x = x.parentId ? byId.get(x.parentId) : undefined) {
      if (ids.has(x.id)) return true;
      seen.add(x.id);
    }
    return false;
  };
  const startedUsd = chats.filter(under).reduce((sum, c) => sum + (Number.isFinite(c.costUsd) ? c.costUsd : 0), 0);
  return { started: roots.length, counts: kidCounts(roots.map(stateOf)), startedUsd: Math.round(startedUsd * 1e6) / 1e6 };
}
