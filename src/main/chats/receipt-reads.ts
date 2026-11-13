// Per run, the reads of its turns' files still under way (manager-checkpoints.ts receiptTurn, ADR 0279): the run's
// deterministic verdict waits for them, and only for its own (a chat may already be reading a newer run's). A module
// of its own because both the turn's end (manager-checkpoints.ts) and the run's end (manager-persistence.ts) ask.
import type { AgentRun } from '../../shared/agents';

const reads = new WeakMap<AgentRun, number>();
export const receiptReadStarted = (run: AgentRun): void => { reads.set(run, (reads.get(run) ?? 0) + 1); };
export const receiptReadEnded = (run: AgentRun): void => { reads.set(run, Math.max(0, (reads.get(run) ?? 1) - 1)); };
/** true while a turn of this run still has its files being read */
export const receiptsReading = (run: AgentRun): boolean => (reads.get(run) ?? 0) > 0;
