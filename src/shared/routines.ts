// The Routine section's data shapes (ADR 0175, 0176): a routine is a self-contained package (routine.json + assets,
// embedded secrets masked here) run by packages/routine-runtime, in the app or from a terminal. Main
// (src/main/routines/) fills them from the package store and the run folders; the renderer's Routine page shows them.
// Secrets never cross IPC: a summary only says whether the package carries them.
import type { RunEvent } from '../../packages/routine-runtime/src/events';

export type { RunEvent };

/** The DevOps trigger filters the user edits in the app (the package's `routine.trigger`). */
export interface RoutineTriggerFilters {
  everyMinutes: number; states: string[]; includeTags: string[]; excludeTags: string[];
  workItemIds: number[]; maxPerHour?: number;
}
export interface RoutineTriggerView extends RoutineTriggerFilters {
  organization: string; project: string; areaPath: string; workItemType: string;
}
export interface RoutineStepView {
  id: string; title: string; model?: string; effort?: string;
  /** names of the package-declared MCP servers / allowed tools / test DBs the session gets */
  mcpServers: string[]; allowedTools: string[]; testDbs: string[];
}
export interface RoutineSummary {
  id: string; title: string; description: string;
  /** the package folder (routine.json + assets/) */
  dir: string;
  steps: RoutineStepView[];
  trigger?: RoutineTriggerView;
  /** who is mentioned on DevOps when a step needs a person */
  escalation?: string;
  /** the package embeds site logins, a DevOps PAT or test DB logins (values never leave main) */
  secrets: { logins: string[]; devopsPat: boolean; testDbs: number };
  /** every secret slot of the package; `set: false` = still the authoring placeholder («Credenziali da inserire») */
  secretSlots: RoutineSecretSlot[];
  /** copyable terminal commands for this package */
  commands: { run: string; item: string; watch: string };
}
/** One secret of a package the user can type (write-only: its value never comes back).
 *  slot: `login:<n>:user|password`, `devopsPat`, `testDb:<id>:user|password`. */
export interface RoutineSecretSlot { slot: string; kind: 'login' | 'devopsPat' | 'testDb'; field: 'user' | 'password' | 'token'; label: string; set: boolean }
export type RoutineRunSource = 'app' | 'terminal';
export interface RoutineRunRef { source: RoutineRunSource; routineId: string; runId: string }
export interface RoutineRunSummary extends RoutineRunRef {
  title: string; status: string; workItem?: number; workItemUrl?: string; createdAt: number; updatedAt: number; endedAt?: number;
  /** the current step from progressFrom(events) */
  step?: { n: number; total: number; title: string };
  waiting?: { url?: string; question: string };
  error?: string;
}
export interface RoutineRunStep {
  n: number; id: string; title: string; status: string; attempts: number;
  startedAt?: number; endedAt?: number; summary?: string; error?: string;
  writes: string[]; notVerified: string[]; failedWrites: string[];
  testDb?: string;
  dir: string; screenshots: string[]; evidence: string[];
}
export interface RoutineRunDetail extends RoutineRunSummary {
  dir: string;
  /** the run's events.jsonl (masked by the runtime), for the shared reducer in the renderer */
  events: RunEvent[];
  steps: RoutineRunStep[];
  /** report.md's path, when written (opened in the app's file viewer) */
  reportPath?: string;
  /** the newest screenshot of the current step, loaded by the visible gallery only */
  lastShot?: { path: string };
  /** the terminal command that resumes it */
  resume: string;
  /** A historical app run: evidence only, never resume it from the app. */
  archived: boolean;
}
/** «Esporta per il terminale»: where the filled zip was written (only under the terminal's packages folder) and which
 *  secrets it carries or still lacks, by name and reason; never a value. */
export interface RoutineTerminalExport { path: string; filled: string[]; missing: { secret: string; reason: string }[] }
/** A legacy routine (FlowVersion) the startup conversion could not turn into a package. */
export interface RoutineLegacy { flowId: string; title: string; error: string }
export interface RoutinesSnapshot {
  routines: RoutineSummary[];
  runs: RoutineRunSummary[];
  /** where packages and runs live on this PC */
  dirs: { packages: string; appRuns: string; terminalRuns: string };
  legacy: RoutineLegacy[];
  error?: string;
}
