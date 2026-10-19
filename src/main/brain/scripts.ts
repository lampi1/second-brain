// The brain's scripts (ADR 0076; the owner, 2026-10-19: "una sezione dedicata agli script, tutti gli script creati e
// riutilizzabili provati che funzionano, piena libertà all'orchestratore per modificarli, aggiungerne, correggerli o
// eliminarli"). They live in the brain's `scripts/` folder, flat, one file each; what a script is for comes from its
// header comment, `@key value` lines the app writes and reads in the language's own comment syntax:
//   // @title Backup delle note          # @usage python scripts/x.py <dir>
//   // @description Zip of the notes…    # @tags backup, git
//   // @tested 2026-10-19 ok: ran on 120 files
// A hand-written script without a header still shows (its file name as title, its first comment line as description).
// Reads mask every line that may hold a credential (mask.ts maskSecrets); a save that
// holds one is refused (no secrets in files, AGENTS.md rule 2). A delete moves the file to `scripts/.deleted/`, never
// destroys it. Every save and delete adds a changelog line (changelog.ts). Nothing here runs a script: the tools only
// write files; the Orchestrator's workers run them with their own permissions. Created on first save (ADR 0072).
// Used by scripts-tools.ts, wiring.ts, demo-wiring.ts. Unit tests: test/unit/brain/scripts.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { BrainScript, BrainScriptSummary } from '../../shared/contract';
import { maskSecrets } from './mask';
import type { BrainChangelog } from './changelog';

export const SCRIPTS_DIR = 'scripts';
const DELETED_DIR = '.deleted';
/** extension → [language label, line comment] */
const LANGS: Record<string, [string, string]> = {
  '.mjs': ['JavaScript', '//'], '.js': ['JavaScript', '//'], '.cjs': ['JavaScript', '//'], '.ts': ['TypeScript', '//'],
  '.py': ['Python', '#'], '.sh': ['Shell', '#'], '.ps1': ['PowerShell', '#'], '.rb': ['Ruby', '#'],
  '.sql': ['SQL', '--'], '.cmd': ['Batch', '::'], '.bat': ['Batch', '::'],
};
export const SCRIPT_EXTS = Object.keys(LANGS);
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_BYTES = 200 * 1024;
const HEADER_LINES = 40;
/** a header line: a comment marker, then @key value */
const META = /^\s*(?:\/\/+|#+|--+|::|rem\b|;+|\*+|\/\*+)\s*@(title|description|usage|tags|tested)\b[:\s]?\s*(.*?)\s*(?:\*\/)?\s*$/i;
const COMMENT = /^\s*(?:\/\/+|#+|--+|::|rem\b|;+|\*+|\/\*+)\s?(.*?)\s*(?:\*\/)?\s*$/i;
const TESTED = /^(\d{4}-\d\d-\d\d)(?:[ T]\d\d:\d\d)?\s+(ok|failed|fallito|ko)\b[:\s-]*(.*)$/i;

export const langOf = (file: string): [string, string] | null => LANGS[path.extname(file).toLowerCase()] ?? null;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The header's fields of a script text (and the first plain comment line, for a script without a header). */
export function parseHeader(text: string): { title: string; description: string; usage: string; tags: string[]; tested: BrainScriptSummary['tested']; firstComment: string } {
  const r = { title: '', description: '', usage: '', tags: [] as string[], tested: { state: 'untested', at: null, note: '' } as BrainScriptSummary['tested'], firstComment: '' };
  for (const line of text.split(/\r?\n/).slice(0, HEADER_LINES)) {
    const m = META.exec(line);
    if (m) {
      const key = m[1]!.toLowerCase(), v = m[2]!.trim();
      if (key === 'tags') r.tags = v.split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 12);
      else if (key === 'tested') {
        const t = TESTED.exec(v);
        r.tested = t ? { state: /^ok$/i.test(t[2]!) ? 'ok' : 'failed', at: t[1]!, note: t[3]!.trim() } : { state: 'untested', at: null, note: v };
      } else if (key === 'usage') r.usage = r.usage ? `${r.usage}\n${v}` : v;
      else r[key as 'title' | 'description'] = v;
      continue;
    }
    if (!r.firstComment && !/^\s*#!/.test(line)) { const c = COMMENT.exec(line); if (c?.[1]?.trim() && !/^[-=*/#\s]+$/.test(c[1])) r.firstComment = c[1].trim(); }
  }
  return r;
}

/** The script without its header lines (a shebang stays first). */
export function stripHeader(text: string): string {
  const out = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line, i) => !(i < HEADER_LINES && META.test(line)));
  const shebang = out[0] && /^\s*#!/.test(out[0]) ? [out.shift()!] : [];
  // the blank lines the header left behind, under the shebang or at the top
  while (out.length && !out[0]!.trim()) out.shift();
  return [...shebang, ...out].join('\n');
}

