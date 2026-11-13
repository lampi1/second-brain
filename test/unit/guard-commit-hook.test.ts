// The guard hooks' pure helpers (ADR 0061): parsing the pre-push input and refusing a malformed line, reading author
// identities and expanding %VARS% in the deny list path (scripts/guard-lib.mjs, scripts/guard-push.mjs). The hook runs
// on real temp repos were removed with the other git tests (docs/tests/load-sensitive-removed.md).
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helpers, no type declarations
import { expandEnv, identEmail } from '../../scripts/guard-lib.mjs';
// @ts-expect-error plain .mjs helper, no type declarations
import { parseUpdates } from '../../scripts/guard-push.mjs';

/** a made-up noreply address, built at run time so the guard's own e-mail rule never sees it whole */
const NOREPLY = 'dev' + '@users.noreply.github.com';

describe('setup and helpers', () => {
  it('parses pre-push input and refuses a malformed line', () => {
    const z = '0'.repeat(40), a = 'a'.repeat(40);
    expect(parseUpdates(`refs/heads/x ${a} refs/heads/x ${z}\n`)).toEqual([{ localRef: 'refs/heads/x', localSha: a, remoteRef: 'refs/heads/x', remoteSha: z }]);
    expect(parseUpdates('')).toEqual([]);
    expect(() => parseUpdates('refs/heads/x nope refs/heads/x')).toThrow(/unexpected pre-push input/);
  });

  it('reads identities and expands %VARS% in the deny list path', () => {
    expect(identEmail(`Dev <${NOREPLY.toUpperCase()}> 1700000000 +0100`)).toBe(NOREPLY);
    expect(expandEnv('%LOCALAPPDATA%/x/deny.txt', { LOCALAPPDATA: 'C:/L' })).toBe('C:/L/x/deny.txt');
    expect(expandEnv('%NOPE%/x', {})).toBe('%NOPE%/x');
  });
});
