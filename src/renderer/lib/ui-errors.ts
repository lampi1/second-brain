// The app page's interface errors to the technical log (ADR 0192): window 'error', unhandled promise rejections and the
// render errors a page's ErrorBoundary catches (components/ErrorBoundary.tsx) go to main through 'log:renderer', which
// rate-limits and redacts them into the `renderer` log (main/renderer-errors.ts). Before, nothing the page threw was
// ever logged. Only the error's name, the first line of its message (quoted text, paths, long numbers and ids folded)
// and its stack frames as file:line (shared/error-scrub.ts) leave the page, never what the user typed or sees. The same message is sent at most once every LOCAL_REPEAT_MS from here too (a render loop must not flood IPC).
// startUiErrors is called by main.tsx; reportUiError by ErrorBoundary.tsx. Tests: test/unit/ui-errors.test.ts.
import type { RendererErrorReport } from '@shared/contract';
import { scrubComponentStack, scrubMessage, scrubSource, scrubStack } from '@shared/error-scrub';
import { sb } from '../sb';

export const LOCAL_REPEAT_MS = 5_000;
const MAX = 2000;
const sent = new Map<string, number>();

const cut = (s: unknown, n: number): string | undefined => (typeof s === 'string' && s.trim() ? s.slice(0, n) : undefined);

/** The report for an error-like value: its message and stack only, cut. */
export function toReport(kind: RendererErrorReport['kind'], err: unknown, extra: Partial<Pick<RendererErrorReport, 'componentStack' | 'source' | 'where'>> = {}): RendererErrorReport {
  const e = err as { message?: unknown; stack?: unknown; name?: unknown } | null | undefined;
  const named = e && typeof e === 'object' && 'message' in e;
  const name = named && typeof e.name === 'string' && e.name && e.name !== 'Error' ? `${e.name.slice(0, 60)}: ` : '';
  const text = cut(named ? String(e.message ?? '') : String(err), 4000);
  const message = `${name}${text ? scrubMessage(text, 500) : ''}`.slice(0, 500).trim() || 'unknown error';
  const rawStack = cut(e && typeof e === 'object' ? e.stack : undefined, 4 * MAX), rawComp = cut(extra.componentStack, 4 * MAX), rawSource = cut(extra.source, 1000);
  const stack = rawStack ? scrubStack(rawStack, MAX) : undefined, componentStack = rawComp ? scrubComponentStack(rawComp, MAX) : undefined;
  const source = rawSource ? scrubSource(rawSource) : undefined, where = cut(extra.where, 60);
  return { kind, message, ...(stack ? { stack } : {}), ...(componentStack ? { componentStack } : {}), ...(source ? { source } : {}), ...(where ? { where } : {}) };
}

/** Sends one interface error to the log; never throws. */
export function reportUiError(kind: RendererErrorReport['kind'], err: unknown, extra: Partial<Pick<RendererErrorReport, 'componentStack' | 'source' | 'where'>> = {}, now = Date.now()): void {
  try {
    const r = toReport(kind, err, extra), key = `${r.kind}|${r.where ?? ''}|${r.message}`;
    const last = sent.get(key);
    if (last !== undefined && now - last < LOCAL_REPEAT_MS) return;
    sent.set(key, now);
    if (sent.size > 200) sent.clear();
    void sb.invoke('log:renderer', r).catch(() => { /* main gone: nothing to do */ });
  } catch { /* reporting never breaks the page */ }
}

/** Listens to the window's uncaught errors and unhandled rejections (the app page; started once by main.tsx). */
export function startUiErrors(win: Pick<Window, 'addEventListener'> = window): void {
  win.addEventListener('error', (ev: Event) => {
    const e = ev as ErrorEvent;
    // a resource that failed to load (img, script) is a plain Event without message or error: not an exception
    if (!e.message && !e.error) return;
    reportUiError('error', e.error ?? e.message, { ...(e.filename ? { source: `${e.filename}:${e.lineno}:${e.colno}` } : {}) });
  });
  win.addEventListener('unhandledrejection', (ev: Event) => {
    reportUiError('rejection', (ev as PromiseRejectionEvent).reason);
  });
}