export interface ScriptMeta { title: string; description: string; usage?: string; tags?: string[]; tested: { ok: boolean; note: string; at?: string } }

/** The script text the app writes: shebang, the header in the language's comment syntax, a blank line, the body. */
export function withHeader(file: string, body: string, meta: ScriptMeta): string {
  const lang = langOf(file);
  if (!lang) throw new Error(`estensione non supportata: usa ${SCRIPT_EXTS.join(' ')}`);
  const c = lang[1];
  const one = (s: string) => s.replace(/\s+/g, ' ').trim();
  const head = [
    `${c} @title ${one(meta.title)}`,
    `${c} @description ${one(meta.description)}`,
    ...(meta.usage ?? '').split(/\r?\n/).map(one).filter(Boolean).map(u => `${c} @usage ${u}`),
    ...(meta.tags?.length ? [`${c} @tags ${meta.tags.map(one).filter(Boolean).join(', ')}`] : []),
    `${c} @tested ${meta.tested.at ?? new Date().toISOString().slice(0, 10)} ${meta.tested.ok ? 'ok' : 'failed'}${meta.tested.note ? `: ${one(meta.tested.note)}` : ''}`,
  ];
  // the body's own line ends and byte-order mark stay (Windows PowerShell 5.1 and .cmd labels depend on them)
  const eol = body.includes('\r\n') ? '\r\n' : '\n', bom = body.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = stripHeader(body).split('\n');
  const shebang = lines[0] && /^\s*#!/.test(lines[0]) ? [lines.shift()!] : [];
  return bom + [...shebang, ...head, '', ...lines].join(eol).replace(/(?:\r?\n)*$/, eol);
}

/** A value read at run time is not a secret: an environment variable, a credentials-file read or any call. Replaced by a
 *  placeholder before the check, so a key assigned from an environment variable or a helper call can be saved. */
const RUNTIME_READ = [
  /\bos\.environ(?:\.get\([^)]*\)|\[[^\]]*\])/g, /\bprocess\.env(?:\.\w+|\[[^\]]*\])/g, /\$env:\w+/gi, /\$ENV\{[^}]*\}/g,
  /\bENV\[[^\]]*\]/g, /\b(?:await\s+)?[A-Za-z_][\w.]*\([^()]*\)/g,
];
const runtimeFree = (line: string): string => RUNTIME_READ.reduce((l, re) => l.replace(re, '<runtime>'), line);

/** The first line that may hold a credential (1-based), or 0. */
export function secretLine(text: string): number {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (maskSecrets(runtimeFree(lines[i]!)).masked) return i + 1;
  return 0;
}

/** Search the scripts by words (all of them, accents and case folded) in title, description, usage, tags, file. */
export function findScripts(list: BrainScriptSummary[], q: string): BrainScriptSummary[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const scored = list.map(s => {
    const strong = fold(`${s.title} ${s.tags.join(' ')} ${s.file}`), all = fold(`${strong} ${s.description} ${s.usage} ${s.language}`);
    return { s, hit: words.filter(w => all.includes(w)).length, strong: words.filter(w => strong.includes(w)).length };
  });
  // every word somewhere; more words in title, tags or name first
  return scored.filter(x => x.hit === words.length).sort((a, b) => b.strong - a.strong).map(x => x.s);
}

export class BrainScripts {
  private cache: { root: string | null; list: BrainScriptSummary[] } | null = null;
  constructor(private readonly root: () => string | null, private readonly changelog?: BrainChangelog) {}

  private dir(): string | null { const r = this.root(); return r ? path.join(r, SCRIPTS_DIR) : null; }
  invalidate(): void { this.cache = null; }

  private summary(dir: string, name: string): BrainScriptSummary | null {
    const lang = langOf(name);
    if (!lang || !NAME.test(name)) return null;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { return null; }
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch { return null; }
    const h = parseHeader(text);
    return {
      id: name, file: `${SCRIPTS_DIR}/${name}`, title: h.title || name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      description: maskSecrets(h.description || h.firstComment).text, usage: maskSecrets(h.usage).text, language: lang[0], tags: h.tags,
      tested: h.tested, changedAt: st.mtime.toISOString(), bytes: st.size,
    };
  }

