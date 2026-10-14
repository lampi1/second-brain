// The "Skill e agenti" section's main side (ADR 0018): finds every skill and agent of Claude Code and Cursor (user level
// in ~/.claude and ~/.cursor, project level in the brain folder and the chats' folders), reads one, saves it (checked
// with shared/skillmd.ts, then passed through the user's PreToolUse hooks for Write: guard.ts) and deletes it (to the
// Recycle Bin). Only files inside those folders and shaped like a skill or an agent are ever read or written: the id the
// renderer sends back is checked against them. Also gives the "/" list of a chat whose engine has not spoken yet
// (skills for its engine and folder). Used by wiring.ts / demo-wiring.ts (index.ts 'skills:*' handlers).
import fs from 'node:fs';
import path from 'node:path';
import type { ChatCommand, Harness, MdIssue, SkillCatalog, SkillDoc, SkillEntry, SkillKind, SkillPlace, SkillSave, SkillSaveResult, SkillScope } from '../../shared/contract';
import { checkMd, field, generatedBy, parseMd } from '../../shared/skillmd';
import { errText, log } from '../log';
import { checkWrite, type GuardInput, type HookRefusal } from './guard';

export interface SkillsOptions {
  /** the user's home (~): ~/.claude and ~/.cursor live there */
  home: string;
  /** project folders to look into (brain folder, chats' folders); worktrees and home itself are left out */
  roots: () => (string | null | undefined)[];
  /** before a write; default = the user's PreToolUse hooks (guard.ts) */
  guard?: (g: GuardInput) => Promise<HookRefusal | null>;
  /** delete = to the Recycle Bin (electron shell.trashItem); tests remove for real */
  trash: (p: string) => Promise<void>;
}

