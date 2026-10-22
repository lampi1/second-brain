// Chat-local memory proposal tool, including direct root chats. The host supplies scope and provenance;
// model arguments cannot claim a different project, author, source or verification status. A case-specific fact is
// refused with what to save instead (memory-worth.ts, ADR 0128).
import { randomUUID } from 'node:crypto';
import type { McpTool } from '../mcp/server';
import { proposeMemory, recallMemory, type MemoryScope } from './memory-records';

/** What memory_propose is for (ADR 0128): general, reusable knowledge, a specific finding generalized first. */
export const MEMORY_PROPOSE_TEXT = 'Propose one durable, reusable piece of knowledge for this role and current project, including from a direct chat: a procedure, a convention, a how-to, where something is kept, a dead end to skip. Generalize a specific finding before saving it: the rule or procedure behind it, without one-off values (URLs with ports, ticket / PR / commit ids, paths in a user folder, dates, branch names); e.g. "after login the local app runs on a port other than the default: read it from the launch profile", not the URL. A case-specific fact is refused. Stored as unverified data until the user confirms it. Never use for task results.';
export interface MemoryToolDeps {
  root(): string | null;
  recall?(scope: MemoryScope, query: string, options: { asOf?: string; budgetTokens?: number }): Promise<string>;
  context(chatId: string): { scope: MemoryScope; sourceRunId: string } | null;
}
export function memoryTools(deps: MemoryToolDeps): McpTool[] {
  return [{
    name: 'memory_propose',
    description: MEMORY_PROPOSE_TEXT,
    inputSchema: { type: 'object', required: ['subject', 'predicate', 'value'], additionalProperties: false, properties: {
      subject: { type: 'string', maxLength: 1000 }, predicate: { type: 'string', maxLength: 1000 }, value: { type: 'string', maxLength: 1000 }, supersedes: { type: 'string', description: 'Optional prior memory id for the same scoped subject and predicate.' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, ctx) => {
      if (Object.keys(args).some(k => !['subject', 'predicate', 'value', 'supersedes'].includes(k))) throw new Error('Unknown memory proposal field.');
      const root = deps.root(), chatId = ctx.params.chatId, context = chatId ? deps.context(chatId) : null;
      if (!root || !context) throw new Error('Memory proposals require a role chat with an active run and brain.');
      if (typeof args.subject !== 'string' || typeof args.predicate !== 'string' || typeof args.value !== 'string' || (args.supersedes !== undefined && typeof args.supersedes !== 'string')) throw new Error('Invalid memory proposal.');
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
