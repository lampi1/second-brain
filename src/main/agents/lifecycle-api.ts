// Validated lifecycle API facade. Renderer reads go through the existing sender-checked IPC adapter;
// feedback writes come only from the authenticated Orchestrator agent_feedback tool, never renderer-supplied run records.
import type { AgentFeedback, AgentFeedbackArgs, AgentLifecycleQuery, AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { AgentRun } from '../../shared/agents';
import type { AgentLifecycle } from './lifecycle';
import { AGENT_LIFECYCLE_PATH, parseAgentFeedbackArgs } from '../../shared/agent-lifecycle';
import type { BrainService } from '../services';
import { unknownRunError } from './runs';
import { log, errText } from '../log';

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
/** The one store's writer (AgentAuthoring.recordFeedback): reads agent/version from the run, decides the basis, persists. */
export type FeedbackWriter = (args: AgentFeedbackArgs, callerId: string) => Promise<AgentFeedback>;
export type LifecycleApi = ReturnType<typeof createLifecycleApi>;
/** unknown = the error for a runId that names no run (unknownRunError with the store and the chats; wiring.ts). */
export function createLifecycleApi(service: AgentLifecycle, runById: (id: string) => AgentRun | undefined, write?: FeedbackWriter, unknown: (id: string) => Error = id => unknownRunError(id, [])) {
  return {
    read(value: unknown): AgentLifecycleSnapshot {
      const { agentId } = lifecycleQuery(value);
      return {
        proposals: service.proposals().filter(p => !agentId || p.agentIds.includes(agentId)),
        evaluations: service.evaluations().filter(e => !agentId || e.agentId === agentId),
        feedback: agentId ? structuredClone(service.feedback.list(agentId)) : [],
        problem: service.problem ?? service.feedback.problem,
      };
    },
    /** agent_feedback's single entry point. The MCP tool authenticates its caller before calling this; the shared parser
     *  refuses any argument outside AgentFeedbackArgs (agent, version, basis…). */
    async feedback(value: unknown, callerId: string): Promise<AgentFeedback> {
      const args = parseAgentFeedbackArgs(value);
      if (!runById(args.runId)) throw unknown(args.runId);
      if (!write) throw Error('Feedback store unavailable.');
      const record = await write(args, callerId);
      // the record is stored: a lifecycle problem (unreadable queue) only costs the gap proposal, never the feedback
      try { service.onFeedback(record); } catch (e) { log.warn('agents', 'feedback gap proposal not recorded', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
      return record;
    },
  };
}
