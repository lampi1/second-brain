// Lifecycle read client over the existing sender-checked, read-only brain API bridge.
import { AGENT_LIFECYCLE_PATH, type AgentLifecycleClient, type AgentLifecycleSnapshot } from '@shared/agent-lifecycle';
import { sb } from '../sb';

export const lifecycleClient: AgentLifecycleClient = {
  async read(query) {
    const path = AGENT_LIFECYCLE_PATH + (query.agentId ? `?agentId=${encodeURIComponent(query.agentId)}` : '');
    const result = await sb.invoke('brain:api', { path });
    if (!result.ok) throw Error(result.error);
    const data = result.data as AgentLifecycleSnapshot | null;
    if (!data || !Array.isArray(data.proposals) || !Array.isArray(data.feedback) || !Array.isArray(data.evaluations)
      || !(data.problem === null || typeof data.problem === 'string')) throw Error('Risposta ciclo Agenti non valida');
    return data;
  },
};
