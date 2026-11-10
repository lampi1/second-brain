// The skill library (#361-#364, ADR 0241): every skill a chat can load, as a whole package (SKILL.md, scripts/,
// references/, assets/), for the Memoria «Skill» tab and the Orchestrator's skill tools (appctl/skills.ts). Origins:
// the brain's `.agents/skills` (the one copy, skills/layout.ts), the user's own ~/.agents and ~/.claude skills, and the
// app's shipped skills (the rendered copy of brain-template/harness/claude/skills). The brain wins a name, then the
// user's, then the app's, as at launch (agents/pack/shared-skills.ts). Every text write goes through the brain's change
// log (brainmodel/changes.ts), so each skill has its own history with a diff and Undo (#363); the user's PreToolUse
// hooks see every write first (skills/guard.ts, ADR 0018). An app skill is read-only where it ships: its first edit
// copies the whole package into the brain (one change: its Undo puts the app's original back in use) and the brain copy
// replaces it from then on (owner 2026-11-09: the app's own skills are visible and editable). Roles: a skill's page
// gives it to roles or takes it away (#364) through the same link the role side uses (brainmodel/service.ts link).
// Pinned by test/unit/skills/library.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import { SKILL_NAME, SKILL_PATH, type LibSkill, type SkillFile, type SkillFileText, type SkillLibraryState, type SkillOrigin, type SkillVersion, type SkillWrite, type SkillWriteResult } from '../../shared/skill-library';
import { checkMd, field, parseMd } from '../../shared/skillmd';
import type { ChangeLog, StoredChange } from '../brainmodel/changes';
import { errText, log } from '../log';
import { checkWrite, type GuardInput, type HookRefusal } from './guard';
import { brainSkillsDir, claudeSkillsDir, unifySkillFolders } from './layout';

/** Who writes: `page` = the user's own click on the Skill page (the only writer of skills outside the brain). */
export interface SkillWriter { who: string; reason?: string; page?: boolean }

export interface SkillLibraryDeps {
  root: () => string | null;
  /** the user's home (~/.agents/skills, ~/.claude/skills); null = none (demo, tests) */
  home: string | null;
  /** the folder holding the app's shipped skills (the rendered tools copy); null = none */
  appSkills: () => string | null;
  /** the brain's change log (BrainModelService.log) */
  changes: () => ChangeLog;
  /** undo one change (BrainModelService.rollback: it also refreshes the Brain pages) */
  undo: (id: string) => void;
  roles: () => AgentProfile[];
  /** give a skill to a role or take it away (BrainModelService.link) */
  link: (skill: string, roleId: string, on: boolean) => void;
  runs: () => AgentRun[];
  /** before a write; default = the user's PreToolUse hooks */
  guard?: (g: GuardInput) => Promise<HookRefusal | null>;
  /** something changed (the Brain pages, the "/" list) */
  changed?: () => void;
  /** move `.claude/skills` into `.agents/skills` once per brain (false in tests that pin the folders) */
  unify?: boolean;
}

const MAX_TEXT = 256 * 1024, MAX_FILES = 400, MAX_DEPTH = 5;
const isText = (buf: Buffer): boolean => !buf.subarray(0, 8000).includes(0);
const posix = (p: string) => p.split(path.sep).join('/');
const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (dir: string, file: string): boolean => { const r = path.relative(dir, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const NO_AGENT = { activeVersion: () => null, restore: () => { throw new Error('not a role change'); } };

interface Found { name: string; origin: SkillOrigin; folder: string; overridesApp: boolean }

/** Every file of a skill package (links and hidden files left out), bounded. */
export function packageFiles(folder: string): SkillFile[] {
  const out: SkillFile[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.isSymbolicLink() || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r, depth + 1); continue; }
      if (!e.isFile()) continue;
      let size = 0, text = true;
      try { size = fs.statSync(abs).size; const fd = fs.openSync(abs, 'r'); try { const b = Buffer.alloc(Math.min(size, 8000)); fs.readSync(fd, b, 0, b.length, 0); text = isText(b); } finally { fs.closeSync(fd); } } catch { continue; }
      out.push({ path: r, size, text });
    }
  };
  walk(folder, '', 0);
  // SKILL.md first, then folders after the files at the top
  return out.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : (a.path.includes('/') ? 1 : 0) - (b.path.includes('/') ? 1 : 0) || a.path.localeCompare(b.path)));
}

