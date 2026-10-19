// Discreet countdown from the authoritative backend deadline. Also listed globally for off-screen agents.
// A held work chat shows instead what it waits for ("In attesa di…", #86, ADR 0084): main names it, never the renderer.
import { t as auditText } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNow } from '../lib/clock';
import { autoCloseRemaining, autoCloseState, keepAgentOpen } from '../store/auto-close';
import { useApp } from '../store/store';
import { focusChat } from '../actions';
import { registerOverlay } from '../lib/viewports';
import { ui } from '../store/ui';
import '../styles/auto-close.css';

export function AutoCloseNotice({ chatId }: { chatId: string }) {
  const row = autoCloseState.use(rows => rows.find(r => r.chatId === chatId));
  useNow(1_000);
  const [failed, setFailed] = useState(false);
  if (row && !row.keptOpen && row.deadline === null && row.waitingFor) {
    return <div className="agent-waiting" data-testid={`autoclose-waiting-${chatId}`} data-waiting={row.waitingFor} title={auditText('cmp.autoClose.waitingTip')}>
      <span className="agent-waiting-dot" aria-hidden="true" />{auditText(`cmp.autoClose.waiting.${row.waitingFor}`)}
    </div>;
  }
  if (!row || (!row.keptOpen && (row.deadline === null || autoCloseRemaining(row) > 120_000))) return null;
  const seconds = row.deadline === null ? 0 : Math.max(0, Math.ceil(autoCloseRemaining(row) / 1_000));
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div className="agent-autoclose" data-autoclose-id={chatId} data-testid={`autoclose-notice-${chatId}`}>
    <span>{row.keptOpen ? auditText('auditExpression.AutoCloseNotice.text5') : auditText('auditExpression.AutoCloseNotice.text6', { v0: countdown })}</span>{' '}
    <button type="button" className="link-btn" onClick={() => void keepAgentOpen(chatId, !row.keptOpen).then(ok => setFailed(!ok))}>{row.keptOpen ? auditText('auditExpression.AutoCloseNotice.text7') : auditText('auditExpression.AutoCloseNotice.text5')}</button>
    {failed && <span role="alert">{auditText('audit.AutoCloseNotice.requestNotConfirmedTryAgainTo')}</span>}
  </div>;
}
export function AutoCloseWarnings() {
  const ref = useRef<HTMLElement>(null);
  const modal = ui.use(s => !!s.modal || s.map);
  const rows = autoCloseState.use(s => s), chats = useApp(s => s.chats);
  useNow(1_000);
  const [announcement, announce] = useState('');
  const announced = useRef(new Set<string>());
  const warnings = rows.filter(r => !r.keptOpen && r.deadline !== null && autoCloseRemaining(r) <= 120_000 && chats[r.chatId] && !chats[r.chatId]?.closedAt);
  const warningKeys = warnings.map(r => `${r.chatId}:${r.generation}`).join('|');
  useEffect(() => {
    const fresh = warnings.filter(row => !announced.current.has(`${row.chatId}:${row.generation}`));
    if (fresh.length && !modal) {
      for (const row of fresh) announced.current.add(`${row.chatId}:${row.generation}`);
      announce(auditText('cmp.autoClose.announce', { names: fresh.map(r => chats[r.chatId]?.title ?? auditText('cmp.autoClose.anAgent')).join(', ') }));
    }
  }, [warningKeys, modal]);
  useLayoutEffect(() => { if (ref.current) return registerOverlay(ref.current); }, [warnings.length]);
  return <><span className="sr-only" role="status" aria-live="polite">{announcement}</span>{warnings.length > 0 && <aside ref={ref} hidden={modal} className="autoclose-warnings" aria-label={auditText('audit.AutoCloseNotice.agentsClosingSoon')} data-testid="autoclose-warnings">
    {warnings.map(row => <div key={row.chatId}><button type="button" className="link-btn" onClick={() => focusChat(row.chatId)}>{chats[row.chatId]?.title ?? auditText('auditExpression.AutoCloseNotice.text9')}</button><AutoCloseNotice chatId={row.chatId} /></div>)}
  </aside>}</>;
}
