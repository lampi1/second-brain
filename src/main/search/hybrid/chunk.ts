// Cuts a brain file into the pieces the hybrid index ranks and embeds: one block per heading section paragraph or
// top-level list item (an error in ai-errors.md, an idea, a now.md line), so a hit points at the line that matters and a
// vector means one thing. Tiny blocks are joined to their neighbour, long ones split at line ends. Pure; used by
// hybrid/engine.ts, pinned by test/unit/hybrid-search.test.ts.

export interface Chunk { line: number; text: string }

const MAX = 1200;   // characters per chunk (the model reads ~512 tokens; e5 is best on short passages)
const MIN = 60;     // a smaller block is joined to the next one

const HEADING = /^#{1,6}\s/;
const ITEM = /^(?:[-*+]|\d+[.)])\s/; // a top-level list item (no indent)

/** The chunks of `text`, each with its 1-based first line. Frontmatter and blank lines are dropped. */
export function chunkText(text: string): Chunk[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') { const end = lines.indexOf('---', 1); if (end > 0) i = end + 1; }
  const blocks: Chunk[] = [];
  let cur: { line: number; rows: string[] } | null = null;
  const flush = () => { if (cur) { const t = cur.rows.join('\n').trim(); if (t) blocks.push({ line: cur.line, text: t }); } cur = null; };
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) { flush(); continue; }
    if (HEADING.test(l) || ITEM.test(l)) flush();
    if (!cur) cur = { line: i + 1, rows: [] };
    cur.rows.push(l);
  }
  flush();
  const out: Chunk[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    // a heading alone or a short line rides with what follows (the heading gives the next block its context)
    // (the blank lines between them are kept, so a line inside the chunk still maps to its line in the file)
    if (prev && prev.text.length < MIN && prev.text.length + b.text.length < MAX) {
      const prevEnd = prev.line + prev.text.split('\n').length - 1;
      prev.text += '\n'.repeat(Math.max(1, b.line - prevEnd)) + b.text;
      continue;
    }
    out.push(...split(b));
  }
  return out;
}

function split(b: Chunk): Chunk[] {
  if (b.text.length <= MAX) return [b];
  const out: Chunk[] = [];
  let line = b.line, rows: string[] = [], size = 0;
  for (const r of b.text.split('\n')) {
    if (size && size + r.length > MAX) { out.push({ line, text: rows.join('\n') }); line += rows.length; rows = []; size = 0; }
    // one very long line (a minified file, a table row) is cut at MAX characters
    for (let s = r; ; s = s.slice(MAX)) { if (s.length <= MAX) { rows.push(s); size += s.length + 1; break; } out.push({ line, text: s.slice(0, MAX) }); }
  }
  if (rows.length) out.push({ line, text: rows.join('\n') });
  return out;
}
