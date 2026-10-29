// Interface errors to the log (ADR 0192): main keeps only the report's strings, cut, writes a `renderer` error with
// cause and hint, the same error at most once a minute (repeats counted on its next line) and at most PER_MINUTE lines a
// minute; the page side cuts and dedupes too and listens to window errors and unhandled rejections.
import { describe, expect, it, vi } from 'vitest';
import { cleanRendererError, MAX_STACK, PER_MINUTE, RendererErrors } from '../../src/main/renderer-errors';
import { log } from '../../src/main/log';
import { scrubComponentStack, scrubMessage, scrubStack } from '../../src/shared/error-scrub';

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke } }));
const { reportUiError, startUiErrors, toReport } = await import('../../src/renderer/lib/ui-errors');

describe('main: renderer errors', () => {
  it('keeps only known fields, cut, and refuses an empty message', () => {
    expect(cleanRendererError({ kind: 'weird', message: '  boom ', stack: 'x'.repeat(5000), extra: 'no', where: 'memoria' }))
      .toEqual({ kind: 'error', message: 'boom', where: 'memoria' }); // a stack without frames keeps nothing
    const long = Array.from({ length: 400 }, (_, i) => `    at f${i} (http://localhost:5173/src/a${i}.tsx:${i + 1}:2)`).join('\n');
    expect(cleanRendererError({ message: 'm', stack: long })!.stack!.length).toBeLessThanOrEqual(MAX_STACK);
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

describe('scrubbed reports: what the user typed or sees never leaves the page', () => {
  it('keeps the name and the first line, quoted text as «…», paths, long numbers and ids folded', () => {
    expect(scrubMessage('Cannot read properties of undefined (reading \'Riunione con Marco\')\nsecond line with secrets')).toBe('Cannot read properties of undefined (reading «…»)');
    expect(scrubMessage('Nota "Diario 2026" non trovata, né «Spese casa» né `x`')).toBe('Nota «…» non trovata, né «…» né «…»');
    expect(scrubMessage('ENOENT: open C:\\Users\\you\\brain\\notes\\x.md failed')).toBe('ENOENT: open <path> failed');
    expect(scrubMessage('fetch https://example.com/api/notes?id=1 failed and /home/user/brain/a.md too')).toBe('fetch <path> failed and <path> too');
    expect(scrubMessage('run r_123456789 at 1730000000000 hash 9f86d081884c7d659a2f')).toBe('run r_<n> at <n> hash <id>');
    expect(scrubMessage('Minified React error #185')).toBe('Minified React error #185');
    const r = toReport('error', new TypeError('x is undefined in "Il mio diario"'));
    expect(r.message).toBe('TypeError: x is undefined in «…»');
  });

  it('keeps stack frames as file:line only, never the message the stack repeats', () => {
    const err = new TypeError('secret note title');
    err.stack = 'TypeError: secret note title\n    at render (http://localhost:5173/src/components/Memory.tsx?t=1730000:120:7)\n    at new Promise (<anonymous>)\n    at file:///C:/Users/you/app/out/index.js:12:3\n    at Object.x (webpack-internal:///./a/b.js:5:1)';
    const r = toReport('error', err);
    expect(r.stack).toBe('Memory.tsx:120\nindex.js:12\nb.js:5');
    expect(r.stack).not.toContain('secret');
    expect(scrubStack('fn@http://localhost/app/main.js:10:2\nother@http://localhost/main.js:3:1')).toBe('main.js:10\nmain.js:3');
    // main scrubs again: a stack already kept reads the same
    expect(cleanRendererError({ message: 'm', stack: r.stack })!.stack).toBe(r.stack);
    expect(scrubComponentStack('\n    at MemoryPage (http://localhost:5173/src/pages/MemoryPage.tsx:10:3)\n    at div\n    in ErrorBoundary (created by App)')).toBe('at MemoryPage (MemoryPage.tsx:10)\nat div\nat ErrorBoundary');
    expect(toReport('error', new Error('x'), { source: 'file:///C:/Users/you/out/renderer/index.js:44:9' }).source).toBe('index.js:44');
  });

  it('main scrubs a report from a page that did not', () => {
    const c = cleanRendererError({ message: 'Errore su "Piano ferie Lucia"\ndettagli', stack: 'Error: Piano ferie Lucia\n    at x (http://h/a.js:1:1)', source: 'C:\\Users\\you\\x.js:4:4' })!;
    expect(c).toEqual({ kind: 'error', message: 'Errore su «…»', stack: 'a.js:1', source: 'x.js:4' });
  });
});

describe('page: ui-errors', () => {
  it('reports message and stack only, cut', () => {
    const err = new TypeError('x is undefined');
    const r = toReport('error', err, { where: 'log' });
    expect(r).toMatchObject({ kind: 'error', message: 'TypeError: x is undefined', where: 'log' });
    expect(r.stack).not.toContain('x is undefined'); // frames only
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
    expect(invoke.mock.calls.map(c => (c as unknown[])[1])).toMatchObject([{ kind: 'error', message: 'boom', source: 'app.js:3' }, { kind: 'rejection', message: 'lost promise' }]);
  });
});
