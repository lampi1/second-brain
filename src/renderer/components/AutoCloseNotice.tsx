// Discreet countdown from the authoritative backend deadline, on the chat's own tile only (no global popup).
// A held work chat shows instead what it waits for ("In attesa di…", #86, ADR 0084): main names it, never the renderer.
// The clock runs only for a strip with a deadline (every second near it), not for every strip all day. Used by ChatTile.
import { t as auditText } from '../i18n';
import { useState } from 'react';
import { useNow } from '../lib/clock';
import { autoCloseRemaining, autoCloseState, keepAgentOpen } from '../store/auto-close';
import type { AutoCloseStatus } from '@shared/auto-close';
import '../styles/auto-close.css';

/** The countdown shows from SHOW_MS before the deadline; until SLOW_MS before it the clock ticks every 10 s, not every
 *  second (a strip far from its deadline re-renders 10 times less; the countdown still appears on time). */
const SHOW_MS = 120_000, SLOW_MS = 140_000;

export function AutoCloseNotice({ chatId }: { chatId: string }) {
  const row = autoCloseState.use(rows => rows.find(r => r.chatId === chatId));
  if (!row) return null;
  if (!row.keptOpen && row.deadline === null) {
    return row.waitingFor ? <div className="agent-waiting" data-testid={`autoclose-waiting-${chatId}`} data-waiting={row.waitingFor} title={auditText('cmp.autoClose.waitingTip')}>
      <span className="agent-waiting-dot" aria-hidden="true" /><span className="agent-waiting-text">{auditText(`cmp.autoClose.waiting.${row.waitingFor}`)}</span>
    </div> : null;
  }
  return <Countdown row={row} chatId={chatId} />;
}

/** A deadline (or «tenuta aperta»): only here the clock runs, every second once the countdown is near. */
function Countdown({ row, chatId }: { row: AutoCloseStatus; chatId: string }) {
  useNow(row.keptOpen ? 3_600_000 : autoCloseRemaining(row) > SLOW_MS ? 10_000 : 1_000);
  const [failed, setFailed] = useState(false);
  if (!row.keptOpen && (row.deadline === null || autoCloseRemaining(row) > SHOW_MS)) return null;
  const seconds = row.deadline === null ? 0 : Math.max(0, Math.ceil(autoCloseRemaining(row) / 1_000));
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div className="agent-autoclose" data-autoclose-id={chatId} data-testid={`autoclose-notice-${chatId}`}>
    <span>{row.keptOpen ? auditText('auditExpression.AutoCloseNotice.text5') : auditText('auditExpression.AutoCloseNotice.text6', { v0: countdown })}</span>{' '}
    <button type="button" className="link-btn" onClick={() => void keepAgentOpen(chatId, !row.keptOpen).then(ok => setFailed(!ok))}>{row.keptOpen ? auditText('auditExpression.AutoCloseNotice.text7') : auditText('auditExpression.AutoCloseNotice.text5')}</button>
    {failed && <span role="alert">{auditText('audit.AutoCloseNotice.requestNotConfirmedTryAgainTo')}</span>}
  </div>;
}
