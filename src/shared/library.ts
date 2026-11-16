// Memoria → Artifact (ADR 0318): the reports, analyses, documents and images the user's chats produce, indexed where
// they are (never moved). Shapes of the index main keeps (main/library/*) and the pure rules both sides share: which
// files are artifacts (`artifactKind`), how a text links one (`linkedPaths`), which files are versions of one report
// (`versionKey`), its title and summary from its head (`titleOf`, `summaryOf`). Used by main/library/service.ts, the
// Memoria tab (renderer/components/library/*) and the viewer's artifact bar; pinned by test/unit/library-shared.test.ts.

/** html, markdown, pdf and images (png, jpg, webp) render in the app's viewer; data and document files that are text (csv,
 *  json, txt) show there too, as a table or text; anything else (Word, Excel, PowerPoint, video, audio, archives, other
 *  images) is indexed the same and opens with the system's app from the viewer's artifact bar (`opensInViewer`). */
export type ArtifactKind = 'html' | 'markdown' | 'pdf' | 'image' | 'data' | 'document' | 'media' | 'file';
/** The gallery's order of kinds. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['html', 'markdown', 'pdf', 'image', 'data', 'document', 'media', 'file'];
/** chat = a chat linked it in its answer or report (or its evidence folder holds it); scan = found in a folder. */
export type ArtifactOrigin = 'chat' | 'scan';

/** One version of an artifact: a file on disk (or a copy the app kept of a text whose file was overwritten since). */
export interface ArtifactVersion {
  path: string;
  /** the file's mtime when seen */
  at: number;
  size: number;
  /** the chat that linked this version, when one did */
  chatId?: string;
  /** a copy of this version's text kept by the app (userData/library/versions), readable when the file changed or went */
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
  /** a short text from its head (Markdown: the first paragraph; HTML: its description or first paragraph) */
  summary: string;
  origin: ArtifactOrigin;
  /** the chat that produced its newest version (or the latest chat that linked it) */
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

export interface ArtifactList {
  artifacts: Artifact[];
  /** a scan of the folders is running now */
  scanning: boolean;
  scannedAt: number | null;
  /** the one-time look through past chats is done */
  backfilled: boolean;
  /** artifacts left out because the index is full (oldest first) */
  dropped: number;
}

/** A card's picture: an image scaled down, an HTML head to draw small, or the first lines of a text file (csv, txt, json). */
export type ArtifactThumb = { kind: 'image'; dataUrl: string } | { kind: 'html'; text: string; path: string } | { kind: 'text'; text: string };

export const LIBRARY_MAX = 4000;
const EXT: Readonly<Record<string, ArtifactKind>> = {
  html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', bmp: 'image', avif: 'image', heic: 'image', tif: 'image', tiff: 'image',
  csv: 'data', tsv: 'data', json: 'data', jsonl: 'data', xlsx: 'data', xls: 'data', ods: 'data',
  txt: 'document', docx: 'document', doc: 'document', odt: 'document', rtf: 'document', pptx: 'document', ppt: 'document', odp: 'document', epub: 'document',
  mp4: 'media', webm: 'media', mov: 'media', mkv: 'media', m4v: 'media', avi: 'media', mp3: 'media', wav: 'media', m4a: 'media', ogg: 'media', flac: 'media',
  zip: 'file', '7z': 'file', eml: 'file', msg: 'file', ics: 'file', drawio: 'file', excalidraw: 'file', vsdx: 'file',
};
/** Files the app's viewer renders (a report, a document, a PDF, a picture) or shows as text (a table for csv/tsv). */
const IN_VIEWER = new Set(['html', 'htm', 'md', 'markdown', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'tsv', 'json', 'jsonl', 'txt', 'svg']);
/** Files whose head is text: read for title, summary and card, and copied as a version when they change. */
const TEXT = new Set(['html', 'htm', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'txt']);
/** Names that are a project's own files, never a chat's output (a README a chat edited is not a report, a package.json
 *  is not data), and hidden files. */
const NOT_ARTIFACT = /^(?:(?:readme|agents|claude|changelog|skill|license|licence|contributing|security|memory|notice|code_of_conduct)\.(?:md|markdown|txt)|requirements[\w.-]*\.txt|robots\.txt|cmakelists\.txt|package(?:-lock)?\.json|[jt]sconfig[\w.-]*\.json|composer\.json|settings(?:\.local)?\.json|launch\.json|tasks\.json|extensions\.json|manifest\.json|permissions\.json|appsettings[\w.-]*\.json|global\.json|index\.json|models\.json|[\w.-]+\.(?:config|schema)\.json|\..*)$/i;/** A table or text file named like a login's state or a secret (a browser's storage state, a token, cookies): never
 *  indexed, copied or previewed. */
const SECRET_NAME = /(cookie|token|secret|credential|passw|auth|storage[-_.]?state|session|private[-_.]?key|api[-_.]?key|\.env\b)/i;
const SECRET_EXT = new Set(['json', 'jsonl', 'txt', 'csv', 'tsv']);
/** A text head that holds a credential (a token, a password, a private key): no copy, no card text, no summary. */
export const secretHead = (text: string): boolean =>
  /"(?:cookies|token|access_?token|refresh_?token|id_?token|password|passwd|private_?key|client_?secret|api_?key|secret|authorization)"\s*:|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|api[_-]?key|secret|token)\s*[=:]\s*["']?[^\s"']{8,}/i.test(text);
/** Folders whose files are tooling, packages or caches. */
const SKIP_SEGMENT = /^(node_modules|\.git|\.claude|\.cursor|\.agents|\.codex|\.vscode|\.idea|\.next|\.cache|__pycache__|bin|obj|dist|coverage|site-packages|vendor)$/i;

const sepSplit = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean);
export const baseNameOf = (p: string): string => sepSplit(p).pop() ?? p;
export const extOf = (p: string): string => { const b = baseNameOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };

