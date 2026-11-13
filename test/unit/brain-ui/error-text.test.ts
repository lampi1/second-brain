// The error box of the brain pages (src/renderer/brain/lib/error-text.ts): a raw error becomes one short line, the
// rest (a Node stack trace, a child's stderr, several lines) stays folded as details; a plain one-line error is shown
// as it is, with no details.
import { describe, expect, it } from 'vitest';
import { SHORT_MAX, shortError } from '../../../src/renderer/brain/lib/error-text';

// what the owner saw on the Miglioramento page, 2026-10-18: the brain's server child's stderr, whole
const STACK = [
  'node:internal/modules/cjs/loader:1228',
  '  throw err;',
  '  ^',
  '',
  "Error: Cannot find module 'C:\\Users\\x\\brain\\ops\\improve\\improve.mjs'",
  '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)',
  '    at Module._load (node:internal/modules/cjs/loader:1051:27)',
  '    at node:internal/main/run_main_module:28:49 {',
  "  code: 'MODULE_NOT_FOUND',",
  '  requireStack: []',
  '}',
  '',
  'Node.js v22.0.0',
].join('\r\n');

describe('error text', () => {
  it('a Node stack trace → its message line, the whole text as details', () => {
    const e = shortError(STACK);
    expect(e.short).toBe("Cannot find module 'C:\\Users\\x\\brain\\ops\\improve\\improve.mjs'");
    expect(e.details).toContain('at Module._resolveFilename');
    expect(e.details).not.toContain('\r');
  });

  it('a plain one-line error is shown as it is, with no details', () => {
    expect(shortError('questo brain non ha un server dati (ops/tools/brain-site.mjs)')).toEqual({ short: 'questo brain non ha un server dati (ops/tools/brain-site.mjs)', details: null });
    expect(shortError('  errore simulato su /api/tables \n')).toEqual({ short: 'errore simulato su /api/tables', details: null });
    expect(shortError('')).toEqual({ short: '', details: null });
    expect(shortError(null)).toEqual({ short: '', details: null });
  });

  it('strips the error class, keeps a multi-line message folded', () => {
    expect(shortError('TypeError: x is not a function').short).toBe('x is not a function');
    expect(shortError('Error [ERR_MODULE_NOT_FOUND]: Cannot find package').short).toBe('Cannot find package');
    const e = shortError('server dati del brain uscito (1): \n  at foo\nrotto');
    expect(e.short).toBe('server dati del brain uscito (1):');
    expect(e.details).toContain('rotto');
  });

  it('cuts a very long line and keeps the full text as details', () => {
    const long = 'x'.repeat(SHORT_MAX + 50);
    const e = shortError(long);
    expect(e.short.length).toBe(SHORT_MAX);
    expect(e.short.endsWith('…')).toBe(true);
    expect(e.details).toBe(long);
  });
});
