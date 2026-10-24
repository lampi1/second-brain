// Discreet countdown from the authoritative backend deadline, on the chat's own tile only (no global popup).
// A held work chat shows instead what it waits for ("In attesa di…", #86, ADR 0084): main names it, never the renderer.
import { t as auditText } from '../i18n';
import { useState } from 'react';
import { useNow } from '../lib/clock';
import { autoCloseRemaining, autoCloseState, keepAgentOpen } from '../store/auto-close';
import '../styles/auto-close.css';

export function AutoCloseNotice({ chatId }: { chatId: string }) {
  const row = autoCloseState.use(rows => rows.find(r => r.chatId === chatId));
  useNow(1_000);
  const [failed, setFailed] = useState(false);
  if (row && !row.keptOpen && row.deadline === null && row.waitingFor) {
    return <div className="agent-waiting" data-testid={`autoclose-waiting-${chatId}`} data-waiting={row.waitingFor} title={auditText('cmp.autoClose.waitingTip')}>
      <span className="agent-waiting-dot" aria-hidden="true" /><span className="agent-waiting-text">{auditText(`cmp.autoClose.waiting.${row.waitingFor}`)}</span>
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
