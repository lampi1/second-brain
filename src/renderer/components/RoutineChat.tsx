// Retired routine workers remain readable on explicit open. No composer, execution controls or live browser mounts.
import { useEffect } from 'react';
import { useApp, loadItems } from '../store/store';
import { ChatTranscript } from './ChatTranscript';
import { t } from '../i18n';
export function RoutineChat({ chatId, onClose }: { chatId: string; tabId?: string; onClose(): void }) {
  const chat = useApp(s => s.chats[chatId]);
  useEffect(() => { void loadItems(chatId); }, [chatId]);
  if (!chat) return null;
  return <section className="rs-detail" data-testid="routine-agent">
    <header className="rs-head"><button type="button" className="btn btn-ghost btn-s" onClick={onClose}>{t('rs.back')}</button><h2>{chat.title}</h2></header>
    <p className="rs-muted">{t('rs.archived')}</p>
    <div className="rs-archive-chat"><ChatTranscript chatId={chatId} busy={false} expanded readOnly /></div>
  </section>;
}
