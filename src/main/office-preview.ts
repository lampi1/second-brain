// A Word, Excel or PowerPoint file as text the app's viewer can show (ADR 0328: «every artifact opens in the app»): the
// document's headings, paragraphs, lists and tables, a workbook's sheets as tables, a deck's slides as titles and
// points, written as Markdown. Not the original layout (fonts, pictures, charts): for that the viewer's artifact bar
// keeps «Apri con l'app». No dependency: an Office file is a ZIP of XML, read here with a bounded reader of its own
// (central directory only, one entry inflated at a time, sizes capped) and a linear scan (indexOf) for the few elements
// that carry text. Nothing is run, no macro or external link is followed. Used by file-view.ts (kind 'office'); pinned
// by test/unit/office-preview.test.ts.
import { inflateRawSync } from 'node:zlib';

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';
export const OFFICE_FORMATS: Readonly<Record<string, OfficeFormat>> = { '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' };
/** The file itself may be this big (its pictures count); one XML part this big unpacked; the text given back this long. */
export const OFFICE_BYTES = 40_000_000;
const PART_BYTES = 30_000_000;
const TEXT_MAX = 600_000;
const ROWS_MAX = 300, COLS_MAX = 40, SHEETS_MAX = 12, SLIDES_MAX = 300;

export interface OfficePreview { markdown: string; /** part of the file was left out (rows, columns, sheets, length) */ cut: boolean }

