// The package demo (packages/routine-runtime/demo) runs from a clean folder through the `routine` command: the package
// and the stand-in Claude CLI are copied into an empty temp folder, the <set-by-user> secrets filled with test values,
// and `routine run` drives it with the real Claude engine adapter (a spawned process, stream-json on stdout) against a
// fake DevOps: no app, no brain, no tokens. Parity: the same package through the app host (createRoutineHost) and
// through the CLI gives the same step folders and the same report.md structure. ADR 0175.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRoutinePackage } from '../../../packages/routine-runtime/src/index';

const DEMO = path.resolve(__dirname, '../../../packages/routine-runtime/demo');

describe('routine runtime demo', () => {
  it('ships two steps (browser login, DevOps read), the ?mode=local login URL and no real secret', () => {
    const pkg = loadRoutinePackage(DEMO);
    expect(pkg.routine.steps.map(s => s.id)).toEqual(['air-login', 'work-item']);
    expect(pkg.routine.steps[0]!.browser).toBe(true);
    expect(pkg.credentials?.[0]?.loginUrl).toBe('https://dent-1.test.air.orisline.com/Account/Login?mode=local');
    expect(JSON.stringify(pkg)).not.toMatch(/demo-value/);
  });

});
