// The agents' improvement loop, assembled once for wiring.ts (and the unit tests): run start → routing snapshot; run end →
// the Orchestrator feedback queue and the trial evaluation; the user's verdict or a stored feedback → evaluation again;
// the probation verdict → a proposal; the heartbeat → the gated feedback wake and the daily local suggestions. Every
// change of a definition, a version, a trial or a probation happens only in LifecycleActions, which only the user's
// agents:lifecycleDecide click reaches (lifecycle-api.ts decide). The owner (2026-10-18): "l'automiglioramento e
// correzione degli agenti in base al costo, tempo, come sono andati, sempre sotto approvazione".
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { ChatSummary, Harness } from '../../shared/contract';
import type { AgentCatalogService } from './catalog';
import type { AgentRunStore } from './runs';
import type { AgentAuthoring } from './authoring';
import type { AgentPackLearning } from './pack/learning';
import type { ProbationJudgement } from './probation';
import { AgentLifecycle, type WakePolicy } from './lifecycle';
import { createLifecycleApi } from './lifecycle-api';
import { lifecycleInput } from './lifecycle-input';
import { parentWins, routingSnapshot, type Classify } from './routing-snapshot';
import { draftRequestMessage, FEEDBACK_QUIET_MS, feedbackGate, feedbackMessage } from './feedback-wake';
import { unknownRunError } from './runs';
import { log, errText } from '../log';

export interface AgentLoopDeps {
  userData: string;
  catalog: Pick<AgentCatalogService, 'list' | 'history' | 'resolveTrial' | 'keep' | 'retire' | 'approveTrial'>;
  runs: AgentRunStore;
  authoring: Pick<AgentAuthoring, 'feedbackOf' | 'storeProblem' | 'recordFeedback' | 'proposals'>;
  learning?: Pick<AgentPackLearning, 'pending'>;
  classify: Classify;
  chats: { list(): ChatSummary[]; send(chatId: string, text: string, images?: undefined, resumed?: boolean, from?: string, liveOnly?: boolean): Promise<void> };
  engineOn(h: Harness): boolean;
  /** a question, permission or command waits for the user somewhere in the app */
  userWaiting(): boolean;
  /** the automatic feedback wake may run at all (the setting regiaEvents, off in test suites) */
  wakeEnabled(): boolean;
  /** nothing works now: the daily pass may read the evidence */
  idle(): boolean;
  emitChanged?(): void;
  wakePolicy?: Partial<WakePolicy>;
  now?(): number;
}

