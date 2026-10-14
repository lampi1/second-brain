// The hand-off dialog of one chat: the note it wrote (or the app built) for whoever continues the work, rendered as
// markdown with who wrote it, when, at what context size and the file it lives in; "Scrivi ora" / "Aggiorna" asks the
// chat for a fresh one (one short turn), "Riprendi in chat nuova" opens the new chat that starts from it. Opened from
// the tile menu and the long-chat notice (ui.openHandoff); rendered by App.tsx for modal 'handoff'. From a cold
// continuation's divider it shows, read only, the note that session started from (ADR 0031).
import { useEffect, useState } from 'react';
import type { HandoffInfo } from '@shared/contract';
import { tokensShort } from '../lib/format';
import { resumeChat } from '../actions';
import { readHandoff, useApp, writeHandoff } from '../store/store';
import { closeModal, toast, ui } from '../store/ui';
import { Markdown } from './ChatItems';
import { IconFile, IconLayers, IconSpinner } from './Icons';
import { OPEN_NEXT_LABEL, RESUME_LABEL, useContinuedBy } from './ContextBar';
import { Keys, Modal } from './ui';

const when = (at: number) => new Date(at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function HandoffDialog() {
  const chatId = ui.use(s => s.handoffChat);
  const session = ui.use(s => s.handoffSession);
  const chat = useApp(s => (chatId ? s.chats[chatId] : undefined));
  const next = useContinuedBy(chat);
  const [h, setH] = useState<HandoffInfo | null | undefined>(undefined);
  const stamp = chat?.handoffAt ?? 0;
  useEffect(() => {
    if (!chatId) return;
    let live = true;
    void readHandoff(chatId, session).then(x => { if (live) setH(x); });
    return () => { live = false; };
  }, [chatId, session, stamp]);
  if (!chatId || !chat) return null;
  const past = !!session;
  const busy = !past && !!chat.handoffBusy;
  const working = chat.state === 'running' || chat.state === 'starting' || chat.pending > 0;
  const canResume = !chat.isRegia && !chat.appRegia && (!!next || (!busy && !working));
  const copyPath = () => { if (h) void navigator.clipboard.writeText(h.path).then(() => toast('Percorso copiato', 'ok')).catch(() => {}); };
  return (
    <Modal onClose={closeModal} label={`Passaggio di consegne · ${chat.title}`} testid="handoff" className="modal-handoff">
      <div className="modal-head">
        <IconLayers size={16} />
        <h2>Passaggio di consegne</h2>
        <span className="handoff-chat" title={chat.title}>{chat.title}</span>
        <span className="sp" /><Keys combo="Esc" />
      </div>
      <div className="modal-body">
        {busy ? (
          <div className="handoff-empty" role="status" data-testid="handoff-busy">
            <IconSpinner size={18} />
            <p><b>La chat sta scrivendo il passaggio…</b><br />Un turno breve: stato, file e worktree, decisioni, cosa è stato scartato, prossimo passo.</p>
          </div>
        ) : h === undefined ? (
          <div className="handoff-empty"><IconSpinner size={18} /></div>
        ) : h === null ? (
          <div className="handoff-empty" data-testid="handoff-none">
            <p><b>Nessun passaggio ancora.</b><br />La chat lo scrive in un turno breve: stato, file e worktree, decisioni prese, provato e scartato, prossimo passo. Una chat nuova riparte da lì senza rileggere tutta la storia.</p>
          </div>
        ) : (
          <>
            <div className="handoff-meta" data-testid="handoff-meta">
              <span className={`handoff-src ${h.source}`}>{h.source === 'chat' ? 'Scritto dalla chat' : 'Automatico (la chat non lo ha scritto)'}</span>
              <span>{when(h.at)}</span>
              {h.contextTokens ? <span>a {tokensShort(h.contextTokens)} token di contesto</span> : null}
              <span className="sp" />
              <button type="button" className="handoff-path" onClick={copyPath} data-tip={`${h.path}|clic per copiare`} data-testid="handoff-path"><IconFile size={12} />{h.path.split(/[\\/]/).pop()}</button>
            </div>
            <div className="handoff-text" data-testid="handoff-text"><Markdown text={h.text} /></div>
          </>
        )}
        {past && <p className="menu-note" data-testid="handoff-past">La sessione dopo «Continua da qui» è ripartita da questo passaggio.</p>}
        {!past && next && <p className="menu-note">Il lavoro continua già in «{next.title}».</p>}
      </div>
      <div className="modal-foot">
        {!past && !next && (
          <button type="button" className="btn btn-ghost btn-m" onClick={() => void writeHandoff(chatId)} disabled={busy || working}
            data-tip={working ? 'Quando la chat ha finito il turno' : 'La chat riscrive il passaggio adesso (un turno breve)'} data-testid="handoff-write">
            {h ? 'Aggiorna' : 'Scrivi ora'}
          </button>
        )}
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} autoFocus={past || !canResume} data-testid="handoff-close">Chiudi</button>
        {!past && !chat.isRegia && !chat.appRegia && (
          <button type="button" className="btn btn-primary btn-m" autoFocus={canResume} disabled={!canResume} onClick={() => { closeModal(); void resumeChat(chatId); }} data-testid="handoff-resume">
            {next ? OPEN_NEXT_LABEL : RESUME_LABEL}
          </button>
        )}
      </div>
    </Modal>
  );
}
