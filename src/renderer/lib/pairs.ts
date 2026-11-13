// Chat ↔ browser pairs: a chat that drives browser tabs and those tabs share one accent color (tile border, a stripe
// on top, the "di: <chat>" chip), and hovering either tile lights up the other, in the agents column, focus mode and
// the Orchestrator column. Colors are sticky slots (8 tokens --pair-0..7, light and dark in
// styles/tokens.css, grid.ts pairSlots): a chat keeps its color while it lives, so closing one pair never recolors the
// others. The mouse over a page (a native view the UI cannot see) comes from main as 'browser:pointer'.
// Why: the user, 2026-10-11, "vorrei che in qualche modo si vedesse che il browser è legato a quella chat comunque".
// Used by ChatTile, OrchestratorTile and BrowserTile.
import { useEffect, type CSSProperties } from 'react';
import { sb } from '../sb';
import { createStore } from '../store/createStore';
import type { AppState } from '../store/state';
import { app, useApp } from '../store/store';
import { pairIndex, pairSlots } from './grid';

let slots: ReadonlyMap<string, number> = new Map();
let seen: { order: AppState['order']; tabs: AppState['tabs'] } | null = null;

/** The pair color slot of a chat in this state, or null when it drives no browser (memoized on order + tabs). */
export function pairOf(s: Pick<AppState, 'order' | 'tabs'>, chatId: string | null | undefined): number | null {
  if (seen?.order !== s.order || seen.tabs !== s.tabs) {
    slots = pairSlots(slots, s.order, s.tabs);
    seen = { order: s.order, tabs: s.tabs };
  }
  return pairIndex(slots, s.tabs, chatId);
}

/** The CSS variable of a slot, for a style prop. */
export const pairStyle = (index: number): CSSProperties => ({ '--pair': `var(--pair-${index})` } as CSSProperties);

// Two sources, lit when either says so: the tiles' DOM (header, frame) and the pages (native views, events from main
// keyed by tab). They arrive on different channels, so one never turns off what the other just turned on.
interface Hover { dom: string | null; pages: Readonly<Record<string, string>> }   // pages: tab id → its chat
const hover = createStore<Hover>({ dom: null, pages: {} });
const off = (chatId: string) => hover.set(h => (h.dom === chatId ? { ...h, dom: null } : h));
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  sb.on('browser:pointer', ({ tabId, inside }) => {
    const owner = app.get().tabs.find(t => t.id === tabId)?.ownerChatId;
    hover.set(h => {
      if (inside && owner) return h.pages[tabId] === owner ? h : { ...h, pages: { ...h.pages, [tabId]: owner } };
      if (!(tabId in h.pages)) return h;
      const { [tabId]: _gone, ...pages } = h.pages;
      return { ...h, pages };
    });
  });
}

/** The pair color of a chat for its tiles (style + class), or nothing when it drives no browser. A tile that unmounts
 *  under the mouse (a view change) never gets its pointerleave: the light goes off with it. */
export function usePair(chatId: string | null | undefined): { cls: string; style: CSSProperties | undefined; index: number | null } {
  listen();
  const index = useApp(s => pairOf(s, chatId));
  const hot = hover.use(h => !!chatId && (h.dom === chatId || Object.values(h.pages).includes(chatId)));
  useEffect(() => (chatId ? () => off(chatId) : undefined), [chatId]);
  if (index === null) return { cls: '', style: undefined, index };
  return { cls: `paired${hot ? ' pair-hot' : ''}`, style: pairStyle(index), index };
}

/** Pointer handlers for a tile of the pair: entering lights up both tiles, leaving turns them off. */
export function pairHover(chatId: string | null | undefined): { onPointerEnter?: () => void; onPointerLeave?: () => void } {
  if (!chatId) return {};
  return { onPointerEnter: () => hover.set(h => (h.dom === chatId ? h : { ...h, dom: chatId })), onPointerLeave: () => off(chatId) };
}
