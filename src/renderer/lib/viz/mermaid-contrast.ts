// Readable labels in a model's diagram (ADR 0275). A model colours its boxes with `classDef` / `style … fill:` (pastel
// green, yellow, light grey) but leaves the text colour to the theme, which on the dark theme is light: the owner saw
// light boxes with unreadable text and boxes that looked empty. Before mermaid draws (lib/viz/mermaid.ts), every
// `classDef` or `style` line that sets a fill and no `color` gets the text colour that reads on that fill: dark on a
// light fill, light on a dark one. A colour the model chose is never changed. Pure, so test/unit/mermaid-contrast.test.ts
// covers it without mermaid.
const DARK_TEXT = '#16181d';
const LIGHT_TEXT = '#f5f6f8';

/** WCAG relative luminance of #rgb, #rrggbb (#rrggbbaa: the alpha ignored) or rgb(r, g, b); null for anything else. */
export function luminance(colour: string): number | null {
  const c = colour.trim().toLowerCase();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(c)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) rgb = [...hex.slice(0, 3)].map(h => parseInt(h + h, 16));
  else if (hex && (hex.length === 6 || hex.length === 8)) rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (fn) rgb = fn.slice(1, 4).map(Number);
  if (!rgb || rgb.some(n => Number.isNaN(n))) return null;
  const [r, g, b] = rgb.map(v => { const s = Math.min(255, v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The mermaid source with a readable text colour on every coloured box that has none. */
export function readableMermaid(code: string): string {
  return code.split('\n').map(line => {
    const m = /^(\s*(?:classDef|style)\s+\S+\s+)(.+?)(;?\s*)$/.exec(line);
    if (!m) return line;
    const props = m[2]!;
    if (/(?:^|,)\s*color\s*:/i.test(props)) return line;
    const fill = /(?:^|,)\s*fill\s*:\s*([^,]+)/i.exec(props)?.[1];
    const l = fill ? luminance(fill) : null;
    if (l === null) return line;
    // the contrast is higher against dark text above ≈0.18 (the point where both reach the same ratio)
    return `${m[1]}${props},color:${l > 0.18 ? DARK_TEXT : LIGHT_TEXT}${m[3]}`;
  }).join('\n');
}
