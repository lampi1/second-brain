// Persistent Orchestrator column geometry shared by its renderer and native overlay avoidance.
// The preference version keeps saved widths compatible with the current column (ADR 0068).
export interface DockSize { w: number; h: number }
export interface Reserve { right: number; bottom: number;top?:number }

/** Persistent right column: broad on home, quieter on detail pages. Heights never resize. */
export function columnSize(saved: DockSize | null, v: { W: number; H: number; top: number; left: number }, home: boolean): DockSize {
  const max = Math.max(280, v.W - v.left - 360);
  const preferred = (saved?.w ?? Math.min(680, Math.max(440, v.W * .42))) * (home ? 1 : .78);
  return { w: Math.round(Math.min(max, Math.max(280, preferred))), h: Math.max(120, v.H - v.top) };
}

/** A size from an older preference version is reset once by loadPrefs. */
export const DEFAULT_V = 2;

/** The page's measures the size depends on (the only DOM read here): window, top bar height, sidebar's right edge. */
export function viewport(): { W: number; H: number; top: number; left: number } {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 52;
  const top = Math.max(bar,document.querySelector('.shell')?.getBoundingClientRect().top??bar);
  return { W: window.innerWidth, H: window.innerHeight, top, left: document.querySelector('.sidebar')?.getBoundingClientRect().right || 56 };
}
