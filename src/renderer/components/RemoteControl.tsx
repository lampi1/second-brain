// «Controllo remoto» (ADR 0229): the phone on the Orchestrator's head turns Claude Code Remote Control on and off
// (chat:remoteControl), and while it is on a line under the head shows the claude.ai link to open on the phone, with
// «Copia link» and «Spegni» (also while it starts: it cancels the bridge being made). No QR code: the app has no QR library (ADR 0229), so the line says to copy the link. The
// bridge itself lives in main (chats/manager-remote.ts, chats/claude.ts). Used by OrchestratorTile.tsx.
import '../styles/remote.css';
import type { ChatSummary } from '@shared/contract';
import { setRemoteControl } from '../store/store';
import { copyLink } from '../actions';
import { t } from '../i18n';
import { IconButton } from './ui';
import { IconPhone } from './Icons';

/** Remote Control is only for an Orchestrator on Claude Code. */
function offered(chat: ChatSummary): boolean {
  return chat.isOrchestrator === true && chat.harness === 'claude' && !chat.closedAt;
}

export function RemoteButton({ chat }: { chat: ChatSummary }) {
  if (!offered(chat)) return null;
  const on = chat.remoteControl?.on === true;
  return <IconButton label={on ? t('remote.turnOff') : t('remote.turnOn')} aria-pressed={on} className={on ? 'remote-on' : ''}
    onClick={() => void setRemoteControl(chat.id, !on)} testid="orchestrator-remote"><IconPhone size={14} /></IconButton>;
}

export function RemoteLine({ chat }: { chat: ChatSummary }) {
  const rc = chat.remoteControl;
  if (!offered(chat) || !rc || rc.status === 'off') return null;
  if (rc.status === 'failed') {
    return <div className="remote-line remote-failed" role="alert" data-testid="remote-line" data-status="failed">
      <IconPhone size={14} aria-hidden="true" /><span>{t('remote.failed', { error: rc.error ?? '' })}</span>
      <button type="button" className="btn btn-subtle btn-s" onClick={() => void setRemoteControl(chat.id, true)} data-testid="remote-retry">{t('remote.retry')}</button>
    </div>;
  }
  const text = rc.status === 'starting' ? t('remote.starting') : rc.status === 'paused' ? t('remote.paused')
    : rc.status === 'connected' ? t('remote.connected') : t('remote.ready');
  const url = rc.url;
  return <div className="remote-line" role="status" data-testid="remote-line" data-status={rc.status}>
    <IconPhone size={14} aria-hidden="true" />
    <div className="remote-body">
      <span>{text}</span>
      {url && rc.status !== 'starting' && <a className="remote-url" href={url} target="_blank" rel="noreferrer" data-testid="remote-url">{url}</a>}
      {url && rc.status !== 'starting' && <span className="remote-noqr">{t('remote.noQr')}</span>}
    </div>
    {url && <button type="button" className="btn btn-subtle btn-s" onClick={() => void copyLink(url)} data-testid="remote-copy">{t('remote.copy')}</button>}
    <button type="button" className="btn btn-subtle btn-s" onClick={() => void setRemoteControl(chat.id, false)} data-testid="remote-off">{t('remote.off')}</button>
  </div>;
}