  /** /api/scripts: every script of the brain, newest change first; none on a brain without a scripts/ folder. */
  list(): { root: string | null; dir: string; scripts: BrainScriptSummary[] } {
    const dir = this.dir();
    const root = this.root();
    if (!this.cache || this.cache.root !== root) {
      let names: string[] = [];
      try { if (dir) names = fs.readdirSync(dir).filter(n => !n.startsWith('.')); } catch { /* no scripts yet */ }
      const list = names.map(n => this.summary(dir!, n)).filter((s): s is BrainScriptSummary => !!s)
        .sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? '') || a.id.localeCompare(b.id));
      this.cache = { root, list };
    }
    return { root, dir: SCRIPTS_DIR, scripts: this.cache.list };
  }

  /** /api/script?id=…: one script with its code, credentials masked. */
  get(id: string): BrainScript {
    const dir = this.dir();
    const name = this.checkName(id);
    const s = dir ? this.summary(dir, name) : null;
    if (!dir || !s) throw new Error(`script non trovato: ${id}`);
    const full = path.join(dir, name);
    const masked = maskSecrets(fs.readFileSync(full, 'utf8'));
    return { ...s, path: full, code: masked.text, masked: masked.masked };
  }

  private checkName(name: string): string {
    const n = String(name ?? '').trim().replace(/^scripts[\\/]/, '');
    if (!NAME.test(n) || n.includes('..')) throw new Error('name: a file name like "backup-notes.mjs" (letters, digits, . _ -), no folders');
    if (!langOf(n)) throw new Error(`name: the extension says the language, one of ${SCRIPT_EXTS.join(' ')}`);
    return n;
  }

  /** Add or replace a script (the Orchestrator's brain_script_save). The body is written under a fresh header; a body
   *  with something that looks like a credential is refused. `fix` = the change repairs a script that failed. */
  save(input: { name: string; code: string; meta: ScriptMeta; by: string; summary?: string; fix?: boolean }): { file: string; path: string; action: 'added' | 'edited' | 'fixed' } {
    const dir = this.dir();
    if (!dir) throw new Error('nessuna cartella brain configurata');
    const name = this.checkName(input.name);
    if (!input.meta.title.trim()) throw new Error('title: required');
    if (!input.meta.description.trim()) throw new Error('description: required (what it does, when to reuse it)');
    const text = withHeader(name, String(input.code ?? ''), input.meta);
    if (!stripHeader(text).trim()) throw new Error('code: empty');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`code: over ${MAX_BYTES / 1024} KB`);
    const bad = secretLine(text);
    if (bad) throw new Error(`refused: line ${bad} looks like a credential. Read secrets from an environment variable or the user's credentials file at run time, never write them in a script`);
    const full = path.join(dir, name);
    const existed = fs.existsSync(full);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
    this.invalidate();
    const action = !existed ? 'added' : input.fix ? 'fixed' : 'edited';
    this.changelog?.add({ kind: 'script', action, target: `${SCRIPTS_DIR}/${name}`, by: input.by, summary: input.summary?.trim() || input.meta.title });
    return { file: `${SCRIPTS_DIR}/${name}`, path: full, action };
  }

  /** Remove a script (the Orchestrator's brain_script_delete): moved to scripts/.deleted/, never destroyed. */
  delete(input: { name: string; by: string; reason: string }): { file: string; keptAt: string } {
    const dir = this.dir();
    if (!dir) throw new Error('nessuna cartella brain configurata');
    const name = this.checkName(input.name);
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) throw new Error(`script non trovato: ${name}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const kept = path.join(dir, DELETED_DIR, `${stamp}-${name}`);
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.renameSync(full, kept);
    this.invalidate();
    const rel = `${SCRIPTS_DIR}/${DELETED_DIR}/${path.basename(kept)}`;
    this.changelog?.add({ kind: 'script', action: 'deleted', target: `${SCRIPTS_DIR}/${name}`, by: input.by, summary: `${input.reason.trim() || 'eliminato'} (copia in ${rel})` });
    return { file: `${SCRIPTS_DIR}/${name}`, keptAt: rel };
  }
}

/** Can a change to this brain path change the Script or Changelog pages? (the brain watcher asks). A path without an
 *  extension may be the scripts folder itself, moved or deleted. */
export const touchesScripts = (rel: string): boolean => {
  const p = rel.replace(/\\/g, '/');
  return p === 'changelog.md' || p === SCRIPTS_DIR || p.startsWith(`${SCRIPTS_DIR}/`);
};
