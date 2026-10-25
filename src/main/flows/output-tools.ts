// Routine-only output and human-handoff tools. Caller identity comes from its authenticated chat endpoint;
// the runtime checks the current bound task and the exact package policy, never an agent-supplied run id.
import type { McpTool } from '../mcp/server';
export function flowOutputTools(ports: { output(chatId: string, id: string, content: string): unknown; downgrade(chatId: string, reason: string): Promise<unknown>; intake?(chatId: string, outcome: 'accept' | 'skip', reason: string): Promise<unknown>; verdict?(chatId: string, outcome: 'ai-fixable' | 'needs-human', reason: string): Promise<unknown>; stepHistory?(chatId: string, text: string): unknown }): McpTool[] {
  return [
    ...(['intake', 'verdict', 'step_history'] as const).map(kind => ({
      name: `flow_${kind}`, description: kind === 'intake' ? 'First running step only, before all writes: accept continues; skip ends quietly with no external comment or lesson. Give the reason and do not report success after skip.' : kind === 'verdict' ? 'Record ai-fixable after accepted intake, or end needs-human without a false-positive lesson. After ai-fixable use flow_downgrade instead.' : 'Prepare the single short step history entry: outcome, key evidence and next step. Safe Markdown links to the approved DevOps organization and uploaded attachment:ID images only. The host posts it on completion/block and adds milestone mentions; no duplicate comment needed.',
      inputSchema: { type: 'object', additionalProperties: false, properties: kind === 'step_history' ? { text: { type: 'string', maxLength: 4000 } } : { outcome: { type: 'string', enum: kind === 'intake' ? ['accept', 'skip'] : ['ai-fixable', 'needs-human'] }, reason: { type: 'string', maxLength: 2000 } }, required: kind === 'step_history' ? ['text'] : ['outcome', 'reason'] },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: kind === 'verdict' },
      run: async (args, ctx) => {
        if (!ctx.params.chatId) throw new Error('Bound routine chat required');
        if (kind === 'step_history') { if (!ports.stepHistory || typeof args.text !== 'string') throw new Error('Step history unavailable'); return JSON.stringify(ports.stepHistory(ctx.params.chatId, args.text)); }
        if (typeof args.reason !== 'string') throw new Error('Reason required');
        if (kind === 'intake' && ports.intake && ['accept', 'skip'].includes(String(args.outcome))) return JSON.stringify(await ports.intake(ctx.params.chatId, args.outcome as 'accept' | 'skip', args.reason));
        if (kind === 'verdict' && ports.verdict && ['ai-fixable', 'needs-human'].includes(String(args.outcome))) return JSON.stringify(await ports.verdict(ctx.params.chatId, args.outcome as 'ai-fixable' | 'needs-human', args.reason));
        throw new Error('Invalid outcome or unavailable capability');
      },
    } satisfies McpTool)),
    { name: 'flow_output', description: 'Save a declared output of this exact routine package. id must match package.outputs; content is an immutable bounded lesson/report. A declared brainPath is projected append-only by the host. Never directly edit brain memory, rules or skills from a routine.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string', maxLength: 16000 } }, required: ['id', 'content'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (args, ctx) => { if (!ctx.params.chatId || typeof args.id !== 'string' || typeof args.content !== 'string') throw new Error('Bound routine chat required'); return JSON.stringify(ports.output(ctx.params.chatId, args.id, args.content)); } },
    { name: 'flow_downgrade', description: 'At any agent step, stop the normal run and invoke its approved needs-human policy. Explain why automation is blocked and exactly what a person must do. The host records a declared lesson, updates the run work item, abandons its draft PR and settles its test lease. No hidden brain edits; cleanup failures remain visible. No successful agent_report after this call.',
      inputSchema: { type: 'object', properties: { reason: { type: 'string', maxLength: 2000 } }, required: ['reason'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      run: async (args, ctx) => { if (!ctx.params.chatId || typeof args.reason !== 'string') throw new Error('Bound routine chat required'); return JSON.stringify(await ports.downgrade(ctx.params.chatId, args.reason)); } },
  ];
}
