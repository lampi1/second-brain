// The child strips of a chat (components/ChildStrips.tsx), pure: which of the engine's observed children show as
// indented strips under their parent chat and in which order. Every running or waiting child always shows (Brother,
// 18/10: «ogni sottoagente o agente che gira deve essere visibile»); an ended one keeps its final state on screen, the
// latest ENDED_SHOWN of them, the older ones behind "altri N finiti". Pinned by test/unit/agent-children-rows.test.ts.
import type { AgentChildren, ChildObservation, ChildState } from '@shared/agents';

/** Ended children shown by default (the older ones fold behind a count). */
export const ENDED_SHOWN = 3;
const ACTIVE = new Set<ChildState>(['running', 'waiting']);

export interface ChildRow {
  key: string;
  kind: ChildObservation['kind'];
  task: string | null;
  state: ChildState;
  /** when the app first saw the child (rows saved before it was recorded: their observation time) */
  startedAt: number;
  observedAt: number;
  active: boolean;
  source: ChildObservation['source'];
}

export const isActiveChild = (c: Pick<ChildObservation, 'state'>): boolean => ACTIVE.has(c.state);
export const startOf = (c: Pick<ChildObservation, 'startedAt' | 'observedAt'>): number => c.startedAt ?? c.observedAt;

/** The strips, in start order; ended ones beyond the latest ENDED_SHOWN are left out unless `all`. */
export function childRows(children: AgentChildren | undefined, all = false): { rows: ChildRow[]; hiddenEnded: number; ended: number } {
  const list = children?.children ?? [];
  const terminal = new Set<ChildState>(['completed', 'failed', 'stopped']);
  const ended = list.filter(c => terminal.has(c.state));
  // the latest ended ones, by the time their last event came (not their start: an old child that ended now is news)
  const keep = all ? new Set(ended.map(c => c.key)) : new Set([...ended].sort((a, b) => b.observedAt - a.observedAt).slice(0, ENDED_SHOWN).map(c => c.key));
  const rows = list
    .filter(c => !terminal.has(c.state) || keep.has(c.key))
    .map<ChildRow>(c => ({ key: c.key, kind: c.kind, task: c.task, state: c.state, startedAt: startOf(c), observedAt: c.observedAt, active: isActiveChild(c), source: c.source }))
    .sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
  return { rows, hiddenEnded: ended.length - keep.size, ended: ended.length };
}

/** The pill tone of a child's state (styles/app.css .pill-*). */
export function childTone(state: ChildState): 'run' | 'wait' | 'done' | 'err' | 'off' {
  if (state === 'running') return 'run';
  if (state === 'waiting') return 'wait';
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'err';
  return 'off';
}
