// The face of a strip (ADR 0295): the role's little person doing what the chat does (AgentSprite.tsx), in place of the
// portrait and its state dot. A role the user gave a picture of their own keeps that picture with the dot (the sprite
// could not look like it). Used by ChatTile.tsx (a root strip) and DelegationCard.tsx (a delegated row); also maps a
// chat's state to the animation (spriteStateOf).
import type { AgentAvatar as Avatar } from '@shared/agents';
import type { ChatItem } from '@shared/contract';
import { useEffect, useState } from 'react';
import { isSpriteId, type SpriteState } from '../lib/agent-sprites';
import { useOwnPicture } from '../lib/agent-images';
import { useApp } from '../store/store';
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

/** The chats whose «done» the user has already seen play: coming back to the page does not celebrate again. */
const celebrated = new Set<string>();

export function StripFace({ chatId, avatar, name, tone, size, height = 32, ...o }: { chatId: string; avatar: Avatar | undefined; name: string; tone: string; size: number; height?: number; waitsUser: boolean; error: boolean; busy: boolean; done: boolean; pending?: boolean }) {
  const thinking = useApp(s => o.busy && isThinking(s.items[chatId]));
  const own = useOwnPicture(avatar);
  const state = spriteStateOf({ ...o, thinking });
  // seen before this row was drawn: it stands still; a new end after more work plays again
  const [seen, setSeen] = useState(() => celebrated.has(chatId));
  useEffect(() => {
    if (state === 'done') { celebrated.add(chatId); return; }
    celebrated.delete(chatId); setSeen(false);
  }, [chatId, state]);
  // a picture of the user's own, or a character without a person, stays a portrait with its state dot
  if (own || (avatar?.kind === 'character' && !isSpriteId(avatar.value)))
    return <span className="strip-face"><AgentAvatar avatar={avatar} name={name} size={size} /><span className={`strip-dot lead tone-${tone}`} aria-hidden="true" /></span>;
  return <span className="strip-face" data-person><AgentSprite id={spriteIdOf(avatar)} state={state} still={state === 'done' && seen} height={height} label={t('product.avatar', { name })} /></span>;
}