/** The artifact kind of a file, or null when it is not one (an unknown extension, a project's own file, a tool folder). */
export function artifactKind(p: string): ArtifactKind | null {
  const kind = EXT[extOf(p)];
  if (!kind) return null;
  if (NOT_ARTIFACT.test(baseNameOf(p))) return null;
  if (SECRET_EXT.has(extOf(p)) && SECRET_NAME.test(baseNameOf(p))) return null;
  if (sepSplit(p).slice(0, -1).some(s => SKIP_SEGMENT.test(s))) return null;
  return kind;
}
/** The app's viewer shows this file (else the artifact bar offers the system's app first). */
export const opensInViewer = (p: string): boolean => IN_VIEWER.has(extOf(p));
/** The file's head is text (title, summary, card lines, a kept copy of each version). */
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
 * path): screenshots named by time are different pictures. Same extension family only (a .csv and a .xlsx of one name
 * are two artifacts).
 */
export function versionKey(p: string, kind: ArtifactKind, platform: string): string {
  const parts = sepSplit(pathKey(p, platform));
  const file = parts.pop() ?? '';
  if (kind === 'image' || kind === 'media') return `${kind}|${parts.join('/')}/${file}`;
  const dot = file.lastIndexOf('.');
  const last = parts.pop();
  const dir = [...parts, ...(last === undefined ? [] : [stemOf(last)])].join('/');
  const family = kind === 'data' || kind === 'document' || kind === 'file' ? `${kind}.${extOf(file).replace(/x$/, '')}` : kind;
  return `${family}|${dir}|${stemOf(dot > 0 ? file.slice(0, dot) : file)}`;
}

// ── links in a chat's text ─────────────────────────────────────────────────────────────────────────────────────────
// every artifact extension, longest first (jsonl before json, markdown before md)
const EXT_ALT = Object.keys(EXT).sort((a, b) => b.length - a.length).join('|');
const END = `(?=$|[\\s"'\`<>|*)\\],;!?]|[.:](?:\\s|$|\\d))`;
const ABS = new RegExp(String.raw`(?:file:\/\/\/?)?(?:[a-zA-Z]:[\\/]|\/(?:Users|home|tmp|private|var\/folders|Volumes|opt|mnt|media|srv|root)\/)[^\s"'\`<>|*?]{0,400}?\.(?:${EXT_ALT})${END}`, 'gi');
const MD_LINK = new RegExp(String.raw`\]\(\s*<?([^)<>\n]{1,600}?\.(?:${EXT_ALT}))>?(?::\d+)?\s*\)`, 'gi');
const REL = new RegExp(String.raw`(?:^|[\s(\["'\`])((?:\.{1,2}[\\/])?[\w@\-.]{1,120}(?:[\\/][\w@\-.]{1,120}){0,12}\.(?:${EXT_ALT}))${END}`, 'gi');

