// The child strips of a chat (components/ChildStrips.tsx), pure: which of the engine's observed children show as
// indented strips under their parent chat and in which order. Every running, waiting or unresolved child shows (Brother,
// 18/10: «ogni sottoagente o agente che gira deve essere visibile»); an ended one leaves at once (owner, 18/10: finished
// rows piled up as "finito" and made the strips too tall); the full census stays in the strip's "Dettagli" popover
// (AgentIdentity.tsx). Each child names the app agent it runs as, or "nessun agente" (childAgent), and a parent whose
// sub-agents still work reads "in attesa", not "finito" (waitsOnChildren, lib/format.ts stateInfo; owner, #69).
// Pinned by test/unit/agent-children-rows.test.ts.
import type { AgentChildren, ChildObservation, ChildState } from '@shared/agents';

const ACTIVE = new Set<ChildState>(['running', 'waiting']);
const TERMINAL = new Set<ChildState>(['completed', 'failed', 'stopped']);

export interface ChildRow {
  key: string;
  kind: ChildObservation['kind'];
  task: string | null;
  /** the engine's agent type for the child (ChildObservation.agentType), null when not reported */
  agentType: string | null;
  state: ChildState;
  /** when the app first saw the child (rows saved before it was recorded: their observation time) */
  startedAt: number;
  observedAt: number;
  active: boolean;
  source: ChildObservation['source'];
}

export const isActiveChild = (c: Pick<ChildObservation, 'state'>): boolean => ACTIVE.has(c.state);
export const startOf = (c: Pick<ChildObservation, 'startedAt' | 'observedAt'>): number => c.startedAt ?? c.observedAt;

/** The strips of the children still at work (unresolved included), in start order; `ended` counts the ones left out. */
export function childRows(children: AgentChildren | undefined): { rows: ChildRow[]; ended: number } {
  const list = children?.children ?? [];
  const rows = list
    .filter(c => !TERMINAL.has(c.state))
    .map<ChildRow>(c => ({ key: c.key, kind: c.kind, task: c.task, agentType: c.agentType ?? null, state: c.state, startedAt: startOf(c), observedAt: c.observedAt, active: isActiveChild(c), source: c.source }))
    .sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
  return { rows, ended: list.length - rows.length };
}

/** The app agent a child runs as: the catalog profile whose id or name is the engine's agent type (case and spaces
 *  aside), else null ("nessun agente": the engine's own generic sub-agent, or a type the app does not know). */
export function childAgent<P extends { id: string; name: string }>(agentType: string | null | undefined, profiles: readonly P[] | null | undefined): P | null {
  const want = agentType?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!want || !profiles?.length) return null;
  return profiles.find(p => p.id.toLowerCase() === want) ?? profiles.find(p => p.name.trim().toLowerCase().replace(/\s+/g, ' ') === want) ?? null;
}

/** True while a sub-agent of the chat still works (running or waiting; a command, kind 'shell', is not a sub-agent):
 *  its parent then reads "in attesa" instead of "finito" (lib/format.ts stateInfo). */
export function waitsOnChildren(children: AgentChildren | undefined): boolean {
  return !!children?.children.some(c => c.kind !== 'shell' && isActiveChild(c));
}

/** The pill tone of a child's state (styles/app.css .pill-*). */
export function childTone(state: ChildState): 'run' | 'wait' | 'done' | 'err' | 'off' {
  if (state === 'running') return 'run';
  if (state === 'waiting') return 'wait';
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'err';
  return 'off';
}
