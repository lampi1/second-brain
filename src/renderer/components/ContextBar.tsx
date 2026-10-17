// Passive context size and explicit handoff status/links. Long context alone never prompts a new session.
import{t}from'../i18n';
import type { ChatSummary } from '@shared/contract';
import { isLongChat } from '@shared/context';
import { tokensShort } from '../lib/format';
import { focusChat, reopenChat } from '../actions';
import { useApp } from '../store/store';
import { IconArrowRight, IconHistory, IconSpinner } from './Icons';

export const DEFAULT_WARN = 200_000;
export const useWarnTokens = (): number => useApp(s => s.settings?.contextWarnTokens ?? DEFAULT_WARN);
export const isLong = (c: Pick<ChatSummary, 'harness' | 'contextTokens' | 'contextMaxTokens' | 'contextEstimated'>, warn: number): boolean => isLongChat(c, warn);
/** The chat that continues this one, while it is still in the app (a closed one no longer counts: "Riprendi" again). */
export const useContinuedBy = (chat: ChatSummary | undefined): ChatSummary | undefined =>
  useApp(s => (chat?.continuedBy ? s.chats[chat.continuedBy.id] : undefined));

export const RESUME_LABEL = 'Riprendi in chat nuova';
export const OPEN_NEXT_LABEL = 'Apri la chat che continua';

/** The size of the chat's context in the sub-line: number + a thin bar when the window size is known. */
export function ContextMeter({ chat, warn }: { chat: ChatSummary; warn: number }) {
  const n = chat.contextTokens;
  if (!n) return null;
  const long = isLong(chat, warn);
  const compacts = chat.harness === 'claude' && !!chat.contextMaxTokens && !chat.contextEstimated;
  const pct = chat.contextMaxTokens ? Math.min(100, Math.round((n / chat.contextMaxTokens) * 100)) : null;
  const label = `${chat.contextEstimated ? '~' : ''}${tokensShort(n)}`;
  const tip = [
    chat.contextEstimated ? `Contesto stimato: circa ${tokensShort(n)} token (Cursor non lo dice: contati dai testi della chat)` : `Contesto: ${tokensShort(n)} token${chat.contextMaxTokens ? ` di ${tokensShort(chat.contextMaxTokens)} (${pct}%)` : ''}`,
    compacts ? `Compatta da sola vicino a ${tokensShort(chat.contextMaxTokens ?? 0)}${long ? ': manca poco' : ''}`
      : chat.harness==='codex'?t('context.native'):t('context.passive'),
  ].join('|');
  return (
    <span className={`th-ctx ${long ? 'long' : ''} ${chat.contextEstimated ? 'est' : ''}`} data-tip={tip} role="img" aria-label={`Contesto ${chat.contextEstimated ? 'stimato ' : ''}${tokensShort(n)} token${long ? ', lungo' : ''}`} data-testid={`chat-ctx-${chat.id}`}>
      <span className="th-ctx-n">{label}</span>
      {pct !== null && <span className="th-ctx-bar" aria-hidden="true"><b style={{ width: `${Math.max(3, pct)}%` }} /></span>}
    </span>
  );
}

/** Only an actual user-requested handoff in progress needs a status. Context length stays a passive meter. */
export function ContextNotice({chat}:{chat:ChatSummary}){
 if(!chat.handoffBusy)return null;
 return <div className="ctx-bar busy" role="status" data-testid={`ctx-bar-${chat.id}`}><IconSpinner size={14}/><span className="ctx-text">{t('context.handoffBusy')}</span></div>;
}

/** "Continua in «X»" on the old chat, "Segue da «X»" on the new one (when the other one is still in the app). */
export function ChatLinks({ chat }: { chat: ChatSummary }) {
  const by = useContinuedBy(chat);
  const from = useApp(s => (chat.continuedFrom ? s.chats[chat.continuedFrom.id] : undefined));
  if (!chat.continuedBy && !chat.continuedFrom) return null;
  return (
    <div className="chat-links" data-testid={`chat-links-${chat.id}`}>
      {chat.continuedFrom && (
        <span className="chat-link-from"><IconHistory size={12} /> Segue da {from
          ? <button type="button" className="link-btn" onClick={() => void (from.closedAt ? reopenChat(from.id) : focusChat(from.id))} data-testid={`chat-from-${chat.id}`}>«{chat.continuedFrom.title}»</button>
          : <span>«{chat.continuedFrom.title}»</span>}</span>
      )}
      {chat.continuedBy && (
        <span className="chat-link-by">Il lavoro continua in {by
          ? <button type="button" className="link-btn" onClick={() => void (by.closedAt ? reopenChat(by.id) : focusChat(by.id))} data-testid={`chat-by-${chat.id}`}>«{chat.continuedBy.title}» <IconArrowRight size={12} /></button>
          : <span>«{chat.continuedBy.title}»</span>}</span>
      )}
    </div>
  );
}