/** Every file under a folder, hidden, linked or deep ones too (bounded): what a delete would take away. */
function everyFile(folder: string, max = 2000): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), r); else out.push(r);
    }
  };
  walk(folder, '');
  return out;
}
const isTextFile = (file: string): boolean => { try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(8000); const n = fs.readSync(fd, b, 0, b.length, 0); return isText(b.subarray(0, n)); } finally { fs.closeSync(fd); } } catch { return true; } };
const sameFile = (a: string, b: string): boolean => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };

/** The skill's area for the filter: frontmatter `area:` or `metadata:` → `area:`. */
export function areaOf(text: string): string | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^﻿/, ''))?.[1] ?? '';
  const m = /^(?:area|\s+area):\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(front);
  return m?.[1]?.trim().slice(0, 40) || null;
}

export class SkillLibrary {
  private readonly guard: (g: GuardInput) => Promise<HookRefusal | null>;
  private readonly unified = new Map<string, Promise<unknown>>();
  constructor(private readonly d: SkillLibraryDeps) { this.guard = d.guard ?? checkWrite; }

  private root(): string | null { const r = this.d.root(); try { return r && fs.statSync(r).isDirectory() ? fs.realpathSync(r) : null; } catch { return null; } }

  /** The one-copy layout, once per brain per process (the first read waits for it). */
  ready(): Promise<unknown> {
    const root = this.root();
    if (!root || this.d.unify === false) return Promise.resolve();
    let p = this.unified.get(root);
    if (!p) { p = unifySkillFolders(root).catch(e => log.warn('skills', 'skill folders not unified', { cause: errText(e) })); this.unified.set(root, p); }
    return p;
  }

  /** The folders to look in, in launch order, with their origin. */
  private places(root: string | null): { dir: string; origin: SkillOrigin }[] {
    const app = this.d.appSkills();
    return [
      ...(root ? [{ dir: brainSkillsDir(root), origin: 'brain' as const }, { dir: claudeSkillsDir(root), origin: 'brain' as const }] : []),
      ...(this.d.home ? [{ dir: path.join(this.d.home, '.agents', 'skills'), origin: 'home' as const }, { dir: path.join(this.d.home, '.claude', 'skills'), origin: 'home' as const }] : []),
      ...(app ? [{ dir: app, origin: 'app' as const }] : []),
    ];
  }

  /** The app's own folder of a skill, when the app ships one. */
  private appFolder(name: string): string | null {
    const app = this.d.appSkills(), dir = app ? path.join(app, name) : null;
    return dir && fs.existsSync(path.join(dir, 'SKILL.md')) ? dir : null;
  }

  private found(root = this.root()): Found[] {
    const out = new Map<string, Found>(), appNames = new Set<string>();
    const places = this.places(root);
    for (const p of places.filter(p => p.origin === 'app')) { try { for (const n of fs.readdirSync(p.dir)) if (SKILL_NAME.test(n)) appNames.add(n); } catch { /* none */ } }
    const seenDirs = new Set<string>();
    for (const p of places) {
      const key = real(p.dir);
      if (seenDirs.has(key)) continue; // .claude/skills linked to .agents/skills
      seenDirs.add(key);
      let names: string[];
      try { names = fs.readdirSync(p.dir).sort(); } catch { continue; }
      for (const name of names) {
        if (!SKILL_NAME.test(name) || out.has(name)) continue;
        const folder = path.join(p.dir, name);
        try { if (!fs.statSync(path.join(folder, 'SKILL.md')).isFile()) continue; } catch { continue; }
        out.set(name, { name, origin: p.origin, folder, overridesApp: p.origin !== 'app' && appNames.has(name) });
      }
    }
    return [...out.values()];
  }

  private find(name: string): Found | null { return this.found().find(f => f.name === name) ?? null; }

  /** The latest live change of every skill folder the history wrote, by folder: one pass over the history, so the list
   *  does not compare every change with every skill (the page stuttered on opening with a long history, 2026-11-10).
   *  `known`: every name of the listed skills' folders (resolved and real: a linked skill folder is logged by its
   *  target); a changed file counts for the nearest of them above it. */
  private latestByFolder(history: StoredChange[], known: ReadonlySet<string>): Map<string, StoredChange> {
    const out = new Map<string, StoredChange>();
    for (const c of history) {
      if (c.rolledBackAt) continue;
      for (const x of c.files) {
        let dir = path.dirname(path.resolve(x.file));
        for (let up = 0; up <= MAX_DEPTH + 1 && path.dirname(dir) !== dir; up++, dir = path.dirname(dir)) {
          if (known.has(dir)) { out.set(dir, c); break; }
        }
      }
    }
    return out;
  }
  /** Runs by the skills they loaded, built once per list. */
  private static runsBySkill(runs: AgentRun[]): Map<string, AgentRun[]> {
    const out = new Map<string, AgentRun[]>();
    for (const r of runs) for (const name of new Set(r.tags?.skills ?? [])) { const l = out.get(name); if (l) l.push(r); else out.set(name, [r]); }
    return out;
  }

