// Advisory routing results shared by the local scorer, MCP discovery and the start dialog; never permissions.
export interface AgentCandidate {
  id: string;
  score: number;
  why: { field: 'name' | 'whenToUse' | 'purpose' | 'instructions' | 'pastRun'; runId?: string };
}
export interface AgentClassification {
  candidates: AgentCandidate[];
  mode: 'hybrid' | 'words';
  threshold: number;
  noneCloseEnough: boolean;
  proposal: 'ask-user-to-create' | null;
}
