// Routing snapshot of an agent run, taken just after it starts: how the local classifier (#40) ranks the run's agent for
// this goal, and, while the agent is on a trial, whether its parent (baseline) version would also have won the request.
// Why: the trial evaluation (trials.ts) compares only work the parent would have taken too; without this record every
// trial run is "unknown routing" and is excluded. Advisory and local: words or hybrid embeddings, no model call, no tokens.
// Used by wiring.ts (ChatManager onRunStarted → AgentRunStore.setRouting) and by the lifecycle's parentWins callback.
import type { AgentProfile, AgentRun, AgentRunRouting, AgentVersion } from '../../shared/agents';
import type { AgentClassification } from '../../shared/agent-classifier';

export type Classify = (request: string, profiles: AgentProfile[], runs: AgentRun[]) => Promise<AgentClassification>;

/** rank 1-based of `agentId` among scored candidates (score > 0); null = not scored */
function place(c: AgentClassification, agentId: string): { score: number | null; rank: number | null } {
  const scored = c.candidates.filter(x => x.score > 0);
  const i = scored.findIndex(x => x.id === agentId);
  return i < 0 ? { score: null, rank: null } : { score: scored[i]!.score, rank: i + 1 };
}

/**
 * The snapshot for a just-started run. `profiles` = the active catalog now, `parent` = the baseline version entry of the
 * agent's open trial (from the catalog history). Never throws: a classifier failure records nulls (unknown).
 */
export async function routingSnapshot(run: AgentRun, profiles: readonly AgentProfile[], runs: readonly AgentRun[],
  parent: AgentVersion | undefined, classify: Classify, now = Date.now()): Promise<AgentRunRouting> {
  const base: AgentRunRouting = { at: now, agentId: run.agentId, version: run.version, mode: null, score: null, rank: null };
  const agent = profiles.find(p => p.id === run.agentId);
  const onTrial = !!agent?.trial && agent.trial.version === run.version && run.version > 0;
  const trial = onTrial ? { baseline: agent!.trial!.baseline, parentWins: null as boolean | null } : undefined;
  const goal = run.goal.trim().slice(0, 2000);
  if (!goal) return { ...base, ...(trial ? { trial } : {}) };
  try {
    const now = await classify(goal, [...profiles], [...runs]);
    const own = place(now, run.agentId);
    Object.assign(base, { mode: now.mode, ...own });
  } catch { /* unknown */ }
  if (trial && parent && agent && parent.version === trial.baseline) {
    try {
      // the same catalog with this agent's baseline definition in place of the trial one
      const withParent = profiles.map(p => p.id === agent.id ? { ...p, ...parent.behaviour, activeVersion: parent.version } as AgentProfile : p);
      const c = await classify(goal, withParent, [...runs]);
      const top = c.candidates.find(x => x.score > 0);
      trial.parentWins = !top ? null : top.id === agent.id;
    } catch { trial.parentWins = null; }
  }
  return { ...base, ...(trial ? { trial } : {}) };
}

/** The trial evaluator's callback: true / false from the run's own snapshot for this baseline, else null (unknown, excluded). */
export function parentWins(run: AgentRun, parentVersion: number): boolean | null {
  const r = run.routing;
  if (!r || r.agentId !== run.agentId || r.version !== run.version || !r.trial || r.trial.baseline !== parentVersion) return null;
  return r.trial.parentWins;
}
