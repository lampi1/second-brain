// Words for the model comparison on the Settings page (components/SettingsPage.tsx): tool names as the user knows
// them, the agents in plain Italian, and the "cost so far" line. Pure; unit-tested in test/unit/settings-ui.test.ts.
import type { CompareExperiment } from '@shared/contract';
import { formatCost } from './format';

const TOOL: Record<string, string> = { cursor: 'Cursor', 'claude-code': 'Claude Code', 'cursor-agent': 'Cursor Agent', manual: 'a mano' };
/** "claude-code opus" → "Claude Code (opus)" */
export const toolName = (t: string): string => {
  const [tool = '', ...model] = t.split(' ');
  const name = TOOL[tool] ?? tool;
  return model.length ? `${name} (${model.join(' ')})` : name;
};
export const AGENT: Record<string, string> = { reviewer: 'revisione del codice', 'code-investigator': 'indagini sul codice', 'prod-log-reader': 'lettura dei log di produzione' };

/** The switch in the user's words (2026-10-11: "far partire Opus in automatico sullo stesso task che fanno i reviewer di
 *  Cursor"): "Opus rifà in automatico il lavoro dei reviewer di Cursor". */
export function autoLine(e: CompareExperiment): string {
  const [tool = '', ...model] = e.contender.split(' ');
  const who = model.length ? model.join(' ').replace(/^./, c => c.toUpperCase()) : TOOL[tool] ?? tool;
  const src = toolName(e.source.split(' ')[0] ?? '');
  const agents = e.agents.map(a => a.name);
  const what = agents.includes('reviewer') ? 'dei reviewer' : agents.length === 1 ? `di ${agents[0]}` : 'degli agenti';
  return `${who || 'Un altro modello'} rifà in automatico il lavoro ${what} di ${src}`;
}

/** "Finora 4 confronti · Claude Code 6,12 $ · Cursor 1,84 $ (1 confronto senza costo)", or null when nothing ran yet. */
export function costLine(e: CompareExperiment): string | null {
  if (!e.rounds) return null;
  const n = (k: number) => `${k} ${k === 1 ? 'confronto' : 'confronti'}`;
  const side = (who: string, c: CompareExperiment['cost']['source']) =>
    c.usd == null ? (c.missing ? `${who}: costo non ancora importato` : null) : `${who} ${formatCost(c.usd)}${c.missing ? ` (${n(c.missing)} senza costo)` : ''}`;
  return [`Finora ${n(e.rounds)}`, side(toolName(e.contender), e.cost.contender), side(toolName(e.source), e.cost.source)].filter(Boolean).join(' · ');
}
