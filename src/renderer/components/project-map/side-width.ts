// The width of the project map's side panel (issue #443, ADR 0322): wider than before, dragged by the user and
// remembered. The numbers and the two pure steps: holding a width inside its limits (and inside the room the drawing
// leaves, so the map keeps a usable width), and reading / writing the remembered one. The grid in project-map.css holds
// the same floor for the drawing (canvasMin) whatever is stored. Used by ProjectMapView.tsx; pinned by
// test/unit/project-map-side-width.test.ts.

export const SIDE = {
  /** the panel never gets narrower: a step's detail still reads */
  min: 280,
  /** nor wider, on any screen */
  max: 760,
  /** where it starts (it was 320 beside the page, 400 full screen) */
  def: 400,
  /** the drawing keeps at least this width at any panel width */
  canvasMin: 320,
  /** one arrow key press on the handle */
  step: 24,
  key: 'sb.projectMap.sideWidth',
} as const;

/** A width the panel can take: inside its limits, and inside `room` (the width the panel and the drawing share) so
 *  the drawing keeps canvasMin; a room too small for both gives the panel its minimum. */
export function clampSide(width: number, room?: number): number {
  const w = Number.isFinite(width) ? Math.round(width) : SIDE.def;
  const most = room === undefined || !Number.isFinite(room) ? SIDE.max : Math.max(SIDE.min, Math.min(SIDE.max, Math.floor(room) - SIDE.canvasMin));
  return Math.max(SIDE.min, Math.min(most, w));
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** The remembered width, or the default (nothing stored, storage off, a value that is not a width). */
export function readSide(storage: Store | undefined): number {
  try {
    const raw = storage?.getItem(SIDE.key);
    const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? clampSide(n) : SIDE.def;
  } catch { return SIDE.def; }
}
export function writeSide(storage: Store | undefined, width: number): void {
  try { storage?.setItem(SIDE.key, String(clampSide(width))); } catch { /* this session only */ }
}
