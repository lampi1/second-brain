// Prepared adapter launches and asynchronous permission consumption at the main/utility boundary.
// Main owns launch policy and callback implementations; the host owns the adapter instance.
import type { AcpOptions } from '../chats/acp';
import type { ApiOptions } from '../chats/api';
import type { ClaudeOptions } from '../chats/claude';
import type { CodexOptions } from '../chats/codex';
import type { AnswerPatch, HarnessSession, SessionSink } from '../chats/session';
import type { Answer } from '../../shared/contract';

export type PreparedAdapter =
  | { kind: 'claude'; options: ClaudeOptions }
  | { kind: 'acp'; options: AcpOptions }
  | { kind: 'codex'; options: CodexOptions }
  | { kind: 'api'; options: ApiOptions };

/** A fulfilled true means the host consumed this exact pending request, not merely queued its answer. */
export interface RuntimeAnswerConsumer {
  answerConsumed(requestId: string, answer: Answer, patch?: AnswerPatch): Promise<boolean>;
}

export type PreparedAdapterFactory = (launch: PreparedAdapter, sink: SessionSink) => HarnessSession;

let factory: PreparedAdapterFactory | null = null;
/** Main configures the opt-in path once; unit tests and the default factory remain in-process. */
export function setRuntimeFactory(value: PreparedAdapterFactory | null): void { factory = value; }
export function runtimeAdapter(launch: PreparedAdapter, sink: SessionSink): HarnessSession | null {
  return factory?.(launch, sink) ?? null;
}
