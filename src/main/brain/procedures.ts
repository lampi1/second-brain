// The procedures already written in the brain folder, for the Procedure page (the user, 2026-10-13: "una sezione
// visibile delle procedure ... tutte quelle che hai già nel cervello"). Read-only and zero tokens: plain file reads.
// Found by structure, never by a list of names: markdown files in a folder named like runbook / procedure / how-to /
// playbook / rules, files named like routines / runbook / procedures, and the files a runbook index links to. Each
// leaf section (## or ###) is one procedure; a file whose sections are numbered steps ("## 1. …") is one procedure.
// Rules and playbooks count only where a section has real steps (a numbered list or a code block).
// Safety (AGENTS.md rules 2 and 5): files whose name says credentials / secrets / passwords / tokens / .env are never
// read; every line that may hold a credential (password=, keys, tokens, connection strings with a password, a URL with
// user:password, a private key) is replaced before it leaves main, so the renderer never sees it. Nothing here runs
// anything. Answered through brain.serveApi as /api/procedures and /api/procedure?id=… (brain/index.ts, demo-wiring.ts);
// unit tests: test/unit/brain/procedures.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Procedure, ProcedureSummary } from '../../shared/contract';

/** What a masked line shows instead (Italian UI). */
export const MASK = '‹riga nascosta: può contenere una credenziale›';

const PROC_DIR = /^(runbooks?|procedures?|procedure|how-?to|howtos?)$/i;
const SOFT_DIR = /^(playbooks?|rules?|regole)$/i;
const PROC_FILE = /^(routines?|runbooks?|procedures?|procedure)$/i;
const INDEX_FILE = /^(index|readme)$/i;
const SECRET_FILE = /(credential|secret|password|passwd|token|\.env$|^\.env)/i;
const SKIP_DIR = /^(\.|node_modules$|out$|dist$|test-results$|state$|output$|tmp$|temp$|bin$|obj$|templates?$)/i;
const MAX_DEPTH = 4;
const MAX_FILES = 400;
const MAX_BYTES = 512 * 1024;

type Kind = 'strong' | 'soft';
const SOURCE_LABEL: Record<string, string> = { runbook: 'Runbook', procedure: 'Procedura', howto: 'Guida', playbook: 'Playbook', rules: 'Regole', routines: 'Routine' };

/** The kind of procedure source a brain-relative path is (forward slashes), or null. Index files are sources of
 *  links, not procedures. */
export function sourceOf(rel: string): { kind: Kind; label: string } | null {
  const parts = rel.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (!/\.md$/i.test(name) || SECRET_FILE.test(name)) return null;
  const base = name.replace(/\.md$/i, '');
  if (INDEX_FILE.test(base)) return null;
  if (PROC_FILE.test(base)) return { kind: 'strong', label: base.toLowerCase().startsWith('routine') ? SOURCE_LABEL.routines! : base.toLowerCase().startsWith('runbook') ? SOURCE_LABEL.runbook! : SOURCE_LABEL.procedure! };
  for (const dir of parts.slice(0, -1).reverse()) {
    if (PROC_DIR.test(dir)) return { kind: 'strong', label: /^run/i.test(dir) ? SOURCE_LABEL.runbook! : /^how/i.test(dir) ? SOURCE_LABEL.howto! : SOURCE_LABEL.procedure! };
    if (SOFT_DIR.test(dir)) return { kind: 'soft', label: /^play/i.test(dir) ? SOURCE_LABEL.playbook! : SOURCE_LABEL.rules! };
  }
  return null;
}

/** Can a change to this path change the list? (the brain watcher asks, brain/index.ts). A path without an extension
 *  is a folder moved or deleted (Windows names only the folder): it may hold procedures. */
export const touchesProcedures = (rel: string): boolean => {
  const base = path.posix.basename(rel);
  return !base.includes('.') || (/\.md$/i.test(base) && !SECRET_FILE.test(base));
};

