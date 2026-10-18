// Probation of agents created on the fly for a task (AGENTS-DESIGN §4.7): the keep/retire evaluator and the helpers the
// Orchestrator side (A7) uses for its caps. Pure: ChatManager applies the decisions through the catalog.
import { inProbation, type AgentCatalog, type AgentProfile, type AgentRun } from '../../shared/agents';
import { REWORK_MS } from './run-metrics';

export const PROBATION_CAP = 10;
/** idle time that retires a probation agent, and how long a retired one blocks re-creation */
export const PROBATION_IDLE_MS = 14 * 86_400_000;
export const RETIRED_BLOCK_MS = 14 * 86_400_000;
/** ended runs with no qualifying outcome that retire it */
export const UNKNOWN_RUNS_MAX = 3;

export type ProbationDecision = 'keep' | 'retire' | 'wait';
export interface ProbationJudgement { decision: ProbationDecision; reason: string }

const qualifying = (r: AgentRun): boolean => r.outcome !== undefined && r.outcome.verdict !== 'unknown' && (r.outcome.basis === 'human' || r.outcome.basis === 'reviewed-evidence');
const correctionsOf = (r: AgentRun): number => r.corrections ? r.corrections.tagged + r.corrections.afterReport : 0;

/**
 * Judges a probation agent on its runs since the probation began (`runs` = every known run: reworks point across agents).
 * Retire first (a failure, a rework, more than one correction per run), then keep (a success on Brother's or reviewed
 * evidence, with corrections counted on it), then the slow retirements (3 runs with no such outcome, 14 days idle).
 * Self-reported and Orchestrator-opinion outcomes never keep. Anything else waits.
 */
export function judge(agent: AgentProfile, runs: readonly AgentRun[], now: number): ProbationJudgement {
  if (!inProbation(agent) || agent.status !== 'active') return { decision: 'wait', reason: 'Non in prova' };
  const since = agent.probation!.since;
  const own = runs.filter(r => r.agentId === agent.id && r.startedAt >= since);
  const ended = own.filter(r => r.endedAt !== undefined && r.endedAt >= since);
  const fail = ended.find(r => qualifying(r) && r.outcome!.verdict === 'fail');
  if (fail) return { decision: 'retire', reason: `Esito negativo confermato (${fail.runId})` };
  // a reopened run is open again: Brother's reopen counts on any run of the probation
  const reopened = own.find(r => r.counters.reopened > 0);
  if (reopened) return { decision: 'retire', reason: `Lavoro riaperto da Brother (${reopened.runId})` };
  const reworked = ended.find(r => runs.some(x => (x.reworkOf === r.runId || x.continuedFrom === r.runId) && x.startedAt >= r.endedAt! && x.startedAt <= r.endedAt! + REWORK_MS));
  if (reworked) return { decision: 'retire', reason: `Lavoro rifatto entro 7 giorni (${reworked.runId})` };
  // a run recorded without corrections counts as 0 here, but never keeps the agent on its own (below)
  if (ended.length && ended.reduce((n, r) => n + correctionsOf(r), 0) / ended.length > 1) return { decision: 'retire', reason: 'Più di una correzione per esecuzione' };
  const success = ended.find(r => qualifying(r) && r.outcome!.verdict === 'success' && r.corrections !== undefined);
  if (success) return { decision: 'keep', reason: `Esito positivo confermato (${success.runId})` };
  if (ended.filter(r => !qualifying(r)).length >= UNKNOWN_RUNS_MAX) return { decision: 'retire', reason: `${UNKNOWN_RUNS_MAX} esecuzioni senza un esito confermato` };
  const last = Math.max(since, ...ended.map(r => r.endedAt!));
  if (!own.some(r => r.endedAt === undefined) && now - last >= PROBATION_IDLE_MS) return { decision: 'retire', reason: 'Nessuna esecuzione da 14 giorni' };
  return { decision: 'wait', reason: 'In attesa di un esito' };
}
export const decide = (agent: AgentProfile, runs: readonly AgentRun[], now: number): ProbationDecision => judge(agent, runs, now).decision;

/** At most PROBATION_CAP active agents in probation at once: over it the task runs on an existing agent or Generale. */
export function probationCapReached(catalog: Pick<AgentCatalog, 'profiles'>): boolean {
  return catalog.profiles.filter(p => p.status === 'active' && inProbation(p)).length >= PROBATION_CAP;
}
/** Probation agents retired in the last 14 days: not recreated for the same kind of task (the Orchestrator files a suggestion). */
export function recentlyRetired(catalog: Pick<AgentCatalog, 'archived'>, now: number): AgentProfile[] {
  return catalog.archived.filter(p => p.status === 'archived' && inProbation(p) && p.archivedAt !== undefined && now - p.archivedAt < RETIRED_BLOCK_MS);
}
