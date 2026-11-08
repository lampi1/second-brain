// Host request bindings shared by the chat manager and deterministic tests. Never trust an agent-supplied actor or key.
import type { ChatSummary, PendingRequest } from '../../shared/contract';
import { proposalHash, type CoordinationStore } from './store';
import type { RequestKey } from './model';

export function requestKey(store: CoordinationStore, chat: ChatSummary, req: Omit<PendingRequest, 'chatId'>): RequestKey {
  return { originalRequestId: req.id, jobId: store.jobFor(chat.id) ?? chat.run?.taskId ?? `chat:${chat.id}`, chatId: chat.id,
    runId: chat.run?.runId ?? null, taskVersion: chat.run?.taskVersion ?? 1, proposalRevision: req.at,
    proposalHash: proposalHash({ type: req.type, tool: req.tool, title: req.title, detail: req.detail, questions: req.questions, input: req.input, noAlways: req.noAlways }) };
}
export function registerRequest(store: CoordinationStore, chat: ChatSummary, req: Omit<PendingRequest, 'chatId'>): void {
  const key = requestKey(store, chat, req), previous = store.original(chat.id, req.id);
  // Existing renderer IPC carries only chatId/requestId. Until it carries the full binding, never recycle that pair:
  // an old button otherwise selects the new request and could approve a different proposal or assignment.
  if (previous && proposalHash(previous.key) !== proposalHash(key)) throw new Error('Engine reused a request id with changed scope; a fresh request id is required.');
  // Permission inputs may contain credentials: hash their scope, do not copy raw inputs into a new archive.
  const payload = { id: req.id, chatId: chat.id, type: req.type, tool: req.tool, at: req.at,
    ...(req.type === 'question' ? { title: req.title, detail: req.detail, questions: req.questions } : { title: req.tool }) };
  const row = store.register({ key, kind: req.type, at: req.at, payload });
  if (row.state !== 'pending') throw new Error('Request already answered or cancelled; stale engine notification refused.');
}
