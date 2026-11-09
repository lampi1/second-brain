// The Orchestrator's structured contract for app_create_chat and app_assign_task (#355, ADR 0247): the tool schema of
// the contract and the prompt it renders with the one renderer of every delegation contract (shared/delegation.ts
// contractText), its criteria, the fields it carried (stored on the run) and its warnings. The free prompt stays as the
// fallback. Used by appctl/tools.ts; tests: test/unit/task-contract.test.ts.
import { checkTaskContract, contractFields, contractText, contractWarnings } from '../../shared/delegation';
import { isWorkRole, ROLE_DEFAULTS } from '../../shared/roles';

// the structured contract (#355, ADR 0247): one standard format, rendered by shared/delegation.ts contractText
export const contractField = { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false,
  description: 'Preferred over prompt: the structured contract, written in English (replies to the user stay in the user\'s language). Rendered in one standard format; give the why and what is already decided, steps only where order matters.',
  properties: {
    goal: { type: 'string', description: 'the wanted outcome, one checkable sentence' },
    why: { type: 'string', description: 'what it is for, who asks, what they will decide with the result' },
    alreadyDecided: { type: 'string', description: 'choices taken with the user, not to reopen' },
    context: { type: 'string', description: 'sources, files, links, current state; what NOT to re-read' },
    inScope: { type: 'string' }, outOfScope: { type: 'string', description: 'explicit non-goals' },
    constraints: { type: 'string', description: 'task-only constraints: repo, branch, time, cost' },
    steps: { type: 'array', items: { type: 'string', maxLength: 300 }, minItems: 1, maxItems: 5, description: 'only if order matters' },
    doneWhen: { type: 'array', items: { type: 'string', maxLength: 300 }, minItems: 1, maxItems: 12, description: 'observable criteria, with the expected evidence' },
    output: { type: 'string', description: 'shape and length of the result, where to write it' },
    askIf: { type: 'string', description: 'the ambiguous reading that would change the work' },
  } } as const;
/** app_create_chat / app_assign_task: the prompt and criteria from a structured contract, or the free prompt (fallback). */
export function taskPrompt(a: Record<string, unknown>, roleId: string): { prompt: string; doneWhen?: string[]; contractFields?: string[]; warnings: string[] } {
  if (a.contract === undefined) return { prompt: typeof a.prompt === 'string' ? a.prompt.trim() : '', warnings: [] };
  if (a.prompt !== undefined || a.doneWhen !== undefined) throw new Error('contract: give the structured contract, or prompt with doneWhen, not both.');
  const c = checkTaskContract(a.contract);
  const prompt = contractText(c, isWorkRole(roleId) ? ROLE_DEFAULTS[roleId].output : undefined).join('\n');
  return { prompt, doneWhen: c.doneWhen, contractFields: contractFields(c), warnings: contractWarnings(c) };
}
