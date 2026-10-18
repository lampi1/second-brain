// Read-only daily evidence adapter for durable runs, current chat metadata and immutable version snapshots.
// Unknown areas/models are omitted. Free-form notes are not promoted to verified outcomes or error categories.
import type { AgentProfile, AgentRun, AgentVersion } from '../../shared/agents';
import type { ChatSummary } from '../../shared/contract';
import { GENERAL_AGENT_ID } from '../../shared/agents';
import { classify } from '../brain/estimates';
import type { ModelCohort, SuggestionInput, WorkEvidence } from './suggestions';

export function lifecycleInput(agents: readonly AgentProfile[], runs: readonly AgentRun[], chats: readonly ChatSummary[],
  version: (agentId: string, version: number) => AgentVersion | undefined): SuggestionInput {
  const work: WorkEvidence[] = [], groups = new Map<string, { descriptor: ModelCohort; runs: AgentRun[] }>();
  const retired = new Set<string>();
  for (const run of runs) {
    if (run.version < 1 || run.endedAt === undefined || run.source === 'oneshot') continue;
    const area = run.tags?.app ?? run.tags?.repo;
    if (!area) continue;
    const chat = chats.find(c => c.id === run.chatId);
    const kind = classify(run.goal || chat?.title || '');
    const ref = { kind: 'run' as const, ref: run.runId, at: run.endedAt };
    if (run.agentId === GENERAL_AGENT_ID) work.push({ source: 'general', kind, area, at: run.endedAt, ref });
    const agent = agents.find(a => a.id === run.agentId);
    if (agent?.status === 'archived' && agent.probation && !agent.probation.keptBy && agent.archivedAt !== undefined) {
      const key = `${agent.id}/${area}`;
      if (!retired.has(key)) { retired.add(key); work.push({ source: 'retired', kind: 'retired-role', area, at: agent.archivedAt, ref }); }
    }
    const snapshot = version(run.agentId, run.version);
    const model = snapshot?.behaviour.model;
    if (!snapshot || !model) continue;
    const cohort = JSON.stringify([snapshot.behaviour.engine, kind, area, [...(run.tags?.skills ?? [])].sort()]);
    const key = JSON.stringify([run.agentId, cohort, model]);
    let group = groups.get(key);
    if (!group) {
      group = { descriptor: { agentId: run.agentId, cohort, model, success: 0, known: 0, ended: 0, costPerSuccess: null, evidence: [] }, runs: [] };
      groups.set(key, group);
    }
    group.runs.push(run);
  }
  for (const { descriptor, runs: group } of groups.values()) {
    const known = group.filter(r => r.outcome && ['human', 'reviewed-evidence'].includes(r.outcome.basis) && r.outcome.verdict !== 'unknown');
    const successes = known.reduce((n, r) => n + (r.outcome!.verdict === 'success' ? 1 : r.outcome!.verdict === 'partial' ? 0.5 : 0), 0);
    descriptor.ended = group.length; descriptor.known = known.length;
    descriptor.success = known.length ? successes / known.length : 0;
    descriptor.costPerSuccess = successes > 0 && group.every(r => r.costUsd !== null) ? group.reduce((n, r) => n + r.costUsd!, 0) / successes : null;
    descriptor.evidence = group.slice(-16).map(r => ({ kind: 'run', ref: r.runId, at: r.endedAt! }));
  }
  return { agents, runs, work, models: [...groups.values()].map(g => g.descriptor) };
}
