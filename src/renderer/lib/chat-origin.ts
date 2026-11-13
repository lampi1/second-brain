// Who started a root chat, for the line above its strip (AgentStrips.tsx Origin, ADR 0102): the Orchestrator (its run's
// startedBy), the app itself (startedBy 'app': a Judge's sampled review, agents/judge-sample.ts, numbered among the
// reviews started today), or the app resuming a turn the last quit cut (resumedAt, "ripresa dopo il riavvio"). The
// user's own chats and delegated children say nothing here. Pure; pinned by test/unit/chat-origin.test.ts.
import type { ChatSummary } from '@shared/contract';

export type ChatOriginLine =
  | { kind: 'orchestrator'; at: number }
  | { kind: 'app'; at: number; review: number }
  | { kind: 'resumed'; at: number };

const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** `all`: every chat the renderer knows (closed ones too), to number today's sampled reviews (1 = the day's first). */
export function originOf(c: ChatSummary | undefined, all: readonly (ChatSummary | undefined)[]): ChatOriginLine | null {
  if (!c || c.isOrchestrator || c.parentId) return null;
  const run = c.run;
  if (run?.startedBy === 'orchestrator') return { kind: 'orchestrator', at: run.startedAt };
  if (run?.startedBy === 'app') {
    if (!run.reviewOf) return { kind: 'app', at: run.startedAt, review: 0 };
    const today = all.filter((x): x is ChatSummary => !!x?.run && x.run.startedBy === 'app' && !!x.run.reviewOf && day(x.run.startedAt) === day(run.startedAt))
      .sort((a, b) => a.run!.startedAt - b.run!.startedAt || a.id.localeCompare(b.id));
    return { kind: 'app', at: run.startedAt, review: today.findIndex(x => x.id === c.id) + 1 || 1 };
  }
  if (c.resumedAt) return { kind: 'resumed', at: c.resumedAt };
  return null;
}
