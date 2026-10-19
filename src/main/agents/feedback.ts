// The read side of the one feedback store (agents/run-feedback.ts), as the lifecycle sees it: a role's records, oldest
// first, and whether the store can be read. Used by lifecycle.ts and lifecycle-api.ts.
import type { AgentFeedback } from '../../shared/agent-lifecycle';

/** Read side of the one feedback store: a role's records, oldest first; problem = the store cannot be read. */
export interface FeedbackSource { list(agentId: string): AgentFeedback[]; readonly problem: string | null }
export const NO_FEEDBACK: FeedbackSource = { list: () => [], problem: null };
