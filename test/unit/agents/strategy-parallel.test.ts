// The Strategist plans with dependencies (ADR 0335): its role and the app's planning flow tell it to say what every
// step depends on, to gather independent steps in one parallel group, and to delegate a whole group in one call.
import { describe, expect, it } from 'vitest';
import { ROLE_DEFAULTS } from '../../../src/shared/roles';
import { STRATEGY_FLOW } from '../../../src/shared/strategy';

describe('the Strategist plans parallel groups from dependencies', () => {
  const flow = STRATEGY_FLOW, role = ROLE_DEFAULTS.strategist.instructions;
  it('every step says which steps it depends on', () => {
    expect(flow).toContain('which steps it depends on');
    expect(role).toContain('the parts it depends on');
  });
  it('independent steps are one parallel group, marked par', () => {
    expect(flow).toMatch(/do not depend on each other are one parallel group/);
    expect(flow).toContain('`par: true`');
    expect(role).toContain('independent ones form a parallel group');
  });
  it('a whole group is delegated in one call, a step waits for what it depends on', () => {
    expect(flow).toContain('delegate a whole parallel group in one agent_delegate call');
    expect(flow).toContain('only when every step it depends on is done');
    expect(role).toContain('a whole parallel group in one call');
  });
  it('the review verdict comes to the Strategist, which checks each finding before any rework (2026-11-23)', () => {
    expect(role).toMatch(/The verdict comes to you, never to the Artisan: check each finding on the code \(a targeted read; a Scout when long\) before any rework/);
    expect(role).toMatch(/Only confirmed findings go, with agent_assign_task rework, to the same implementation chat/);
    expect(role).toMatch(/report a false positive or a disputed functional finding to the user in plain words, never to the Artisan/);
    // no role's text makes the reviewer answer the developer
    for (const r of Object.values(ROLE_DEFAULTS)) expect(r.instructions).not.toMatch(/fix what it finds|verdict (?:goes|comes) to the artisan/i);
  });
});
