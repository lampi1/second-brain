// Chat-local memory proposal tool, including direct root chats. The host supplies scope and provenance;
// model arguments cannot claim a different project, author, source or verification status.
import { randomUUID } from 'node:crypto';
import type { McpTool } from '../mcp/server';
import { proposeMemory, type MemoryScope } from './memory-records';

export interface MemoryToolDeps {
  root(): string | null;
  context(chatId: string): { scope: MemoryScope; sourceRunId: string } | null;
}
export function memoryTools(deps: MemoryToolDeps): McpTool[] {
  return [{
    name: 'memory_propose',
    description: 'Propose a durable setup fact for this role and current project, including from a direct chat. Stored as unverified data until independently confirmed. Never use for task results or instructions.',
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
  }];
}