// ── secrets ────────────────────────────────────────────────────────────────────────────────────────────────────────
// A value that is a placeholder or a reference is not a secret, only when it is the whole value: <x>, $env:X, ${x},
// %X%, {x}, ***, …. Anything else is masked, a "$…" value too (it may be a password starting with $): better hide more.
const PLACEHOLDER = String.raw`(?:<[^>\n]*>|\$env:\w+|\$\{\w+\}|%\w+%|\{\{?\w*\}?\}|\*{3,}|…|\.{3})(?=[\s"'\`;,*]|$)`;
// (the quotes and markers before the value are taken atomically: no backtracking around the placeholder check)
const VALUE = String.raw`(?=(?<lead>[\s"'\`*_]*))\k<lead>(?!${PLACEHOLDER})[^\s"'\`;,*]{4,}`;
// keyword, then quotes or bold markers ("password": …, **Password:** …), then the separator
const KEY = String.raw`(?:password|passwd|pwd|passphrase|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?key|subscription[_-]?key|sas[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|token)`;
const SECRET_LINE: RegExp[] = [
  // password=…, "api_key": …, **Password:** …, AccountKey=…, Ocp-Apim-Subscription-Key: … (connection strings included)
  new RegExp(String.raw`\b${KEY}\b["'*_]*\s*[:=]${VALUE}`, 'i'),
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/,                                   // base64 user:password
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/,                            // a JWT
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/,               // GitHub tokens
  /\bsk-[A-Za-z0-9_-]{20,}/,                                          // API secret keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,                                   // chat bot tokens
  /\bAKIA[0-9A-Z]{16}\b/,                                             // cloud access key ids
  /[?&]sig=[A-Za-z0-9%+/=]{16,}/,                                     // a signed URL
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@<$%{]+@/i,                   // a URL with user:password@
  // password flags: sqlcmd -P …, --password …, --client-secret=…, az login … -p …
  new RegExp(String.raw`(?:^|\s)(?:-P|--password|--client-secret|--secret|--account-key|--sas-token|--connection-string)(?:\s+|=)${VALUE}`),
  new RegExp(String.raw`\baz\s+login\b.*\s-p\s+${VALUE}`, 'i'),
  new RegExp(String.raw`\bConvertTo-SecureString\s+(?:-String\s+)?["']${VALUE}`, 'i'),
];
// a table column whose header names a credential: its cells are masked (the row, as a whole)
const SECRET_HEAD = /pass|pwd|secret|segret|token|api.?key|account.?key|access.?key|subscription.?key/i;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
const isTableRule = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const placeholderCell = (c: string) => !c || c === '-' || new RegExp(String.raw`^[\`"']*${PLACEHOLDER}`).test(c);

/** Replaces every line that may hold a credential (and whole private key blocks). Returns the text and the count. */
export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0, inKey = false;
  let secretCols: number[] = [];
  const lines = text.split(/\r?\n/);
  const out = lines.map((l, i) => {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l)) inKey = true;
    if (inKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(l)) inKey = false;
      masked++;
      return MASK;
    }
    if (!/^\s*\|/.test(l)) secretCols = [];
    else if (isTableRule(l) && i > 0) {
      secretCols = cells(lines[i - 1]!).flatMap((c, j) => (SECRET_HEAD.test(c) ? [j] : []));
      return l;
    }
    const row = secretCols.length > 0 && !isTableRule(l) && secretCols.some(j => !placeholderCell(cells(l)[j] ?? ''));
    if (row || SECRET_LINE.some(re => re.test(l))) { masked++; return `${l.match(/^\s*(?:[-*]\s+|\d+[.)]\s+)?/)?.[0] ?? ''}${MASK}`; }
    return l;
  });
  return { text: out.join('\n'), masked };
}

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Heading { level: number; text: string; line: number }

/** ATX headings outside code fences (0-based line numbers). */
function headings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; return; }
    if (fence) return;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) out.push({ level: h[1]!.length, text: h[2]!, line: i });
  });
  return out;
}

/** Markdown inline → plain text (for titles and the one-line purpose). */
export const plain = (s: string): string => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__)(.+?)\1/g, '$2')
  .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=$|[^\w*])/g, '$1$2')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The first line of prose of a body: no fences, tables, headings or quote markers; list markers dropped. */
