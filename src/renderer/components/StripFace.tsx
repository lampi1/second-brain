// The face of a strip (ADR 0295): the role's little person doing what the chat does (AgentSprite.tsx), in place of the
// portrait and its state dot. A role the user gave a picture of their own keeps that picture with the dot (the sprite
// could not look like it). Used by ChatTile.tsx (a root strip) and DelegationCard.tsx (a delegated row); also maps a
// chat's state to the animation (spriteStateOf), and sends the user's pat or whack on the person to the chat's run
// (run:touch, ADR 0297). At work the person plays what the chat is really doing when its tool says so (reading, a
// command, tests, a search, a page, a hand-off: ADR 0305), its role's own work otherwise, and speaks about it: its
// state, or the tool it is using with the real file or command (ADR 0303, lib/quips.ts quipMoment); once about an end.
import type { AgentAvatar as Avatar } from '@shared/agents';
import type { ChatItem } from '@shared/contract';
import { useEffect, useRef, useState } from 'react';
import { isSpriteActivity, isSpriteId, type SpriteState } from '../lib/agent-sprites';
import { quipMoment, type QuipMoment } from '../lib/quips';
import { useOwnPicture } from '../lib/agent-images';
import { app, useApp } from '../store/store';
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

/** How long a kind of work is played before the person may change to another, in ms: tools follow each other faster
 *  than a scene can be watched. */
export const ACTIVITY_MS = 4000;
/** How long a new value still waits, in ms, when the shown one was taken at `since`: 0 = it is taken now. */
export const settleLeft = (since: number, ms: number, now: number): number => Math.max(0, since + ms - now);
/** A value that changes no more often than every `ms`: the latest one is taken when the time is up (the first
 *  change at once). */
function useSettled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value), since = useRef(0);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const take = () => { since.current = Date.now(); setShown(value); };
    const left = settleLeft(since.current, ms, Date.now());
    if (left <= 0) { take(); return; }
    const later = setTimeout(take, left);
    return () => clearTimeout(later);
  }, [value, shown, ms]);
  return shown;
}

/** The end of each chat the user has already seen play (its run, turns and cost when it ended): coming back to the
 *  page does not celebrate again, a new end after more work does. */
const celebrated = new Map<string, string>();
/** The end of each chat its person has already spoken about: it says so once, then keeps quiet until more work. */
const boasted = new Map<string, string>();

export function StripFace({ chatId, avatar, name, tone, size, height = 40, ...o }: { chatId: string; avatar: Avatar | undefined; name: string; tone: string; size: number; height?: number; waitsUser: boolean; error: boolean; busy: boolean; done: boolean; pending?: boolean }) {
  const thinking = useApp(s => o.busy && isThinking(s.items[chatId]));
  const own = useOwnPicture(avatar);
  const state = spriteStateOf({ ...o, thinking });
  // what kind of work it is doing (its last tool), held a few seconds: the person plays that, and speaks about it
  const kind = useApp(s => (state === 'work' ? quipMoment('work', s.items[chatId]).kind : null));
  const activity = useSettled(isSpriteActivity(kind) ? kind : null, ACTIVITY_MS);
  const mark = useApp(s => { const c = s.chats[chatId]; return `${c?.run?.runId ?? ''}:${c?.run?.turns ?? ''}:${c?.costUsd ?? ''}`; });
  // seen before this row was drawn: it stands still
  const [seen, setSeen] = useState(() => celebrated.get(chatId) === mark);
  useEffect(() => {
    if (state === 'done') { celebrated.set(chatId, mark); return; }
    celebrated.delete(chatId); boasted.delete(chatId); setSeen(false);
  }, [chatId, state, mark]);
  // the user's pat or whack is a nudge on this chat's run (ADR 0297): sent when it changes, never at every click
  const hasRun = useApp(s => !!s.chats[chatId]?.run), touched = useApp(s => s.chats[chatId]?.run?.touch?.sign);
  const onTouch = (sign: 1 | -1) => {
    if (state === 'done') setSeen(true); // after its reaction a finished person stands still: no second celebration
    if (hasRun && sign !== touched) void sb.invoke('run:touch', { chatId, sign }).catch(() => undefined);
  };
  // what it speaks about when its turn comes: read then, from the transcript the app already has
  const mood = (): QuipMoment | null => {
    if (state === 'done') {
      // which end: its run and turn, not its cost (the real cost replaces the estimate after the end)
      const run = app.get().chats[chatId]?.run, end = `${run?.runId ?? ''}:${run?.turns ?? ''}`;
      if (boasted.get(chatId) === end) return null;
      boasted.set(chatId, end);
    }
    return quipMoment(state, app.get().items[chatId], activity);
  };
  // a picture of the user's own, or a character without a person, stays a portrait with its state dot
  if (own || (avatar?.kind === 'character' && !isSpriteId(avatar.value)))
    return <span className="strip-face"><AgentAvatar avatar={avatar} name={name} size={size} /><span className={`strip-dot lead tone-${tone}`} aria-hidden="true" /></span>;
  return <span className="strip-face" data-person><AgentSprite id={spriteIdOf(avatar)} state={state} activity={activity} still={state === 'done' && seen} height={height} label={t('product.avatar', { name })}
    mood={mood} onTouch={onTouch} tip={t(!hasRun ? 'sprite.tip' : touched === 1 ? 'sprite.tipPat' : touched === -1 ? 'sprite.tipWhack' : 'sprite.tipRun')} /></span>;
}
