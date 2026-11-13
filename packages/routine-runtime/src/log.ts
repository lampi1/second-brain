// The routine runtime's log (ADR 0175): one sink the host sets (the app's structured log, the CLI's stderr), every
// message masked first. The runtime modules call `runtimeLog.info/warn`; until a host sets a sink, lines are dropped.
import { redact } from './mask';
import type { RuntimeLog } from './ports';

let sink: RuntimeLog | null = null;

/** The host's log; null drops lines (unit tests, a CLI run with --quiet). */
export function useRuntimeLog(next: RuntimeLog | null): void { sink = next; }

const clean = (extra?: { data?: unknown; cause?: string; hint?: string }) => extra && { ...extra, ...(extra.cause ? { cause: redact(extra.cause) } : {}) };
export const runtimeLog: RuntimeLog = {
  info: (scope, msg, extra) => sink?.info(scope, redact(msg), clean(extra)),
  warn: (scope, msg, extra) => sink?.warn(scope, redact(msg), clean(extra)),
};
