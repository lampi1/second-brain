// Interface errors to the log (ADR 0192): main keeps only the report's strings, cut, writes a `renderer` error with
// cause and hint, the same error at most once a minute (repeats counted on its next line) and at most PER_MINUTE lines a
// minute; the page side cuts and dedupes too and listens to window errors and unhandled rejections.
import { describe, expect, it, vi } from 'vitest';
import { cleanRendererError, MAX_STACK, PER_MINUTE, RendererErrors } from '../../src/main/renderer-errors';
import { log } from '../../src/main/log';

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke } }));
const { reportUiError, startUiErrors, toReport } = await import('../../src/renderer/lib/ui-errors');

describe('main: renderer errors', () => {
  it('keeps only known fields, cut, and refuses an empty message', () => {
    expect(cleanRendererError({ kind: 'weird', message: '  boom ', stack: 'x'.repeat(5000), extra: 'no', where: 'memoria' }))
      .toEqual({ kind: 'error', message: 'boom', stack: 'x'.repeat(MAX_STACK), where: 'memoria' });
    expect(cleanRendererError({ message: '' })).toBeNull();
    expect(cleanRendererError('nope')).toBeNull();
    expect(cleanRendererError({ kind: 'render', message: 'm', componentStack: 7 })).toEqual({ kind: 'render', message: 'm' });
  });

  it('writes a renderer error with cause and hint, redacted', () => {
    const r = new RendererErrors(() => 1000);
    expect(r.report({ kind: 'render', message: 'failed with sk-abcdefghijklmnopqrstuv', where: 'memoria', componentStack: 'at MemoryPage' })).toBe(true);
    const e = log.recent.at(-1)!;
    expect(e).toMatchObject({ lvl: 'error', scope: 'renderer', msg: 'failed with [redacted]', data: { kind: 'render', where: 'memoria', componentStack: 'at MemoryPage' } });
    expect(e.cause).toContain('React component');
    expect(e.hint).toContain('Ricarica la pagina');
  });

  it('rate-limits: the same error once a minute, at most PER_MINUTE lines a minute', () => {
    let now = 0;
    const r = new RendererErrors(() => now);
    expect(r.report({ message: 'same' })).toBe(true);
    expect(r.report({ message: 'same' })).toBe(false);
    expect(r.report({ message: 'same' })).toBe(false);
    for (let i = 1; i < PER_MINUTE; i++) expect(r.report({ message: `other ${i}` })).toBe(true);
    expect(r.report({ message: 'one too many' })).toBe(false);
    now = 61_000;
    expect(r.report({ message: 'same' })).toBe(true);
    expect(log.recent.at(-1)!.data).toMatchObject({ repeatedBefore: 2, droppedOthers: 1 });
  });
});

describe('page: ui-errors', () => {
  it('reports message and stack only, cut', () => {
    const err = new TypeError('x is undefined');
    const r = toReport('error', err, { where: 'log' });
    expect(r).toMatchObject({ kind: 'error', message: 'TypeError: x is undefined', where: 'log' });
    expect(r.stack).toContain('x is undefined');
    expect(toReport('rejection', 'plain reason').message).toBe('plain reason');
    expect(toReport('rejection', undefined).message).toBe('undefined');
    expect(toReport('error', { message: 'm'.repeat(900) }).message).toHaveLength(500);
  });

  it('sends the same error once in LOCAL_REPEAT_MS and listens to window errors and rejections', () => {
    invoke.mockClear();
    reportUiError('error', new Error('dup'), {}, 10);
    reportUiError('error', new Error('dup'), {}, 20);
    expect(invoke).toHaveBeenCalledTimes(1);
    reportUiError('error', new Error('dup'), {}, 10 + 6000);
    expect(invoke).toHaveBeenCalledTimes(2);
    const handlers: Record<string, (e: unknown) => void> = {};
    startUiErrors({ addEventListener: ((type: string, fn: (e: unknown) => void) => { handlers[type] = fn; }) as Window['addEventListener'] });
    invoke.mockClear();
    handlers.error!({ type: 'error' }); // a resource that failed to load: not an exception
    expect(invoke).not.toHaveBeenCalled();
    handlers.error!({ message: 'Uncaught boom', error: new Error('boom'), filename: 'app.js', lineno: 3, colno: 9 });
    handlers.unhandledrejection!({ reason: new Error('lost promise') });
    expect(invoke.mock.calls.map(c => (c as unknown[])[1])).toMatchObject([{ kind: 'error', message: 'boom', source: 'app.js:3:9' }, { kind: 'rejection', message: 'lost promise' }]);
  });
});
