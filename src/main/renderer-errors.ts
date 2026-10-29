// Interface errors in the technical log (ADR 0192). The page reports its window 'error', unhandled promise rejections
// and the render errors a page's ErrorBoundary caught ('log:renderer', renderer/lib/ui-errors.ts); here each becomes one
// `renderer` error with cause and hint, so `npm run logs -- --scope renderer`, the Log page, the daily digest and the
// maintenance pack see them (before, nothing in the page was ever logged; window.ts's crash hint pointed at it). The
// page is not trusted: only strings are kept, cut (message 500, stacks MAX_STACK), and the logger redacts secrets. A
// broken page must not flood the log: the same error at most once per REPEAT_MS (the repeats counted on its next line),
// at most PER_MINUTE lines a minute in all. Used by index.ts; tests: test/unit/renderer-errors.test.ts.
import type { RendererErrorReport } from '../shared/contract';
import { log } from './log';

export const REPEAT_MS = 60_000;
export const PER_MINUTE = 10;
export const MAX_STACK = 2000;
const KINDS = ['error', 'rejection', 'render'] as const;

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

/** The report as logged: known kind, strings only, cut. A hostile or broken page cannot write anything else. */
export function cleanRendererError(a: unknown): RendererErrorReport | null {
  const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const message = str(r.message, 500);
  if (!message) return null;
  const kind = KINDS.find(k => k === r.kind) ?? 'error';
  const stack = str(r.stack, MAX_STACK), componentStack = str(r.componentStack, MAX_STACK), source = str(r.source, 300), where = str(r.where, 60);
  return { kind, message, ...(stack ? { stack } : {}), ...(componentStack ? { componentStack } : {}), ...(source ? { source } : {}), ...(where ? { where } : {}) };
}

const CAUSE: Record<RendererErrorReport['kind'], string> = {
  error: 'an uncaught exception in the app page',
  rejection: 'an unhandled promise rejection in the app page',
  render: 'a React component threw while rendering: its page shows «Questa pagina ha avuto un errore»',
};

export class RendererErrors {
  /** key → when it was last written and how many repeats were dropped since */
  private readonly seen = new Map<string, { at: number; dropped: number }>();
  private minute = { start: 0, n: 0, dropped: 0 };
  constructor(private readonly now: () => number = Date.now) {}

  /** Logs one report unless the limits drop it; returns whether it was written. Never throws. */
  report(a: unknown): boolean {
    try {
      const r = cleanRendererError(a);
      if (!r) return false;
      const t = this.now(), key = `${r.kind}|${r.where ?? ''}|${r.message}`;
      if (t - this.minute.start >= 60_000) this.minute = { start: t, n: 0, dropped: this.minute.dropped };
      const last = this.seen.get(key);
      if (last && t - last.at < REPEAT_MS) { last.dropped++; return false; }
      if (this.minute.n >= PER_MINUTE) { this.minute.dropped++; return false; }
      this.minute.n++;
      const repeated = last?.dropped ?? 0, dropped = this.minute.dropped;
      this.seen.set(key, { at: t, dropped: 0 });
      this.minute.dropped = 0;
      if (this.seen.size > 500) for (const [k, v] of this.seen) if (t - v.at >= REPEAT_MS) this.seen.delete(k);
      log.error('renderer', r.message, {
        cause: CAUSE[r.kind],
        hint: r.kind === 'render' ? 'the page\'s «Ricarica la pagina» remounts it; the stack and component stack here name the component' : 'see the stack here; npm run logs -- --scope renderer --since 1h lists the others',
        data: { kind: r.kind, ...(r.where ? { where: r.where } : {}), ...(r.source ? { source: r.source } : {}), ...(r.stack ? { stack: r.stack } : {}), ...(r.componentStack ? { componentStack: r.componentStack } : {}),
          ...(repeated ? { repeatedBefore: repeated } : {}), ...(dropped ? { droppedOthers: dropped } : {}) },
      });
      return true;
    } catch { return false; }
  }
}