export function purposeOf(body: string): string {
  let fence = false;
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim();
    if (/^(`{3,}|~{3,})/.test(l)) { fence = !fence; continue; }
    if (fence || !l || l.startsWith('|') || l.startsWith('#') || l === MASK || /^[-*_]{3,}$/.test(l)) continue;
    const t = plain(l.replace(/^>\s*/, '').replace(/^([-*+]|\d+[.)])\s+/, ''));
    if (t && !t.includes(MASK)) return cut(t, 200);
  }
  return '';
}

const NUMBERED = /^\s{0,3}\d+[.)]\s+\S/m;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/m;
/** Content tags (Italian UI): what a reader will find inside. */
export function tagsOf(body: string): string[] {
  const t: string[] = [];
  if (NUMBERED.test(body)) t.push('passi');
  if (/\.sql\b|\bSELECT\s|\bEXEC\s|\bUPDATE\s+\w+\s+SET\b/i.test(body)) t.push('query');
  if (FENCE.test(body) || /`(?:node|npm|npx|az|git|pwsh|powershell|curl|sqlcmd|bash|sh|dotnet|docker|kubectl)\s[^`]+`|\.(?:mjs|ps1|sh|cmd)\b/i.test(body)) t.push('comandi');
  if (/\bproduzione\b|\bprod\b|\bproduction\b/i.test(body)) t.push('produzione');
  return t;
}

/** Does a body look like something to do (steps, a command, a query, a file to run), not just a note? */
const hasSteps = (body: string, kind: Kind): boolean => {
  const text = body.replace(/^\s*\(?(nessuno|nessuna|none|vuoto)\)?\s*$/gim, '').trim();
  if (text.length < 12) return false;
  if (kind === 'soft') return FENCE.test(text) || (text.match(/^\s{0,3}\d+[.)]\s+\S/gm)?.length ?? 0) >= 2;
  return true;
};

export const slugOf = (s: string): string => plain(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sezione';

interface Parsed { summary: ProcedureSummary; start: number; end: number }

/** The procedures of one file's text. `rel`: brain-relative path; the area is the file's H1, else its name. */
export function parseProcedures(rel: string, text: string, src: { kind: Kind; label: string }, changedAt: string | null): Parsed[] {
  const lines = text.split(/\r?\n/);
  const hs = headings(lines);
  const h1 = hs.find(h => h.level === 1);
  const area = h1 ? plain(h1.text).replace(/\s*\((index|indice)\)\s*$/i, '') : path.posix.basename(rel, '.md');
  const subs = hs.filter(h => h.level === 2 || h.level === 3);
  const make = (title: string, line: number, start: number, end: number, group: string | null): Parsed => {
    // the list shows titles and purposes too: masked like the text
    const body = maskSecrets(lines.slice(start, end).join('\n')).text;
    const safe = (s: string) => (maskSecrets(s).masked ? MASK : s);
    return {
      start, end,
      summary: { id: '', title: safe(title), purpose: purposeOf(body), area: safe(area), group: group && safe(group), file: rel, line: line + 1, source: src.label, tags: tagsOf(body), changedAt },
    };
  };
  const out: Parsed[] = [];
  // numbered sections ("## 1. Trova…", "## 2. …"): the whole file is one procedure, its steps are the sections
  if (subs.filter(h => /^\d+[.)]\s/.test(h.text)).length >= 2) {
    const start = h1 ? h1.line + 1 : 0;
    const p = make(area, h1?.line ?? 0, start, lines.length, null);
    if (hasSteps(lines.slice(start).join('\n'), src.kind)) out.push(p);
  } else {
    subs.forEach((h, i) => {
      const next = subs[i + 1];
      if (next && next.level > h.level) return; // a group: its children are the procedures
      // up to the next heading of the same level or above (an H1 too: a second part of the file is not this section)
      const end = hs.find(x => x.line > h.line && x.level <= h.level)?.line ?? lines.length;
      // the group heading above (a ## with ### children)
      const group = h.level === 3 ? [...subs.slice(0, i)].reverse().find(x => x.level === 2) : undefined;
      const body = lines.slice(h.line + 1, end).join('\n');
      if (hasSteps(body, src.kind)) out.push(make(plain(h.text), h.line, h.line + 1, end, group ? plain(group.text) : null));
    });
  }
  // unique ids: "Deploy", "Deploy" and "Deploy 2" → #deploy, #deploy-3, #deploy-2 (a suffix never takes a real slug)
  const taken = new Set(out.map(p => `${rel}#${slugOf(p.summary.title)}`));
  const used = new Set<string>();
  for (const p of out) {
    const base = `${rel}#${slugOf(p.summary.title)}`;
    let id = base;
    for (let n = 2; used.has(id) || (id !== base && taken.has(id)); n++) id = `${base}-${n}`;
    used.add(id);
    p.summary.id = id;
  }
  return out;
}

// ── discovery ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Brain-relative .md paths a procedure-folder index links to (`../x.md`, [t](x.md)), inside the brain. */
export function linkedFrom(indexRel: string, text: string): string[] {
  const dir = path.posix.dirname(indexRel);
  const out = new Set<string>();
  const re = /`([^`\s]+\.md)`|\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const target = path.posix.normalize(path.posix.join(dir, m[1] ?? m[2]!));
    if (!target.startsWith('../') && !path.posix.isAbsolute(target)) out.add(target);
  }
  return [...out];
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_FILES * 4) return;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < MAX_DEPTH && !SKIP_DIR.test(e.name)) visit(rel, depth + 1); }
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(rel);
    }
  };
  visit('', 0);
  return out;
}

/** Reads one brain file as text, or null (missing, too big, outside the brain, a link). */
function readText(root: string, rel: string): { text: string; mtime: string } | null {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  try {
    // a junction or link on the way (an index may point anywhere): the real path must stay inside the brain too
    const real = fs.realpathSync(abs), realBase = fs.realpathSync(base);
    if (!real.startsWith(realBase + path.sep)) return null;
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { text: fs.readFileSync(abs, 'utf8'), mtime: st.mtime.toISOString() };
  } catch { return null; }
}

interface Entry { summary: ProcedureSummary; start: number; end: number }

/** The procedures of a brain folder, cached until a brain file changes (invalidate) or a minute passes. */
export class Procedures {
  private cache: { at: number; list: Entry[] } | null = null;

  constructor(private root: () => string | null, private maxAgeMs = 60e3, private now: () => number = Date.now) {}

  invalidate(): void { this.cache = null; }

  private scan(): Entry[] {
    const root = this.root();
    if (!root) return [];
    const files = walk(root);
    const sources = new Map<string, { kind: Kind; label: string }>();
    for (const f of files) {
      const s = sourceOf(f);
      if (s) sources.set(f, s);
      // an index of a procedure folder: the files it links to are procedures too (e.g. a flow kept beside the folder)
      const parts = f.split('/');
      if (INDEX_FILE.test(path.posix.basename(f, '.md')) && parts.slice(0, -1).some(d => PROC_DIR.test(d))) {
        const t = readText(root, f);
        const label = SOURCE_LABEL[/^run/i.test(parts[parts.length - 2] ?? '') ? 'runbook' : 'procedure']!;
        for (const l of t ? linkedFrom(f, t.text) : []) if (!SECRET_FILE.test(path.posix.basename(l)) && !INDEX_FILE.test(path.posix.basename(l, '.md'))) sources.set(l, sources.get(l) ?? { kind: 'strong', label });
      }
    }
    const out: Entry[] = [];
    for (const [rel, src] of [...sources].slice(0, MAX_FILES)) {
      const t = readText(root, rel);
      if (t) out.push(...parseProcedures(rel, t.text, src, t.mtime));
    }
    return out.sort((a, b) => a.summary.area.localeCompare(b.summary.area, 'it') || a.summary.file.localeCompare(b.summary.file) || a.summary.line - b.summary.line);
  }

  private entries(): Entry[] {
    if (!this.cache || this.now() - this.cache.at > this.maxAgeMs) this.cache = { at: this.now(), list: this.scan() };
    return this.cache.list;
  }

  list(): { root: string | null; procedures: ProcedureSummary[] } {
    return { root: this.root(), procedures: this.entries().map(e => e.summary) };
  }

  /** One procedure with its text, credentials masked. Read fresh from disk (the list may be a minute old). */
  get(id: string): Procedure {
    const root = this.root();
    const e = this.entries().find(x => x.summary.id === id);
    if (!root || !e) throw new Error('procedura non trovata: forse il file è cambiato, ricarica l\'elenco');
    const t = readText(root, e.summary.file);
    if (!t) throw new Error(`non riesco a leggere ${e.summary.file}`);
    const fresh = parseProcedures(e.summary.file, t.text, sourceOf(e.summary.file) ?? { kind: 'strong', label: e.summary.source }, t.mtime).find(p => p.summary.id === id) ?? null;
    if (!fresh) { this.invalidate(); throw new Error('procedura non trovata: il file è cambiato, ricarica l\'elenco'); }
    const body = t.text.split(/\r?\n/).slice(fresh.start, fresh.end).join('\n').trim();
    const m = maskSecrets(body);
    return { ...fresh.summary, path: path.join(root, fresh.summary.file), markdown: m.text, masked: m.masked };
  }
}
