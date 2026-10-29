// What the main process and the read worker (read-work.ts, read-worker.ts) say to each other, kept apart so the worker
// bundle imports no Worker of its own. The runs a request carries can be held by the worker under a key (#276, #277).
import type { AgentRun } from '../shared/agents';
import type { BrainModelState } from '../shared/brain-model';
import type { RunEstimates } from '../shared/task-estimate';
import type { BrainViewInput } from './brainmodel/view';
export type ReadRequest = { op: 'brain'; input: BrainViewInput } | { op: 'estimates'; runs: AgentRun[]; runIds: string[]; now: number };
export interface ReadResults { brain: BrainModelState; estimates: RunEstimates }
/** The message to the worker: `runsKey` = the runs it carries are stored under this key; `cached` = no runs sent, use the
 *  stored ones. */
export interface ReadMessage { id: number; request: ReadRequest; runsKey?: string; cached?: true }
export const runsOf = (r: ReadRequest): AgentRun[] => r.op === 'brain' ? r.input.runs : r.runs;
export const withRuns = (r: ReadRequest, runs: AgentRun[]): ReadRequest => r.op === 'brain' ? { ...r, input: { ...r.input, runs } } : { ...r, runs };
