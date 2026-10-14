// The ⋯ menu of a chat tile: model, effort and permissions (Claude), rename, copy link, focus mode, the context size
// with "Passaggio di consegne…" and "Riprendi in chat nuova" (not on the Regia: it renews instead), close. The same
// menu serves a Regia, which adds "Pulisci" (a confirm, then the same engine started empty), "Ricomincia da capo" and
// "Cambia motore" (Claude ↔ Cursor): both open the "Nuova Regia" confirm (RegiaRenewDialog); the old Regia goes on as
// a normal chat, history kept; the overlay's opacity (setting regiaOpacity, ADR 0021). "Chiudi la Regia" only while another Regia stays.
// TitleInput is the inline rename field the menu's "Rinomina…" opens. Used by ChatTile and RegiaTile.
import type { RefObject } from 'react';
import type { ChatSummary, Harness } from '@shared/contract';
import { EFFORTS, effortLabel, permissionLabel, PERMISSION_MODES, tokensShort } from '../lib/format';
import { MODELS } from '../lib/models';
import { makeLink } from '../lib/notify';
import { isBusy, sameList } from '../store/state';
import { closeChat, setChat, setSetting, useApp } from '../store/store';
import { openHandoff, setFocused } from '../store/ui';
import { askClearRegia, askCloseRegia, askRenewRegia, copyLink, resumeChat, toggleFocusMode } from '../actions';
import { regieIdsOf } from '../lib/regia-route';
import { OPEN_NEXT_LABEL, RESUME_LABEL, useContinuedBy } from './ContextBar';
import { MenuItem, MenuLabel, MenuSep, Popover } from './ui';

export const harnessName = (h: Harness): string => (h === 'claude' ? 'Claude Code' : 'Cursor');
const otherHarness = (h: Harness): Harness => (h === 'claude' ? 'cursor' : 'claude');

/** Why the Regia cannot move to this engine now (null = it can). */
export function useEngineBlock(h: Harness): string | null {
  const off = useApp(s => s.settings?.engines[h] === false);
  const missing = useApp(s => s.info?.cli?.[h]?.found === false);
  if (off) return `${harnessName(h)} è spento nelle impostazioni.`;
  if (missing) return `La CLI di ${harnessName(h)} non è installata.`;
  return null;
}

