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
import { t, locale } from '../i18n';
import { Markdown } from './ChatItems';
import { IconFile, IconLayers, IconSpinner } from './Icons';
import { openNextLabel, resumeLabel, useContinuedBy } from './ContextBar';
import { Modal } from './ui';

const when = (at: number) => new Date(at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
  const canResume = !chat.isOrchestrator && (!!next || (!busy && !working));
  const copyPath = () => { if (h) void navigator.clipboard.writeText(h.path).then(() => toast(t('dialogs.linkPeek.copyPathSuccess'), 'ok')).catch(() => {}); };
  return (
    <Modal onClose={closeModal} label={`${t('dialogs.handoffDialog.title')} · ${chat.title}`} testid="handoff" className="modal-handoff" size="m"
      icon={<IconLayers size={16} />} title={t('dialogs.handoffDialog.title')} subtitle={<span className="handoff-chat" title={chat.title}>{chat.title}</span>} closeButton
      footer={<>
        {!past && !next && (
          <button type="button" className="btn btn-ghost btn-m" onClick={() => void writeHandoff(chatId)} disabled={busy || working}
            data-tip={working ? t('dialogs.handoffDialog.notYetDone') : t('dialogs.handoffDialog.updateTip')} data-testid="handoff-write">
            {h ? t('dialogs.handoffDialog.update') : t('dialogs.handoffDialog.writeNow')}
          </button>
        )}
        <span className="sp" />
        <button type="button" className="btn btn-ghost btn-m" onClick={closeModal} autoFocus={past || !canResume} data-testid="handoff-close">{t('dialogs.handoffDialog.closeButton')}</button>
        {!past && !chat.isOrchestrator && (
          <button type="button" className="btn btn-primary btn-m" autoFocus={canResume} disabled={!canResume} onClick={() => { closeModal(); void resumeChat(chatId); }} data-testid="handoff-resume">
            {next ? openNextLabel() : resumeLabel()}
          </button>
        )}
      </>}>
      {busy ? (
        <div className="handoff-empty" role="status" data-testid="handoff-busy">
          <IconSpinner size={18} />
          <p><b>{t('dialogs.handoffDialog.busy')}</b><br />{t('dialogs.handoffDialog.busyDescription')}</p>
        </div>
      ) : h === undefined ? (
        <div className="handoff-empty"><IconSpinner size={18} /></div>
      ) : h === null ? (
        <div className="handoff-empty" data-testid="handoff-none">
          <p><b>{t('dialogs.handoffDialog.none')}</b><br />{t('dialogs.handoffDialog.noneDescription')}</p>
        </div>
      ) : (
        <>
          <div className="handoff-meta" data-testid="handoff-meta">
            <span className={`handoff-src ${h.source}`}>{h.source === 'chat' ? t('dialogs.handoffDialog.fromChat') : t('dialogs.handoffDialog.automatic')}</span>
            <span>{when(h.at)}</span>
            {h.contextTokens ? <span>{t('dialogs.handoffDialog.contextTokens', { n: tokensShort(h.contextTokens) })}</span> : null}
            <span className="sp" />
            <button type="button" className="handoff-path" onClick={copyPath} data-tip={`${h.path}|${t('dialogs.handoffDialog.copyPathTip')}`} data-testid="handoff-path"><IconFile size={12} />{h.path.split(/[\\/]/).pop()}</button>
          </div>
          <div className="handoff-text" data-testid="handoff-text"><Markdown text={h.text} /></div>
        </>
      )}
      {past && <p className="menu-note" data-testid="handoff-past">{t('dialogs.handoffDialog.pastSession')}</p>}
      {!past && next && <p className="menu-note">{t('dialogs.handoffDialog.continuesElsewhere', { title: next.title })}</p>}
    </Modal>
  );
}
