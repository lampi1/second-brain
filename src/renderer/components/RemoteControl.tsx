// «Controllo remoto» (ADR 0229 + Telegram bridge): the phone button on the Orchestrator's head turns remote control on
// and off. On Claude Code it drives Claude Remote Control (chat:remoteControl + claude.ai link). On Antigravity (Neon)
// and other engines it surfaces the engine-agnostic Telegram Phone Bridge (lib/phone.ts, ADR 0219) directly in the
// Orchestrator header with live status, 1-click toggle, or quick jump to Settings → Telefono. Used by OrchestratorTile.tsx.
import '../styles/remote.css';
import { useEffect, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import { setRemoteControl } from '../store/store';
import { copyLink, go } from '../actions';
import { phoneApi, phoneStatus, startPhone } from '../lib/phone';
import { toast } from '../store/ui';
import { errText } from '../lib/ipc-error';
import { t } from '../i18n';
import { IconButton } from './ui';
import { IconPhone, IconX } from './Icons';

/** Remote Control is offered for every active Orchestrator (Claude native bridge, or Telegram bridge on Antigravity & others). */
function offered(chat: ChatSummary): boolean {
  return chat.isOrchestrator === true && !chat.closedAt;
}

export function RemoteButton({ chat, reveal }: { chat: ChatSummary; reveal: () => void }) {
  const phone = phoneStatus.use(s => s);
  useEffect(() => { if (offered(chat) && chat.harness !== 'claude') startPhone(); }, [chat.harness, chat.id]);
  if (!offered(chat)) return null;
  if (chat.harness === 'claude') {
    const on = chat.remoteControl?.on === true;
    return <IconButton label={on ? t('remote.copy') : t('remote.turnOn')} aria-pressed={on} className={on ? 'remote-on' : ''}
      onClick={() => { reveal(); if (!on) void setRemoteControl(chat.id, true); }} testid="orchestrator-remote"><IconPhone size={14} /></IconButton>;
  }
  const on = !!phone && phone.enabled && phone.state === 'running';
  return <IconButton label={on ? 'Controllo remoto Telegram attivo' : 'Controllo remoto (Telegram)'} aria-pressed={on} className={on ? 'remote-on' : ''}
    onClick={reveal} testid="orchestrator-remote"><IconPhone size={14} /></IconButton>;
}

export function RemoteLine({ chat, dismiss, forceOpen }: { chat: ChatSummary; dismiss: () => void; forceOpen?: boolean }) {
  const phone = phoneStatus.use(s => s);
  const [busy, setBusy] = useState(false);
  if (!offered(chat)) return null;
  if (chat.harness !== 'claude') {
    const connected = !!phone && phone.enabled && phone.state === 'running';
    if (!forceOpen && !connected) return null;
    const api = phoneApi();
    const toggle = async (enabled: boolean) => {
      if (!api || busy) return;
      setBusy(true);
      try { phoneStatus.set(await api.update({ enabled })); }
      catch (e) { toast(errText(e), 'err'); }
      finally { setBusy(false); }
    };
    const configured = !!phone?.hasToken && !!phone?.paired;
    const statusText = !phone
      ? 'Bridge Telegram non disponibile in questa sessione'
      : phone.state === 'dev-disabled'
      ? 'Bridge Telegram disattivato in istanza dev'
      : connected
      ? 'Controllo remoto attivo via Telegram — scrivi dal telefono a questo Orchestrator'
      : configured
      ? `Bridge Telegram in pausa (${t(`phone.state.${phone.state}`)})`
      : 'Collega il bot Telegram per controllare questo Orchestrator anche da telefono';
    return <div className="remote-line" role="status" data-testid="remote-line" data-status={connected ? 'connected' : 'ready'}>
      <IconPhone size={14} aria-hidden="true" />
      <div className="remote-body">
        <span>{statusText}</span>
      </div>
      {configured && api && phone.state !== 'dev-disabled' && (
        <button type="button" className="btn btn-subtle btn-s" disabled={busy} onClick={() => void toggle(!phone.enabled)} data-testid="remote-telegram-toggle">
          {phone.enabled ? t('remote.off') : 'Attiva'}
        </button>
      )}
      {!configured && (
        <button type="button" className="btn btn-subtle btn-s" onClick={() => { dismiss(); go({ page: 'impostazioni' }); }} data-testid="remote-telegram-setup">
          Configura Telegram
        </button>
      )}
      <IconButton label={t('chat.tile.close')} onClick={dismiss} testid="remote-dismiss"><IconX size={14} /></IconButton>
    </div>;
  }
  const rc = chat.remoteControl;
  if (!rc || rc.status === 'off') return null;
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
    <IconButton label={t('chat.tile.close')} onClick={dismiss} testid="remote-dismiss"><IconX size={14} /></IconButton>
  </div>;
}