export function ChatMenu({ chat, anchor, open, onClose, onRename, regia }: {
  chat: ChatSummary; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; onRename: () => void; regia?: boolean;
}) {
  const id = chat.id;
  const to = otherHarness(chat.harness);
  const block = useEngineBlock(to);
  const next = useContinuedBy(chat);
  const pick = (fn: () => void) => () => { fn(); onClose(); };
  const opacity = useApp(s => s.settings?.regiaOpacity ?? 100);
  const regie = useApp(s => regieIdsOf(s), sameList);
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} testid={`chat-menu-pop-${id}`} width={regia ? 290 : 260}>
      {regia && (
        <>
          <MenuLabel>Regia</MenuLabel>
          <MenuItem onSelect={pick(() => askClearRegia(id))} testid={`chat-clear-${id}`}>Pulisci…</MenuItem>
          {!chat.appRegia && (
            <>
              <MenuItem onSelect={pick(() => askRenewRegia(chat.harness))} shortcut="Ctrl+Shift+R" testid={`chat-renew-${id}`}>Ricomincia da capo…</MenuItem>
              <MenuItem onSelect={pick(() => askRenewRegia(to))} disabled={!!block} testid={`chat-engine-${id}`}>
                Cambia motore → {harnessName(to)}…
              </MenuItem>
              {block && <p className="menu-note" data-testid={`chat-engine-block-${id}`}>{block}</p>}
            </>
          )}
          <label className="menu-range" data-testid="regia-opacity">
            <span>Opacità <b>{opacity}%</b></span>
            <input type="range" min={40} max={100} step={5} value={opacity} aria-label="Opacità della Regia"
              onChange={e => void setSetting({ regiaOpacity: Number(e.target.value) })} data-testid="regia-opacity-range" />
          </label>
          <MenuSep />
        </>
      )}
      <MenuLabel>Modello</MenuLabel>
      {MODELS[chat.harness].map(m => (
        <MenuItem key={m.id || 'default'} checked={(chat.model ?? '') === m.id} onSelect={pick(() => void setChat(id, { model: m.id }))} testid={`chat-model-${id}-${m.id || 'default'}`}>{m.label}</MenuItem>
      ))}
      {chat.harness === 'claude' && (
        <>
          <MenuSep />
          <MenuLabel>Ragionamento</MenuLabel>
          {EFFORTS.map(e => (
            <MenuItem key={e} checked={chat.effort === e} onSelect={pick(() => void setChat(id, { effort: e }))} testid={`chat-effort-${id}-${e}`}>{effortLabel(e)}</MenuItem>
          ))}
          <MenuSep />
          <MenuLabel>Permessi</MenuLabel>
          {PERMISSION_MODES.map(p => (
            <MenuItem key={p} checked={chat.permissionMode === p} danger={p === 'bypassPermissions'} onSelect={pick(() => void setChat(id, { permissionMode: p }))} testid={`chat-perm-${id}-${p}`}>{permissionLabel(p)}</MenuItem>
          ))}
        </>
      )}
      <MenuSep />
      <MenuItem onSelect={pick(onRename)} testid={`chat-rename-${id}`}>Rinomina…</MenuItem>
      <MenuItem onSelect={pick(() => void copyLink(makeLink('workspace', regia ? 'regia' : `chat-${id}`)))} testid={`chat-link-${id}`}>Copia link</MenuItem>
      {!regia && chat.space !== 'app' && <MenuItem onSelect={pick(() => { setFocused(`chat:${id}`); toggleFocusMode(); })} shortcut="Ctrl+Shift+F" testid={`chat-focusmode-${id}`}>Modalità focus</MenuItem>}
      <MenuSep />
      <MenuLabel>Contesto{chat.contextTokens ? ` · ${chat.contextEstimated ? '~' : ''}${tokensShort(chat.contextTokens)} token` : ''}</MenuLabel>
      <MenuItem onSelect={pick(() => openHandoff(id))} testid={`chat-handoff-${id}`}>Passaggio di consegne…</MenuItem>
      {!chat.isRegia && !chat.appRegia && (
        <MenuItem onSelect={pick(() => void resumeChat(id))} disabled={!next && (isBusy(chat) || chat.pending > 0 || !!chat.handoffBusy)} testid={`chat-resume-${id}`}>
          {next ? OPEN_NEXT_LABEL : RESUME_LABEL}
        </MenuItem>
      )}
      <MenuSep />
      {!regia && <MenuItem onSelect={pick(() => closeChat(id))} danger testid={`chat-close-${id}`}>Chiudi chat</MenuItem>}
      {regia && chat.isRegia && regie.length > 1 && regie[0] !== id && <MenuItem onSelect={pick(() => askCloseRegia(id))} danger testid={`chat-close-${id}`}>Chiudi questa Regia…</MenuItem>}
    </Popover>
  );
}

/** Inline rename in a tile header: Enter or leaving the field saves, Esc cancels. */
export function TitleInput({ chat, onDone, className = 'th-title-input' }: { chat: Pick<ChatSummary, 'id' | 'title'>; onDone: () => void; className?: string }) {
  const save = (v: string) => { const t = v.trim(); if (t && t !== chat.title) void setChat(chat.id, { title: t }); onDone(); };
  return (
    <input className={className} defaultValue={chat.title} autoFocus aria-label="Nome della chat" data-testid={`chat-title-input-${chat.id}`}
      onKeyDown={e => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
      }}
      onBlur={e => save(e.currentTarget.value)} />
  );
}