const HOME_DIR: Record<Harness, string> = { claude: '.claude', cursor: '.cursor' };
const SUB: Record<SkillKind, string> = { skill: 'skills', agent: 'agents' };
const ENGINE: Record<Harness, string> = { claude: 'Claude', cursor: 'Cursor' };
/** plugin and built-in skill folders: not the user's to edit */
const SKIP_DIRS = new Set(['synced', 'skills-cursor']);
const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export class SkillsService {
  private readonly guard: (g: GuardInput) => Promise<HookRefusal | null>;
  constructor(private readonly o: SkillsOptions) { this.guard = o.guard ?? checkWrite; }

  /** Project folders: existing, not home, not a git worktree (its .git is a file), each once. */
  projectRoots(): string[] {
    const out = new Map<string, string>();
    const home = norm(this.o.home);
    for (const r of this.o.roots()) {
      if (!r || !path.isAbsolute(r)) continue;
      const k = norm(r);
      if (k === home || out.has(k)) continue;
      try {
        if (!fs.statSync(r).isDirectory()) continue;
        const git = path.join(r, '.git');
        if (fs.existsSync(git) && fs.statSync(git).isFile()) continue;
      } catch { continue; }
      out.set(k, path.resolve(r));
    }
    return [...out.values()];
  }

  places(): SkillPlace[] {
    const out: SkillPlace[] = [];
    for (const kind of ['skill', 'agent'] as const) for (const harness of ['claude', 'cursor'] as const) {
      out.push({ kind, harness, scope: 'user', root: null, dir: path.join(this.o.home, HOME_DIR[harness], SUB[kind]), label: `${ENGINE[harness]} · tutti i progetti (~/${HOME_DIR[harness]})` });
      for (const root of this.projectRoots()) out.push({ kind, harness, scope: 'project', root, dir: path.join(root, HOME_DIR[harness], SUB[kind]), label: `${ENGINE[harness]} · progetto ${path.basename(root)}` });
    }
    return out;
  }

  list(): SkillCatalog {
    const places = this.places();
    const entries: SkillEntry[] = [];
    for (const pl of places) {
      let names: string[] = [];
      try { names = fs.readdirSync(pl.dir); } catch { continue; }
      for (const n of names.sort()) {
        if (SKIP_DIRS.has(n)) continue;
        const file = pl.kind === 'skill' ? path.join(pl.dir, n, 'SKILL.md') : n.toLowerCase().endsWith('.md') ? path.join(pl.dir, n) : null;
        if (!file) continue;
        const e = this.entry(pl, file);
        if (e) entries.push(e);
      }
    }
    return { entries, places };
  }

  private entry(pl: SkillPlace, file: string, text?: string): SkillEntry | null {
    let st: fs.Stats;
    try { st = fs.statSync(file); if (!st.isFile()) return null; } catch { return null; }
    let t = text;
    if (t === undefined) { try { t = fs.readFileSync(file, 'utf8'); } catch (e) { log.warn('skills', 'file not read', { data: { file, error: errText(e) } }); return null; } }
    const p = parseMd(t);
    const fallback = pl.kind === 'skill' ? path.basename(path.dirname(file)) : path.basename(file, path.extname(file));
    const ro = generatedBy(t);
    return {
      id: file, kind: pl.kind, harness: pl.harness, scope: pl.scope, root: pl.root,
      name: field(p, 'name')?.trim() || fallback, description: (field(p, 'description') ?? '').trim(),
      path: file, mtime: st.mtimeMs, errors: checkMd(pl.kind, t).filter(i => i.level === 'error').length,
      ...(ro ? { readOnly: ro } : {}),
    };
  }

  /** The place an existing file belongs to, or null (not a skill/agent file of a known folder). */
  private placeOf(id: string): SkillPlace | null {
    if (typeof id !== 'string' || !path.isAbsolute(id)) return null;
    const file = norm(id);
    for (const pl of this.places()) {
      const dir = norm(pl.dir);
      if (!file.startsWith(`${dir}/`)) continue;
      const rest = file.slice(dir.length + 1).split('/');
      if (pl.kind === 'skill' && rest.length === 2 && rest[1] === 'skill.md' && !SKIP_DIRS.has(rest[0]!)) return pl;
      if (pl.kind === 'agent' && rest.length === 1 && rest[0]!.endsWith('.md')) return pl;
    }
    return null;
  }

  read(id: string): SkillDoc {
    const pl = this.placeOf(id);
    if (!pl) throw new Error('Non è un file di skill o di agente di una cartella conosciuta.');
    const text = fs.readFileSync(id, 'utf8');
    const entry = this.entry(pl, id, text);
    if (!entry) throw new Error('File non trovato.');
    return { entry, text };
  }

  async save(req: SkillSave): Promise<SkillSaveResult> {
    const text = typeof req?.text === 'string' ? req.text : '';
    const kind: SkillKind = req?.kind === 'agent' ? 'agent' : 'skill';
    const issues = checkMd(kind, text);
    if (issues.some(i => i.level === 'error')) return { ok: false, error: 'Il file ha errori: correggili prima di salvare.', issues };
    if (text.length > 200_000) return { ok: false, error: 'File troppo grande (oltre 200 000 caratteri).' };
    const name = field(parseMd(text), 'name')!.trim();

    let pl: SkillPlace | null;
    let old: string | null = null;
    if (req.id) {
      pl = this.placeOf(req.id);
      if (!pl || pl.kind !== kind) return { ok: false, error: 'Non è un file di skill o di agente di una cartella conosciuta.' };
      if (!fs.existsSync(req.id)) return { ok: false, error: 'Il file non c’è più: è stato cancellato o spostato fuori dall’app.' };
      const cur = fs.readFileSync(req.id, 'utf8');
      if (generatedBy(cur)) return { ok: false, error: generatedBy(cur)! };
      if (typeof req.mtime === 'number' && fs.statSync(req.id).mtimeMs > req.mtime + 1) return { ok: false, error: 'Il file è cambiato su disco dopo che l’hai aperto: ricaricalo, poi rifai la modifica.' };
      old = req.id;
    } else {
      const scope: SkillScope = req.scope === 'project' ? 'project' : 'user';
      const root = scope === 'project' && req.root ? norm(req.root) : null;
      pl = this.places().find(p => p.kind === kind && p.harness === req.harness && p.scope === scope && (scope === 'user' || (p.root && norm(p.root) === root))) ?? null;
      if (!pl) return { ok: false, error: 'Cartella di destinazione non valida.' };
    }
    // a file moves only when its name changes; a folder or file already named otherwise stays where it is
    const renamed = old !== null && field(parseMd(fs.readFileSync(old, 'utf8')), 'name')?.trim() !== name;
    const target = old && !renamed ? old : kind === 'skill' ? path.join(pl.dir, name, 'SKILL.md') : path.join(pl.dir, `${name}.md`);
    const moving = old !== null && norm(old) !== norm(target);
    if ((!old || moving) && fs.existsSync(kind === 'skill' ? path.dirname(target) : target)) {
      return { ok: false, error: `Esiste già ${kind === 'skill' ? 'una skill' : 'un agente'} "${name}" in questa cartella.` };
    }

    // the user's PreToolUse hooks decide first, with the file as it will be (never bypassed: ADR 0018)
    const refused = await this.guard({ home: this.o.home, root: pl.root, filePath: target, content: text });
    if (refused) return { ok: false, error: refused.message, hook: refused.command };

    try {
      if (moving && kind === 'skill') fs.renameSync(path.dirname(old!), path.dirname(target)); // the folder goes with its other files
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, target);
      if (moving && kind === 'agent') fs.rmSync(old!, { force: true });
    } catch (e) {
      log.warn('skills', 'save failed', { data: { file: target }, cause: errText(e), hint: 'check the folder is writable and not open elsewhere' });
      return { ok: false, error: `Non salvato: ${errText(e)}` };
    }
    log.info('skills', moving ? 'moved and saved' : old ? 'saved' : 'created', { data: { kind, harness: pl.harness, file: target, from: moving ? old : undefined } });
    const entry = this.entry(pl, target, text);
    return entry ? { ok: true, entry, issues: issues as MdIssue[] } : { ok: false, error: 'Salvato, ma non riesco a rileggerlo.' };
  }

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const pl = this.placeOf(id);
    if (!pl) return { ok: false, error: 'Non è un file di skill o di agente di una cartella conosciuta.' };
    const what = pl.kind === 'skill' ? path.dirname(id) : id;
    try {
      await this.o.trash(what);
      log.info('skills', 'deleted (recycle bin)', { data: { kind: pl.kind, harness: pl.harness, path: what } });
      return { ok: true };
    } catch (e) {
      log.warn('skills', 'delete failed', { data: { path: what }, cause: errText(e), hint: 'the folder may be open in another program' });
      return { ok: false, error: `Non cancellato: ${errText(e)}` };
    }
  }

  /** "/" before the engine listed its commands: the skills of this engine for the chat's folder (user + project). */
  commandsFor(harness: Harness, cwd: string): ChatCommand[] {
    const c = norm(cwd);
    const out = new Map<string, ChatCommand>();
    for (const e of this.list().entries) {
      if (e.kind !== 'skill' || e.harness !== harness || e.errors) continue;
      if (e.scope === 'project' && !(e.root && (c === norm(e.root) || c.startsWith(`${norm(e.root)}/`)))) continue;
      if (!out.has(e.name)) out.set(e.name, { name: e.name, description: e.description, skill: true });
    }
    return [...out.values()];
  }
}
