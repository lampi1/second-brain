// Validated lifecycle API facade. Renderer reads go through the existing sender-checked brain:api IPC (GET only); the
// user's decisions on the "Da approvare" queue come only from the sender-checked agents:lifecycleDecide IPC (index.ts);
// feedback writes come only from a parent on its own children's runs (agent_child_feedback on the chat's own token
// endpoint) and from the app's Judge reviews (brainmodel/jobs.ts judge-sample), never renderer-supplied run records.
import type { AgentFeedback, AgentFeedbackArgs, AgentLifecycleDecide, AgentLifecycleQuery, AgentLifecycleSnapshot } from '../../shared/agent-lifecycle';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { ModelTier } from '../../shared/roles';
import type { AgentLifecycle } from './lifecycle';
import { AGENT_LIFECYCLE_PATH, parseAgentFeedbackArgs } from '../../shared/agent-lifecycle';
import type { BrainService } from '../services';
import { unknownRunError } from './runs';
import { log, errText } from '../log';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Richiesta «Da approvare» non valida');
  return value as Record<string, unknown>;
};
export function lifecycleQuery(value: unknown): AgentLifecycleQuery {
  const q = object(value);
  if (Object.keys(q).some(k => k !== 'agentId') || q.agentId !== undefined && (typeof q.agentId !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(q.agentId))) throw Error('Ruolo non valido');
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
/** The one store's writer (RunFeedback.recordFeedback): reads role/version from the run, decides the basis, persists. */
export type FeedbackWriter = (args: AgentFeedbackArgs, callerId: string) => Promise<AgentFeedback>;
export type LifecycleApi = ReturnType<typeof createLifecycleApi>;
/** What approving a queue entry does; each one is a catalog write the user's click authorises (lifecycle.ts header). */
export interface LifecycleActions {
  resolveTrial(agentId: string, decision: 'keep' | 'rollback'): unknown;
  /** a trial version of the role on `tier` (catalog.approveTrial) */
  tierTrial(agentId: string, tier: ModelTier, reason: string): unknown;
}
export interface LifecycleApiOptions {
  /** the roles now: stale entries are hidden and refused */
  agents?: () => AgentProfile[];
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
    try { o.afterFeedback?.(record); } catch (e) { log.warn('agents', 'trial not evaluated after feedback', { cause: errText(e), hint: 'the next run end or the daily pass evaluates it again' }); }
    return record;
  };
  // keys whose approval is still running: a second click or a second window must not apply the same entry twice
  const deciding = new Set<string>();
  const api = {
    read(value: unknown): AgentLifecycleSnapshot {
      const { agentId } = lifecycleQuery(value);
      const agents = o.agents?.();
      return {
        proposals: service.proposals().filter(p => (!agentId || p.agentIds.includes(agentId)) && (!agents || service.stillValid(p, agents))),
        evaluations: service.evaluations().filter(e => !agentId || e.agentId === agentId),
        feedback: agentId ? structuredClone(service.feedback.list(agentId)) : [],
        problem: service.problem ?? service.feedback.problem,
      };
    },
    /** The app's own feedback entry point (a Judge's review, brainmodel/jobs.ts): the shared parser refuses any argument
     *  outside AgentFeedbackArgs (role, version, basis…). */
    async feedback(value: unknown, callerId: string): Promise<AgentFeedback> {
      const args = parseAgentFeedbackArgs(value);
      if (!runById(args.runId)) throw unknown(args.runId);
      return stored(args, callerId);
    },
    /** A parent's opinion of a run it delegated: only a run whose parentRunId is a run of the caller's own chat, never its
     *  own run nor a sibling's. callerChatId comes from the chat's token endpoint. The record is an opinion (basis
     *  orchestrator-opinion unless a verified Judge review backs it). */
    async childFeedback(value: unknown, callerChatId: string): Promise<AgentFeedback> {
      const args = parseAgentFeedbackArgs(value);
      if (args.sendToRun) throw Error('sendToRun is not available here: write to the child with send_to_chat.');
      const child = runById(args.runId);
      if (!child) throw unknown(args.runId);
      const parent = child.parentRunId ? runById(child.parentRunId) : undefined;
      if (!parent || parent.chatId !== callerChatId || child.chatId === callerChatId) throw Error('Feedback only on the runs of your own children (agent_children lists them).');
      return stored(args, callerChatId);
    },
    /** The runs whose parent is a run of this chat (newest first): what agent_children shows the parent. */
    children(callerChatId: string, all: readonly AgentRun[]) {
      const mine = new Set(all.filter(r => r.chatId === callerChatId).map(r => r.runId));
      return all.filter(r => !!r.parentRunId && mine.has(r.parentRunId) && r.chatId !== callerChatId)
        .sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
        .map(r => ({ runId: r.runId, chatId: r.chatId, agentId: r.agentId, version: r.version, goal: r.goal.slice(0, 300), parentRunId: r.parentRunId!,
          state: r.endedAt === undefined ? 'open' : 'ended', endReason: r.endReason ?? null, outcome: r.outcome ? { verdict: r.outcome.verdict, basis: r.outcome.basis } : null,
          costUsd: r.costUsd, questions: r.counters.questions }));
    },
    /** The user's decision on one queue entry (agents:lifecycleDecide only). Returns the queue as it is after it. */
    async decide(value: unknown): Promise<AgentLifecycleSnapshot> {
      const { key, decision } = lifecycleDecideArgs(value);
      if (deciding.has(key)) throw Error('Decisione già in corso su questa proposta.');
      deciding.add(key);
      try { return await decideOne(key, decision); } finally { deciding.delete(key); }
    },
  };
  async function decideOne(key: string, decision: AgentLifecycleDecide['decision']): Promise<AgentLifecycleSnapshot> {
    const p = service.proposal(key);
    if (!p) throw Error('Proposta non trovata: forse è già stata decisa.');
    const agents = o.agents?.();
    if (agents && !service.stillValid(p, agents)) { service.reconcile(agents); throw Error('La proposta non vale più: il ruolo è cambiato.'); }
    if (decision === 'dismiss') { service.settle(key, true); return api.read({}); }
    const a = o.actions;
    if (!a) throw Error('Decisioni non disponibili.');
    const id = p.agentIds[0];
    if (key.startsWith('trial:') && (p.kind === 'keep' || p.kind === 'revert')) a.resolveTrial(id!, p.kind === 'keep' ? 'keep' : 'rollback');
    else if (p.kind === 'tier') {
      if (!id || !p.tier) throw Error('Proposta di livello incompleta.');
      a.tierTrial(id, p.tier, p.reason);
    } else throw Error('Proposta non applicabile.');
    service.settle(key, false);
    log.info('agents', 'lifecycle proposal approved by the user', { data: { key, kind: p.kind } });
    return api.read({});
  }
  return api;
}
