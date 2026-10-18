// The ⋯ menu of a chat tile, the everyday actions first (2026-10-15): rename, copy link, focus mode; then model, effort
// and permissions (engines that take them); "Passaggio di consegne" with the context size, the note and "Riprendi in chat
// nuova" (not on the Regia: it renews instead); close last. The same menu serves a Regia, which adds, after the
// everyday actions, "Pulisci" (a confirm, then the same engine started empty), "Ricomincia da capo" and
// "Cambia motore" (to the first other engine): both open the "Nuova Regia" confirm (RegiaRenewDialog); the old Regia goes on as
// a normal chat, history kept; the overlay's opacity (setting regiaOpacity, ADR 0021). "Chiudi la Regia" only while another Regia stays.
// TitleInput is the inline rename field the menu's "Rinomina…" opens. Used by ChatTile and RegiaTile.
import type { RefObject } from 'react';
import type { AppInfo, ChatSummary, Harness, Settings } from '@shared/contract';
import { EFFORTS, effortLabel, permissionLabel, PERMISSION_MODES, tokensShort } from '../lib/format';
import { engineCan, engineName, otherEngine } from '../lib/engines';
import { modelOptions, useModelsSeen } from '../lib/models';
import { makeLink } from '../lib/notify';
import { isBusy, sameList } from '../store/state';
import { closeChat, setChat, setSetting, useApp } from '../store/store';
import { openHandoff, setFocused } from '../store/ui';
import { askClearRegia, askCloseRegia, askRenewRegia, copyLink, resumeChat, toggleFocusMode } from '../actions';
import { regieIdsOf } from '../lib/regia-route';
import { openNextLabel, resumeLabel, useContinuedBy } from './ContextBar';
import { MenuItem, MenuLabel, MenuSep, Popover } from './ui';
import { t } from '../i18n';

/** Why the Regia cannot move to an engine now (null = it can): switched off in the settings, the Regie may not use it
 *  (a Regia is an agent itself), or its CLI missing. */
function engineBlock(h: Harness, s: Pick<Settings, 'engineOn' | 'engines'> | undefined, cli: AppInfo['cli'] | undefined): string | null {
  if (s && s.engineOn[h] !== true) return t('chat.menu.engineBlockOff', { engine: engineName(h) });
  if (s && s.engines[h] !== true) return t('chat.menu.engineBlockRegiaOff', { engine: engineName(h) });
  if (cli?.[h]?.found === false) return t('chat.menu.engineBlockCliMissing', { engine: engineName(h) });
  return null;
}

/** engineBlock for any engine, from one read of the settings and the CLI status (no hook per engine). */
export function useEngineBlocks(): (h: Harness) => string | null {
  const on = useApp(s => s.settings?.engineOn);
  const regie = useApp(s => s.settings?.engines);
  const cli = useApp(s => s.info?.cli);
  return h => engineBlock(h, on && regie ? { engineOn: on, engines: regie } : undefined, cli);
}

