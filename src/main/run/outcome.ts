// `run:outcome` (renderer IPC only, never an agent tool): Brother's verdict on a settled agent run. The renderer sends
// only chat and verdict; basis, author and time are fixed by ChatManager.markRun.
import type { ChatSummary } from '../../shared/contract';
import type { ChatService } from '../services';

const VERDICTS = ['success', 'partial', 'fail'] as const;
type Verdict = (typeof VERDICTS)[number];

export function markRunOutcome(chats: ChatService, a: unknown): ChatSummary {
  const req = a && typeof a === 'object' ? a as { chatId?: unknown; verdict?: unknown } : {};
  const { chatId, verdict } = req;
  if (typeof chatId !== 'string' || !chatId || chatId.length > 120) throw new Error('Richiesta non valida.');
  if (!VERDICTS.includes(verdict as Verdict)) throw new Error('Esito non valido.');
  if (!chats.markRun) throw new Error('Esito non disponibile.');
  const chat = chats.list().find(c => c.id === chatId);
  if (!chat?.run) throw new Error('Questa chat non è un’esecuzione di un Agente.');
  if (chat.state === 'starting' || chat.state === 'running' || chat.state === 'waiting' || chat.queued || chat.pending > 0 || chats.pending().some(p => p.chatId === chatId))
    throw new Error('L’esecuzione è ancora in corso: dai l’esito quando ha finito.');
  return chats.markRun(chatId, verdict as Verdict);
}
