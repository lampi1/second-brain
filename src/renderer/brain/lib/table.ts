// The logic of the brain's data tables, without React: facet filters with counts, free-text search, sort (numbers as
// numbers, text in Italian collation with numeric parts), CSV for Excel in Italian (semicolon + BOM), JSON, and the
// window of rows to draw when a table is virtualized. Used by components/DataTable.tsx; unit-tested in
// test/unit/brain-ui/table.test.ts.

export type ColType = 'text' | 'num' | 'usd' | 'date';
export interface ColBase<R> {
  key: string;
  label: string;
  type?: ColType;
  /** the value for search, sort and CSV when it is not row[key] */
  value?: (r: R) => unknown;
}
export interface TableQuery { q: string; filters: Record<string, string>; sort: { key: string; dir: 1 | -1 } | null }

export const cellValue = <R>(c: ColBase<R>, r: R): unknown => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
const text = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Ascending order of two cell values: numbers as numbers, the rest as Italian text with numeric parts ("P-9" < "P-10"). */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return text(a).localeCompare(text(b), 'it', { numeric: true, sensitivity: 'base' });
}

/** Distinct values of a facet with their counts, in Italian order; empties left out. */
export function facetValues<R>(rows: R[], col: ColBase<R>): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) { const v = text(cellValue(col, r)); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'it', { numeric: true }));
}

/** Rows that pass the filters and the search, sorted. Empty values always sort last. */
export function queryRows<R>(rows: R[], cols: ColBase<R>[], q: TableQuery): R[] {
  const byKey = new Map(cols.map(c => [c.key, c]));
  const active = Object.entries(q.filters).filter(([, v]) => v);
  let out = active.length ? rows.filter(r => active.every(([k, v]) => { const c = byKey.get(k); return text(c ? cellValue(c, r) : (r as Record<string, unknown>)[k]) === v; })) : rows;
  const needle = q.q.trim().toLowerCase();
  if (needle) out = out.filter(r => cols.some(c => text(cellValue(c, r)).toLowerCase().includes(needle)) || text(r).toLowerCase().includes(needle));
  if (q.sort) {
    const c = byKey.get(q.sort.key), dir = q.sort.dir;
    if (c) out = out.map((r, i) => ({ r, i, v: cellValue(c, r) })).sort((a, b) => {
      const ae = a.v === '' || a.v == null, be = b.v === '' || b.v == null;
      if (ae !== be) return ae ? 1 : -1;
      return compareValues(a.v, b.v) * dir || a.i - b.i;
    }).map(x => x.r);
  }
  return out;
}

/** Next sort when a header is clicked: same column flips; a new one starts descending for numbers, ascending for text. */
export function nextSort<R>(cur: TableQuery['sort'], col: ColBase<R>): NonNullable<TableQuery['sort']> {
  if (cur?.key === col.key) return { key: col.key, dir: cur.dir === 1 ? -1 : 1 };
  return { key: col.key, dir: col.type === 'num' || col.type === 'usd' || col.type === 'date' ? -1 : 1 };
}

const csvCell = (v: unknown): string => { const s = text(v); return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV that Excel in Italian opens in columns at once: BOM, semicolons, CRLF. */
export function toCsv<R>(cols: ColBase<R>[], rows: R[]): string {
  return `﻿${[cols.map(c => csvCell(c.label)).join(';'), ...rows.map(r => cols.map(c => csvCell(cellValue(c, r))).join(';'))].join('\r\n')}`;
}
/** The rows as JSON, only the shown columns (by label), values as the table holds them. */
export function toJson<R>(cols: ColBase<R>[], rows: R[]): string {
  return JSON.stringify(rows.map(r => Object.fromEntries(cols.map(c => [c.key, cellValue(c, r) ?? null]))), null, 2);
}
export const stamp = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);
export const fileSafe = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'tabella';

/** The slice of rows to draw in a virtualized list, with the spacer heights above and below. */
export function windowRange(scrollTop: number, viewport: number, rowH: number, count: number, overscan = 8): { start: number; end: number; padTop: number; padBottom: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowH) + overscan);
  return { start, end, padTop: start * rowH, padBottom: Math.max(0, (count - end) * rowH) };
}

/** scrollTop that brings row i into a viewport (unchanged when already visible). */
export function scrollIntoRow(i: number, scrollTop: number, viewport: number, rowH: number, header = 0): number {
  const top = i * rowH, bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport - header) return bottom - viewport + header;
  return scrollTop;
}
