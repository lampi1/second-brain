// Persistent Orchestrator column geometry shared by its renderer and native overlay avoidance.
// The column is about half the window on every page (ADR 0307); the preference version keeps saved widths compatible
// with the current column (ADR 0068).
export interface DockSize { w: number; h: number }
export interface Reserve { right: number; bottom: number;top?:number }

/** The share of the window the column takes by default (the owner, 2026-11-14: «voglio che l'orchestrator occupi
 *  sempre metà schermata circa», ADR 0307). */
export const COLUMN_SHARE = .5;
/** The least room left to the page beside the column, in px. */
export const PAGE_MIN = 360;
/** Persistent right column: about half the window on every page, or the width the user dragged it to; the page
 *  always keeps PAGE_MIN. Heights never resize. */
export function columnSize(saved: DockSize | null, v: { W: number; H: number; top: number; left: number }): DockSize {
  const max = Math.max(280, v.W - v.left - PAGE_MIN);
  return { w: Math.round(Math.min(max, Math.max(280, saved?.w ?? v.W * COLUMN_SHARE))), h: Math.max(120, v.H - v.top) };
}

/** A size from an older preference version is reset once by loadPrefs (3: the column is half the window, ADR 0307). */
export const DEFAULT_V = 3;

/** The page's measures the size depends on (the only DOM read here): window, top bar height, sidebar's right edge. */
export function viewport(): { W: number; H: number; top: number; left: number } {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 52;
  const top = Math.max(bar,document.querySelector('.shell')?.getBoundingClientRect().top??bar);
  return { W: window.innerWidth, H: window.innerHeight, top, left: document.querySelector('.sidebar')?.getBoundingClientRect().right || 56 };
}
