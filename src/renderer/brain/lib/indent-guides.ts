// The indent guides of the file viewer's code (ADR 0316, the owner 2026-11-15: «il codice vorrei fosse formattato bene
// leggibilissimo come dal miglior ide»): a thin line at every indent level, so the nesting of a block reads at a glance,
// as in an editor. Per line, how many columns its indent takes (tabs to the next multiple of 4); a blank line takes the
// smaller of the lines around it, so a guide does not break on an empty line. The step is the file's smallest indent
// (2 to 8 columns; 4 for tabs or none). Pure; drawn by brain/pages/FileViewer.tsx (Code), pinned by
// test/unit/indent-guides.test.ts.

export interface IndentGuides { unit: number; cols: number[] }

export function indentGuides(lines: readonly string[], tab = 4): IndentGuides {
  let tabs = false;
  const lead = lines.map(l => {
    let c = 0;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === ' ') c++;
      else if (ch === '\t') { c += tab - (c % tab); tabs = true; } else return c;
    }
    return -1; // blank (or only spaces)
  });
  const smallest = lead.reduce((m, c) => (c > 0 && c < m ? c : m), Infinity);
  const unit = tabs || !Number.isFinite(smallest) ? tab : Math.min(8, Math.max(2, smallest));
  const cols = lead.slice();
  const prev: number[] = [];
  for (let i = 0, p = 0; i < lead.length; i++) { if (lead[i]! >= 0) p = lead[i]!; prev[i] = p; }
  for (let i = lead.length - 1, n = 0; i >= 0; i--) { if (lead[i]! >= 0) n = lead[i]!; else cols[i] = Math.min(prev[i]!, n); }
  return { unit, cols };
}