  private info(f: Found, latestBy: Map<string, StoredChange>, bySkill: Map<string, AgentRun[]>, roles: AgentProfile[]): LibSkill {
    const skillMd = path.join(f.folder, 'SKILL.md');
    let text = '';
    try { text = fs.readFileSync(skillMd, 'utf8').slice(0, MAX_TEXT); } catch { /* listed with no description */ }
    const p = parseMd(text);
    const mine = bySkill.get(f.name) ?? [];
    const byRole = new Map<string, { uses: number; lastAt: number }>();
    for (const r of mine) { const u = byRole.get(r.agentId) ?? { uses: 0, lastAt: 0 }; u.uses++; u.lastAt = Math.max(u.lastAt, r.startedAt); byRole.set(r.agentId, u); }
    const latest = this.folders(f).map(d => latestBy.get(d)).filter((c): c is StoredChange => !!c).sort((a, b) => b.at - a.at)[0];
    let changedAt: number | null = null;
    try { changedAt = fs.statSync(skillMd).mtimeMs; } catch { /* gone */ }
    return {
      name: f.name, description: (field(p, 'description') ?? '').trim(), origin: f.origin, overridesApp: f.overridesApp, folder: f.folder,
      files: packageFiles(f.folder), area: areaOf(text),
      roles: roles.filter(r => r.skills.includes(f.name) || !!r.knowhow?.linked.includes(f.name)).map(r => r.id),
      uses: [...byRole].map(([role, u]) => ({ role, ...u })).sort((a, b) => b.uses - a.uses),
      totalUses: mine.length, lastUse: mine.length ? Math.max(...mine.map(r => r.startedAt)) : null,
      changedAt: latest?.at ?? changedAt, madeBy: latest?.job ?? null,
      errors: checkMd('skill', text).filter(i => i.level === 'error').length,
    };
  }

  /** The skill folders a change may have written: the brain's (both names of the one folder) or the user's. */
  private folders(f: Pick<Found, 'name' | 'folder' | 'origin'>): string[] {
    const root = this.root();
    const dirs = [f.folder, ...(root && f.origin !== 'home' ? [path.join(brainSkillsDir(root), f.name), path.join(claudeSkillsDir(root), f.name)] : [])];
    return [...new Set(dirs.flatMap(d => [path.resolve(d), real(d)]))];
  }
  private touches(c: StoredChange, f: Pick<Found, 'name' | 'folder' | 'origin'>): boolean {
    const dirs = this.folders(f);
    return c.files.some(x => dirs.some(d => inside(d, path.resolve(x.file))));
  }

