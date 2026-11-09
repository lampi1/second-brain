// The guard's pre-commit hook (ADR 0061) on real temp repos: .githooks/pre-commit (scripts/guard-commit.mjs) blocks a
// staged bad line, a wrong author e-mail, a deny list that is set but missing, empty or a deny word in a path, and lets a
// clean commit through. Every block names file:line and the rule, never the matched value. Also scripts/setup-hooks.mjs
// (`npm run setup`: core.hooksPath, the optional config printed, never set) and the guard-lib helpers.
// Setup and values: guard-hooks-helpers.ts; the pre-push hook: guard-push-hook.test.ts.

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helpers, no type declarations
import { expandEnv, identEmail } from '../../scripts/guard-lib.mjs';
// @ts-expect-error plain .mjs helper, no type declarations
import { parseUpdates } from '../../scripts/guard-push.mjs';
import { NOREPLY } from './guard-hooks-helpers';

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