export function createAgentLoop(d: AgentLoopDeps) {
  const now = () => d.now?.() ?? Date.now();
  const everyAgent = (): AgentProfile[] => { const all = d.catalog.list(); return [...all.profiles, ...all.archived]; };
  let snapshot: { agents: AgentProfile[]; judged: Map<string, Set<string>> } | null = null;
  const pass = () => { if (!snapshot) { snapshot = { agents: everyAgent(), judged: new Map() }; queueMicrotask(() => { snapshot = null; }); } return snapshot; };
  let failedAt = -Infinity;
  const lifecycle = new AgentLifecycle({ userData: d.userData, ...(d.now ? { now: d.now } : {}), ...(d.wakePolicy ? { wakePolicy: d.wakePolicy } : {}),
    feedback: { list: id => d.authoring.feedbackOf(id), get problem() { return d.authoring.storeProblem; } },
    changed: () => d.emitChanged?.(),
    // the human verdict and a verified review need no opinion; nor does a run that already has one, or a hidden agent's
    // (the queue is pruned in one synchronous pass: one catalog and feedback read per pass, not one per queued run)
    needsFeedback: id => {
      const r = d.runs.get(id), s = pass(), agent = r && s.agents.find(a => a.id === r.agentId);
      if (!r || !agent || agent.routable === false || r.outcome?.basis === 'human' || r.outcome?.basis === 'reviewed-evidence') return false;
      let judged = s.judged.get(r.agentId);
      if (!judged) s.judged.set(r.agentId, judged = new Set(d.authoring.feedbackOf(r.agentId).map(f => f.runId)));
      return !judged.has(id);
    },
    wake: async runIds => {
      if (!d.wakeEnabled()) return false;
      // a delivery that failed waits as long as a busy Orchestrator would, never one try per heartbeat
      if (now() - failedAt < FEEDBACK_QUIET_MS) return false;
      const gate = feedbackGate(d.chats.list(), now(), d.engineOn, d.userWaiting());
      if ('refused' in gate) { log.debug('agents', 'feedback wake held', { data: { reason: gate.refused, runs: runIds.length } }); return false; }
      const runs = runIds.map(id => d.runs.get(id)).filter((r): r is AgentRun => !!r);
      if (!runs.length) return true;
      // liveOnly: never reopens a closed Orchestrator nor one that is not idle (an idle one whose engine was released resumes)
      try { await d.chats.send(gate.chat.id, feedbackMessage(runs, everyAgent()), undefined, false, undefined, true); return true; }
      catch (e) { failedAt = now(); log.warn('agents', 'feedback wake not delivered', { cause: errText(e), hint: 'the runs stay queued; the next heartbeat tries again within the daily cap' }); return false; }
    } });
  const evaluate = (agentId?: string): void => {
    try {
      const all = everyAgent(), runs = d.runs.list();
      if (agentId === undefined) { lifecycle.evaluateAll(all, runs, parentWins); return; }
      for (const a of all) if (a.id === agentId && a.status === 'active' && a.trial) lifecycle.evaluate(a, runs, parentWins);
      lifecycle.reconcile(all);
    } catch (e) { log.warn('agents', 'trial evaluation failed', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable; the next run end tries again' }); }
  };
  const orchestrator = () => d.chats.list().find(c => c.isRegia && c.orchestrator && !c.closedAt);
  const api = createLifecycleApi(lifecycle, id => d.runs.get(id), (args, caller) => d.authoring.recordFeedback(args, caller),
    id => unknownRunError(id, d.runs.list(), cid => d.chats.list().find(c => c.id === cid)), {
      agents: everyAgent,
      learned: () => d.learning?.pending() ?? [],
      drafts: () => { try { return d.authoring.proposals(); } catch { return []; } },
      afterFeedback: record => evaluate(record.agentId),
      actions: {
        resolveTrial: (id, decision) => d.catalog.resolveTrial(id, decision),
        keep: id => d.catalog.keep(id, 'brother'),
        retire: (id, reason) => d.catalog.retire(id, reason.slice(0, 600), 'brother'),
        modelTrial: (id, model, reason) => {
          const p = d.catalog.list().profiles.find(x => x.id === id);
          if (!p) throw new Error('Agente non trovato.');
          return d.catalog.approveTrial(id, { ...p, model }, reason);
        },
        // the user asked for a concrete draft: one message to the Orchestrator (it may resume it: the user's own click)
        requestDraft: async p => {
          const o = orchestrator();
          if (!o) throw new Error('Nessun Orchestrator aperto: aprilo e riprova; la proposta resta in «Da approvare».');
          if (!d.engineOn(o.harness)) throw new Error('Il motore dell’Orchestrator è spento nelle Impostazioni.');
          await d.chats.send(o.id, draftRequestMessage(p, everyAgent()));
        },
      },
    });
  const hooks = {
    started(run: AgentRun): Promise<void> {
      const all = d.catalog.list(), agent = all.profiles.find(p => p.id === run.agentId);
      const parent = agent?.trial ? d.catalog.history(agent.id).find(v => v.version === agent.trial!.baseline) : undefined;
      return routingSnapshot(run, all.profiles, d.runs.list(), parent, d.classify, now())
        .then(snapshot => { if (d.runs.setRouting(run.runId, snapshot)) d.runs.flush(); })
        .catch(e => log.warn('agents', 'run routing not recorded', { cause: errText(e), data: { runId: run.runId }, hint: 'this run counts as unknown routing in its trial evaluation' }));
    },
    ended(run: AgentRun): void {
      try { lifecycle.onRunEnded(run); } catch (e) { log.warn('agents', 'run end not queued for feedback', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
      evaluate(run.agentId);
    },
    outcome(run: AgentRun): void { evaluate(run.agentId); },
    probation(agent: AgentProfile, j: ProbationJudgement): void {
      try { lifecycle.onProbation(agent, j); } catch (e) { log.warn('agents', 'probation verdict not queued', { cause: errText(e), hint: 'the next run end or the daily pass judges it again' }); }
    },
  };
  /** The heartbeat (wiring.ts: every 10 s): the gated wake, then the daily pass (with every trial evaluated once more). */
  async function tick(): Promise<void> {
    try { await lifecycle.flushWake(); } catch (e) { log.warn('agents', 'feedback wake failed', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
    try {
      const ran = lifecycle.daily(d.idle(), () => lifecycleInput(everyAgent(), d.runs.list(), d.chats.list(), (id, v) => d.catalog.history(id).find(x => x.version === v)));
      if (ran) evaluate();
    } catch (e) { log.warn('agents', 'daily agent suggestions failed', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
  }
  return { lifecycle, api, hooks, tick, evaluate };
}
export type AgentLoop = ReturnType<typeof createAgentLoop>;
