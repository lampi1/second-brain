// The reusable scripts (ADR 0076; the owner, 2026-10-19: "una sezione dedicata agli script, tutti gli script creati e
// riutilizzabili provati che funzionano, piena libertà all'orchestratore per modificarli, aggiungerne, correggerli o
// eliminarli"). Since ADR 0263 they live in the skill that uses them, in its scripts/ folder (the Agent Skills format):
// the list reads every skill's scripts/ (brain, the user's, the app's) and what is still in the brain's old scripts/
// (skill null, waiting for the move of skills/assets.ts or the user's pick). What a script is for comes from its header
// comment, `@key value` lines the app writes and reads in the language's own comment syntax:
//   // @title Backup delle note          # @usage python scripts/x.py <dir>
//   // @description Zip of the notes…    # @tags backup, git
//   // @tested 2026-10-19 ok: ran on 120 files
// A hand-written script without a header still shows (its file name as title, its first comment line as description).
// Reads mask every line that may hold a credential (mask.ts maskSecrets); a save that holds one is refused (no secrets in
// files, AGENTS.md rule 2). A save or delete in a skill is one change of the brain's change log (the skill's history,
// Annulla); one still in the old folder is edited in place or moved to scripts/.deleted/. Every save and delete also adds
// a changelog line (changelog.ts). Nothing here runs a script. Used by scripts-tools.ts, auto-scripts.ts,
// skills/assets.ts, wiring.ts, demo-wiring.ts. Unit tests: test/unit/brain/scripts.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { BrainScript, BrainScriptSummary } from '../../shared/contract';
import { maskSecrets } from './mask';
import type { BrainChangelog } from './changelog';
import type { ChangeLog } from '../brainmodel/changes';

export const SCRIPTS_DIR = 'scripts';
/** a skill's own scripts folder (Agent Skills format) */
export const SKILL_SCRIPTS = 'scripts';
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

export interface ScriptMeta { title: string; description: string; usage?: string; tags?: string[]; /** absent: never run, no @tested line (shown as untested) */ tested?: { ok: boolean; note: string; at?: string } }

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
    ...(meta.tested ? [`${c} @tested ${meta.tested.at ?? new Date().toISOString().slice(0, 10)} ${meta.tested.ok ? 'ok' : 'failed'}${meta.tested.note ? `: ${one(meta.tested.note)}` : ''}`] : []),
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
  // (a read, not an assignment: `$env:ADO_PAT = "…"` keeps its name, so the credential check still sees it)
  /\bos\.environ(?:\.get\([^)]*\)|\[[^\]]*\](?!\s*=(?!=)))/g, /\bprocess\.env(?:\.\w+\b|\[[^\]]*\])(?!\s*=(?!=))/g, /\$env:\w+\b(?!\s*=(?!=))/gi, /\$ENV\{[^}]*\}(?!\s*=(?!=))/g,
  /\bENV\[[^\]]*\](?!\s*=(?!=))/g, /\b(?:await\s+)?[A-Za-z_][\w.]*\([^()]*\)/g,
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

/** A skill folder the stores look in (skills/library.ts located()): its name, where it comes from, its folder. */
export interface SkillPlace { name: string; origin: 'brain' | 'app' | 'home'; folder: string }

/** Where a script lives: a skill's scripts/ folder, or the brain's old scripts/ (not yet in a skill, ADR 0263). */
interface Spot { dir: string; name: string; skill: string | null; origin: SkillPlace['origin'] | null }

/** A script id: `<skill>/<file>`, or the bare file name of one still in the brain's scripts/. */
export const scriptId = (skill: string | null, name: string): string => (skill ? `${skill}/${name}` : name);

export class BrainScripts {
  private cache: { root: string | null; list: BrainScriptSummary[] } | null = null;
  /** `skills`: the skill folders to look in (brain, the user's, the app's); `log`: the brain's change log, through which a
   *  skill's script is written and removed (its Skill page history, with Annulla). */
  constructor(private readonly root: () => string | null, private readonly changelog?: BrainChangelog,
    private readonly skills: () => readonly SkillPlace[] = () => [], private readonly log: () => ChangeLog | null = () => null) {}