export function ChatMenu({ chat, anchor, open, onClose, onRename, regia }: {
  chat: ChatSummary; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onRename: () => void; regia?: boolean;
}) {
  const id = chat.id;
  const to = otherEngine(chat.harness);
  const blockOf = useEngineBlocks();
  const block = to ? blockOf(to) : null;
  const next = useContinuedBy(chat);
  const seen = useModelsSeen(open);
  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const opacity = useApp(s => s.settings?.regiaOpacity ?? 100);
  const regie = useApp(s => regieIdsOf(s), sameList);
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} testid={`chat-menu-pop-${id}`} width={regia ? 290 : 270}>
      <MenuItem onSelect={pick(onRename)} testid={`chat-rename-${id}`}>{t('chat.menu.rename')}</MenuItem>
      <MenuItem onSelect={pick(() => void copyLink(makeLink('home', regia ? 'regia' : `chat-${id}`)))} testid={`chat-link-${id}`}>{t('chat.menu.copyLink')}</MenuItem>
      {!regia && chat.space !== 'app' && <MenuItem onSelect={pick(() => { setFocused(`chat:${id}`); toggleFocusMode(); })} shortcut="Ctrl+Shift+F" testid={`chat-focusmode-${id}`}>{t('chat.menu.focusMode')}</MenuItem>}
      <MenuSep />
      {regia && (
        <>
          <MenuLabel>{t('chat.menu.regiaLabel')}</MenuLabel>
          <MenuItem onSelect={pick(() => askClearRegia(id))} testid={`chat-clear-${id}`}>{t('chat.menu.clear')}</MenuItem>
          {!chat.appRegia && (
            <>
              <MenuItem onSelect={pick(() => askRenewRegia(chat.harness))} shortcut="Ctrl+Shift+R" testid={`chat-renew-${id}`}>{t('chat.menu.renew')}</MenuItem>
              {to && (
                <>
                  <MenuItem onSelect={pick(() => askRenewRegia(to))} disabled={!!block} testid={`chat-engine-${id}`}>
                    {t('chat.menu.switchEngine', { engine: engineName(to) })}
                  </MenuItem>
                  {block && <p className="menu-note" data-testid={`chat-engine-block-${id}`}>{block}</p>}
                </>
              )}
            </>
          )}
          <label className="menu-range" data-testid="regia-opacity">
            <span>{t('chat.menu.opacityWord')} <b>{opacity}%</b></span>
            <input type="range" min={40} max={100} step={5} value={opacity} aria-label={t('chat.menu.opacityLabel')}
              onChange={e => void setSetting({ regiaOpacity: Number(e.target.value) })} data-testid="regia-opacity-range" />
          </label>
          <MenuSep />
        </>
      )}
      <MenuLabel>{t('chat.menu.modelLabel')}</MenuLabel>
      {modelOptions(chat.harness, seen, chat.model ?? '').map(m => (
        <MenuItem key={m.id || 'default'} checked={(chat.model ?? '') === m.id} onSelect={pick(() => void setChat(id, { model: m.id }))} testid={`chat-model-${id}-${m.id || 'default'}`}>{m.label}</MenuItem>
      ))}
      {engineCan(chat.harness, 'effort') && (
        <>
          <MenuSep />
          <MenuLabel>{t('chat.menu.effortLabel')}</MenuLabel>
          {EFFORTS.map(e => (
            <MenuItem key={e} checked={chat.effort === e} onSelect={pick(() => void setChat(id, { effort: e }))} testid={`chat-effort-${id}-${e}`}>{effortLabel(e)}</MenuItem>
          ))}
        </>
      )}
      {engineCan(chat.harness, 'permissionMode') && (
        <>
          <MenuSep />
          <MenuLabel>{t('chat.menu.permissionLabel')}</MenuLabel>
          {PERMISSION_MODES.map(p => (
            <MenuItem key={p} checked={chat.permissionMode === p} danger={p === 'bypassPermissions'} onSelect={pick(() => void setChat(id, { permissionMode: p }))} testid={`chat-perm-${id}-${p}`}>{permissionLabel(p)}</MenuItem>
          ))}
        </>
      )}
      <MenuSep />
      <MenuLabel>{t('chat.menu.handoffLabel', { tokens: chat.contextTokens ? t('chat.menu.handoffTokens', { amount: `${chat.contextEstimated ? '~' : ''}${tokensShort(chat.contextTokens)}` }) : undefined })}</MenuLabel>
      <MenuItem onSelect={pick(() => openHandoff(id))} testid={`chat-handoff-${id}`}>{t('chat.menu.handoffRead')}</MenuItem>
      {!chat.isRegia && !chat.appRegia && (
        <MenuItem onSelect={pick(() => void resumeChat(id))} disabled={!next && (isBusy(chat) || chat.pending > 0 || !!chat.handoffBusy)} testid={`chat-resume-${id}`}>
          {next ? openNextLabel() : resumeLabel()}
        </MenuItem>
      )}
      <MenuSep />
      {!regia && <MenuItem onSelect={pick(() => closeChat(id))} danger testid={`chat-close-${id}`}>{t('chat.menu.closeChat')}</MenuItem>}
      {regia && chat.isRegia && regie.length > 1 && regie[0] !== id && <MenuItem onSelect={pick(() => askCloseRegia(id))} danger testid={`chat-close-${id}`}>{t('chat.menu.closeRegia')}</MenuItem>}
    </Popover>
  );
}

/** Inline rename in a tile header: Enter or leaving the field saves, Esc cancels. */
export function TitleInput({ chat, onDone, className = 'th-title-input' }: { chat: Pick<ChatSummary, 'id' | 'title'>; onDone: () => void; className?: string }) {
  const save = (v: string) => { const t = v.trim(); if (t && t !== chat.title) void setChat(chat.id, { title: t }); onDone(); };
  return (
    <input className={className} defaultValue={chat.title} autoFocus aria-label={t('chat.menu.titleInput')} data-testid={`chat-title-input-${chat.id}`}
      onKeyDown={e => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
      }}
      onBlur={e => save(e.currentTarget.value)} />
  );
}
