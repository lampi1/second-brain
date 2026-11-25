// Which engine a chat started on and why, one line (ADR 0359): a role chat's route («OpenAI Sol: primo disponibile»), else
// how the app or the user chose it (the Orchestrator's engine, a chat the user opened). Used by StripMeta.tsx; the same
// line opens a role chat's transcript (shared/sys.ts engineStarted). Pure; pinned by test/unit/engine-why.test.ts.
import type { ChatSummary } from '@shared/contract';

export function engineWhy(c: Pick<ChatSummary, 'run' | 'route'>): string | null {
  return c.run?.presetChoice?.route ?? c.route?.reason ?? null;
}
