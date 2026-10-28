// Prompt context regression checks: keep product boundaries in the always-on frame while tool schemas own flow
// details, so changing supported adapters cannot leave a contradictory instruction in every Orchestrator session.
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_ROLE, orchestratorRole } from '../../../src/main/agents/orchestrator-role';
import { packageTools } from '../../../src/main/flows/package-tools';

const unavailable = (): never => { throw new Error('Prompt checks must not call a service'); };
const tools = [
  ...packageTools({ store: unavailable, brainRoot: () => null, authed: () => true }),
];
const description = (name: string): string => tools.find(tool => tool.name === name)!.description;

describe('Orchestrator context ownership', () => {
  it('keeps flow mechanics in current tool descriptions rather than an obsolete universal adapter list', () => {
    expect(ORCHESTRATOR_ROLE).toContain('read app_routine_capabilities');
    expect(ORCHESTRATOR_ROLE).toContain('save it with app_routine_save');
    expect(ORCHESTRATOR_ROLE).not.toContain('All company adapters remain unavailable');
    expect(ORCHESTRATOR_ROLE).not.toContain('explicit organization/project/area/type/states');
    expect(description('app_routine_save')).toContain('preflight');
    expect(description('app_routine_save')).toContain('Never pass a password');
  });

  it('keeps single-entry routing, exact approvals and production boundaries even with a custom role', () => {
    const frame = orchestratorRole('My coordination preference');
    for (const rule of [
      'Routines execute only in the user terminal',
      'no routine scans in generic recaps',
      'Never write or ask for a password or PAT',
      'Production and shared-system operations stay with the user',
      'execution permission checks still apply',
      'free text is a clarification, never implicit approval',
      'exactly two options "Sì" and "No"',
      'only what needs a person reaches the user, once',
      'The role grants no permission and approves no action',
      'Updater apply is disabled',
    ]) expect(frame).toContain(rule);
  });

  it('requires independent review for every development completion, with thresholds only for other reports', () => {
    expect(ORCHESTRATOR_ROLE).toContain('After implementation, arrange an independent Sentinel review');
    expect(ORCHESTRATOR_ROLE).toContain('Development always requires the independent Sentinel review above. For other reports');
    expect(ORCHESTRATOR_ROLE).toContain('Never declare review passed without its report and concrete evidence');
  });

  it('bounds shipped overhead without truncating editable role instructions', () => {
    // Baseline ce759437: 17,457 UTF-16 characters. This ceiling catches accidental reinsertion of flow manuals.
    expect(ORCHESTRATOR_ROLE.length).toBeLessThan(16_000);
    const custom = 'A user-specific instruction. '.repeat(700);
    expect(orchestratorRole(custom)).toContain(custom.trim());
  });
});
