// Validated lifecycle API facade. Renderer reads go through the existing sender-checked IPC adapter;
// feedback writes are for the authenticated Orchestrator MCP owner, never renderer-supplied run records.
import type { AgentLifecycleQuery, AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { AgentRun } from '../../shared/agents';
import type { FeedbackInput } from './feedback';
import type { AgentLifecycle } from './lifecycle';
import { AGENT_LIFECYCLE_PATH } from '../../shared/agent-lifecycle';
import type { BrainService } from '../services';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Richiesta ciclo Agenti non valida');
  return value as Record<string, unknown>;
};
export function lifecycleQuery(value: unknown): AgentLifecycleQuery {
  const q = object(value);
  if (Object.keys(q).some(k => k !== 'agentId') || q.agentId !== undefined && (typeof q.agentId !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(q.agentId))) throw Error('Agente non valido');
  return q.agentId === undefined ? {} : { agentId: q.agentId as string };
}
/** Main-owned read endpoint; the existing brain:api IPC enforces renderer sender checks and GET-only access. */
export function mountLifecycleApi(brain: Pick<BrainService, 'serveApi'>, api: ReturnType<typeof createLifecycleApi>): void {
  brain.serveApi(AGENT_LIFECYCLE_PATH, query => {
    const keys = [...query.keys()];
    if (keys.some(k => k !== 'agentId') || query.getAll('agentId').length > 1) throw Error('Parametri non validi');
    return api.read(query.has('agentId') ? { agentId: query.get('agentId') } : {});
  });
}
export function createLifecycleApi(service: AgentLifecycle, runById: (id: string) => AgentRun | undefined) {
  return {
    read(value: unknown): AgentLifecycleSnapshot {
      const { agentId } = lifecycleQuery(value);
      return {
        proposals: service.proposals().filter(p => !agentId || p.agentIds.includes(agentId)),
        evaluations: service.evaluations().filter(e => !agentId || e.agentId === agentId),
        feedback: agentId ? service.feedback.list(agentId) : [],
        problem: service.problem ?? service.feedback.problem,
      };
    },
    /** The MCP adapter must authorize its caller before invoking this method. Unknown/elevated fields are refused. */
    feedback(value: unknown): void {
      const q = object(value);
      const allowed = ['runId', 'verdict', 'worked', 'failed', 'gap', 'gapKey', 'evidence'];
      if (Object.keys(q).some(k => !allowed.includes(k)) || typeof q.runId !== 'string' || !/^r_[a-f0-9]{12}$/.test(q.runId)) throw Error('Feedback non valido');
      const run = runById(q.runId);
      if (!run) throw Error('Esecuzione non trovata');
      // Store validates every feedback field and supplies agent/version/basis from the authoritative run.
      service.recordFeedback(run, { verdict: q.verdict, worked: q.worked, failed: q.failed, gap: q.gap, gapKey: q.gapKey, evidence: q.evidence } as FeedbackInput);
    },
  };
}
