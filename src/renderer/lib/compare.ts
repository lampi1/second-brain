// Words for the model comparison on the Settings page (components/SettingsPage.tsx): each side and the judge by its
// engine's name, model and effort (ADR 0046 §4: any engine against any engine, nothing hard-coded), the agents in plain
// Italian, and the "cost so far" line. Pure; unit-tested in test/unit/settings-ui.test.ts.
import type { CompareCost, CompareExperiment } from '@shared/contract';
import { formatCost } from './format';
import { t } from '../i18n';

export const getAgent = (): Record<string, string> => ({ reviewer: t('tools.compare.agentReviewer'), 'code-investigator': t('tools.compare.agentCodeInvestigator'), 'prod-log-reader': t('tools.compare.agentProdLogReader') });

type Side = { label: string; model?: string | null; effort?: string | null };

/** "Claude opus medium": the engine's name, then the model and effort the experiment names. */
export const sideName = (s: Side): string => [s.label || t('tools.compare.engineNotSet'), s.model, s.effort].filter(Boolean).join(' ');

/** "A: Cursor (reviewer) · B: Claude opus medium · giudice: Cursor gpt-5" (side a's agents: the ones compared now). */
export function sidesLine(e: CompareExperiment): string {
  const on = e.agents.filter(a => a.on).map(a => a.name);
  return `A: ${sideName(e.a)}${on.length ? ` (${on.join(', ')})` : ''}${t('tools.compare.separator')}B: ${sideName(e.b)}${t('tools.compare.separator')}${t('tools.compare.judge')}: ${sideName(e.judge)}`;
}

/** The switch in the user's words (2026-10-11: "far partire Opus in automatico sullo stesso task che fanno i reviewer di
 *  Cursor"): "Opus rifà in automatico il lavoro dei reviewer di Cursor"; side b by its model when it names one. */
export function autoLine(e: CompareExperiment): string {
  const who = e.b.model ? e.b.model.replace(/^./, c => c.toUpperCase()) : e.b.label || t('tools.compare.anotherModel');
  const agents = e.agents.map(a => a.name);
  const what = agents.includes('reviewer') ? t('tools.compare.ofReviewers') : agents.length === 1 ? `${t('tools.compare.of')} ${agents[0]}` : t('tools.compare.ofAgents');
  return `${who} ${t('tools.compare.runsAutomatically')} ${what} ${t('tools.compare.of')} ${sideName(e.a)}`;
}

/** "Finora 4 confronti · Claude opus 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)", or null when nothing ran yet. */
export function costLine(e: CompareExperiment): string | null {
  if (!e.rounds) return null;
  const n = (k: number) => t('tools.compare.rounds', { n: k });
  const side = (who: string, c: CompareCost) =>
    c.usd == null ? (c.missing ? `${who}: ${t('tools.compare.costNotYet')}` : null) : `${who} ${formatCost(c.usd)}${c.missing ? ` (${n(c.missing)} ${t('tools.compare.noCost')})` : ''}`;
  return [`${t('tools.compare.soFar')} ${n(e.rounds)}`, side(sideName(e.b), e.cost.b), side(sideName(e.a), e.cost.a)].filter(Boolean).join(t('tools.compare.separator'));
}
