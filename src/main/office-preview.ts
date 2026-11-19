// A Word, Excel or PowerPoint file as text the app's viewer can show (ADR 0328: «every artifact opens in the app»): the
// document's headings, paragraphs, lists and tables, a workbook's sheets as tables, a deck's slides as titles and
// points, written as Markdown. Not the original layout (fonts, pictures, charts): for that the viewer's artifact bar
// keeps «Apri con l'app». No dependency: an Office file is a ZIP of XML, read here with a bounded reader of its own
// (central directory only, one entry inflated at a time, sizes capped) and regular expressions over the few elements
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
  if (!e || e.size > PART_BYTES || (e.method !== 0 && e.method !== 8) || e.local + 30 > bytes.length || bytes.readUInt32LE(e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + bytes.readUInt16LE(e.local + 26) + bytes.readUInt16LE(e.local + 28);
  if (start + e.packed > bytes.length) return null;
  try {
    const data = bytes.subarray(start, start + e.packed);
    return (e.method === 0 ? data : inflateRawSync(data, { maxOutputLength: PART_BYTES })).toString('utf8');
  } catch { return null; }
}

// ── XML text ──
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return NAMED[e.toLowerCase()] ?? all;
});
/** Text as Markdown shows it literally (a cell holding «*» or «<b>» stays what it is). */
const esc = (s: string): string => s.replace(/([\\`*_[\]<>|#~])/g, '\\$1');
const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
function table(rows: string[][]): string {
  const width = Math.min(COLS_MAX, rows.reduce((m, r) => Math.max(m, r.length), 0));
  if (!width || !rows.length) return '';
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => oneLine(r[i] ?? '') || ' ').join(' | ')} |`;
  return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

// ── Word ──
/** The text of the runs inside `xml` (a paragraph, a cell): <w:t> texts, tabs and line breaks. */
function runs(xml: string, t = 'w:t', tab = 'w:tab', br = 'w:br'): string {
  let out = '';
  for (const m of xml.matchAll(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>|<${tab}\\b[^>]*/>|<${br}\\b[^>]*/>`, 'g'))) out += m[1] !== undefined ? unxml(m[1]) : m[0].startsWith(`<${tab}`) ? '\t' : '\n';
  return out;
}
function docx(xml: string): string {
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const blocks: string[] = [];
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/w:p>)/g)) {
    const x = m[0];
    if (x.startsWith('<w:tbl>')) {
      const rows = [...x.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].slice(0, ROWS_MAX).map(r => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(c => esc(runs(c[0]))));
      const t = table(rows);
      if (t) blocks.push(t);
      continue;
    }
    const text = runs(x).trim();
    if (!text) continue;
    const style = x.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const level = /^title$/i.test(style) ? 1 : Number(style.match(/^heading\s?([1-6])$/i)?.[1] ?? style.match(/^titolo\s?([1-6])$/i)?.[1] ?? 0);
    if (level) blocks.push(`${'#'.repeat(level)} ${esc(oneLine(text))}`);
    else if (/<w:numPr>/.test(x)) blocks.push(`- ${esc(oneLine(text))}`);
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
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const code = unxml(attr(m[0], 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    custom.set(Number(attr(m[0], 'numFmtId')), /[ymdhs]/i.test(code) && !/^general$/i.test(code));
  }
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map(m => { const id = Number(attr(m[0], 'numFmtId') ?? 0); return custom.get(id) ?? DATE_IDS.has(id); });
}
/** An Excel serial day as a date (and the time when it has one), 1900 system. */
function serialDate(n: number): string {
  const ms = Math.round((n - 25569) * 864e5);
  if (!Number.isFinite(ms) || n < 1 || n > 2958465) return String(n);
  const iso = new Date(ms).toISOString();
  return n % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
const colOf = (ref: string): number => { let n = 0; for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function xlsx(bytes: Buffer, all: Map<string, Entry>): OfficePreview | null {
  const book = part(bytes, all, 'xl/workbook.xml');
  if (!book) return null;
  const rels = new Map<string, string>();
  for (const m of (part(bytes, all, 'xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) rels.set(attr(m[0], 'Id') ?? '', attr(m[0], 'Target') ?? '');
  const shared = [...(part(bytes, all, 'xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m => runs((m[1] ?? '').replace(/<rPh>[\s\S]*?<\/rPh>/g, ''), 't', '__', '__'));
  const dates = dateStyles(part(bytes, all, 'xl/styles.xml'));
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)];
  let cut = sheets.length > SHEETS_MAX;
  const out: string[] = [];
  for (const s of sheets.slice(0, SHEETS_MAX)) {
    const target = (rels.get(attr(s[0], 'r:id') ?? '') ?? '').replace(/^\/?(xl\/)?/, '');
    const xml = target ? part(bytes, all, `xl/${target}`) : null;
    out.push(`## ${esc(unxml(attr(s[0], 'name') ?? ''))}`);
    if (!xml) continue;
    const rows: string[][] = [];
    const found = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
    if (found.length > ROWS_MAX) cut = true;
    for (const r of found.slice(0, ROWS_MAX)) {
      const row: string[] = [];
      let next = 0;
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = ` ${c[1] ?? ''}`, ref = attr(tag, 'r'), i = ref ? colOf(ref) : next;
        next = i + 1;
        if (i >= COLS_MAX) { cut = true; continue; }
        const inner = c[2] ?? '', type = attr(tag, 't'), v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let text = '';
        if (type === 'inlineStr') text = runs(inner, 't', '__', '__');
        else if (v === undefined) text = '';
        else if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e') text = unxml(v);
        else text = dates[Number(attr(tag, 's') ?? -1)] ? serialDate(Number(v)) : unxml(v);
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
  for (const m of (part(bytes, all, 'ppt/_rels/presentation.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) rels.set(attr(m[0], 'Id') ?? '', attr(m[0], 'Target') ?? '');
  // the deck's own order (presentation.xml); a damaged list falls back to the files' numbers
  let names = [...(part(bytes, all, 'ppt/presentation.xml') ?? '').matchAll(/<p:sldId\b[^>]*>/g)].map(m => `ppt/${(rels.get(attr(m[0], 'r:id') ?? '') ?? '').replace(/^\/?(ppt\/)?/, '')}`).filter(n => all.has(n));
  if (!names.length) names = [...all.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!names.length) return null;
  const out: string[] = [];
  names.slice(0, SLIDES_MAX).forEach((name, i) => {
    const xml = part(bytes, all, name) ?? '';
    let title = '';
    const lines: string[] = [];
    for (const sp of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>|<a:tbl>[\s\S]*?<\/a:tbl>/g)) {
      if (sp[0].startsWith('<a:tbl>')) {
        const t = table([...sp[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].slice(0, ROWS_MAX).map(r => [...r[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(c => esc(runs(c[0], 'a:t', 'a:tab', 'a:br')))));
        if (t) lines.push(`\n${t}\n`);
        continue;
      }
      const paras = [...sp[0].matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map(p => oneLine(runs(p[0], 'a:t', 'a:tab', 'a:br'))).filter(Boolean);
      if (!title && /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(sp[0])) title = paras.join(' ');
      else lines.push(...paras.map(p => `- ${esc(p)}`));
    }
    out.push([`## ${i + 1}. ${esc(title)}`.trimEnd(), ...lines].join('\n'));
  });
  return { markdown: out.join('\n\n'), cut: names.length > SLIDES_MAX };
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
