// Pure selected-evidence adapter for the EXISTING Improve coordinator. No scheduler, prompt send or model calls.
import type { aggregateAgentUsage, buildAgentReadModel } from '../agents/analytics';

type Analytics = ReturnType<typeof aggregateAgentUsage> & Partial<Pick<ReturnType<typeof buildAgentReadModel>, 'insights' | 'insightPolicy' | 'period'>>;
export interface ImproveEvidenceSelection { agentIds: string[]; insightRefs?: string[]; budgetBytes: number }

/** Caller invokes only for an explicit user request/preview. Unselected agents never enter the packet. */
export function buildImproveEvidence(analytics: Analytics, selection: ImproveEvidenceSelection) {
  if (!Number.isSafeInteger(selection.budgetBytes) || selection.budgetBytes < 256 || selection.budgetBytes > 32768 || selection.agentIds.length > 20 || (selection.insightRefs?.length ?? 0) > 50) throw new Error('Invalid Improve evidence selection');
  const agentIds = new Set(selection.agentIds);
  if ([...agentIds].some(id => !analytics.agents.some(agent => agent.agentId === id))) throw new Error('Selected agent evidence unavailable');
  const insightRefs = new Set(selection.insightRefs ?? []);
  if ([...insightRefs].some(ref => !(analytics.insights ?? []).some(insight => `${insight.sourceId}/${insight.id}` === ref))) throw new Error('Selected insight unavailable');
  const observations = analytics.agents.filter(agent => agentIds.has(agent.agentId)).map(agent => ({
    agentId: agent.agentId, revisions: agent.revisions, sessions: agent.sessions,
    costs: agent.costs, timing: agent.timing, elapsed: agent.elapsed, evidence: agent.evidence,
    rationale: `${agent.sessions} observed sessions; ${agent.costs.actualUsd.unknownSessions} without actual-charge evidence. Timing summaries describe observations and do not establish a fastest agent.`,
  }));
  const packet = { kind: 'selected-improve-evidence', version: 1, observations: [] as typeof observations, cohorts: [] as Analytics['cohorts'], insights: [] as NonNullable<Analytics['insights']> };
  const omitted: string[] = [];
  const render = () => JSON.stringify(packet);
  const fits = () => Buffer.byteLength(render(), 'utf8') <= selection.budgetBytes;
  // Add complete evidence objects only; no truncation or hidden LLM call.
  for (const observation of observations) {
    packet.observations.push(observation);
    if (!fits()) { packet.observations.pop(); omitted.push(`agent/${observation.agentId}`); }
  }
  for (const cohort of analytics.cohorts.filter(row => packet.observations.some(agent => agent.agentId === row.agentId))) {
    packet.cohorts.push(cohort);
    if (!fits()) { packet.cohorts.pop(); omitted.push(`cohort/${cohort.agentId}`); }
  }
  for (const insight of (analytics.insights ?? []).filter(insight => insightRefs.has(`${insight.sourceId}/${insight.id}`))) {
    packet.insights.push(insight);
    if (!fits()) { packet.insights.pop(); omitted.push(`insight/${insight.sourceId}/${insight.id}`); }
  }
  const text = packet.observations.length || packet.insights.length ? render() : '';
  return { text, bytes: Buffer.byteLength(text, 'utf8'), omitted, publication: 'existing-human-reviewed-flow-only' as const };
}