// ── the ZIP: names → where each entry is, from the central directory ──
interface Entry { method: number; packed: number; size: number; local: number }
function entries(bytes: Buffer): Map<string, Entry> | null {
  let end = bytes.length - 22;
  const floor = Math.max(0, bytes.length - 65557);
  while (end >= floor && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < floor || end < 0) return null;
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const out = new Map<string, Entry>();
  for (let i = 0; i < count && i < 5000; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) return null;
    const nl = bytes.readUInt16LE(at + 28), el = bytes.readUInt16LE(at + 30), cl = bytes.readUInt16LE(at + 32);
    const name = bytes.toString('utf8', at + 46, at + 46 + nl);
    out.set(name, { method: bytes.readUInt16LE(at + 10), packed: bytes.readUInt32LE(at + 20), size: bytes.readUInt32LE(at + 24), local: bytes.readUInt32LE(at + 42) });
    at += 46 + nl + el + cl;
  }
  return out;
}
/** One entry's text, or null (absent, too big, encrypted or damaged). */
function part(bytes: Buffer, all: Map<string, Entry>, name: string): string | null {
  const e = all.get(name);
  if (!e || e.size > PART_BYTES || (e.method === 0 && e.packed > PART_BYTES) || (e.method !== 0 && e.method !== 8) || e.local + 30 > bytes.length || bytes.readUInt32LE(e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + bytes.readUInt16LE(e.local + 26) + bytes.readUInt16LE(e.local + 28);
  if (start + e.packed > bytes.length) return null;
  try {
    const data = bytes.subarray(start, start + e.packed);
    return (e.method === 0 ? data : inflateRawSync(data, { maxOutputLength: PART_BYTES })).toString('utf8');
  } catch { return null; }
}

// ── XML text ──
// Every element is found with indexOf, never with a lazy regular expression: a file made to hurt (a million opening
// tags and no closing one) is read in time linear in its size, on main's thread.
interface El { name: string; /** the opening tag's text, at most TAG_MAX */ open: string; /** what is between the tags ('' when self-closing) */ inner: string }
const TAG_MAX = 4000;
/** The elements named `names` in `xml`, in document order, not looking inside one it gave back (a table's paragraphs
 *  are the table's). An element never closed ends the search for that name. */
function* elements(xml: string, names: readonly string[]): Generator<El> {
  const next = names.map(() => -2); // -2: not searched from `at` yet, -1: no more
  let at = 0;
  const find = (i: number, from: number): number => {
    const tag = `<${names[i]!}`;
    for (let p = xml.indexOf(tag, from); p >= 0; p = xml.indexOf(tag, p + 1)) {
      const c = xml.charCodeAt(p + tag.length);
      if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13) return p; // > / space tab newline
    }
    return -1;
  };
  for (;;) {
    let best = -1;
    for (let i = 0; i < names.length; i++) {
      if (next[i] === -1) continue;
      if (next[i]! < at) next[i] = find(i, at);
      if (next[i]! >= 0 && (best < 0 || next[i]! < next[best]!)) best = i;
    }
    if (best < 0) return;
    const start = next[best]!, name = names[best]!;
    const gt = xml.indexOf('>', start);
    if (gt < 0) return;
    const open = xml.slice(start, Math.min(gt + 1, start + TAG_MAX));
    if (xml.charCodeAt(gt - 1) === 47) { at = gt + 1; yield { name, open, inner: '' }; continue; }
    const close = `</${name}>`, end = xml.indexOf(close, gt + 1);
    if (end < 0) { next[best] = -1; continue; }
    at = end + close.length;
    yield { name, open, inner: xml.slice(gt + 1, end) };
  }
}
const first = (xml: string, name: string): El | null => { for (const e of elements(xml, [name])) return e; return null; };
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string): string => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,8});/gi, (all, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return NAMED[e.toLowerCase()] ?? all;
});
/** Text as Markdown shows it literally (a cell holding «*» or «<b>» stays what it is). */
const esc = (s: string): string => s.replace(/([\\`*_[\]<>|#~])/g, '\\$1');
/** An attribute of an opening tag (indexOf again: a tag of a thousand unclosed quotes costs nothing). */
function attr(tag: string, name: string): string | null {
  const key = `${name}="`;
  for (let p = tag.indexOf(key); p >= 0; p = tag.indexOf(key, p + 1)) {
    const c = tag.charCodeAt(p - 1);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) continue;
    const end = tag.indexOf('"', p + key.length);
    return end < 0 ? null : tag.slice(p + key.length, end);
  }
  return null;
}
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
function table(rows: string[][]): string {
  const width = Math.min(COLS_MAX, rows.reduce((m, r) => Math.max(m, r.length), 0));
  if (!width || !rows.length) return '';
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => oneLine(r[i] ?? '') || ' ').join(' | ')} |`;
  return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}
/** At most `max` elements, and whether there were more. */
function take(xml: string, name: string, max: number): { list: El[]; more: boolean } {
  const list: El[] = [];
  for (const e of elements(xml, [name])) { if (list.length >= max) return { list, more: true }; list.push(e); }
  return { list, more: false };
}

// ── Word ──
/** The text of the runs inside `xml` (a paragraph, a cell): the text elements, tabs and line breaks; `skip` names an
 *  element whose text is not the cell's (Excel's phonetic guide). */
function runs(xml: string, t = 'w:t', tab = 'w:tab', br = 'w:br', skip?: string): string {
  let out = '';
  for (const e of elements(xml, skip ? [t, tab, br, skip] : [t, tab, br])) out += e.name === t ? unxml(e.inner) : e.name === tab ? '\t' : e.name === br ? '\n' : '';
  return out;
}
function docx(xml: string): string {
  const from = xml.indexOf('<w:body>'), to = xml.lastIndexOf('</w:body>');
  const body = from >= 0 && to > from ? xml.slice(from + 8, to) : xml;
  const blocks: string[] = [];
  for (const x of elements(body, ['w:tbl', 'w:p'])) {
    if (x.name === 'w:tbl') {
      const rows = take(x.inner, 'w:tr', ROWS_MAX).list.map(r => [...elements(r.inner, ['w:tc'])].map(c => esc(runs(c.inner))));
      const t = table(rows);
      if (t) blocks.push(t);
      continue;
    }
    const text = runs(x.inner).trim();
    if (!text) continue;
    const styled = first(x.inner, 'w:pStyle'), style = styled ? attr(styled.open, 'w:val') ?? '' : '';
    const level = /^title$/i.test(style) ? 1 : Number(style.match(/^heading\s?([1-6])$/i)?.[1] ?? style.match(/^titolo\s?([1-6])$/i)?.[1] ?? 0);
    if (level) blocks.push(`${'#'.repeat(level)} ${esc(oneLine(text))}`);
    else if (x.inner.includes('<w:numPr')) blocks.push(`- ${esc(oneLine(text))}`);
    else blocks.push(esc(text).replace(/\n/g, '  \n'));
  }
  // list items stay one list: only other blocks get a blank line between them
  return blocks.map((b, i) => (i && !(b.startsWith('- ') && blocks[i - 1]!.startsWith('- ')) ? `\n${b}` : b)).join('\n');
}

// ── Excel ──
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
/** For each cell style (the `s` attribute), whether its number format is a date or a time. */
function dateStyles(styles: string | null): boolean[] {
  if (!styles) return [];
  const custom = new Map<number, boolean>();
  for (const m of elements(styles, ['numFmt'])) {
    const code = unxml((attr(m.open, 'formatCode') ?? '').slice(0, 200)).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    custom.set(Number(attr(m.open, 'numFmtId')), /[ymdhs]/i.test(code) && !/^general$/i.test(code));
  }
  return [...elements(first(styles, 'cellXfs')?.inner ?? '', ['xf'])].map(m => { const id = Number(attr(m.open, 'numFmtId') ?? 0); return custom.get(id) ?? DATE_IDS.has(id); });
}
/** An Excel serial day as a date (and the time when it has one), 1900 system. */
function serialDate(n: number): string {
  const ms = Math.round((n - 25569) * 864e5);
  if (!Number.isFinite(ms) || n < 1 || n > 2958465) return String(n);
  const iso = new Date(ms).toISOString();
  return n % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
const colOf = (ref: string): number => { let n = 0; for (const ch of ref.slice(0, 12).replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function xlsx(bytes: Buffer, all: Map<string, Entry>): OfficePreview | null {
  const book = part(bytes, all, 'xl/workbook.xml');
  if (!book) return null;
  const rels = new Map<string, string>();
  for (const m of elements(part(bytes, all, 'xl/_rels/workbook.xml.rels') ?? '', ['Relationship'])) rels.set(attr(m.open, 'Id') ?? '', attr(m.open, 'Target') ?? '');
  const strings = part(bytes, all, 'xl/sharedStrings.xml');
  const shared = [...elements(strings ?? '', ['si'])].map(m => runs(m.inner, 't', '__', '__', 'rPh'));
  const dates = dateStyles(part(bytes, all, 'xl/styles.xml'));
  const sheets = take(book, 'sheet', SHEETS_MAX);
  // a part too big to read (or damaged) leaves cells or a whole sheet out: the preview says it is cut
  let cut = sheets.more || (strings === null && all.has('xl/sharedStrings.xml'));
  const out: string[] = [];
  for (const s of sheets.list) {
    const target = (rels.get(attr(s.open, 'r:id') ?? '') ?? '').replace(/^\/?(xl\/)?/, '');
    const xml = target ? part(bytes, all, `xl/${target}`) : null;
    out.push(`## ${esc(unxml(attr(s.open, 'name') ?? ''))}`);
    if (xml === null) { if (target && all.has(`xl/${target}`)) cut = true; continue; }
    const rows: string[][] = [];
    const found = take(xml, 'row', ROWS_MAX);
    if (found.more) cut = true;
    for (const r of found.list) {
      const row: string[] = [];
      let next = 0;
      for (const c of elements(r.inner, ['c'])) {
        const ref = attr(c.open, 'r'), i = ref ? colOf(ref) : next;
        next = i + 1;
        if (i >= COLS_MAX) { cut = true; break; }
        if (i < 0) continue;
        const type = attr(c.open, 't'), v = first(c.inner, 'v')?.inner;
        let text = '';
        if (type === 'inlineStr') text = runs(c.inner, 't', '__', '__', 'rPh');
        else if (v === undefined) text = '';
        else if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e') text = unxml(v);
        else text = dates[Number(attr(c.open, 's') ?? -1)] ? serialDate(Number(v)) : unxml(v);
        row[i] = esc(text);
      }
      if (row.some(x => x)) rows.push(Array.from(row, x => x ?? ''));
    }
    const t = table(rows);
    if (t) out.push(t);
  }
  return { markdown: out.join('\n\n'), cut };
}

