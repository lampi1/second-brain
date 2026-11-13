// #355 (ADR 0247): one standard delegation contract. The renderer writes the fields in the template's order and skips
// empty ones; checkContract takes the hybrid fields and warns (never refuses) when the why is missing or the goal is a
// long list of steps; app_create_chat / app_assign_task render a structured contract the same way, the free prompt stays
// the fallback, and the fields reach the run. Pure.
import { describe, expect, it } from 'vitest';
import { checkContract, contractFields, contractText, contractWarnings, delegationPrompt } from '../../src/shared/delegation';
import { taskPrompt } from '../../src/main/appctl/task-contract';
import { partsOf } from '../../src/main/agents/task-estimate';
import { orchestratorRole, RETIRED_LINES } from '../../src/main/agents/orchestrator-role';

const full = {
  goal: 'The order total includes the discount.', why: 'Davide decides the release with it.', alreadyDecided: 'Keep the API.',
  context: 'src/order.ts', inScope: 'order total', outOfScope: 'the cart UI', constraints: 'branch fix/total',
  steps: ['Reproduce', 'Fix'], doneWhen: ['A test with a discount passes'], output: 'A PR link', askIf: 'the discount is per line',
};

describe('the standard contract', () => {
  it('renders every field in the template order and skips the empty ones', () => {
    const lines = contractText(full);
    const heads = lines.map(l => l.split(':')[0] ?? '');
    expect(heads.filter(h => !/^(\d\.|-)/.test(h))).toEqual(['Goal', 'Why', 'Already decided', 'Context', 'In scope', 'Out of scope', 'Constraints', 'Steps (in this order)', 'Done when', 'Output', 'Ask the parent if']);
    expect(lines).toContain('1. Reproduce');
    expect(contractText({ goal: 'G', doneWhen: ['d'] })).toEqual(['Goal: G', 'Done when:', '- d']);
    const prompt = delegationPrompt(checkContract(full, 'artisan'), { role: 'artisan', parentTitle: 'P', title: 'T', skills: [] });
    expect(prompt.indexOf('Why:')).toBeGreaterThan(prompt.indexOf('Goal:'));
    expect(prompt.indexOf('Output: A PR link')).toBeGreaterThan(prompt.indexOf('Done when:'));
  });
  it('checks the hybrid fields and warns, never refuses, without a why or with a goal of many steps', () => {
    expect(checkContract(full, 'artisan')).toMatchObject({ why: full.why, steps: full.steps, askIf: full.askIf });
    expect(() => checkContract({ ...full, steps: ['1', '2', '3', '4', '5', '6'] }, 'artisan')).toThrow(/1 to 5 steps/);
    expect(contractWarnings({ goal: 'x', why: 'y' })).toEqual([]);
    expect(contractWarnings({ goal: 'x' })[0]).toMatch(/why is missing/);
    expect(contractWarnings({ goal: '1. a\n2. b\n3. c\n4. d\n5. e\n6. f', why: 'y' })[0]).toMatch(/numbered steps/);
    expect(contractWarnings({ goal: '1) a 2) b 3) c 4) d 5) e 6) f', why: 'y' })[0]).toMatch(/numbered steps/); // on one line too
    expect(contractFields(checkContract(full, 'artisan'))).toEqual(['goal', 'why', 'alreadyDecided', 'context', 'inScope', 'outOfScope', 'constraints', 'steps', 'doneWhen', 'output', 'askIf']);
  });
  it('app_create_chat / app_assign_task: a structured contract, or the free prompt as the fallback, never both', () => {
    const t = taskPrompt({ contract: { goal: 'G', why: 'W', doneWhen: ['d'] } }, 'scout');
    expect(t).toEqual({ prompt: 'Goal: G\nWhy: W\nDone when:\n- d', estimate: 'G\nW', what: 'contract (rendered)', doneWhen: ['d'], contractFields: ['goal', 'why', 'doneWhen'], warnings: [] });
    expect(taskPrompt({ prompt: ' do it ' }, 'scout')).toEqual({ prompt: 'do it', estimate: 'do it', what: 'prompt', warnings: [] });
    expect(() => taskPrompt({ contract: { goal: 'G', doneWhen: ['d'] }, prompt: 'x' }, 'scout')).toThrow(/not both/);
    expect(() => taskPrompt({ contract: { goal: 'G', doneWhen: ['d'], tools: [] } }, 'scout')).toThrow(/unknown field tools/);
    expect(taskPrompt({ contract: { goal: 'G', doneWhen: ['d'] } }, 'scout').warnings[0]).toMatch(/why is missing/);
  });
  it('estimates a one-part job by its goal, not by the rendered criteria and steps', () => {
    const t = taskPrompt({ contract: { goal: 'Fix the order total rounding.', why: 'A customer saw it.', doneWhen: ['a test passes', 'the PR is open', 'the total is right'], steps: ['Reproduce', 'Fix'] } }, 'artisan');
    expect(partsOf(t.prompt)).toBeGreaterThan(1); // each list line reads as a part
    expect(partsOf(t.estimate)).toBe(1);
  });
  it('ships the Orchestrator line that names the contract field, and maps the old lines to it', () => {
    const line = 'Write each contract in the contract field (goal, why, alreadyDecided, doneWhen; steps only if order matters)';
    expect(orchestratorRole()).toContain(line);
    for (const [old, now] of RETIRED_LINES) if (old.startsWith('Write each contract')) expect(now).toContain(line);
  });
});
