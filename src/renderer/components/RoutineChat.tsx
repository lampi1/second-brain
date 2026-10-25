// Live step worker and its browser stay in Routine. This is an ordinary page surface, so questions and file viewers
// can open above it and native browser views use the existing clipping/overlay safety model.
import { Suspense, lazy, useEffect, useRef } from 'react';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { showTab } from '../actions';
import { BrowserTile } from './BrowserTile';
import { t } from '../i18n';
const ChatTile = lazy(() => import('./ChatTile').then(module => ({ default: module.ChatTile })));
export function RoutineChat({ chatId, tabId, onClose }: { chatId: string; tabId?: string; onClose: () => void }) {
  const browserRef = useRef<HTMLElement>(null);
  const chat = useApp(state => state.chats[chatId]);
  const tabs = useApp(state => state.tabs.filter(tab => tab.ownerChatId === chatId));
  const selected = tabs.find(tab => tab.id === tabId) ?? tabs[0];
  useEffect(() => { if (tabId && selected?.id === tabId) browserRef.current?.scrollIntoView({ block: 'start' }); }, [tabId, selected?.id]);
  if (!chat) return null;
  return <section className="rt-agent-page" data-testid="routine-agent" onKeyDown={event => {
    const state = ui.get(); if (event.key === 'Escape' && !state.viewer.open && !state.modal && !state.qwin.shown) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="rt-detail-head"><button type="button" className="btn btn-ghost btn-s" onClick={onClose} data-testid="routine-agent-back">‹ {t('rt.title')}</button><h2>{chat.title}</h2></header>
    <div className="rt-agent-conversation"><Suspense fallback={<p>{t('flows.loading')}</p>}><ChatTile chatId={chatId} embedded focus /></Suspense></div>
    {selected && <section ref={browserRef} className="rt-agent-browser" data-testid="routine-agent-browser"><nav aria-label="Browser">{tabs.map(tab => <button type="button" key={tab.id} className="btn btn-ghost btn-s" aria-pressed={tab.id === selected.id} onClick={() => showTab(tab.id)}>{tab.title || tab.url}</button>)}</nav><BrowserTile tabId={selected.id} embedded /></section>}
  </section>;
}
