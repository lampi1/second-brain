// The Orchestrator's structured contract for app_create_chat and app_assign_task (#355, ADR 0247): the tool schema of
// the contract and the prompt it renders with the one renderer of every delegation contract (shared/delegation.ts
// contractText), its criteria, the fields it carried (stored on the run) and its warnings. The free prompt stays as the
// fallback. Used by appctl/tools.ts; tests: test/unit/task-contract.test.ts.
import { checkTaskContract, contractFields, contractText, contractWarnings, CONTEXT_MAX, GOAL_MAX, NOTE_MAX, OUTPUT_MAX, WHY_MAX } from '../../shared/delegation';
import { isWorkRole, ROLE_DEFAULTS } from '../../shared/roles';

// the structured contract (#355, ADR 0247): one standard format, rendered by shared/delegation.ts contractText
export const contractField = { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false,
  description: 'Preferred over prompt: the structured contract, written in English (replies to the user stay in the user\'s language). Rendered in one standard format; give the why and what is already decided, steps only where order matters.',
  properties: {
    goal: { type: 'string', maxLength: GOAL_MAX, description: 'the wanted outcome, one checkable sentence' },
    why: { type: 'string', maxLength: WHY_MAX, description: 'what it is for, who asks, what they will decide with the result' },
    alreadyDecided: { type: 'string', maxLength: NOTE_MAX, description: 'choices taken with the user, not to reopen' },
    context: { type: 'string', maxLength: CONTEXT_MAX, description: 'sources, files, links, current state; what NOT to re-read' },
    inScope: { type: 'string', maxLength: NOTE_MAX }, outOfScope: { type: 'string', maxLength: NOTE_MAX, description: 'explicit non-goals' },
    constraints: { type: 'string', maxLength: NOTE_MAX, description: 'task-only constraints: repo, branch, time, cost' },
    steps: { type: 'array', items: { type: 'string', maxLength: 300 }, minItems: 1, maxItems: 5, description: 'only if order matters' },
    doneWhen: { type: 'array', items: { type: 'string', maxLength: 300 }, minItems: 1, maxItems: 12, description: 'observable criteria, with the expected evidence' },
    output: { type: 'string', maxLength: OUTPUT_MAX, description: 'shape and length of the result, where to write it' },
    askIf: { type: 'string', maxLength: NOTE_MAX, description: 'the ambiguous reading that would change the work' },
  } } as const;
/** app_create_chat / app_assign_task: the prompt and criteria from a structured contract, or the free prompt (fallback).
 *  `estimate` is the text the task estimate reads: the goal and why only, since the rendered criteria and steps are
 *  list lines it would count as parts of a tree. `what` names the input in a length error. */
export function taskPrompt(a: Record<string, unknown>, roleId: string): { prompt: string; estimate: string; what: string; doneWhen?: string[]; contractFields?: string[]; warnings: string[] } {
  if (a.contract === undefined) { const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''; return { prompt, estimate: prompt, what: 'prompt', warnings: [] }; }
  if (a.prompt !== undefined || a.doneWhen !== undefined) throw new Error('contract: give the structured contract, or prompt with doneWhen, not both.');
  const c = checkTaskContract(a.contract);
  const prompt = contractText(c, isWorkRole(roleId) ? ROLE_DEFAULTS[roleId].output : undefined).join('\n');
  return { prompt, estimate: [c.goal, c.why].filter(Boolean).join('\n'), what: 'contract (rendered)', doneWhen: c.doneWhen, contractFields: contractFields(c), warnings: contractWarnings(c) };
}
