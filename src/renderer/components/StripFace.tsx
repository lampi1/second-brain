// The face of a strip (ADR 0294): the role's little person doing what the chat does (AgentSprite.tsx), in place of the
// portrait and its state dot. A role the user gave a picture of their own keeps that picture with the dot (the sprite
// could not look like it). Used by ChatTile.tsx (a root strip) and DelegationCard.tsx (a delegated row); also maps a
// chat's state to the animation (spriteStateOf).
import type { AgentAvatar as Avatar } from '@shared/agents';
import type { ChatItem } from '@shared/contract';
import { isRoleId } from '@shared/roles';
import type { SpriteState } from '../lib/agent-sprites';
import { useAgentImages } from '../lib/agent-images';
import { useApp } from '../store/store';
import { t } from '../i18n';
import { AgentAvatar } from './AgentAvatar';
import { AgentSprite, spriteIdOf } from './AgentSprite';

/** What the little person does: the user first (it waits for them), then an error, the work, the end, a rest. */
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

export function StripFace({ chatId, avatar, name, tone, size, scale = 2, ...o }: { chatId: string; avatar: Avatar | undefined; name: string; tone: string; size: number; scale?: number; waitsUser: boolean; error: boolean; busy: boolean; done: boolean; pending?: boolean }) {
  const images = useAgentImages();
  const thinking = useApp(s => o.busy && isThinking(s.items[chatId]));
  const own = avatar?.kind === 'character' && isRoleId(avatar.value) && !!images[avatar.value];
  if (own) return <span className="strip-face"><AgentAvatar avatar={avatar} name={name} size={size} /><span className={`strip-dot lead tone-${tone}`} aria-hidden="true" /></span>;
  return <span className="strip-face"><AgentSprite id={spriteIdOf(avatar)} state={spriteStateOf({ ...o, thinking })} scale={scale} label={t('product.avatar', { name })} /></span>;
}
