// The app's readable log (the Log page; owner, 2026-10-21: «Log leggibili e carini … in tempo reale», «deve essere TUTTO
// visibile», «che non ingigantiscano troppo … che si pulisca anche in automatico»). One event per thing the app saw: a
// task's chain (who chose which role and why, the role's work with cost, tools and errors, the result, the verification),
// the classifiers' choices, the estimates, the errors and memory written to the brain, Battito's runs, the app's own
// warnings. Events are the app's own data: reading them never spends AI tokens. Written by main/activity/journal.ts,
// read by renderer/components/LogPage.tsx through log:list and log:events. Shapes and limits only.

export type LogKind = 'task' | 'classifier' | 'estimate' | 'error' | 'memory' | 'pulse' | 'brain' | 'app';
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';
/** A task event's place in the chain: opened (who chose the role and why), a work turn, a request to the user and its
 *  end, the delivered result, a review opened on it, a verdict, the chat closed. */
export type LogStep = 'open' | 'work' | 'request' | 'resolved' | 'result' | 'review' | 'verdict' | 'closed';

export interface LogEvent {
  id: string;
  at: number;
  kind: LogKind;
  level: LogLevel;
  /** one readable Italian line */
  title: string;
  /** a second line: the reason, the summary */
  text?: string;
  step?: LogStep;
  /** the chat it is about, its root (the task) and its parent; who = the role or the chat's name */
  chatId?: string; rootId?: string; parentId?: string; runId?: string; who?: string;
  /** the task's title (the root chat's), so a chain still reads after its chats are gone */
  task?: string;
  costUsd?: number; ms?: number;
  /** tool names used in a work turn, each once, in order; toolErrors = how many of its tool calls failed */
  tools?: string[]; toolErrors?: number;
  input?: string; output?: string; error?: string;
  /** a request: its id and type; resolved: who closed it (the user's answer, or anything else) */
  reqId?: string; reqType?: 'permission' | 'question'; by?: 'user' | 'ended' | 'other';
  /** a review's run (step review), or the verdict's (step verdict) */
  reviewOf?: string; verdict?: 'success' | 'partial' | 'fail' | 'unknown';
}
export type LogInput = Omit<LogEvent, 'id' | 'at'> & { at?: number };

export interface LogList { events: LogEvent[]; bytes: number; keepDays: number; maxBytes: number }

/** Days of events kept on disk; older files are deleted at start and every hour. */
export const LOG_KEEP_DAYS = 7;
/** Total size kept on disk; past it the oldest days go first. */
export const LOG_MAX_BYTES = 20 * 1024 * 1024;
/** Events kept in memory and sent to the page at open. */
export const LOG_RECENT = 3000;
/** Longest text field kept (input, output, error, text). */
export const LOG_FIELD_MAX = 2000;

export const LOG_KINDS: readonly LogKind[] = ['task', 'classifier', 'estimate', 'error', 'memory', 'pulse', 'brain', 'app'];

/** A text field cut to the limit, with an ellipsis. */
export function clip(s: unknown, max = LOG_FIELD_MAX): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