/** A link as written → the plain path: file: URLs decoded, a trailing ":line" dropped. */
function plain(raw: string): string {
  let x = raw.trim();
  if (/^file:/i.test(x)) {
    x = x.replace(/^file:\/\//i, '');
    try { x = decodeURIComponent(x); } catch { /* as written */ }
    if (/^\/[a-zA-Z]:[\\/]/.test(x)) x = x.slice(1);
  }
  return x.replace(/:\d+(?::\d+)?$/, '');
}
const isAbsolute = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');

/** The artifact files a text names: absolute paths (Windows, macOS/Linux, file: URLs), Markdown link targets and relative
 *  paths with a folder or an artifact extension. Relative ones come back as written (main resolves them against the
 *  chat's folder and the brain); URLs never. At most 60, in order, without repeats. */
export function linkedPaths(text: string): { absolute: string[]; relative: string[] } {
  const abs: string[] = [], rel: string[] = [], seen = new Set<string>();
  const add = (raw: string) => {
    const p = plain(raw);
    if (!p || p.length > 1024 || /^[a-z][a-z0-9+.-]*:\/\//i.test(p) && !/^file:/i.test(p) || seen.has(p) || !artifactKind(p)) return;
    seen.add(p);
    (isAbsolute(p) ? abs : rel).push(p);
  };
  const body = String(text ?? '').slice(0, 400_000);
  for (const m of body.matchAll(MD_LINK)) if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(m[1]!) || /^file:/i.test(m[1]!)) add(m[1]!);
  for (const m of body.matchAll(ABS)) add(m[0]);
  // a relative path inside a URL (https://x/y.png) is not a file: URLs are blanked first
  const noUrls = body.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
  for (const m of noUrls.matchAll(REL)) if (!isAbsolute(m[1]!)) add(m[1]!);
  return { absolute: abs.slice(0, 60), relative: rel.slice(0, 60) };
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

// ── the gallery's filters, shared by the tab and its tests ────────────────────────────────────────────────────────────
export type ArtifactSort = 'newest' | 'oldest' | 'title' | 'versions';
export type ArtifactRange = 'all' | 'today' | 'week' | 'month';
export interface ArtifactFilter { q: string; kind: ArtifactKind | 'all'; area: string | 'all'; chat: string | 'all'; range: ArtifactRange; sort: ArtifactSort }
export const NO_FILTER: ArtifactFilter = { q: '', kind: 'all', area: 'all', chat: 'all', range: 'all', sort: 'newest' };

const DAY = 864e5;
function since(range: ArtifactRange, now: number): number {
  if (range === 'all') return -Infinity;
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return now - (range === 'week' ? 7 : 30) * DAY;
}
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The artifacts a filter keeps, in its order. Search: every word in the title, summary, area, chat, or file name. */
export function filterArtifacts(list: readonly Artifact[], f: ArtifactFilter, now: number): Artifact[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean), from = since(f.range, now);
  const out = list.filter(a => (f.kind === 'all' || a.kind === f.kind) && (f.area === 'all' || a.area === f.area)
    && (f.chat === 'all' || a.chatId === f.chat || a.versions.some(v => v.chatId === f.chat)) && a.at >= from
    && (!words.length || ((hay: string) => words.every(w => hay.includes(w)))(fold(`${a.title} ${a.summary} ${a.area} ${a.chatTitle ?? ''} ${baseNameOf(a.path)}`))));
  const by: Record<ArtifactSort, (x: Artifact, y: Artifact) => number> = {
    newest: (x, y) => y.at - x.at, oldest: (x, y) => x.at - y.at,
    title: (x, y) => x.title.localeCompare(y.title) || y.at - x.at,
    versions: (x, y) => y.versions.length - x.versions.length || y.at - x.at,
  };
  return out.sort(by[f.sort]);
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
