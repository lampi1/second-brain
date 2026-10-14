// Long chats in a tile: the context meter of the sub-line ("182k", "~31k" when Cursor's size is an estimate; amber near
// a Claude chat's compaction window, or above the user's threshold contextWarnTokens on Cursor: shared/context.ts), the
// amber notice of a long Cursor chat (every message re-reads the whole story: "Riprendi" opens a new chat from the
// hand-off; Claude chats compact by themselves, ADR 0031), "writing the hand-off…" while a chat writes it, and the links
// between a chat and the one that continues it. Why: 80% of the spend was re-reading context (owner, 2026-10-11).
// Used by ChatTile; the hand-off dialog is HandoffDialog.tsx.
import type { ChatSummary } from '@shared/contract';
import { isLongChat } from '@shared/context';
import { tokensShort } from '../lib/format';
import { focusChat, reopenChat, resumeChat } from '../actions';
import { useApp } from '../store/store';
import { openHandoff } from '../store/ui';
import { IconArrowRight, IconHistory, IconLayers, IconSpinner, IconX } from './Icons';
import { HelpTip } from './HelpTip';

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
      : long ? `Sopra la soglia di ${tokensShort(warn)}: ogni messaggio rilegge tutta la storia` : `Soglia del contesto lungo: ${tokensShort(warn)}`,
  ].join('|');
  return (
    <span className={`th-ctx ${long ? 'long' : ''} ${chat.contextEstimated ? 'est' : ''}`} data-tip={tip} role="img" aria-label={`Contesto ${chat.contextEstimated ? 'stimato ' : ''}${tokensShort(n)} token${long ? ', lungo' : ''}`} data-testid={`chat-ctx-${chat.id}`}>
      <span className="th-ctx-n">{label}</span>
      {pct !== null && <span className="th-ctx-bar" aria-hidden="true"><b style={{ width: `${Math.max(3, pct)}%` }} /></span>}
    </span>
  );
}

/** The amber notice of a long chat (and the hand-off being written). Not on the Regia (its own menu restarts it), nor
 *  on a Claude chat that knows its window: it compacts by itself at the same cost (ADR 0031); "Riprendi" stays in the
 *  menu for a change of engine, model or task. */
export function ContextNotice({ chat, warn, onDismiss }: { chat: ChatSummary; warn: number; onDismiss: () => void }) {
  const next = useContinuedBy(chat);
  if (chat.handoffBusy) {
    return (
      <div className="ctx-bar busy" role="status" data-testid={`ctx-bar-${chat.id}`}>
        <IconSpinner size={14} />
        <span className="ctx-text"><b>Passaggio di consegne in corso.</b> Un turno breve: stato, file, decisioni, prossimo passo.</span>
      </div>
    );
  }
  if (chat.isRegia || chat.appRegia || next || !isLong(chat, warn)) return null;
  if (chat.harness === 'claude' && chat.contextMaxTokens && !chat.contextEstimated) return null;
  const ready = !!chat.handoffAt;
  return (
    <div className="ctx-bar" role="note" data-testid={`ctx-bar-${chat.id}`}>
      <IconLayers size={14} />
      <span className="ctx-text">
        <b>Contesto lungo · {chat.contextEstimated ? '~' : ''}{tokensShort(chat.contextTokens ?? 0)}</b>
        <HelpTip label="Contesto lungo e passaggio di consegne" title="Passaggio di consegne" testid={`ctx-help-${chat.id}`}>
          La chat scrive un riassunto breve: stato, file, decisioni, prossimo passo. Una chat nuova parte da lì e non rilegge tutta la storia, quindi ogni messaggio costa molto meno.
        </HelpTip>
        {ready ? ' Il passaggio di consegne è pronto: riprendi in una chat nuova che parte da lì.' : ' Ogni messaggio rilegge tutta la storia: riprendere in una chat nuova costa meno.'}
      </span>
      <button type="button" className="btn btn-subtle btn-s" onClick={() => openHandoff(chat.id)} data-testid={`ctx-handoff-${chat.id}`}>{ready ? 'Vedi passaggio' : 'Passaggio di consegne'}</button>
      <button type="button" className="btn btn-amber btn-s" onClick={() => void resumeChat(chat.id)} disabled={chat.state === 'running' || chat.state === 'starting' || chat.pending > 0}
        data-tip={chat.state === 'running' || chat.pending > 0 ? 'Quando la chat ha finito il turno' : 'Una chat nuova, stesso motore e cartella, che parte dal passaggio di consegne'} data-testid={`ctx-resume-${chat.id}`}>
        {RESUME_LABEL}
      </button>
      <button type="button" className="ctx-x" aria-label="Nascondi l'avviso" data-tip="Nascondi" onClick={onDismiss} data-testid={`ctx-dismiss-${chat.id}`}><IconX size={12} /></button>
    </div>
  );
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
