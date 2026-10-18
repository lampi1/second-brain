// Validated lifecycle API facade. Renderer reads go through the existing sender-checked brain:api IPC (GET only); the
// user's decisions on the "Da approvare" queue come only from the sender-checked agents:lifecycleDecide IPC (index.ts);
// feedback writes come only from the authenticated Orchestrator agent_feedback tool, or from a parent agent on its own
// child runs (agent_child_feedback on the chat's own token endpoint), never renderer-supplied run records.
import type { AgentFeedback, AgentFeedbackArgs, AgentLifecycleDecide, AgentLifecycleProposal, AgentLifecycleQuery, AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { AgentProposal } from '../../shared/agent-authoring';
import type { LearnedRuleProposal } from '../../shared/agent-pack';
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
/** What approving a queue entry does; each one is a catalog write the user's click authorises (lifecycle.ts header). */
export interface LifecycleActions {
  resolveTrial(agentId: string, decision: 'keep' | 'rollback'): unknown;
  keep(agentId: string): unknown;
  retire(agentId: string, reason: string): unknown;
  /** a trial version of the agent on `model` (catalog.approveTrial) */
  modelTrial(agentId: string, model: string, reason: string): unknown;
  /** asks the Orchestrator for a concrete draft (update/create/merge/split); throws when none can take it now */
  requestDraft(proposal: AgentLifecycleProposal): Promise<void>;
}
export interface LifecycleApiOptions {
  /** the catalog now (active and archived): stale trial/probation entries are hidden and refused */
  agents?: () => AgentProfile[];
  learned?: () => LearnedRuleProposal[];
  drafts?: () => AgentProposal[];
  actions?: LifecycleActions;
  /** a feedback record was stored (the trial of its agent is evaluated again) */
  afterFeedback?: (record: AgentFeedback) => void;
}
export function lifecycleDecideArgs(value: unknown): AgentLifecycleDecide {
  const a = object(value);
  if (Object.keys(a).some(k => k !== 'key' && k !== 'decision') || typeof a.key !== 'string' || !a.key || a.key.length > 400 || (a.decision !== 'approve' && a.decision !== 'dismiss')) throw Error('Decisione non valida');
  return { key: a.key, decision: a.decision };
}
/** unknown = the error for a runId that names no run (unknownRunError with the store and the chats; wiring.ts). */
export function createLifecycleApi(service: AgentLifecycle, runById: (id: string) => AgentRun | undefined, write?: FeedbackWriter, unknown: (id: string) => Error = id => unknownRunError(id, []), o: LifecycleApiOptions = {}) {
  const stored = async (args: AgentFeedbackArgs, callerId: string): Promise<AgentFeedback> => {
    if (!write) throw Error('Feedback store unavailable.');
    const record = await write(args, callerId);
    // the record is stored: a lifecycle problem (unreadable queue) only costs the gap proposal, never the feedback
    try { service.onFeedback(record); } catch (e) { log.warn('agents', 'feedback gap proposal not recorded', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
    try { o.afterFeedback?.(record); } catch (e) { log.warn('agents', 'trial not evaluated after feedback', { cause: errText(e), hint: 'the next run end or the daily pass evaluates it again' }); }
    return record;
  };
  const api = {
    read(value: unknown): AgentLifecycleSnapshot {
      const { agentId } = lifecycleQuery(value);
      const agents = o.agents?.();
      return {
        proposals: service.proposals().filter(p => (!agentId || p.agentIds.includes(agentId)) && (!agents || service.stillValid(p, agents))),
        evaluations: service.evaluations().filter(e => !agentId || e.agentId === agentId),
        feedback: agentId ? structuredClone(service.feedback.list(agentId)) : [],
        problem: service.problem ?? service.feedback.problem,
        learned: (o.learned?.() ?? []).filter(p => p.status === 'pending' && (!agentId || p.agentId === agentId)),
        drafts: (o.drafts?.() ?? []).filter(p => p.state === 'pending' && (!agentId || p.agentId === agentId)),
      };
    },
    /** agent_feedback's single entry point. The MCP tool authenticates its caller before calling this; the shared parser
     *  refuses any argument outside AgentFeedbackArgs (agent, version, basis…). */
    async feedback(value: unknown, callerId: string): Promise<AgentFeedback> {
      const args = parseAgentFeedbackArgs(value);
      if (!runById(args.runId)) throw unknown(args.runId);
      return stored(args, callerId);
    },
    /** A parent agent's opinion of a sub-agent run it asked for: only a run whose parentRunId (or spawnedBy) is a run of
     *  the caller's own chat, never its own run nor a sibling's. callerChatId comes from the chat's token endpoint. The
     *  record is the same opinion as the Orchestrator's (basis orchestrator-opinion unless a verified review backs it). */
    async childFeedback(value: unknown, callerChatId: string): Promise<AgentFeedback> {
      const args = parseAgentFeedbackArgs(value);
      if (args.sendToRun) throw Error('sendToRun is not available here: write to the sub-agent with send_to_chat.');
      const child = runById(args.runId);
      if (!child) throw unknown(args.runId);
      const parentId = child.spawnedBy ?? child.parentRunId, parent = parentId ? runById(parentId) : undefined;
      if (!parent || parent.chatId !== callerChatId || child.chatId === callerChatId) throw Error('Feedback only on the runs of your own sub-agents (agent_children lists them).');
      return stored(args, callerChatId);
    },
    /** The sub-agent runs whose parent is a run of this chat (newest first): what agent_children shows the parent. */
    children(callerChatId: string, all: readonly AgentRun[]) {
      const mine = new Set(all.filter(r => r.chatId === callerChatId).map(r => r.runId));
      return all.filter(r => { const p = r.spawnedBy ?? r.parentRunId; return !!p && mine.has(p) && r.chatId !== callerChatId; })
        .sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
        .map(r => ({ runId: r.runId, chatId: r.chatId, agentId: r.agentId, version: r.version, goal: r.goal.slice(0, 300), parentRunId: (r.spawnedBy ?? r.parentRunId)!,
          state: r.endedAt === undefined ? 'open' : 'ended', endReason: r.endReason ?? null, outcome: r.outcome ? { verdict: r.outcome.verdict, basis: r.outcome.basis } : null,
          costUsd: r.costUsd, questions: r.counters.questions }));
    },
    /** The user's decision on one queue entry (agents:lifecycleDecide only). Returns the queue as it is after it. */
    async decide(value: unknown): Promise<AgentLifecycleSnapshot> {
      const { key, decision } = lifecycleDecideArgs(value);
      const p = service.proposal(key);
      if (!p) throw Error('Proposta non trovata: forse è già stata decisa.');
      const agents = o.agents?.();
      if (agents && !service.stillValid(p, agents)) { service.reconcile(agents); throw Error('La proposta non vale più: l’Agente è cambiato.'); }
      if (decision === 'dismiss') { service.settle(key, true); return api.read({}); }
      const a = o.actions;
      if (!a) throw Error('Decisioni non disponibili.');
      const id = p.agentIds[0];
      if (key.startsWith('trial:') && (p.kind === 'keep' || p.kind === 'revert')) a.resolveTrial(id!, p.kind === 'keep' ? 'keep' : 'rollback');
      else if (key.startsWith('probation:') && p.kind === 'keep') a.keep(id!);
      else if (key.startsWith('probation:') && p.kind === 'retire') a.retire(id!, p.reason);
      else if (p.kind === 'model-trial') {
        if (!id || !p.model) throw Error('Proposta di modello incompleta.');
        a.modelTrial(id, p.model, p.reason);
      } else if (['update', 'create', 'merge', 'split'].includes(p.kind)) await a.requestDraft(p);
      else throw Error('Proposta non applicabile.');
      service.settle(key, false);
      log.info('agents', 'lifecycle proposal approved by the user', { data: { key, kind: p.kind } });
      return api.read({});
    },
  };
  return api;
}
