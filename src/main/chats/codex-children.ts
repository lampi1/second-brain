// Official app-server v2 ThreadItem schema (2026-10-17): collabAgentToolCall/subAgentActivity.
// https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json
// Tool-call completion is not child completion. Coverage remains partial: these are observations, not a census.
import type { ChildObservation, ChildState } from '../../shared/agents';
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string | null => typeof v === 'string' && v.length > 0 && v.length <= 300 ? v : null;
const STATES: Record<string, ChildState> = { pendingInit: 'running', running: 'running', interrupted: 'stopped', completed: 'completed', errored: 'failed', shutdown: 'stopped', notFound: 'unknown' };
export function codexChildren(value: unknown, source: 'live' | 'replay', observedAt: number): ChildObservation[] {
  const it = obj(value), call = str(it.id);
  if (!call) return [];
  if (it.type === 'subAgentActivity') {
    const id = str(it.agentThreadId);
    if (!id) return [];
    const states: Record<string, ChildState> = { started: 'running', interacted: 'unknown', interrupted: 'stopped', completed: 'completed' };
    return [{ key: id, nativeId: id, toolCallId: null, parentNativeId: null, kind: 'agent', state: states[String(it.kind)] ?? 'unknown', task: null, observedAt, source }];
  }
  if (it.type !== 'collabAgentToolCall' || !Array.isArray(it.receiverThreadIds)) return [];
  const states = obj(it.agentsStates);
  return [...new Set(it.receiverThreadIds)].flatMap(value => {
    const id = str(value);
    if (!id) return [];
    const state = STATES[String(obj(states[id]).status)] ?? 'unknown';
    return [{ key: id, nativeId: id, toolCallId: call, parentNativeId: it.tool === 'spawnAgent' ? str(it.senderThreadId) : null, kind: 'agent' as const, state,
      task: it.tool === 'spawnAgent' && typeof it.prompt === 'string' ? it.prompt.slice(0, 1200) : null, observedAt, source }];
  });
}
