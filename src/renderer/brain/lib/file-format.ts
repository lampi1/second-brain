// How the read-only file viewer shows a file (SPEC 22): a view per kind, syntax highlighting with highlight.js loaded
// on demand (the core and one language chunk per file type, offline, no LLM), CSV/TSV parsed into rows for a table and
// JSON pretty-printed. Pure functions besides the lazy imports; pinned by test/unit/file-format.test.ts.
import type { HLJSApi, LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;
/** File extension → highlight.js language, each one its own chunk (only the opened file's language is loaded). */
const LANGUAGES: Record<string, [string, Loader]> = {};
const lang = (name: string, load: Loader, ...exts: string[]) => { for (const ext of exts) LANGUAGES[ext] = [name, load]; };
lang('typescript', () => import('highlight.js/lib/languages/typescript'), 'ts', 'tsx', 'mts', 'cts');
lang('javascript', () => import('highlight.js/lib/languages/javascript'), 'js', 'jsx', 'mjs', 'cjs');
lang('json', () => import('highlight.js/lib/languages/json'), 'json', 'jsonc', 'json5');
lang('yaml', () => import('highlight.js/lib/languages/yaml'), 'yml', 'yaml');
lang('markdown', () => import('highlight.js/lib/languages/markdown'), 'md', 'markdown');
lang('xml', () => import('highlight.js/lib/languages/xml'), 'xml', 'html', 'htm', 'svg', 'csproj', 'props', 'targets', 'config', 'resx', 'xaml', 'trx', 'razor', 'cshtml', 'vue');
lang('css', () => import('highlight.js/lib/languages/css'), 'css');
lang('scss', () => import('highlight.js/lib/languages/scss'), 'scss', 'sass');
lang('csharp', () => import('highlight.js/lib/languages/csharp'), 'cs', 'csx');
lang('python', () => import('highlight.js/lib/languages/python'), 'py', 'pyw');
lang('powershell', () => import('highlight.js/lib/languages/powershell'), 'ps1', 'psm1', 'psd1');
lang('bash', () => import('highlight.js/lib/languages/bash'), 'sh', 'bash', 'zsh');
lang('dos', () => import('highlight.js/lib/languages/dos'), 'bat', 'cmd');
lang('sql', () => import('highlight.js/lib/languages/sql'), 'sql');
lang('java', () => import('highlight.js/lib/languages/java'), 'java');
lang('kotlin', () => import('highlight.js/lib/languages/kotlin'), 'kt', 'kts');
lang('go', () => import('highlight.js/lib/languages/go'), 'go');
lang('rust', () => import('highlight.js/lib/languages/rust'), 'rs');
lang('cpp', () => import('highlight.js/lib/languages/cpp'), 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx');
lang('ruby', () => import('highlight.js/lib/languages/ruby'), 'rb');
lang('php', () => import('highlight.js/lib/languages/php'), 'php');
lang('ini', () => import('highlight.js/lib/languages/ini'), 'ini', 'toml', 'cfg', 'env', 'editorconfig', 'gitconfig', 'properties');
lang('diff', () => import('highlight.js/lib/languages/diff'), 'diff', 'patch');
lang('dockerfile', () => import('highlight.js/lib/languages/dockerfile'), 'dockerfile');

export type FileView = 'markdown' | 'csv' | 'jsonl' | 'json' | 'code';

/** The lowercase extension of a path (a dotfile like `.env` → `env`, `Dockerfile` → `dockerfile`). */
export function extOf(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? '';
  if (/^dockerfile$/i.test(name)) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function viewOf(p: string): FileView {
  const ext = extOf(p);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl';
  if (ext === 'json') return 'json';
  return 'code';
}

export const languageOf = (p: string): string | null => LANGUAGES[extOf(p)]?.[0] ?? null;

let core: Promise<HLJSApi> | null = null;
/** highlight.js highlighting of `text` split in lines (each line's HTML closes and reopens the spans it crosses), or
 *  null when the type has no language. The HTML is highlight.js's own (the text escaped, only `<span class>` added),
 *  passed through `clean` (the viewer's DOMPurify, spans and classes only) before it is split. */
export async function highlightLines(text: string, p: string, clean: (html: string) => string = h => h): Promise<string[] | null> {
  const entry = LANGUAGES[extOf(p)];
  if (!entry) return null;
  const [name, load] = entry;
  core ??= import('highlight.js/lib/core').then(m => m.default);
  const hljs = await core;
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, (await load()).default);
  return splitHighlighted(clean(hljs.highlight(text, { language: name, ignoreIllegals: true }).value));
}

/** highlight.js HTML → one HTML string per line, every line self-contained (open spans closed at its end, reopened on the next). */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = '';
  const tag = /<span[^>]*>|<\/span>|\r?\n/g;
  let last = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    cur += html.slice(last, m.index);
    last = tag.lastIndex;
    const t = m[0];
    if (t.startsWith('</')) { open.pop(); cur += t; }
    else if (t.startsWith('<')) { open.push(t); cur += t; }
    else { lines.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
  }
  lines.push(cur + html.slice(last) + '</span>'.repeat(open.length));
  return lines;
}

/** Tabs, semicolons and commas in the first record, outside quoted cells (a quoted cell may hold any of them). As in
 *  parseCsv, a quote opens a quoted cell only at a cell's start (after any candidate delimiter), so `5" disk` is text. */
function delimiterCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false, start = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') continue;
      if (text[i + 1] === '"') i++;
      else quoted = false;
    } else if (c === '"' && start) quoted = true;
    else if (c === '\n' || c === '\r') break;
    else if (c in counts) { counts[c]!++; start = true; continue; }
    start = false;
  }
  return counts;
}

/** CSV/TSV text → rows of cells (RFC 4180 quotes, the delimiter guessed from the first record outside quotes: tab, `;`
 *  or `,`). */
export function parseCsv(text: string, p = ''): string[][] {
  const counts = delimiterCounts(text);
  const count = (c: string) => counts[c]!;
  const delim = extOf(p) === 'tsv' || count('\t') > Math.max(count(','), count(';')) ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.replace(/^\uFEFF/, '')));
}

/** JSON text pretty-printed with two spaces, or null when it does not parse. */
export function prettyJson(text: string): string | null {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
