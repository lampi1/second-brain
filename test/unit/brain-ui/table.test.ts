// Data table logic (src/renderer/brain/lib/table.ts): facets, search, sort with empties last, CSV for Excel in
// Italian, JSON, the virtualized window.
import { describe, expect, it } from 'vitest';
import { compareValues, facetValues, fileSafe, nextSort, queryRows, scrollIntoRow, toCsv, toJson, windowRange, type ColBase } from '../../../src/renderer/brain/lib/table';

interface R { id: string; tipo: string; usd: number | ''; nota?: string }
const rows: R[] = [
  { id: 'P-10', tipo: 'regola', usd: 3 },
  { id: 'P-9', tipo: 'script', usd: '' },
  { id: 'P-2', tipo: 'regola', usd: 12.5, nota: 'con "virgolette"; e punto e virgola' },
];
const cols: ColBase<R>[] = [{ key: 'id', label: 'Id' }, { key: 'tipo', label: 'Tipo' }, { key: 'usd', label: 'Spesa', type: 'usd' }];

describe('query', () => {
  it('facet values with counts, Italian order, empties left out', () => {
    expect(facetValues(rows, cols[1]!)).toEqual([{ value: 'regola', count: 2 }, { value: 'script', count: 1 }]);
  });
  it('filters, then searches every column and the whole row', () => {
    expect(queryRows(rows, cols, { q: '', filters: { tipo: 'regola' }, sort: null }).map(r => r.id)).toEqual(['P-10', 'P-2']);
    expect(queryRows(rows, cols, { q: 'virgolette', filters: {}, sort: null }).map(r => r.id)).toEqual(['P-2']);
  });
  it('sorts numbers as numbers and text with numeric parts; empties last in both directions', () => {
    expect(queryRows(rows, cols, { q: '', filters: {}, sort: { key: 'id', dir: 1 } }).map(r => r.id)).toEqual(['P-2', 'P-9', 'P-10']);
    expect(queryRows(rows, cols, { q: '', filters: {}, sort: { key: 'usd', dir: -1 } }).map(r => r.id)).toEqual(['P-2', 'P-10', 'P-9']);
    expect(queryRows(rows, cols, { q: '', filters: {}, sort: { key: 'usd', dir: 1 } }).map(r => r.id)).toEqual(['P-10', 'P-2', 'P-9']);
    expect(compareValues(2, 10)).toBeLessThan(0);
  });
  it('a click on a new column sorts numbers descending, text ascending; the same column flips', () => {
    expect(nextSort(null, cols[2]!)).toEqual({ key: 'usd', dir: -1 });
    expect(nextSort(null, cols[0]!)).toEqual({ key: 'id', dir: 1 });
    expect(nextSort({ key: 'id', dir: 1 }, cols[0]!)).toEqual({ key: 'id', dir: -1 });
  });
});

describe('export', () => {
  it('CSV: BOM, semicolons, CRLF, quotes doubled', () => {
    const csv = toCsv([...cols, { key: 'nota', label: 'Nota' }], rows);
    expect(csv.startsWith('﻿Id;Tipo;Spesa;Nota\r\n')).toBe(true);
    expect(csv).toContain('P-2;regola;12.5;"con ""virgolette""; e punto e virgola"');
  });
  it('JSON: only the shown columns', () => {
    expect(JSON.parse(toJson(cols.slice(0, 2), rows.slice(0, 1)))).toEqual([{ id: 'P-10', tipo: 'regola' }]);
  });
  it('file names are safe', () => {
    expect(fileSafe('Errori dell’IA / città')).toBe('errori-dell-ia-citta');
  });
});

describe('virtualization', () => {
  it('draws only the visible rows plus overscan, with spacers', () => {
    expect(windowRange(0, 340, 34, 1137, 4)).toEqual({ start: 0, end: 14, padTop: 0, padBottom: (1137 - 14) * 34 });
    const w = windowRange(3400, 340, 34, 1137, 4);
    expect(w.start).toBe(96);
    expect(w.end).toBe(114);
    expect(w.padTop + (w.end - w.start) * 34 + w.padBottom).toBe(1137 * 34);
  });
  it('scrolls just enough to show the active row', () => {
    expect(scrollIntoRow(5, 0, 340, 34)).toBe(0);
    expect(scrollIntoRow(20, 0, 340, 34, 32)).toBe(21 * 34 - 340 + 32);
    expect(scrollIntoRow(2, 500, 340, 34)).toBe(68);
  });
});
