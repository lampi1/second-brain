// The face of a strip (ADR 0295): the role's little person doing what the chat does (AgentSprite.tsx), in place of the
// portrait and its state dot. A role the user gave a picture of their own keeps that picture with the dot (the sprite
// could not look like it). Used by ChatTile.tsx (a root strip) and DelegationCard.tsx (a delegated row); also maps a
// chat's state to the animation (spriteStateOf), and sends the user's pat or whack on the person to the chat's run
// (run:touch, ADR 0297).
import type { AgentAvatar as Avatar } from '@shared/agents';
import type { ChatItem } from '@shared/contract';
import { useEffect, useState } from 'react';
import { isSpriteId, type SpriteState } from '../lib/agent-sprites';
import { useOwnPicture } from '../lib/agent-images';
import { useApp } from '../store/store';
import { sb } from '../sb';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentSprite, spriteIdOf } from './AgentSprite';

/** What the little person does: an error first, then the user (it waits for them), the work, the end, a rest. */
export function spriteStateOf(o: { waitsUser: boolean; error: boolean; busy: boolean; thinking: boolean; done: boolean; pending?: boolean }): SpriteState {
  if (o.error) return 'err';
  if (o.waitsUser) return 'wait';
  if (o.busy) return o.thinking ? 'think' : 'work';
  if (o.done) return 'done';
  return o.pending ? 'think' : 'idle';
}

/** A turn thinks while its last word is a thought, or before its first step; between two steps the person keeps at its
 *  work (the hammer does not stop at every tool that ends). */
export function isThinking(items: readonly ChatItem[] | undefined): boolean {
  const last = items?.[items.length - 1];
  return !last || last.kind === 'thinking' || last.kind === 'user';
}

/** The end of each chat the user has already seen play (its run, turns and cost when it ended): coming back to the
 *  page does not celebrate again, a new end after more work does. */
const celebrated = new Map<string, string>();

export function StripFace({ chatId, avatar, name, tone, size, height = 40, ...o }: { chatId: string; avatar: Avatar | undefined; name: string; tone: string; size: number; height?: number; waitsUser: boolean; error: boolean; busy: boolean; done: boolean; pending?: boolean }) {
  const thinking = useApp(s => o.busy && isThinking(s.items[chatId]));
  const own = useOwnPicture(avatar);
  const state = spriteStateOf({ ...o, thinking });
  const mark = useApp(s => { const c = s.chats[chatId]; return `${c?.run?.runId ?? ''}:${c?.run?.turns ?? ''}:${c?.costUsd ?? ''}`; });
  // seen before this row was drawn: it stands still
  const [seen, setSeen] = useState(() => celebrated.get(chatId) === mark);
  useEffect(() => {
    if (state === 'done') { celebrated.set(chatId, mark); return; }
    celebrated.delete(chatId); setSeen(false);
  }, [chatId, state, mark]);
  // the user's pat or whack is a nudge on this chat's run (ADR 0297): sent when it changes, never at every click
  const hasRun = useApp(s => !!s.chats[chatId]?.run), touched = useApp(s => s.chats[chatId]?.run?.touch?.sign);
  const onTouch = (sign: 1 | -1) => {
    if (state === 'done') setSeen(true); // after its reaction a finished person stands still: no second celebration
    if (hasRun && sign !== touched) void sb.invoke('run:touch', { chatId, sign }).catch(() => undefined);
  };
  // a picture of the user's own, or a character without a person, stays a portrait with its state dot
  if (own || (avatar?.kind === 'character' && !isSpriteId(avatar.value)))
    return <span className="strip-face"><AgentAvatar avatar={avatar} name={name} size={size} /><span className={`strip-dot lead tone-${tone}`} aria-hidden="true" /></span>;
  return <span className="strip-face" data-person><AgentSprite id={spriteIdOf(avatar)} state={state} still={state === 'done' && seen} height={height} label={t('product.avatar', { name })}
    onTouch={onTouch} tip={t(!hasRun ? 'sprite.tip' : touched === 1 ? 'sprite.tipPat' : touched === -1 ? 'sprite.tipWhack' : 'sprite.tipRun')} /></span>;
}
