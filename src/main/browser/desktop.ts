// The fixed desktop size of agent tabs (chat:<id>, mcp:<session>): the page always lays out at DESKTOP, whatever the
// size of its tile, and the tile shows it scaled to fit (owner, 2026-10-12: QA must not test a web app in a tiny viewport).
// Pure, so it is unit-tested without Electron. Used by browser/tabs.ts (placing and emulation).
import type { Rect } from '../../shared/contract';

/** The viewport of every agent tab, in CSS px. */
export const DESKTOP = { width: 1920, height: 1080 };

/** An agent tab's view inside its tile: DESKTOP scaled to fit, centered. */
export function fitDesktop(rect: Rect): { bounds: Rect; scale: number } {
  const s = Math.min(rect.width / DESKTOP.width, rect.height / DESKTOP.height);
  const width = Math.max(1, Math.round(DESKTOP.width * s)), height = Math.max(1, Math.round(DESKTOP.height * s));
  return { bounds: { x: rect.x + Math.floor((rect.width - width) / 2), y: rect.y + Math.floor((rect.height - height) / 2), width, height }, scale: width / DESKTOP.width };
}