// ── PowerPoint ──
function pptx(bytes: Buffer, all: Map<string, Entry>): OfficePreview | null {
  const rels = new Map<string, string>();
  for (const m of elements(part(bytes, all, 'ppt/_rels/presentation.xml.rels') ?? '', ['Relationship'])) rels.set(attr(m.open, 'Id') ?? '', attr(m.open, 'Target') ?? '');
  // the deck's own order (presentation.xml); a damaged list falls back to the files' numbers
  let names = take(part(bytes, all, 'ppt/presentation.xml') ?? '', 'p:sldId', SLIDES_MAX + 1).list.map(m => `ppt/${(rels.get(attr(m.open, 'r:id') ?? '') ?? '').replace(/^\/?(ppt\/)?/, '')}`).filter(n => all.has(n));
  if (!names.length) names = [...all.keys()].filter(n => /^ppt\/slides\/slide\d{1,6}\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!names.length) return null;
  const out: string[] = [];
  let cut = names.length > SLIDES_MAX;
  names.slice(0, SLIDES_MAX).forEach((name, i) => {
    const xml = part(bytes, all, name);
    if (xml === null) cut = true;
    let title = '';
    const lines: string[] = [];
    for (const sp of elements(xml ?? '', ['p:sp', 'a:tbl'])) {
      if (sp.name === 'a:tbl') {
        const t = table(take(sp.inner, 'a:tr', ROWS_MAX).list.map(r => [...elements(r.inner, ['a:tc'])].map(c => esc(runs(c.inner, 'a:t', 'a:tab', 'a:br')))));
        if (t) lines.push(`\n${t}\n`);
        continue;
      }
      const paras = [...elements(sp.inner, ['a:p'])].map(p => oneLine(runs(p.inner, 'a:t', 'a:tab', 'a:br'))).filter(Boolean);
      const kind = attr(first(sp.inner, 'p:ph')?.open ?? '', 'type');
      if (!title && (kind === 'title' || kind === 'ctrTitle')) title = paras.join(' ');
      else lines.push(...paras.map(p => `- ${esc(p)}`));
    }
    out.push([`## ${i + 1}. ${esc(title)}`.trimEnd(), ...lines].join('\n'));
  });
  return { markdown: out.join('\n\n'), cut };
}

/** The file's text as Markdown, or null when it is not a readable Office file (encrypted, damaged, another format). */
export function officePreview(bytes: Buffer, format: OfficeFormat): OfficePreview | null {
  if (bytes.length < 22 || bytes.length > OFFICE_BYTES || bytes.readUInt32LE(0) !== 0x04034b50) return null;
  let all: Map<string, Entry> | null;
  try { all = entries(bytes); } catch { return null; }
  if (!all) return null;
  let out: OfficePreview | null = null;
  try {
    if (format === 'docx') { const xml = part(bytes, all, 'word/document.xml'); out = xml === null ? null : { markdown: docx(xml), cut: false }; }
    else out = format === 'xlsx' ? xlsx(bytes, all) : pptx(bytes, all);
  } catch { return null; }
  if (!out) return null;
  return out.markdown.length > TEXT_MAX ? { markdown: out.markdown.slice(0, TEXT_MAX), cut: true } : out;
}
