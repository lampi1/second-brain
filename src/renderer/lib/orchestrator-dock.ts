// The Orchestrator widget's geometry and counts (ADR 0028): docked bottom-right, collapsed to a bar or expanded to a panel the
// user resizes from its top-left corner. Pure, so unit tests check it without React; used by
// components/OrchestratorOverlay.tsx (place, size, unread), App.tsx (the room the workspace leaves it) and lib/layer.ts (the
// global layer's cards and toasts sit beside it, never on it).
import type { ChatItem } from '@shared/contract';

export interface DockSize { w: number; h: number }
export interface Reserve { right: number; bottom: number;top?:number }

/** Persistent right column: broad on home, quieter on detail pages. Heights never resize. */
export function columnSize(saved: DockSize | null, v: { W: number; H: number; top: number; left: number }, home: boolean): DockSize {
  const max = Math.max(280, v.W - v.left - 360);
  const preferred = (saved?.w ?? Math.min(680, Math.max(440, v.W * .42))) * (home ? 1 : .78);
  return { w: Math.round(Math.min(max, Math.max(280, preferred))), h: Math.max(120, v.H - v.top) };
}

/** the collapsed bar's height; EDGE = the workspace's --gap; MIN_WORK = what the chats always keep in width */
export const BAR_H = 34, EDGE = 8, MIN_W = 340, MIN_H = 260, MIN_WORK = 420;

/** The expanded panel's first size in a W×H window under a `top` px top bar: wide and low (the user, 2026-10-13: "la
 *  finestra dell’Orchestrator la voglio più larga e meno alta"): 42% of the width (480-820 px), 42% of the height under the
 *  top bar (300-560 px). DEFAULT_V: bumped when the default changes, so a size saved before is dropped once. */
export const DEFAULT_V = 2;
export function defaultSize(W: number, H: number, top: number): DockSize {
  return { w: Math.min(820, Math.max(480, Math.round(W * 0.42))), h: Math.min(560, Math.max(300, Math.round((H - top) * 0.42))) };
}

/** A size kept usable: never under the minimum, never taller than the room under the top bar, never so wide that the
 *  chats (right of the `left` px sidebar) get less than MIN_WORK. */
export function clampSize(s: DockSize, W: number, H: number, top: number, left: number): DockSize {
  const maxW = Math.max(MIN_W, W - left - MIN_WORK - 3 * EDGE);
  const maxH = Math.max(MIN_H, H - top - 2 * EDGE);
  return { w: Math.round(Math.min(Math.max(MIN_W, s.w), maxW)), h: Math.round(Math.min(Math.max(MIN_H, s.h), maxH)) };
}

/** The size shown: the saved one (or the default) kept usable in this window. */
export function sizeIn(saved: DockSize | null, W: number, H: number, top: number, left: number): DockSize {
  return clampSize(saved ?? defaultSize(W, H, top), W, H, top, left);
}

/** One geometry for the workspace, native overlay avoidance and the full-width coordinator. */
export function topSize(savedHeight:number|null,W:number,H:number,top:number,left:number):DockSize{
  const room=Math.max(120,H-top-2*EDGE);
  return{w:Math.max(200,W-left-2*EDGE),h:Math.round(Math.min(room,Math.max(120,Math.min(savedHeight??room*.42,560,room*.7))))};
}

/** The page's measures the size depends on (the only DOM read here): window, top bar height, sidebar's right edge. */
export function viewport(): { W: number; H: number; top: number; left: number } {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 52;
  const top = Math.max(bar,document.querySelector('.shell')?.getBoundingClientRect().top??bar);
  return { W: window.innerWidth, H: window.innerHeight, top, left: document.querySelector('.sidebar')?.getBoundingClientRect().right || 56 };
}

/** The room the widget takes from the bottom-right corner, so nothing lands under it (the user, 2026-10-13: never over
 *  a chat's input or its Esegui/Copia): expanded = a right column as wide as the panel; collapsed = a bottom strip
 *  as tall as the bar. The workspace pads by it; the global layer and the questions window move by it. */
export function reserveOf(open: boolean, size: DockSize, placement:'top'|'corner'='corner',map=false): Reserve {
  if(placement==='top')return{right:0,bottom:0,top:map?0:open?size.h+2*EDGE:BAR_H+2*EDGE};
  return open ? { right: size.w + EDGE, bottom: 0 } : { right: 0, bottom: BAR_H + EDGE };
}

/** The "seen at" to keep when the panel collapses at `at`: a reply still streaming then (its `at` is when it started)
 *  is not seen yet, so the bar counts it once it ends. */
export function seenAtCollapse(lists: readonly (readonly ChatItem[] | undefined)[], at: number): number {
  let seen = at;
  for (const items of lists) for (const it of items ?? []) if (it.kind === 'assistant' && it.streaming && it.at <= seen) seen = it.at - 1;
  return seen;
}

/** Replies of an Orchestrator the user has not seen: finished assistant messages after `seenAt` (the last time the panel was
 *  open). */
export function unreadOf(items: readonly ChatItem[] | undefined, seenAt: number): number {
  let n = 0;
  for (const it of items ?? []) if (it.kind === 'assistant' && !it.streaming && it.at > seenAt) n++;
  return n;
}