  private dir(): string | null { const r = this.root(); return r ? path.join(r, SCRIPTS_DIR) : null; }
  invalidate(): void { this.cache = null; }

  private spots(): Spot[] {
    const out: Spot[] = [];
    const add = (dir: string, skill: string | null, origin: Spot['origin']) => {
      try { for (const n of fs.readdirSync(dir)) if (!n.startsWith('.')) out.push({ dir, name: n, skill, origin }); } catch { /* none */ }
    };
    const legacy = this.dir();
    if (legacy) add(legacy, null, null);
    for (const s of this.safeSkills()) add(path.join(s.folder, SKILL_SCRIPTS), s.name, s.origin);
    return out;
  }
  private safeSkills(): readonly SkillPlace[] { try { return this.skills(); } catch { return []; } }

  private summary(spot: Spot): BrainScriptSummary | null {
    const { dir, name, skill } = spot;
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
      id: scriptId(skill, name), skill, path: full, file: skill ? `${skill}/${SKILL_SCRIPTS}/${name}` : `${SCRIPTS_DIR}/${name}`,
      title: h.title || name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      description: maskSecrets(h.description || h.firstComment).text, usage: maskSecrets(h.usage).text, language: lang[0], tags: h.tags,
      tested: h.tested, changedAt: st.mtime.toISOString(), bytes: st.size,
    };
  }

  /** /api/scripts: every script of the skills (and the few still in the brain's scripts/), newest change first. */
  list(): { root: string | null; dir: string; scripts: BrainScriptSummary[] } {
    const root = this.root();
    if (!this.cache || this.cache.root !== root) {
      const list = this.spots().map(s => this.summary(s)).filter((s): s is BrainScriptSummary => !!s)
        .sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? '') || a.id.localeCompare(b.id));
      this.cache = { root, list };
    }
    return { root, dir: SCRIPTS_DIR, scripts: this.cache.list };
  }

  /** One listed script by its id (`skill/file`, or a bare file name: the one script of that name). */
  private find(id: string): BrainScriptSummary | null {
    const raw = String(id ?? '').trim().replace(/\\/g, '/').replace(/^scripts\//, '');
    const all = this.list().scripts;
    const exact = all.find(s => s.id === raw);
    if (exact) return exact;
    if (raw.includes('/')) return null;
    const named = all.filter(s => path.basename(s.path) === raw);
    if (named.length > 1) throw new Error(`${raw}: more than one skill has a script of this name (${named.map(s => s.skill ?? 'scripts/').join(', ')}): pass «skill/${raw}»`);
    return named[0] ?? null;
  }

  /** /api/script?id=…: one script with its code, credentials masked. */
  get(id: string): BrainScript {
    const s = this.find(id);
    if (!s) throw new Error(`script non trovato: ${id}`);
    const masked = maskSecrets(fs.readFileSync(s.path, 'utf8'));
    return { ...s, code: masked.text, masked: masked.masked };
  }

  private checkName(name: string): string {
    const n = String(name ?? '').trim().replace(/^scripts[\\/]/, '');
    if (!NAME.test(n) || n.includes('..')) throw new Error('name: a file name like "backup-notes.mjs" (letters, digits, . _ -), no folders');
    if (!langOf(n)) throw new Error(`name: the extension says the language, one of ${SCRIPT_EXTS.join(' ')}`);
    return n;
  }

  /** The brain skill a script goes in: it must exist and be the brain's own (an app skill or one of the user's own is not
   *  written here). */
  brainSkill(name: string): SkillPlace {
    const n = String(name ?? '').trim();
    const s = this.safeSkills().find(x => x.name === n);
    if (!s) throw new Error(`skill: «${n}» not found. Pass the folder name of a brain skill (the Skill page lists them); a new skill is created first with its SKILL.md`);
    if (s.origin !== 'brain') throw new Error(`skill: «${n}» is ${s.origin === 'app' ? 'one of the app\'s skills (its first edit on the Skill page makes the brain copy scripts go in)' : 'one of the user\'s own skills (changed only from the Skill page)'}`);
    return s;
  }

  /** Add or replace a script in a skill's scripts/ folder (brain_script_save, brain_script_add, the auto-save; ADR
   *  0263). The body is written under a fresh header; a body with something that looks like a credential is refused.
   *  `fix` = the change repairs a script that failed. `create` = add only: a file with the same name in any case is
   *  refused. Without `skill`, only a script still in the brain's scripts/ is edited in place. */
  save(input: { skill?: string | null; name: string; code: string; meta: ScriptMeta; by: string; summary?: string; fix?: boolean; create?: boolean }): { file: string; path: string; skill: string | null; action: 'added' | 'edited' | 'fixed' } {
    const name = this.checkName(input.name);
    const skillName = String(input.skill ?? '').trim();
    let dir: string, skill: string | null = null;
    if (skillName) { dir = path.join(this.brainSkill(skillName).folder, SKILL_SCRIPTS); skill = skillName; }
    else {
      const legacy = this.dir();
      if (!legacy) throw new Error('nessuna cartella brain configurata');
      if (input.create || !fs.existsSync(path.join(legacy, name))) throw new Error('skill: required, the skill this script belongs to (its folder name): the script is saved in that skill\'s scripts/ folder');
      dir = legacy;
    }
    if (!input.meta.title.trim()) throw new Error('title: required');
    if (!input.meta.description.trim()) throw new Error('description: required (what it does, when to reuse it)');
    const text = withHeader(name, String(input.code ?? ''), input.meta);
    if (!stripHeader(text).trim()) throw new Error('code: empty');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`code: over ${MAX_BYTES / 1024} KB`);
    const bad = secretLine(text);
    if (bad) throw new Error(`refused: line ${bad} looks like a credential. Read secrets from an environment variable or the user's credentials file at run time, never write them in a script`);
    const full = path.join(dir, name);
    if (skill && !insideReal(this.brainSkill(skill).folder, full)) throw new Error(`skill: «${skill}»'s ${SKILL_SCRIPTS}/ is a link out of the skill: refused`);
    const existed = fs.existsSync(full);
    if (input.create && (existed || this.taken(dir, name))) throw new Error(`${name} exists already: add only creates a new script`);
    const file = skill ? `${skill}/${SKILL_SCRIPTS}/${name}` : `${SCRIPTS_DIR}/${name}`;
    const what = input.summary?.trim() || input.meta.title;
    const log = skill ? this.log() : null;
    if (log) log.apply({ job: 'user', kind: 'script', action: existed ? 'update' : 'create', target: skill!, summary: `Script ${SKILL_SCRIPTS}/${name} ${existed ? 'modificato' : 'aggiunto'} (${input.by})`, reason: what.slice(0, 500), evidence: [`${SKILL_SCRIPTS}/${name}`] }, [{ file: full, text }]);
    else { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(full, text, { encoding: 'utf8', flag: input.create ? 'wx' : 'w' }); }
    this.invalidate();
    const action = !existed ? 'added' : input.fix ? 'fixed' : 'edited';
    this.changelog?.add({ kind: 'script', action, target: file, by: input.by, summary: what });
    return { file, path: full, skill, action };
  }

  /** A file in the scripts folder with this name in another case (a case-insensitive file system would overwrite it). */
  private taken(dir: string, name: string): boolean {
    const want = name.toLowerCase();
    try { return fs.readdirSync(dir).some(f => f.toLowerCase() === want); } catch { return false; }
  }

  /** Remove a script (brain_script_delete): a skill's goes through the change log (Annulla on the Skill page puts it
   *  back); one still in the brain's scripts/ moves to scripts/.deleted/, never destroyed. */
  delete(input: { name: string; by: string; reason: string }): { file: string; keptAt: string } {
    const s = this.find(input.name);
    if (!s) throw new Error(`script non trovato: ${input.name}`);
    const why = input.reason.trim() || 'eliminato';
    if (s.skill) {
      if (!this.safeSkills().some(x => x.origin === 'brain' && s.path.startsWith(x.folder + path.sep) && insideReal(x.folder, s.path))) throw new Error(`«${s.skill}» is not a brain skill: an app skill's or the user's own scripts are changed only from the Skill page`);
      const log = this.log();
      if (!log) throw new Error('nessuna cronologia del brain: elimina lo script dalla pagina Skill');
      const c = log.apply({ job: 'user', kind: 'script', action: 'remove', target: s.skill, summary: `Script ${SKILL_SCRIPTS}/${path.basename(s.path)} tolto (${input.by})`, reason: why.slice(0, 500), evidence: [`${SKILL_SCRIPTS}/${path.basename(s.path)}`] }, [{ file: s.path, text: null }]);
      if (!c) throw new Error('lo script non si può togliere con Annulla: toglilo dalla cartella della skill');
      this.invalidate();
      this.changelog?.add({ kind: 'script', action: 'deleted', target: s.file, by: input.by, summary: `${why} (Annulla nella cronologia della skill)` });
      return { file: s.file, keptAt: `history:${c.id}` };
    }
    const dir = path.dirname(s.path), name = path.basename(s.path);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const kept = path.join(dir, DELETED_DIR, `${stamp}-${name}`);
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.renameSync(s.path, kept);
    this.invalidate();
    const rel = `${SCRIPTS_DIR}/${DELETED_DIR}/${path.basename(kept)}`;
    this.changelog?.add({ kind: 'script', action: 'deleted', target: s.file, by: input.by, summary: `${why} (copia in ${rel})` });
    return { file: s.file, keptAt: rel };
  }

  /** Whether a script of this file name was deleted and not put back (the auto-save does not add it again): one moved to
   *  the brain's scripts/.deleted/, or a skill's removed through the change log. */
  wasDeleted(name: string, skill?: string): boolean {
    const legacy = this.dir();
    try { if (legacy && fs.readdirSync(path.join(legacy, DELETED_DIR)).some(f => f.endsWith(`-${name}`))) return true; } catch { /* none */ }
    const log = this.log();
    if (!log) return false;
    // a removal from a skill's scripts/ (in that skill when one is named), or an add the user undid; the move out of the
    // old scripts/ is no delete
    // the log keeps real paths (links resolved): compare the same way
    const real = (p: string) => { try { return fs.realpathSync(p); } catch { return null; } };
    const folders = this.safeSkills().filter(s => s.origin === 'brain' && (!skill || s.name === skill))
      .map(s => foldPath(path.join(real(path.join(s.folder, SKILL_SCRIPTS)) ?? path.join(real(s.folder) ?? path.resolve(s.folder), SKILL_SCRIPTS), name)));
    const here = (file: string) => folders.includes(foldPath(path.resolve(file))) || folders.includes(foldPath(path.join(real(path.dirname(file)) ?? path.dirname(path.resolve(file)), path.basename(file))));
    return log.all().some(c => c.files.some(f => here(f.file) && (c.rolledBackAt
      ? f.before === null && f.after !== null
      : c.action === 'remove' && f.after === null && f.before !== null)));
  }
}

