// Pure helpers of the app's tooltips: where a HelpTip bubble goes (components/HelpTip.tsx) and how a `data-tip` value
// splits into text, keys and a second line (TooltipLayer in components/ui.tsx). Pure, so unit-tested in node.

const GAP = 8; // between the mark and the bubble
const EDGE = 8; // the bubble never touches the window's edge

export type Pos = { x: number; y: number; side: 'below' | 'above'; arrow: number };

/** Where the bubble goes: below the mark if it fits, else above, else on the roomier side; always inside the window. */
export function placeBubble(a: { left: number; top: number; width: number; height: number }, b: { width: number; height: number }, win: { width: number; height: number }): Pos {
  const below = a.top + a.height + GAP;
  const fitsBelow = below + b.height <= win.height - EDGE;
  const fitsAbove = a.top - GAP - b.height >= EDGE;
  const side = fitsBelow || (!fitsAbove && win.height - (a.top + a.height) >= a.top) ? 'below' : 'above';
  const rawY = side === 'below' ? below : a.top - GAP - b.height;
  const y = Math.max(EDGE, Math.min(rawY, win.height - b.height - EDGE));
  const cx = a.left + a.width / 2;
  const x = Math.max(EDGE, Math.min(cx - b.width / 2, win.width - b.width - EDGE));
  const arrow = Math.max(12, Math.min(cx - x, b.width - 12));
  return { x, y, side, arrow };
}

/** A tip's part after "|": a shortcut ("Ctrl+K", "Esc") becomes keys, anything else a second line of text. */
export function splitTip(raw: string): { text: string; keys?: string; more?: string } {
  const [text = '', rest] = raw.split('|');
  if (rest === undefined) return { text };
  return rest.length <= 24 && /^[A-Z][\w.]*(?:\+\S+)*(?: [A-Z][\w.]*(?:\+\S+)*)*$/.test(rest) ? { text, keys: rest } : { text, more: rest };
}
