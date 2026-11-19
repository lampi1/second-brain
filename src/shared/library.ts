// Memoria → Artifact (ADR 0328, which replaces ADR 0319's «every file the chats produce»): the reports, documents,
// plans and analyses an agent made because the user asked for one, declared by the agent itself (artifact_save,
// main/library/tools.ts) and indexed where they are (never moved). Nothing is looked for in folders or in the chats'
// answers any more: a screenshot, a log or a scratch file is never an artifact. Shapes of the index main keeps
// (main/library/*) and the pure rules both sides share: which files can be artifacts (`artifactKind`: only what the
// app's viewer opens), which files are versions of one report (`versionKey`), its title and summary from its head
// (`titleOf`, `summaryOf`), the search (`searchArtifacts`). Used by main/library/service.ts, the Memoria tab
// (renderer/components/library/*) and the viewer's artifact bar; pinned by test/unit/library-shared.test.ts.

/** The look of a card and of a version's key, never a way to group the list (the owner 2026-11-19: «non divisi per tipo
 *  di file»). Every kind opens in the app's viewer: html, markdown, pdf and images (png, jpg, webp, gif) as they are, a
 *  table (csv, tsv) as a table, json and txt as text, Word, Excel and PowerPoint as their text and tables
 *  (main/office-preview.ts). An SVG is not one: the viewer shows its source, so a drawing goes inside an HTML report. */
export type ArtifactKind = 'html' | 'markdown' | 'pdf' | 'image' | 'data' | 'document';

/** One version of an artifact: a file on disk (or the copy the app kept of it when the file was overwritten or went). */
export interface ArtifactVersion {
  path: string;
  /** the file's mtime when saved */
  at: number;
  size: number;
  /** the chat that saved this version */
  chatId?: string;
  /** a copy of this version kept by the app (userData/library/versions), readable when the file changed or went */
  copy?: string;
  /** the file is gone (or changed since: then `copy`, when kept, still shows this version) */
  missing?: true;
}

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  /** the project or area it belongs to: a chat's app or repo, a project folder, «Brain» */
  area: string;
  /** a short text: the agent's own, else from the file's head */
  summary: string;
  /** the chat that produced its newest version */
  chatId?: string;
  chatTitle?: string;
  /** the newest version's file */
  path: string;
  /** the newest version's mtime */
  at: number;
  size: number;
  /** the newest version's file is gone */
  missing: boolean;
  /** newest first; one entry = no history */
  versions: ArtifactVersion[];
}

export interface ArtifactList { artifacts: Artifact[] }

/** A card's picture: an image scaled down, an HTML head to draw small, or the first lines of a text file (csv, txt, json). */
export type ArtifactThumb = { kind: 'image'; dataUrl: string } | { kind: 'html'; text: string; path: string } | { kind: 'text'; text: string };

/** The index keeps this many; past it the oldest go (their files stay where they are). */
export const LIBRARY_MAX = 2000;
/** The list shows this many at first and this many more at each «Mostra altri». */
export const LIBRARY_PAGE = 20;
const EXT: Readonly<Record<string, ArtifactKind>> = {
  html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  csv: 'data', tsv: 'data', json: 'data', xlsx: 'data',
  txt: 'document', docx: 'document', pptx: 'document',
};
/** The formats an artifact can have, as a tool's error names them. */
export const ARTIFACT_FORMATS = 'html, md, pdf, png, jpg, webp, gif, csv, tsv, json, txt, docx, xlsx, pptx';
/** Files whose head is text: read for title, summary and card. */
const TEXT = new Set(['html', 'htm', 'md', 'markdown', 'csv', 'tsv', 'json', 'txt']);
/** A table or text file named like a login's state or a secret (a browser's storage state, a token, cookies): never an
 *  artifact. */