  async state(): Promise<SkillLibraryState> {
    await this.ready();
    const root = this.root(), history = this.d.changes().all(), runs = this.safe(() => this.d.runs(), []), roles = this.safe(() => this.d.roles(), []).filter(r => r.scope === 'role');
    const found = this.found(root), latestBy = this.latestByFolder(history, new Set(found.flatMap(f => this.folders(f)))), bySkill = SkillLibrary.runsBySkill(runs);
    return { root, skills: found.map(f => this.info(f, latestBy, bySkill, roles)).sort((a, b) => a.name.localeCompare(b.name)), roles: roles.map(r => ({ id: r.id, name: r.name })) };
  }
  private safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }

  /** Whether a skill of this name exists anywhere (brain, home, app). */
  async has(name: string): Promise<boolean> { await this.ready(); return !!this.find(String(name)); }

  async skill(name: string): Promise<LibSkill> {
    await this.ready();
    const f = this.find(String(name));
    if (!f) throw new Error(`Skill non trovata: ${name}`);
    return this.info(f, this.latestByFolder(this.d.changes().all(), new Set(this.folders(f))), SkillLibrary.runsBySkill(this.safe(() => this.d.runs(), [])), this.safe(() => this.d.roles(), []).filter(r => r.scope === 'role'));
  }

  /** One file of a skill (a binary one comes back without text). */
  async read(name: string, rel = 'SKILL.md'): Promise<SkillFileText> {
    await this.ready();
    const f = this.find(String(name));
    if (!f) throw new Error(`Skill non trovata: ${name}`);
    const file = this.fileOf(f.folder, rel);
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error('Non è un file.');
    const buf = st.size > MAX_TEXT ? null : fs.readFileSync(file);
    return { skill: f.name, path: rel, text: buf && isText(buf) ? buf.toString('utf8') : null, size: st.size, mtime: st.mtimeMs, origin: f.origin };
  }

  /** The absolute file of `rel` in `folder`: a plain path that stays inside, through no link. */
  private fileOf(folder: string, rel: string): string {
    // no «..», no segment ending in a dot or a space (Windows drops them), and no other spelling of SKILL.md (a
    // case-insensitive disk would reach SKILL.md past its checks)
    if (typeof rel !== 'string' || !SKILL_PATH.test(rel) || rel.split('/').some(s => s === '..' || s === '.' || /[. ]$/.test(s))
      || (rel !== 'SKILL.md' && rel.toLowerCase().replace(/[. ]+$/, '') === 'skill.md')) throw new Error(`Percorso non valido: ${rel}`);
    const file = path.join(folder, ...rel.split('/'));
    let at = folder;
    for (const part of rel.split('/')) { at = path.join(at, part); try { if (fs.lstatSync(at).isSymbolicLink()) throw new Error('Un collegamento non è un file della skill.'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    if (!inside(folder, file)) throw new Error(`Percorso non valido: ${rel}`);
    return file;
  }

  /** Writes one file of a skill (null = removes it), as one undoable change. A new SKILL.md creates the skill in the
   *  brain; the first edit of an app skill copies its package into the brain. `by` names who asked, for the history. */
  async write(req: SkillWrite, by: SkillWriter): Promise<SkillWriteResult> {
    try {
      await this.ready();
      const name = String(req?.skill ?? ''), rel = String(req?.path ?? '');
      if (!SKILL_NAME.test(name) || name.length > 64) return { ok: false, error: 'Nome non valido: usa minuscole, cifre e trattini (es. «report-mensile»).' };
      if (req.text !== null && typeof req.text !== 'string') return { ok: false, error: 'Testo mancante.' };
      if (typeof req.text === 'string' && Buffer.byteLength(req.text) > MAX_TEXT) return { ok: false, error: 'File troppo grande (oltre 256 KB): la cronologia non potrebbe annullarlo.' };
      const root = this.root();
      let f = this.find(name);
      const creating = !f;
      if (creating) {
        if (rel !== 'SKILL.md' || req.text === null) return { ok: false, error: `Skill non trovata: ${name}. Per crearla scrivi prima il suo SKILL.md.` };
        // without a brain a new skill goes to the user's ~/.claude/skills, where Claude finds it in every chat
        if (!root && (!this.d.home || !by.page)) return { ok: false, error: 'Scegli prima la cartella del brain: le skill nuove vanno lì.' };
        f = root ? { name, origin: 'brain', folder: path.join(brainSkillsDir(root), name), overridesApp: false }
          : { name, origin: 'home', folder: path.join(this.d.home!, '.claude', 'skills', name), overridesApp: false };
      }
      if (rel === 'SKILL.md') {
        if (req.text === null) return { ok: false, error: 'SKILL.md non si toglie da solo: elimina la skill intera.' };
        const errors = checkMd('skill', req.text).filter(i => i.level === 'error');
        if (errors.length) return { ok: false, error: `SKILL.md ha errori: ${errors.map(e => e.text).join('; ')}` };
        const named = field(parseMd(req.text), 'name')?.trim();
        if (named && named !== name) return { ok: false, error: `Il name del frontmatter («${named}») deve essere il nome della cartella («${name}»).` };
      }
      // the user's own skills (~/.claude, ~/.agents) load in every Claude session of the PC: only the user's click changes them
      if (f!.origin === 'home' && !by.page) return { ok: false, error: 'Le skill della tua cartella utente si cambiano solo dalla pagina Skill.' };
      // an app skill is edited as a brain copy of its whole package
      const copy = f!.origin === 'app';
      if (copy && !root) return { ok: false, error: 'Scegli prima la cartella del brain: la copia modificabile di una skill dell’app va lì.' };
      const source = f!;
      const folder = copy ? path.join(brainSkillsDir(root!), name) : source.folder;
      const file = this.fileOf(folder, rel);
      const sourceFile = this.fileOf(source.folder, rel);
      if (typeof req.mtime === 'number') { try { if (fs.statSync(sourceFile).mtimeMs > req.mtime + 1) return { ok: false, error: 'Il file è cambiato su disco dopo che l’hai aperto: ricaricalo, poi rifai la modifica.' }; } catch { /* a new file */ } }
      if (req.text === null && !fs.existsSync(sourceFile)) return { ok: false, error: 'Il file non c’è.' };
      // a binary file has no text history: its Undo could not put it back, so it is changed in the skill's folder
      if (fs.existsSync(sourceFile) && !isTextFile(sourceFile)) return { ok: false, error: 'È un file binario: si cambia o si toglie dalla cartella della skill.' };
      if (req.text !== null) {
        const refused = await this.guard({ home: this.d.home ?? '', root: root ?? null, filePath: file, content: req.text });
        if (refused) return { ok: false, error: refused.message };
        // the hook may take a while: a change on disk meanwhile wins
        if (typeof req.mtime === 'number') { try { if (fs.statSync(sourceFile).mtimeMs > req.mtime + 1) return { ok: false, error: 'Il file è cambiato su disco dopo che l’hai aperto: ricaricalo, poi rifai la modifica.' }; } catch { /* a new file */ } }
      }
      const writes: { file: string; text: string | null }[] = [];
      if (copy) {
        for (const pf of packageFiles(source.folder)) {
          if (pf.path === rel || !pf.text) continue;
          writes.push({ file: path.join(folder, ...pf.path.split('/')), text: fs.readFileSync(path.join(source.folder, ...pf.path.split('/')), 'utf8') });
        }
      }
      if (req.text === null && copy) { /* removing a file of an app skill: the copy simply leaves it out */ }
      else writes.push({ file, text: req.text });
      if (writes.some(w => { try { return fs.statSync(w.file).size > MAX_TEXT; } catch { return false; } })) return { ok: false, error: 'Un file della skill supera 256 KB: la cronologia non potrebbe annullarlo, cambialo dalla cartella.' };
      const action = creating ? 'create' : req.text === null ? 'remove' : 'update';
      const what = creating ? `Skill «${name}» creata` : copy ? `Copia modificabile di «${name}» (skill dell’app): ${rel}` : `${rel} di «${name}» ${req.text === null ? 'tolto' : 'modificato'}`;
      const c = this.d.changes().apply({ job: 'user', kind: 'skill', action, target: name, summary: `${what} (${by.who})`, reason: by.reason?.slice(0, 500) || `Modifica dalla pagina Skill o dall’Orchestrator (${by.who}).`, evidence: [rel] }, writes);
      // no change (the same text): ok, with nothing in the history (too big files were refused above)
      if (copy) for (const pf of packageFiles(source.folder)) {
        // binary assets come along as they are (they have no text history)
        if (pf.text) continue;
        const to = path.join(folder, ...pf.path.split('/'));
        if (!fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(source.folder, ...pf.path.split('/')), to); }
      }
      log.info('skills', `skill ${action}`, { data: { skill: name, file: rel, by: by.who, copy, change: c?.id ?? null } });
      this.d.changed?.();
      return { ok: true, changeId: c?.id ?? null, skill: await this.skill(name) };
    } catch (e) {
      log.warn('skills', 'skill write failed', { cause: errText(e), data: { skill: req?.skill, file: req?.path }, hint: 'check the brain folder is writable; a file over 256 KB cannot be kept in the history' });
      return { ok: false, error: `Non salvato: ${errText(e)}` };
    }
  }

  /** Removes a brain or home skill, or a brain copy of an app skill (its whole package's text, one undoable change:
   *  binary files have no history and go with the folder). The app's own skills are not removed. */
  async remove(name: string, by: SkillWriter): Promise<SkillWriteResult | { ok: true; changeId: string | null; skill: null }> {
    await this.ready();
    const f = this.find(String(name));
    if (!f) return { ok: false, error: `Skill non trovata: ${name}` };
    if (f.origin === 'app') return { ok: false, error: 'Una skill dell’app non si elimina: puoi toglierla ai ruoli.' };
    if (f.origin === 'home' && !by.page) return { ok: false, error: 'Le skill della tua cartella utente si eliminano solo dalla pagina Skill.' };
    const files = packageFiles(f.folder);
    if (files.some(x => x.text && x.size > MAX_TEXT)) return { ok: false, error: 'Un file della skill è troppo grande per la cronologia: eliminala dalla cartella.' };
    // the history keeps text only: a file it could not put back (binary, hidden, linked, too deep) stops the delete,
    // unless it is the app's own copy of an override (the original stays in the app)
    const app = f.overridesApp ? this.appFolder(f.name) : null;
    const lost = everyFile(f.folder).filter(rel => !files.some(x => x.text && x.path === rel) && !(app && sameFile(path.join(f.folder, ...rel.split('/')), path.join(app, ...rel.split('/')))));
    if (lost.length) return { ok: false, error: `La cronologia non potrebbe rimettere ${lost.length === 1 ? 'questo file' : 'questi file'}: ${lost.slice(0, 5).join(', ')}${lost.length > 5 ? '…' : ''}. Toglili dalla cartella della skill, poi eliminala.` };
    const c = this.d.changes().apply({ job: 'user', kind: 'skill', action: 'remove', target: f.name, summary: f.overridesApp ? `Ripristinata la skill dell’app «${f.name}» (tolta la copia del brain) (${by.who})` : `Skill «${f.name}» eliminata (${by.who})`, reason: by.reason?.slice(0, 500) || 'Scelta tua sulla pagina Skill.', evidence: [] },
      files.filter(x => x.text).map(x => ({ file: path.join(f.folder, ...x.path.split('/')), text: null })));
    // what is left: the override's copies of the app's binaries (checked above) and empty folders
    try { fs.rmSync(f.folder, { recursive: true, force: true }); } catch { /* left over: empty folders only */ }
    log.info('skills', 'skill removed', { data: { skill: f.name, by: by.who, change: c?.id ?? null } });
    this.d.changed?.();
    return { ok: true, changeId: c?.id ?? null, skill: null };
  }

  /** The skill's history, newest first: every change that wrote one of its files (#363). */
  async history(name: string): Promise<SkillVersion[]> {
    await this.ready();
    const f = this.find(String(name)) ?? (() => { const root = this.root(); return root ? { name: String(name), folder: path.join(brainSkillsDir(root), String(name)), origin: 'brain' as const } : null; })();
    if (!f) return [];
    const log = this.d.changes(), dirs = this.folders(f);
    return log.all().filter(c => this.touches(c, f)).reverse().slice(0, 100).map(c => ({
      id: c.id, at: c.at, job: c.job, summary: c.summary, reason: c.reason, undoneAt: c.rolledBackAt ?? null,
      canUndo: log.canRollback(c, NO_AGENT),
      files: c.files.filter(x => dirs.some(d => inside(d, path.resolve(x.file)))).map(x => {
        const d = dirs.find(d => inside(d, path.resolve(x.file)))!;
        return { path: posix(path.relative(d, path.resolve(x.file))), before: x.before, after: x.after };
      }),
    }));
  }

  /** Undo one change of a skill's history. */
  async undo(name: string, changeId: string): Promise<SkillVersion[]> {
    const h = await this.history(name);
    if (!h.some(v => v.id === changeId)) throw new Error('Questa modifica non è della skill.');
    this.d.undo(changeId);
    this.d.changed?.();
    return this.history(name);
  }

  /** Which roles load the skill: gives it to `roles` and takes it from the others (#364). */
  async setRoles(name: string, roles: readonly string[]): Promise<LibSkill> {
    const s = await this.skill(name);
    const known = new Set(this.d.roles().filter(r => r.scope === 'role').map(r => r.id));
    const want = new Set(roles.filter(r => known.has(r)));
    const profiles = this.d.roles().filter(r => known.has(r.id));
    // checked first, then applied: a refused request changes no role
    const kept = profiles.find(p => !want.has(p.id) && p.skills.includes(s.name));
    if (kept) throw new Error(`«${s.name}» è una skill predefinita di ${kept.name}: si toglie dal ruolo (Agenti → ${kept.name}).`);
    for (const p of profiles) {
      const linked = !!p.knowhow?.linked.includes(s.name), byDefault = p.skills.includes(s.name);
      if (want.has(p.id) && !linked && !byDefault) this.d.link(s.name, p.id, true);
      else if (!want.has(p.id) && linked) this.d.link(s.name, p.id, false);
    }
    this.d.changed?.();
    return this.skill(name);
  }
}
