// Words for the model comparison on the Settings page (components/SettingsPage.tsx): each side and the judge by its
// engine's name, model and effort (ADR 0046 §4: any engine against any engine, nothing hard-coded), the agents in plain
// Italian, and the "cost so far" line. Pure; unit-tested in test/unit/settings-ui.test.ts.
import type { CompareCost, CompareExperiment } from '@shared/contract';
import { formatCost } from './format';

export const AGENT: Record<string, string> = { reviewer: 'revisione del codice', 'code-investigator': 'indagini sul codice', 'prod-log-reader': 'lettura dei log di produzione' };

type Side = { label: string; model?: string | null; effort?: string | null };

/** "Claude opus medium": the engine's name, then the model and effort the experiment names. */
export const sideName = (s: Side): string => [s.label || 'motore non indicato', s.model, s.effort].filter(Boolean).join(' ');

/** "A: Cursor (reviewer) · B: Claude opus medium · giudice: Cursor gpt-5" (side a's agents: the ones compared now). */
export function sidesLine(e: CompareExperiment): string {
  const on = e.agents.filter(a => a.on).map(a => a.name);
  return `A: ${sideName(e.a)}${on.length ? ` (${on.join(', ')})` : ''} · B: ${sideName(e.b)} · giudice: ${sideName(e.judge)}`;
}

/** The switch in the user's words (2026-10-11: "far partire Opus in automatico sullo stesso task che fanno i reviewer di
 *  Cursor"): "Opus rifà in automatico il lavoro dei reviewer di Cursor"; side b by its model when it names one. */
export function autoLine(e: CompareExperiment): string {
  const who = e.b.model ? e.b.model.replace(/^./, c => c.toUpperCase()) : e.b.label || 'Un altro modello';
  const agents = e.agents.map(a => a.name);
  const what = agents.includes('reviewer') ? 'dei reviewer' : agents.length === 1 ? `di ${agents[0]}` : 'degli agenti';
  return `${who} rifà in automatico il lavoro ${what} di ${sideName(e.a)}`;
}

/** "Finora 4 confronti · Claude opus 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)", or null when nothing ran yet. */
export function costLine(e: CompareExperiment): string | null {
  if (!e.rounds) return null;
  const n = (k: number) => `${k} ${k === 1 ? 'confronto' : 'confronti'}`;
  const side = (who: string, c: CompareCost) =>
    c.usd == null ? (c.missing ? `${who}: costo non ancora importato` : null) : `${who} ${formatCost(c.usd)}${c.missing ? ` (${n(c.missing)} senza costo)` : ''}`;
  return [`Finora ${n(e.rounds)}`, side(sideName(e.b), e.cost.b), side(sideName(e.a), e.cost.a)].filter(Boolean).join(' · ');
}
