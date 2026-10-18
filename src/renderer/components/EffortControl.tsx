// Always-visible effort status in agent/Regia headers, with a progressive control for the next turn.
// Provider effective value, submitted parameter and requested choice are kept distinct. No inferred medium/default.
import { t as auditText } from '../i18n';
import { useRef, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { engineCan } from '../lib/engines';
import { EFFORTS, effortLabel } from '../lib/format';
import { effortSummary } from '../lib/effort-status';
import { setChat } from '../store/store';
import { Popover } from './ui';
import '../styles/effort.css';

export function EffortControl({ chat }: { chat: ChatSummary }) {
  const ref = useRef<HTMLButtonElement>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); ref.current?.focus(); };
  const status = chat.effortStatus ?? { supported: engineCan(chat.harness, 'effort'), requested: chat.effort, submitted: null, effective: null, pending: false, effectiveSource: 'unknown' as const, sessionDefault: null };
  const summary = effortSummary(status);
  if(!summary.compactBadge)return null; // Missing provider data remains available in details; it is not repeated in every header.
  return <span className="effort-control" data-testid={`effort-${chat.id}`}>
    <button ref={ref} type="button" className="link-btn effort-badge" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={auditText('auditExpression.EffortControl.text34', { v0: summary.badge, v1: summary.requested, v2: summary.pending ? `. ${summary.pending}` : '' })} title={auditText('auditExpression.EffortControl.text36', { v0: summary.requested, v1: summary.submitted })}>{summary.compactBadge}</button>
    <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={330} testid={`effort-pop-${chat.id}`}>
      <div className="effort-details"><b>{auditText('audit.EffortControl.agentReasoning')}</b><dl><dt>{auditText('audit.EffortControl.activeReportedByTheProvider')}</dt><dd>{summary.active}</dd><dt>{auditText('audit.EffortControl.requestedChoice')}</dt><dd>{summary.requested}</dd><dt>{auditText('audit.EffortControl.parameterSentForTheTurn')}</dt><dd>{summary.submitted}</dd><dt>{auditText('audit.EffortControl.reportedSessionDefault')}</dt><dd>{summary.sessionDefault}</dd></dl>
        <p>{status.pending ? auditText('auditExpression.EffortControl.text37') : auditText('auditExpression.EffortControl.text38')}</p>
        {status.supported ? <><p>{auditText('audit.EffortControl.choiceForFutureTurns')}</p>{EFFORTS.map(effort => <button type="button" key={effort} className="menu-item" role="menuitemradio" aria-checked={status.requested === effort} disabled={busy} onClick={() => { if (busy) return; setBusy(true); void setChat(chat.id, { effort }).finally(() => { setBusy(false); close(); }); }}>{effortLabel(effort)}</button>)}</> : <p>{auditText('audit.EffortControl.thisEngineDoesNotSupportReasoning')}</p>}
        <button type="button" role="menuitem" className="menu-item" onClick={close}>{auditText('audit.EffortControl.close')}</button>
      </div>
    </Popover>
  </span>;
}
