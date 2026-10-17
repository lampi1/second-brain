// Offline interview recommendations: use existing catalog IDs, editable proposals, no permissions or remote calls.
import type { AgentProfile, SetupDraft } from '@shared/agents';

export const INTERVIEW_STEPS = ['Il tuo lavoro', 'I tuoi obiettivi', 'Strumenti e materiali', 'I tuoi agenti', 'Riepilogo'] as const;
export const emptySetup = (): SetupDraft => ({ step: 0, work: '', goals: '', tools: '', style: 'balanced', agentIds: [] });
export function recommendedAgents(draft: SetupDraft, catalog: readonly AgentProfile[]): string[] {
  const ids = new Set(['default-general', 'default-planning']);
  if (draft.work === 'independent' || /scriv|document|test[oi]|offert|client/i.test(draft.goals)) ids.add('default-writing');
  if (/anal|dat[oi]|confront|report|numer/i.test(draft.goals)) ids.add('default-analysis');
  if (/ricerc|font|informaz|stud/i.test(draft.goals)) ids.add('default-research');
  if (/svilupp|software|codice|programmaz/i.test(draft.goals)) ids.add('default-development');
  return catalog.filter(p => ids.has(p.id)).map(p => p.id);
}
export function validSetupStep(step: number): number { return Math.max(0, Math.min(INTERVIEW_STEPS.length - 1, Number.isInteger(step) ? step : 0)); }
