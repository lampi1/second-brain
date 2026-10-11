// Element refs handed to agents: "e12" in the top frame, "f3e12" in frame 3 (any iframe, same- or cross-origin), the
// Playwright MCP convention. "ref_12" (Claude browser pane style) and "[e12]" are accepted as aliases. Pure; used by
// browser/actions.ts and the page walker (browser/page.ts) through refPrefix().

export interface Ref { frame: number; ref: string }

export function refPrefix(frame: number): string { return frame === 0 ? 'e' : `f${frame}e`; }

export function parseRef(input: unknown): Ref {
  const s = String(input ?? '').trim().replace(/^\[|\]$/g, '');
  const m = /^(?:f(\d+)[_-]?)?(?:e|ref_)(\d+)$/i.exec(s);
  if (!m) throw new Error(`Invalid ref "${s}": use a ref from read_page or find, like e12 or f1e7 (inside an iframe).`);
  const frame = m[1] ? Number(m[1]) : 0;
  return { frame, ref: `${refPrefix(frame)}${Number(m[2])}` };
}

/** "f2" | "2" | 2 → 2; undefined/"top"/"" → 0. */
export function parseFrame(input: unknown): number {
  if (input === undefined || input === null || input === '' || input === 'top' || input === 'main') return 0;
  const m = /^f?(\d+)$/i.exec(String(input).trim());
  if (!m) throw new Error(`Invalid frame "${String(input)}": use the frame id shown by read_page (f1, f2...) or omit it for the top page.`);
  return Number(m[1]);
}
