// The roles' improvement loop (ADR 0083: the app owns it; the Orchestrator only sees status), assembled once for
// wiring.ts and the unit tests: a run's end, the user's verdict or a stored review → the role's trial evaluated again;
// the heartbeat → the daily local tier rule (new entries are announced in the feed, `proposed`, ADR 0102). Every change of a version, a trial or a tier happens only in
// LifecycleActions, which only the user's agents:lifecycleDecide click reaches (lifecycle-api.ts decide). Role text and
// skills change elsewhere, at once with an Annulla (the maintenance jobs, brainmodel/jobs.ts).
import type { AgentProfile } from '../../shared/agents';
import type { ChatSummary } from '../../shared/contract';
import type { AgentLifecycleProposal } from '../../shared/agent-lifecycle';
import { tierRank } from '../../shared/roles';
import type { AgentCatalogService } from './catalog';
import type { AgentRunStore } from './runs';
import type { RunFeedback } from './run-feedback';
import { AgentLifecycle } from './lifecycle';
import { createLifecycleApi } from './lifecycle-api';
import { unknownRunError } from './runs';
import { log, errText } from '../log';

export interface AgentLoopDeps {
  userData: string;
  catalog: Pick<AgentCatalogService, 'list' | 'resolveTrial' | 'approveTrial'>;
  runs: AgentRunStore;
  feedback: Pick<RunFeedback, 'feedbackOf' | 'storeProblem' | 'recordFeedback'>;
  chats: { list(): ChatSummary[] };
  /** nothing works now: the daily pass may read the evidence */
  idle(): boolean;
  emitChanged?(): void;
  /** the heartbeat's pass added entries to "Da approvare" (the daily tier rule, a trial's keep/revert advice): the feed's
   *  "Proposta su un ruolo" (wiring.ts → brain/announce.ts, ADR 0102) */
  proposed?(added: AgentLifecycleProposal[]): void;
  now?(): number;
}

export function createAgentLoop(d: AgentLoopDeps) {
  const roles = (): AgentProfile[] => d.catalog.list().profiles.filter(p => p.scope === 'role');
  const lifecycle = new AgentLifecycle({ userData: d.userData, ...(d.now ? { now: d.now } : {}),
    feedback: { list: id => d.feedback.feedbackOf(id), get problem() { return d.feedback.storeProblem; } },
    changed: () => d.emitChanged?.() });
  const evaluate = (agentId?: string): void => {
    try {
      const all = roles(), runs = d.runs.list();
      if (agentId === undefined) { lifecycle.evaluateAll(all, runs); return; }
      for (const a of all) if (a.id === agentId && a.trial) lifecycle.evaluate(a, runs);
      lifecycle.reconcile(all);
    } catch (e) { log.warn('agents', 'trial evaluation failed', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable; the next run end tries again' }); }
  };
  const api = createLifecycleApi(lifecycle, id => d.runs.get(id), (args, caller) => d.feedback.recordFeedback(args, caller),
    id => unknownRunError(id, d.runs.list(), cid => d.chats.list().find(c => c.id === cid)), {
      agents: roles,
      afterFeedback: record => evaluate(record.agentId),
      actions: {
        resolveTrial: (id, decision) => d.catalog.resolveTrial(id, decision),
        tierTrial: (id, tier, reason) => {
          const p = roles().find(x => x.id === id);
          if (!p) throw new Error('Ruolo non trovato.');
          return d.catalog.approveTrial(id, { ...p, tier, tierMax: tierRank(tier) > tierRank(p.tierMax) ? tier : p.tierMax }, reason);
        },
      },
    });
  const hooks = {
    ended(run: { agentId: string }): void { evaluate(run.agentId); },
    outcome(run: { agentId: string }): void { evaluate(run.agentId); },
  };
  /** The heartbeat (wiring.ts: every 10 s): the daily pass, then every trial evaluated once more. */
  function tick(): void {
    try {
      const before = new Set(lifecycle.proposals().map(p => p.key));
      if (lifecycle.daily(d.idle(), () => ({ roles: roles(), runs: d.runs.list() }))) {
        evaluate();
        const added = lifecycle.proposals().filter(p => !before.has(p.key));
        if (added.length) d.proposed?.(added);
      }
    } catch (e) { log.warn('agents', 'daily role suggestions failed', { cause: errText(e), hint: 'check that agent-lifecycle.json in the app data folder is readable and writable' }); }
  }
  return { lifecycle, api, hooks, tick, evaluate };
}