/** Is this file (existing or not yet) really inside the folder, links followed? A skill's scripts/ or assets/ that is a
 *  link out of it (to another skill, to a folder outside the brain) is never written or deleted through (ADR 0263). */
export function insideReal(folder: string, file: string): boolean {
  try {
    const base = fs.realpathSync(folder);
    let p = path.resolve(file);
    const rest: string[] = [];
    for (;;) {
      try { fs.lstatSync(p); break; } catch { /* not there yet: its parent decides */ }
      const up = path.dirname(p);
      if (up === p) return false;
      rest.unshift(path.basename(p)); p = up;
    }
    const real = path.join(fs.realpathSync(p), ...rest);
    return real.startsWith(base + path.sep);
  } catch { return false; }
}

/** Windows and macOS folders ignore case: a path compares folded there. */
export const foldPath = (p: string): string => (process.platform === 'linux' ? p : p.toLowerCase());

/** Can a change to this brain path change the Script or Changelog pages? (the brain watcher asks). A path without an
 *  extension may be the scripts folder itself, moved or deleted. */
export const touchesScripts = (rel: string): boolean => {
  const p = rel.replace(/\\/g, '/');
  return p === 'changelog.md' || p === SCRIPTS_DIR || p.startsWith(`${SCRIPTS_DIR}/`) || /^\.(?:agents|claude)\/skills(?:\/|$)/.test(p);
};