const SECRET_NAME = /(cookie|token|secret|credential|passw|auth|storage[-_.]?state|session|private[-_.]?key|api[-_.]?key|\.env\b)/i;
const SECRET_EXT = new Set(['json', 'txt', 'csv', 'tsv']);
/** A text head that holds a credential (a token, a password, a private key): refused as an artifact. */
export const secretHead = (text: string): boolean =>
  /"(?:cookies|token|access_?token|refresh_?token|id_?token|password|passwd|private_?key|client_?secret|api_?key|secret|authorization)"\s*:|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|api[_-]?key|secret|token)\s*[=:]\s*["']?[^\s"']{8,}/i.test(text);

const sepSplit = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean);
export const baseNameOf = (p: string): string => sepSplit(p).pop() ?? p;
export const extOf = (p: string): string => { const b = baseNameOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

/** The artifact kind of a file, or null when it cannot be one (a format the viewer does not open, a hidden file, a
 *  file named like a secret). */
export function artifactKind(p: string): ArtifactKind | null {
  const kind = EXT[extOf(p)];
  if (!kind || baseNameOf(p).startsWith('.')) return null;
  if (SECRET_EXT.has(extOf(p)) && SECRET_NAME.test(baseNameOf(p))) return null;
  return kind;
}
/** The file's head is text (title, summary, card lines). */
export const readsText = (p: string): boolean => TEXT.has(extOf(p));

/** Same file on this OS: Windows and macOS disks ignore case; slashes unified. */
export function pathKey(p: string, platform: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'linux' ? n : n.toLowerCase();
}

const DATE_HEAD = /^\d{4}-\d{2}-\d{2}(?:[t_ -]\d{2}[-:.]?\d{2}(?:[-:.]?\d{2})?)?[-_ .]*/i;
const DATE_TAIL = /[-_ .]+(?:\d{4}-\d{2}-\d{2}(?:[t_ -]\d{2}[-:.]?\d{2}(?:[-:.]?\d{2}(?:[-.]\d{1,3})?)?z?)?|\d{8}(?:[-_]\d{4,6})?)$/i;
const VERSION_TOKEN = /(^|[-_ .])(?:v|ver|rev)\d{1,3}(?=$|[-_ .])/gi;
// «-2» is a copy mark, except after a word that numbers parts (part-1 and part-2 are two documents)
const COPY_TAIL = /(?:(?<!(?:part|parte|step|fase|phase|chapter|capitolo|section|sezione|day|giorno|week|settimana|sprint|lesson|lezione|round|run|test|case|caso))[-_ ](?:\d{1,2}|final|finale|draft|bozza|new|nuovo|nuova|latest|updated|aggiornat[oa])|\s*\(\d{1,2}\))$/i;

/** A file or folder name without its dates, version tokens (v3, rev2) and copy marks (-2, (1), -final): the same report
 *  regenerated later gets the same stem. Empty → the name as it is. */
export function stemOf(name: string): string {
  const raw = name.toLowerCase();
  let s = raw;
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(DATE_HEAD, '').replace(DATE_TAIL, '').replace(VERSION_TOKEN, '$1').replace(COPY_TAIL, '').replace(/[-_ .]{2,}/g, '-').replace(/^[-_ .]+|[-_ .]+$/g, '');
    if (s === before) break;
  }
  return s || raw;
}

/**
 * The key that makes files versions of one artifact. A document: its kind, its folder (the last folder's name without
 * dates, so `2026-10-12-giornata/report.html` and `2026-10-13-giornata/report.html` are one report) and its stem
 * (`flow-bugfix-v18-notes.md` = `flow-bugfix-v19-notes.md`). An image or a recording only ever versions itself (its
 * path). Same extension only (a .csv and a .xlsx of one name are two artifacts).
 */
export function versionKey(p: string, kind: ArtifactKind, platform: string): string {
  const parts = sepSplit(pathKey(p, platform));
  const file = parts.pop() ?? '';
  if (kind === 'image') return `${kind}|${parts.join('/')}/${file}`;
  const dot = file.lastIndexOf('.');
  const last = parts.pop();
  const dir = [...parts, ...(last === undefined ? [] : [stemOf(last)])].join('/');
  const family = kind === 'data' || kind === 'document' ? `${kind}.${extOf(file)}` : kind;
  return `${family}|${dir}|${stemOf(dot > 0 ? file.slice(0, dot) : file)}`;
}

