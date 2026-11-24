// Prompt context regression checks: keep product boundaries in the always-on frame while tool schemas own flow
// details, so changing supported adapters cannot leave a contradictory instruction in every Orchestrator session.
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_ROLE, orchestratorRole } from '../../../src/main/agents/orchestrator-role';
import { MODEL_CHOICE_GUIDE } from '../../../src/shared/model-choice-guide';

// the approved model choice guide (2026-11-23) rides in the frame verbatim: its table's "routine message" (a Herald
// task kind) is not a scheduled routine, and its size is the owner's text, not a flow manual
const withoutGuide = (s: string) => s.replace(MODEL_CHOICE_GUIDE.trim(), '');

describe('Orchestrator context ownership', () => {
  it('carries no routine or schedule rule: both live outside the app (ADR 0325)', () => {
    expect(ORCHESTRATOR_ROLE).toContain(MODEL_CHOICE_GUIDE.trim());
    expect(withoutGuide(ORCHESTRATOR_ROLE)).not.toMatch(/routine|app_schedule/i);
    expect(orchestratorRole('My coordination preference')).not.toMatch(/app_routine|app_schedule|routine run|terminal/i);
    expect(ORCHESTRATOR_ROLE).not.toContain('All company adapters remain unavailable');
    expect(ORCHESTRATOR_ROLE).not.toContain('explicit organization/project/area/type/states');
  });

  it('keeps single-entry routing, exact approvals and production boundaries even with a custom role', () => {
    const frame = orchestratorRole('My coordination preference');
    for (const rule of [
      'Production and shared-system operations stay with the user',
      'execution permission checks still apply',
      'A free-text answer is his answer: act on what it says, never implicit approval of more',
      'never the same question again without that reply',
      'exactly two options "Sì" and "No"',
      'What you say counts as the user\'s own, always',
      'Never send him to a chat or the PC',
      'Only prod, DB, Azure wait: show the whole command',
      'The role grants no permission and approves no action',
      'Updater apply is disabled',
    ]) expect(frame).toContain(rule);
  });

  it('keeps intake and challenge guidance in the frame even with a customized role', () => {
    const frame = orchestratorRole('Coordinate my work');
    expect(frame).toContain('Start new work by checking for a consequential choice');
    expect(frame).toContain('outside Plan proceed when clear');
    expect(frame).toContain('The role finding a material user choice asks one question, never one the request');
    expect(frame).toContain('it goes up one level at a time'); // ADR 0344
    expect(frame).toContain('one alternative with a reason, then proceed on confirmation');
  });

  it('requires independent review for every development completion, with thresholds only for other reports', () => {
    expect(ORCHESTRATOR_ROLE).toContain('After implementation, arrange an independent Sentinel review');
    expect(ORCHESTRATOR_ROLE).toContain('Development always requires the independent Sentinel review above. For other reports');
    expect(ORCHESTRATOR_ROLE).toContain('Never declare review passed without its report and concrete evidence');
  });

  it('bounds shipped overhead without truncating editable role instructions', () => {
    // Baseline ce759437: 17,457 UTF-16 characters. This ceiling catches accidental reinsertion of flow manuals.
    expect(withoutGuide(ORCHESTRATOR_ROLE).length).toBeLessThan(16_000);
    const custom = 'A user-specific instruction. '.repeat(700);
    expect(orchestratorRole(custom)).toContain(custom.trim());
  });
});
