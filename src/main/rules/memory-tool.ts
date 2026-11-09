// Chat-local memory tools, including direct root chats. The host supplies scope and provenance; model arguments cannot
// claim a different project, author, source or verification status. A case-specific fact is refused with what to save
// instead (memory-worth.ts, ADR 0129). With `lessons` (#365, ADR 0242) memory_propose no longer writes a role note: it
// proposes a lesson for a skill (the role's own skill, or the task's skill named by `skill`) that the user decides.
import { randomUUID } from 'node:crypto';
import type { McpTool } from '../mcp/server';
import { proposeMemory, recallMemory, type MemoryScope } from './memory-records';
import { checkMemoryWorth } from './memory-worth';
import { factSentence } from '../../shared/proposals';
import type { LessonProposal, SkillLesson } from '../skills/lessons';

/** What memory_propose is for (ADR 0129): general, reusable knowledge, a specific finding generalized first. */
export const MEMORY_PROPOSE_TEXT = 'Propose one durable, reusable piece of knowledge for this role and current project, including from a direct chat: a user preference, a procedure, a convention, a how-to, where something is kept, a dead end to skip. Save only something that will change how a future task is handled; leave it out when nothing new was learned. Generalize a specific finding before saving it: the rule or procedure behind it, without one-off values (URLs with ports, ticket / PR / commit ids, paths in a user folder, dates, branch names); e.g. "after login the local app runs on a port other than the default: read it from the launch profile", not the URL. Case-specific facts, task updates and acknowledgements are refused. New facts are saved without asking the user (maintenance merges them and keeps the most recent 40 per role); equivalent repeats return the original record and its existing status, including a dismissal. Never use for task results or to repeat a known or rejected fact.';
/** The same tool once lessons are on: a proposal to change a skill, never a note read at launch. */
export const LESSON_PROPOSE_TEXT = 'Propose one durable, reusable lesson for a skill: by default your role skill (read in full at every start of your role), or the skill of the task when you name it in `skill`. Good lessons: a user preference, a procedure, a convention, a how-to, where something is kept, a dead end to skip. Save only something that will change how a future task is handled. Generalize a specific finding first: the rule or procedure behind it, without one-off values (URLs with ports, ticket / PR / commit ids, paths in a user folder, dates, branch names). Case-specific facts, task results and acknowledgements are refused. The user approves or rejects each lesson in Memoria → Proposte; an approved one is added to the skill\'s «Lezioni» section. A lesson already proposed comes back as it is.';
export interface MemoryToolDeps {
  root(): string | null;
  /** lessons for skills (#365): memory_propose proposes one instead of writing a role note */
  lessons?(p: LessonProposal): { lesson: SkillLesson; duplicate: boolean };
  recall?(scope: MemoryScope, query: string, options: { asOf?: string; budgetTokens?: number }): Promise<string>;
  context(chatId: string): { scope: MemoryScope; sourceRunId: string } | null;
}
export function memoryTools(deps: MemoryToolDeps): McpTool[] {
  return [{
    name: 'memory_propose',
    description: deps.lessons ? LESSON_PROPOSE_TEXT : MEMORY_PROPOSE_TEXT,
    inputSchema: { type: 'object', required: ['subject', 'predicate', 'value'], additionalProperties: false, properties: {
      subject: { type: 'string', maxLength: 1000 }, predicate: { type: 'string', maxLength: 1000 }, value: { type: 'string', maxLength: 1000 },
      ...(deps.lessons ? { skill: { type: 'string', maxLength: 64, description: 'Optional: the task skill the lesson belongs to (its name, as in /name). Default: your role skill.' } }
        : { supersedes: { type: 'string', description: 'Optional prior memory id for the same scoped subject and predicate.' } }),
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      const allowed = deps.lessons ? ['subject', 'predicate', 'value', 'skill'] : ['subject', 'predicate', 'value', 'supersedes'];
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('Unknown memory proposal field.');
      const root = deps.root(), chatId = ctx.params.chatId, context = chatId ? deps.context(chatId) : null;
      if (!root || !context) throw new Error('Memory proposals require a role chat with an active run and brain.');
      if (typeof args.subject !== 'string' || typeof args.predicate !== 'string' || typeof args.value !== 'string' || (args.supersedes !== undefined && typeof args.supersedes !== 'string') || (args.skill !== undefined && typeof args.skill !== 'string')) throw new Error('Invalid memory proposal.');
      if (deps.lessons) {
        checkMemoryWorth(args.subject, args.predicate, args.value);
        const roleId = context.scope.roleId;
        if (!roleId) throw new Error('Lessons need a role chat.');
        const r = deps.lessons({ role: roleId, text: factSentence(args.subject, args.predicate, args.value), ...(typeof args.skill === 'string' && args.skill.trim() ? { skill: args.skill } : {}), chatId: chatId!, runId: context.sourceRunId });
        return JSON.stringify({ proposed: !r.duplicate, id: r.lesson.id, skill: r.lesson.skill, state: r.lesson.state, note: r.duplicate ? 'Already proposed: nothing new to ask.' : 'The user decides it in Memoria → Proposte.' });
      }
      return JSON.stringify(proposeMemory(root, { scope: context.scope, sourceRunId: context.sourceRunId, sourceEventId: `memory-proposal:${randomUUID()}`, subject: args.subject, predicate: args.predicate, value: args.value, ...(typeof args.supersedes === 'string' ? { supersedes: args.supersedes } : {}) }));
    },
  }, {
    name: 'memory_recall', description: 'Read relevant scoped memory as quoted data, optionally asOf an ISO date for historical facts. Scope is your current role/project; proposed records are unverified.',
    inputSchema: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', maxLength: 4000 }, asOf: { type: 'string' }, budgetTokens: { type: 'integer', minimum: 1, maximum: 4000 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      if (Object.keys(args).some(k => !['query', 'asOf', 'budgetTokens'].includes(k)) || typeof args.query !== 'string' || args.query.length > 4000 || (args.asOf !== undefined && (typeof args.asOf !== 'string' || !Number.isFinite(Date.parse(args.asOf)))) || (args.budgetTokens !== undefined && (!Number.isInteger(args.budgetTokens) || Number(args.budgetTokens) < 1 || Number(args.budgetTokens) > 4000))) throw new Error('Invalid memory recall.');
      const root = deps.root(), chatId = ctx.params.chatId, context = chatId ? deps.context(chatId) : null;
      if (!root || !context) throw new Error('Memory recall requires a role chat with a brain.');
      const options = { ...(typeof args.asOf === 'string' ? { asOf: args.asOf } : {}), ...(typeof args.budgetTokens === 'number' ? { budgetTokens: args.budgetTokens } : {}) };
      return deps.recall ? deps.recall(context.scope, args.query, options) : recallMemory(root, context.scope, args.query, options.budgetTokens, options.asOf);
    },
  }];
}
