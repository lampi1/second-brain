// Routine-only output and human-handoff tools. Caller identity comes from its authenticated chat endpoint;
// the runtime checks the current bound task and the exact package policy, never an agent-supplied run id.
import type { McpTool } from '../mcp/server';
export function flowOutputTools(ports: { output(chatId: string, id: string, content: string): unknown; downgrade(chatId: string, reason: string): Promise<unknown> }): McpTool[] {
  return [
    { name: 'flow_output', description: 'Save a declared output of this exact routine package. id must match package.outputs; content is an immutable bounded lesson/report. A declared brainPath is projected append-only by the host. Never directly edit brain memory, rules or skills from a routine.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string', maxLength: 16000 } }, required: ['id', 'content'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args, ctx) => { if (!ctx.params.chatId || typeof args.id !== 'string' || typeof args.content !== 'string') throw new Error('Bound routine chat required'); return JSON.stringify(ports.output(ctx.params.chatId, args.id, args.content)); } },
    { name: 'flow_downgrade', description: 'At any agent step, stop the normal run and invoke its approved needs-human policy. Explain why automation is blocked and exactly what a person must do. The host records a declared lesson, updates the run work item, abandons its draft PR and settles its test lease. No hidden brain edits; cleanup failures remain visible. No successful agent_report after this call.',
      inputSchema: { type: 'object', properties: { reason: { type: 'string', maxLength: 2000 } }, required: ['reason'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      run: async (args, ctx) => { if (!ctx.params.chatId || typeof args.reason !== 'string') throw new Error('Bound routine chat required'); return JSON.stringify(await ports.downgrade(ctx.params.chatId, args.reason)); } },
  ];
}
