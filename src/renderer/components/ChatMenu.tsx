// The ⋯ menu of a chat tile, the everyday actions first (2026-10-15): rename, copy link, focus mode; then model, effort
// and permissions (engines that take them); "Passaggio di consegne" with the context size, the note and "Riprendi in chat
// nuova" (not on the Orchestrator: it renews instead); close last. The same menu serves an Orchestrator, which adds, after the
// everyday actions, "Pulisci" (a confirm, then the same engine started empty), "Ricomincia da capo" and
// "Cambia motore" (to the first other engine): both open the "Nuovo Orchestrator" confirm (OrchestratorRenewDialog); the old Orchestrator goes on as
// a normal chat, history kept; the overlay's opacity (setting orchestratorOpacity, ADR 0021).
// TitleInput is the inline rename field the menu's "Rinomina…" opens. Used by ChatTile and OrchestratorTile.
import { useState, type RefObject } from 'react';
import { AgentContextInspector } from './AgentContextInspector';
import type { AppInfo, ChatSummary, Harness, Settings } from '@shared/contract';
import { EFFORTS, effortLabel, permissionLabel, PERMISSION_MODES, tokensShort } from '../lib/format';
import { engineCan, engineName, otherEngine } from '../lib/engines';
import { modelOptions, useModelsSeen } from '../lib/models';
import { makeLink } from '../lib/notify';
import { isBusy } from '../store/state';
import { closeChat, setChat, setSetting, undoTurn, useApp } from '../store/store';
import { askConfirm, openHandoff, setFocused } from '../store/ui';
import { askClearOrchestrator, askRenewOrchestrator, copyLink, resumeChat, toggleFocusMode } from '../actions';
import { openNextLabel, resumeLabel, useContinuedBy } from './ContextBar';
import { MenuItem, MenuLabel, MenuSep, Popover } from './ui';
import { t } from '../i18n';

/** Why the Orchestrator cannot move to an engine now (null = it can): switched off in the settings, the Orchestrators may not use it
 *  (an Orchestrator is an agent itself), or its CLI missing. */
function engineBlock(h: Harness, s: Pick<Settings, 'engineOn' | 'engines'> | undefined, cli: AppInfo['cli'] | undefined): string | null {
  if (s && s.engineOn[h] !== true) return t('chat.menu.engineBlockOff', { engine: engineName(h) });
  if (s && s.engines[h] !== true) return t('chat.menu.engineBlockOrchestratorOff', { engine: engineName(h) });
  if (cli?.[h]?.found === false) return t('chat.menu.engineBlockCliMissing', { engine: engineName(h) });
  return null;
}

/** engineBlock for any engine, from one read of the settings and the CLI status (no hook per engine). */
export function useEngineBlocks(): (h: Harness) => string | null {
  const on = useApp(s => s.settings?.engineOn);
  const orchestrators = useApp(s => s.settings?.engines);
  const cli = useApp(s => s.info?.cli);
  return h => engineBlock(h, on && orchestrators ? { engineOn: on, engines: orchestrators } : undefined, cli);
}

export function ChatMenu({ chat, anchor, open, onClose, onRename, orchestrator }: {
  chat: ChatSummary; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onRename: () => void; orchestrator?: boolean;
}) {
  const id = chat.id;
  const [inspectContext, setInspectContext] = useState(false);
  const to = otherEngine(chat.harness);
  const blockOf = useEngineBlocks();
  const block = to ? blockOf(to) : null;
  const next = useContinuedBy(chat);
  const seen = useModelsSeen(open);
  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const opacity = useApp(s => s.settings?.orchestratorOpacity ?? 100);
  return (<>
    {inspectContext && <AgentContextInspector chat={chat} onClose={() => setInspectContext(false)} />}
    <Popover anchor={anchor} open={open} onClose={onClose} testid={`chat-menu-pop-${id}`} width={orchestrator ? 290 : 270}>
      <MenuItem onSelect={pick(() => setInspectContext(true))} testid={`chat-context-${id}`}>{t('rt.context.title')}</MenuItem>
      <MenuItem onSelect={pick(onRename)} testid={`chat-rename-${id}`}>{t('chat.menu.rename')}</MenuItem>
      <MenuItem onSelect={pick(() => void copyLink(makeLink('home', orchestrator ? 'orchestrator' : `chat-${id}`)))} testid={`chat-link-${id}`}>{t('chat.menu.copyLink')}</MenuItem>
      {!orchestrator && <MenuItem onSelect={pick(() => { setFocused(`chat:${id}`); toggleFocusMode(); })} shortcut="Ctrl+Shift+F" testid={`chat-focusmode-${id}`}>{t('chat.menu.focusMode')}</MenuItem>}
      <MenuSep />
      {orchestrator && (
        <>
          <MenuLabel>{t('chat.menu.orchestratorLabel')}</MenuLabel>
          <MenuItem onSelect={pick(() => askClearOrchestrator(id))} testid={`chat-clear-${id}`}>{t('chat.menu.clear')}</MenuItem>
          <MenuItem onSelect={pick(() => askRenewOrchestrator(chat.harness))} shortcut="Ctrl+Shift+R" testid={`chat-renew-${id}`}>{t('chat.menu.renew')}</MenuItem>
          {to && (
            <>
              <MenuItem onSelect={pick(() => askRenewOrchestrator(to))} disabled={!!block} testid={`chat-engine-${id}`}>
                {t('chat.menu.switchEngine', { engine: engineName(to) })}
              </MenuItem>
              {block && <p className="menu-note" data-testid={`chat-engine-block-${id}`}>{block}</p>}
            </>
          )}
          <label className="menu-range" data-testid="orchestrator-opacity">
            <span>{t('chat.menu.opacityWord')} <b>{opacity}%</b></span>
            <input type="range" min={40} max={100} step={5} value={opacity} aria-label={t('chat.menu.opacityLabel')}
              onChange={e => void setSetting({ orchestratorOpacity: Number(e.target.value) })} data-testid="orchestrator-opacity-range" />
          </label>
          <MenuSep />
        </>
      )}
      <MenuLabel>{t('chat.menu.modelLabel')}</MenuLabel>
      {/* an agent's lasting model and effort live in its profile (ADR 0078): the menu only changes this chat */}
      {chat.agent?.source === 'catalog' && !orchestrator && <p className="menu-note" data-testid={`chat-profile-note-${id}`}>{t('chat.menu.profileNote', { name: chat.agent.name })}</p>}
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
      {!chat.isOrchestrator && (
        <MenuItem onSelect={pick(() => void resumeChat(id))} disabled={!next && (isBusy(chat) || chat.pending > 0 || !!chat.handoffBusy)} testid={`chat-resume-${id}`}>
          {next ? openNextLabel() : resumeLabel()}
        </MenuItem>
      )}
      {!!chat.checkpointAt && !chat.isOrchestrator && (
        <MenuItem onSelect={pick(() => askConfirm({ title: t('chat.menu.undoTurnTitle'), body: t('chat.menu.undoTurnBody'), confirmLabel: t('chat.menu.undoTurnConfirm'), danger: true, onConfirm: () => void undoTurn(id) }))} disabled={isBusy(chat) || chat.pending > 0} testid={`chat-undo-turn-${id}`}>{t('chat.menu.undoTurn')}</MenuItem>
      )}
      <MenuSep />
      {!orchestrator && <MenuItem onSelect={pick(() => closeChat(id))} danger testid={`chat-close-${id}`}>{t('chat.menu.closeChat')}</MenuItem>}
    </Popover></>
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
