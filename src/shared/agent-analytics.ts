// Renderer-facing projection of the agent read model. Main's aggregateAgentUsage is structurally compatible;
// keeping this small contract shared prevents renderer imports of Node-dependent analytics implementation.
export interface AgentMeasure {
  total: number | null;
  knownSubtotal: number | null;
  knownSessions: number;
  unknownSessions: number;
}
export type AgentTimingKind = 'execution' | 'user-wait' | 'permission-wait' | 'queue' | 'unknown';
export interface AgentAnalyticsData {
  agents: {
    agentId: string;
    name: string;
    revisions: number[];
    sessions: number;
    costs: Record<'actualUsd' | 'listPriceUsd' | 'estimatedUsd', AgentMeasure>;
    timing: Record<AgentTimingKind, AgentMeasure & { medianMs: number | null; observedPartialMs: number }>;
    elapsed: AgentMeasure & { medianMs: number | null };
  }[];
  cohorts: {
    agentId: string;
    ownerRevision: number;
    taskType: string;
    engine: string | null;
    model: string;
    effortObserved: string;
    samples: number;
    medianExecutionMs: number | null;
    medianElapsedMs: number | null;
  }[];
}
