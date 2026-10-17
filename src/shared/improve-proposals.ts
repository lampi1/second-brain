// Contract extension for isolated application proposals, consumed by the proposal service and review panel.
// The integrator registers IPC separately. Publication is a renderer click; these actions are never MCP tools.
export type ProposalPhase = 'editing' | 'checking' | 'ready' | 'publishing' | 'published' | 'blocked';
export interface ProposalCheck { state: 'pending' | 'passed' | 'failed'; head: string | null }
export interface AppProposal {
  id: string;
  directory: string;
  branch: string;
  base: string;
  phase: ProposalPhase;
  head: string | null;
  files: string[];
  diff: string | null;
  quality: ProposalCheck;
  privacy: ProposalCheck;
  /** Reviews are supplied by the established reviewer workflow, tied to exactly this commit. */
  reviews: ProposalCheck;
  problem: string | null;
  url: string | null;
  publication: 'open' | 'closed' | 'merged' | null;
}
export interface ProposalPublication { id: string; reviewedHead: string }
export interface ProposalAvailability { available: boolean; reason: string | null; publishBlocked: string | null }
