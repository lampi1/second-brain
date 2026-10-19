// The former "Procedure" sources of a brain (runbook folders, routines / runbook files, the files a runbook index
// links to), read only by the one-time migration that turns each section into a skill (ADR 0077: the app has agents and
// skills only; brainmodel/jobs.ts). Found by structure, never by a list of names: markdown files in a folder named like
// runbook / procedure / how-to / playbook / rules, files named like routines / runbook / procedures, and the files a
// runbook index links to. Each leaf section (## or ###) is one item; a file whose sections are numbered steps
// ("## 1. …") is one item. Rules and playbooks count only where a section has real steps (a numbered list or a code
// block). Files whose name says credentials / secrets / passwords / tokens / .env are never read; agents' own folders
// and the skill folders are left out. Nothing here runs anything or writes. Tests: test/unit/brainmodel/legacy.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { MASK, maskSecrets } from '../brain/mask';

/** One section found in a former source: `line` 1-based (its heading), `start`/`end` its body's lines (0-based). */
export interface LegacySection {
  id: string; title: string; purpose: string; area: string; group: string | null;
  file: string; line: number; source: string; tags: string[]; start: number; end: number;
}

const PROC_DIR = /^(runbooks?|procedures?|procedure|how-?to|howtos?)$/i;
const SOFT_DIR = /^(playbooks?|rules?|regole)$/i;
const PROC_FILE = /^(routines?|runbooks?|procedures?|procedure)$/i;
const INDEX_FILE = /^(index|readme)$/i;
const SECRET_FILE = /(credential|secret|password|passwd|token|\.env$|^\.env)/i;
const SKIP_DIR = /^(\.|node_modules$|out$|dist$|test-results$|state$|output$|tmp$|temp$|bin$|obj$|templates?$|agents$)/i;
const MAX_DEPTH = 4;
const MAX_FILES = 400;
const MAX_BYTES = 512 * 1024;

type Kind = 'strong' | 'soft';
const SOURCE_LABEL: Record<string, string> = { runbook: 'Runbook', howto: 'Guida', playbook: 'Playbook', rules: 'Regole', routines: 'Routine' };

/** The kind of former source a brain-relative path is (forward slashes), or null. Index files are sources of links. */
export function sourceOf(rel: string): { kind: Kind; label: string } | null {
  const parts = rel.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (!/\.md$/i.test(name) || SECRET_FILE.test(name)) return null;
  const base = name.replace(/\.md$/i, '');
  if (INDEX_FILE.test(base)) return null;
  if (PROC_FILE.test(base)) return { kind: 'strong', label: base.toLowerCase().startsWith('routine') ? SOURCE_LABEL.routines! : SOURCE_LABEL.runbook! };
  for (const dir of parts.slice(0, -1).reverse()) {
    if (PROC_DIR.test(dir)) return { kind: 'strong', label: /^how/i.test(dir) ? SOURCE_LABEL.howto! : SOURCE_LABEL.runbook! };
    if (SOFT_DIR.test(dir)) return { kind: 'soft', label: /^play/i.test(dir) ? SOURCE_LABEL.playbook! : SOURCE_LABEL.rules! };
  }
  return null;
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


/** The sections of one file's text. `rel`: brain-relative path; the area is the file's H1, else its name. */
export function parseSections(rel: string, text: string, src: { kind: Kind; label: string }): LegacySection[] {
  const lines = text.split(/\r?\n/);
  const hs = headings(lines);
  const h1 = hs.find(h => h.level === 1);
  const area = h1 ? plain(h1.text).replace(/\s*\((index|indice)\)\s*$/i, '') : path.posix.basename(rel, '.md');
  const subs = hs.filter(h => h.level === 2 || h.level === 3);
  const make = (title: string, line: number, start: number, end: number, group: string | null): LegacySection => {
    // titles and purposes reach the report: masked like the text
    const body = maskSecrets(lines.slice(start, end).join('\n')).text;
    const safe = (s: string) => (maskSecrets(s).masked ? MASK : s);
    return { id: '', title: safe(title), purpose: purposeOf(body), area: safe(area), group: group && safe(group), file: rel, line: line + 1, source: src.label, tags: tagsOf(body), start, end };
  };
  const out: LegacySection[] = [];
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
  const taken = new Set(out.map(p => `${rel}#${slugOf(p.title)}`));
  const used = new Set<string>();
  for (const p of out) {
    const base = `${rel}#${slugOf(p.title)}`;
    let id = base;
    for (let n = 2; used.has(id) || (id !== base && taken.has(id)); n++) id = `${base}-${n}`;
    used.add(id);
    p.id = id;
  }
  return out;
}

// ── discovery ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Brain-relative .md paths a runbook-folder index links to (`../x.md`, [t](x.md)), inside the brain. */
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
function readText(root: string, rel: string): { text: string } | null {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  try {
    // a junction or link on the way (an index may point anywhere): the real path must stay inside the brain too
    const real = fs.realpathSync(abs), realBase = fs.realpathSync(base);
    if (!real.startsWith(realBase + path.sep)) return null;
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return { text: fs.readFileSync(abs, 'utf8') };
  } catch { return null; }
}

/** Every section of the former sources of a brain folder, in a stable order (area, file, line). */
export function legacySections(root: string): LegacySection[] {
  const files = walk(root);
  const sources = new Map<string, { kind: Kind; label: string }>();
  for (const f of files) {
    const s = sourceOf(f);
    if (s) sources.set(f, s);
    // an index of a runbook folder: the files it links to are sources too (e.g. a flow kept beside the folder)
    const parts = f.split('/');
    if (INDEX_FILE.test(path.posix.basename(f, '.md')) && parts.slice(0, -1).some(d => PROC_DIR.test(d))) {
      const t = readText(root, f);
      for (const l of t ? linkedFrom(f, t.text) : []) if (!SECRET_FILE.test(path.posix.basename(l)) && !INDEX_FILE.test(path.posix.basename(l, '.md'))) sources.set(l, sources.get(l) ?? { kind: 'strong', label: SOURCE_LABEL.runbook! });
    }
  }
  const out: LegacySection[] = [];
  for (const [rel, src] of [...sources].slice(0, MAX_FILES)) {
    const t = readText(root, rel);
    if (t) out.push(...parseSections(rel, t.text, src));
  }
  return out.sort((a, b) => a.area.localeCompare(b.area, 'it') || a.file.localeCompare(b.file) || a.line - b.line);
}

/** The body of one section as on disk, credential lines masked (a skill is loaded into an agent's context and may be
 *  exported; the original file keeps the full text and is never changed). */
export function sectionText(root: string, s: LegacySection): { text: string; masked: number } | null {
  const t = readText(root, s.file);
  if (!t) return null;
  return maskSecrets(t.text.split(/\r?\n/).slice(s.start, s.end).join('\n').trim());
}