// ── title and summary from a file's head ───────────────────────────────────────────────────────────────────────────
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', middot: '·' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all; }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
const htmlText = (s: string): string => squash(decode(s.replace(/<[^>]*>/g, ' ')));
const mdInline = (s: string): string => squash(s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').replace(/<[^>]+>/g, ''));

/** A file name as a title: dates, extension and separators gone, first letter up («2026-10-26-app-cpu-report.md» →
 *  «App cpu report»). */
export function nameTitle(p: string): string {
  const b = baseNameOf(p), dot = b.lastIndexOf('.'), stem = dot > 0 ? b.slice(0, dot) : b;
  const s = squash(stem.replace(DATE_HEAD, '').replace(/[-_]+/g, ' ')) || stem;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The title in a file's head: a Markdown document's first heading (or front matter title), an HTML page's <title> or
 *  first <h1>; else its name. */
export function titleOf(kind: ArtifactKind, head: string, p: string): string {
  let t = '';
  if (kind === 'markdown') {
    const fm = head.match(/^---\r?\n([\s\S]{0,4000}?)\r?\n---/);
    t = fm?.[1]?.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? '';
    if (!t) t = head.replace(/^---\r?\n[\s\S]{0,4000}?\r?\n---/, '').replace(/```[\s\S]*?```/g, '').match(/^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/m)?.[1] ?? '';
    t = mdInline(t);
  } else if (kind === 'html') {
    t = htmlText(head.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i)?.[1] ?? '') || htmlText(head.match(/<h1[^>]*>([\s\S]{0,800}?)<\/h1>/i)?.[1] ?? '');
  }
  return clip(t, 140) || nameTitle(p);
}

/** A sentence or two from a file's head: Markdown's first paragraph after the title, HTML's meta description or first
 *  paragraph, a text file's first paragraph, a table's columns (`p` tells csv from tsv); '' for the rest. */
export function summaryOf(kind: ArtifactKind, head: string, p = ''): string {
  const ext = extOf(p);
  if (ext === 'txt') {
    for (const block of head.split(/\r?\n\s*\r?\n/)) { const text = squash(block); if (text.length >= 24) return clip(text, 220); }
    return clip(squash(head), 220);
  }
  if (ext === 'csv' || ext === 'tsv') {
    const first = head.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    const sep = ext === 'tsv' ? '\t' : [';', ',', '\t'].reduce((best, c) => (first.split(c).length > first.split(best).length ? c : best), ',');
    const cols = first.split(sep).map(c => squash(c.replace(/^"|"$/g, ''))).filter(Boolean);
    return cols.length > 1 ? clip(cols.join(' · '), 220) : '';
  }
  if (kind === 'markdown') {
    const body = head.replace(/^---\r?\n[\s\S]{0,4000}?\r?\n---/, '').replace(/```[\s\S]*?(```|$)/g, '\n\n').replace(/<!--[\s\S]*?-->/g, '');
    for (const block of body.split(/\r?\n\s*\r?\n/)) {
      const lines = block.split(/\r?\n/).filter(l => l.trim() && !/^\s{0,3}(#|>?\s*\||[-*_]{3,}\s*$|!\[|<)/.test(l));
      const text = mdInline(lines.map(l => l.replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, '')).join(' '));
      if (text.length >= 24) return clip(text, 220);
    }
    return '';
  }
  if (kind === 'html') {
    const meta = head.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{8,600})["']/i)?.[1] ?? head.match(/<meta[^>]+content=["']([^"']{8,600})["'][^>]*name=["']description["']/i)?.[1];
    if (meta) return clip(squash(decode(meta)), 220);
    const body = head.replace(/<(script|style|head|svg|nav|header)[\s\S]*?<\/\1>/gi, ' ');
    for (const m of body.matchAll(/<(p|li|div)[^>]*>([\s\S]{0,2000}?)<\/\1>/gi)) { const text = htmlText(m[2]!); if (text.length >= 24) return clip(text, 220); }
  }
  return '';
}

// ── the search, shared by the tab and its tests ──────────────────────────────────────────────────────────────────────
const DAY = 864e5;
const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The artifacts a search keeps, newest first: every word in the title, summary, area, chat, or file name. */
export function searchArtifacts(list: readonly Artifact[], q: string): Artifact[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list.filter(a => !words.length || ((hay: string) => words.every(w => hay.includes(w)))(fold(`${a.title} ${a.summary} ${a.area} ${a.chatTitle ?? ''} ${baseNameOf(a.path)}`)))
    .sort((x, y) => y.at - x.at);
}

/** Related to `a`: from the same chat first, then from the same folder, then the same area within two days; at most `n`. */
export function relatedArtifacts(a: Artifact, list: readonly Artifact[], n = 6): Artifact[] {
  const dir = (p: string) => p.replace(/[\\/][^\\/]*$/, '').toLowerCase();
  const mine = dir(a.path), out: Artifact[] = [], seen = new Set([a.id]);
  const take = (pred: (b: Artifact) => boolean) => { for (const b of [...list].sort((x, y) => Math.abs(x.at - a.at) - Math.abs(y.at - a.at))) if (out.length < n && !seen.has(b.id) && pred(b)) { seen.add(b.id); out.push(b); } };
  if (a.chatId) take(b => b.chatId === a.chatId);
  take(b => dir(b.path) === mine);
  take(b => b.area === a.area && Math.abs(b.at - a.at) < 2 * DAY);
  return out;
}

/** The artifact whose version is this file (newest version first), with that version's index. */
export function artifactOfPath(list: readonly Artifact[], p: string, platform: string): { artifact: Artifact; version: number } | null {
  const k = pathKey(p, platform);
  for (const a of list) { const i = a.versions.findIndex(v => pathKey(v.path, platform) === k || (v.copy !== undefined && pathKey(v.copy, platform) === k)); if (i >= 0) return { artifact: a, version: i }; }
  return null;
}
