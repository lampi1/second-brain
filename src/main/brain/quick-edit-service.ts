// The Orchestrator's small brain edit, applied by the app itself (ADR 0370, owner proposal 4): a rule, a now.md line, a
// section of me.md or a skill's text changed in seconds instead of an Artisan and a Sentinel. One edit = up to
// QUICK_LIMITS.files files, QUICK_LIMITS.lines changed lines (quick-edit.ts: the path guard, the counts, the diff line).
// In order, all or nothing: every path checked (inside the brain's real folder, no link out), every change applied in
// memory, no credential in the new text (mask.ts), the user's own PreToolUse hooks asked for every file as for a chat's
// Write (skills/guard.ts, ADR 0018: brain-limits.mjs keeps the fixed-context budget) — only then the files are written.
// After: the brain's own lint when it has one (ops/tools/brain-lint.mjs, read only) and the skill lint of a SKILL.md, a
// line in the brain's changelog.md, and a git commit of exactly those files when the brain is a git repo («brain: …»).
// «Annulla» for QUICK_LIMITS.undoMs: the files back to their text before, only while each still is what the edit wrote
// (a later edit, the user's own or a chat's, is never overwritten), committed as a revert. The journal of edits (texts
// before and after, never more than the files themselves) is in userData/brain-quick-edits.json, the last 50.
// Created by wiring.ts / demo-wiring.ts; the tool is appctl/brain-edit.ts; unit tests: test/unit/brain/quick-edit.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readLocal, writeLocal } from '../agents/local-store';
import { writeText } from '../brainmodel/changes';
import { maskSecrets } from './mask';
import { lintSkill, lintText } from '../../shared/skill-lint';
import type { BrainChangelog } from './changelog';
import type { ChangelogKind } from '../../shared/contract';
import { errText, log } from '../log';
import { QUICK_LIMITS, applyChanges, commitMessage, diffLine, inside, quickPath, type FileDelta, type QuickChange } from './quick-edit';

/** The brain repo's git, as far as this edit needs it (quick-edit-ports.ts; tests: a fake). */
export interface QuickGit {
  /** commits exactly these brain-relative paths (added, changed or removed); the commit id, or why not (no repo, the
   *  sync holds the repo, a hook refused…): the files stay written either way */
  commit(root: string, paths: readonly string[], message: string): Promise<{ sha: string } | { skipped: string }>;
}
/** The brain's own lint, when it has one: its findings on these files, or null (no lint, or it failed). */
export type QuickLint = (root: string, files: readonly string[]) => Promise<{ summary: string; findings: string[] } | null>;
/** The user's PreToolUse hooks on a Write of this text: their refusal, or null. */
export type QuickHooks = (root: string, file: string, content: string) => Promise<string | null>;

export interface QuickEditDeps {
  root: () => string | null;
  /** userData/brain-quick-edits.json */
  journalFile: string;
  git?: QuickGit;
  lint?: QuickLint;
  hooks?: QuickHooks;
  changelog?: BrainChangelog;
  /** the brain's pages read again (skills, rules) */
  changed?: () => void;
  now?: () => number;
}

interface FileSnap { path: string; before: string | null; after: string }
interface Entry { id: string; at: number; summary: string; by: string; files: FileSnap[]; commit: string | null; undoneAt?: number }

export interface QuickEditResult {
  id: string;
  /** the one compact line to show the user */
  diff: string;
  files: FileDelta[];
  commit: string | null;
  /** why it was not committed (the files are written) */
  commitSkipped?: string;
  /** the brain lint's and the skill lint's findings on these files: fix them in a next edit */
  warnings: string[];
  lint?: string;
  undoUntil: number;
}

const KEEP = 50;
const read = (f: string): string | null => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

export class BrainQuickEdit {
  constructor(private readonly d: QuickEditDeps) {}
  private now(): number { return this.d.now?.() ?? Date.now(); }

  private journal(): Entry[] {
    try { const j = readLocal(this.d.journalFile) as { entries?: Entry[] } | undefined; return Array.isArray(j?.entries) ? j.entries : []; }
    catch (e) { log.warn('brain-edit', 'brain-quick-edits.json unreadable: earlier quick edits cannot be undone here', { cause: errText(e), hint: 'git revert in the brain folder still undoes them' }); return []; }
  }
  private save(entries: Entry[]): void { writeLocal(this.d.journalFile, { version: 1, entries: entries.slice(-KEEP) }); }

  /** The brain's real folder and this path's real file, or why not. */
  private target(root: string, rel: string): string {
    const realRoot = fs.realpathSync(root), abs = path.join(realRoot, rel);
    // the nearest folder that exists must be the brain's own (a link or junction pointing out is refused)
    let dir = path.dirname(abs);
    while (!fs.existsSync(dir)) dir = path.dirname(dir);
    const realDir = fs.realpathSync(dir);
    if (realDir !== realRoot && !inside(realRoot, realDir)) throw new Error(`${rel}: outside the brain folder (a linked folder)`);
    try { if (fs.lstatSync(abs).isSymbolicLink()) throw new Error(`${rel}: a link: not edited here`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return abs;
  }

  /** The recent edits, newest first (what «Annulla» can name). */
  recent(): { id: string; at: number; summary: string; files: string[]; commit: string | null; undone: boolean; canUndo: boolean }[] {
    const t = this.now();
    return this.journal().slice().reverse().slice(0, 10).map(e => ({ id: e.id, at: e.at, summary: e.summary, files: e.files.map(f => f.path), commit: e.commit, undone: !!e.undoneAt, canUndo: !e.undoneAt && t - e.at <= QUICK_LIMITS.undoMs }));
  }

  async apply(changes: readonly QuickChange[], o: { summary: string; by: string }): Promise<QuickEditResult> {
    const root = this.d.root();
    if (!root) throw new Error('No brain folder is configured.');
    if (!Array.isArray(changes) || !changes.length) throw new Error('changes: give at least one {path, old?, new}.');
    if (changes.length > QUICK_LIMITS.changes) throw new Error(`Too many changes (${changes.length} > ${QUICK_LIMITS.changes}): give this edit to an Artisan.`);
    // 1. the paths, grouped by file in the order given
    const byFile = new Map<string, QuickChange[]>();
    for (const c of changes) {
      const p = quickPath(c?.path);
      if ('problem' in p) throw new Error(p.problem);
      byFile.set(p.rel, [...(byFile.get(p.rel) ?? []), c]);
    }
    if (byFile.size > QUICK_LIMITS.files) throw new Error(`${byFile.size} files > ${QUICK_LIMITS.files}: too big for a quick edit; give it to an Artisan.`);
    // 2. every file's new text, in memory
    const plan: (FileSnap & { abs: string; delta: FileDelta; preview: string })[] = [];
    for (const [rel, list] of byFile) {
      const abs = this.target(root, rel);
      const before = read(abs);
      if (before !== null && Buffer.byteLength(before) > QUICK_LIMITS.bytes) throw new Error(`${rel} is over ${QUICK_LIMITS.bytes / 1024} KB: give this edit to an Artisan.`);
      const r = applyChanges(before, list, rel);
      if ('problem' in r) throw new Error(r.problem);
      if (r.after === before) continue;
      plan.push({ path: rel, abs, before, after: r.after, preview: r.preview, delta: { path: rel, added: r.added, removed: r.removed, created: before === null } });
    }
    if (!plan.length) throw new Error('Nothing changes: the files already have this text.');
    const lines = plan.reduce((n, f) => n + f.delta.added + f.delta.removed, 0);
    if (lines > QUICK_LIMITS.lines) throw new Error(`${lines} changed lines > ${QUICK_LIMITS.lines}: too big for a quick edit; give it to an Artisan.`);
    // 3. no credential in what is added, and the user's own hooks on every write
    for (const f of plan) {
      const known = new Set((f.before ?? '').split(/\r?\n/));
      const addedText = f.after.split(/\r?\n/).filter(l => !known.has(l)).join('\n');
      if (maskSecrets(addedText).masked) throw new Error(`${f.path}: the new text looks like it holds a credential; never write a secret in the brain.`);
    }
    for (const f of plan) {
      const no = await this.d.hooks?.(root, f.abs, f.after);
      if (no) throw new Error(`${f.path}: refused by the brain's own hook: ${no}`);
    }
    // 4. the writes, all or nothing (the hooks may have taken a while: a file changed on disk meanwhile stops it)
    const done: typeof plan = [];
    try {
      for (const f of plan) {
        if (read(f.abs) !== f.before) throw new Error(`${f.path} changed on disk meanwhile: read it again`);
        writeText(f.abs, f.after);
        done.push(f);
      }
    } catch (e) {
      for (const f of done.reverse()) try { writeText(f.abs, f.before); } catch { /* best effort: reported below */ }
      throw new Error(`Not written: ${errText(e)}`);
    }
    const id = randomBytes(5).toString('hex'), at = this.now(), files = plan.map(f => f.path);
    const summary = o.summary.replace(/\s+/g, ' ').trim().slice(0, 200) || `edit ${files.join(', ')}`;
    const logged = this.changelog(files, summary, o.by, 'edited');
    try { this.d.changed?.(); } catch { /* the pages re-read on their own too */ }
    // 5. the brain's lint and the commit, side by side
    const [lint, commit] = await Promise.all([this.lint(root, files), this.commit(root, logged ? [...files, 'changelog.md'] : files, commitMessage(summary, files))]);
    const entries = this.journal();
    entries.push({ id, at, summary, by: o.by.slice(0, 60), files: plan.map(f => ({ path: f.path, before: f.before, after: f.after })), commit: 'sha' in commit ? commit.sha : null });
    try { this.save(entries); } catch (e) { log.warn('brain-edit', 'quick edit journal not written: its «Annulla» works only through git', { cause: errText(e), hint: 'check that the app data folder is writable' }); }
    log.info('brain-edit', 'quick brain edit applied', { data: { id, files, lines, commit: 'sha' in commit ? commit.sha.slice(0, 10) : null } });
    return {
      id, diff: diffLine(plan.map(f => f.delta), plan.find(f => f.preview)?.preview ?? ''), files: plan.map(f => f.delta),
      commit: 'sha' in commit ? commit.sha : null, ...('skipped' in commit ? { commitSkipped: commit.skipped } : {}),
      warnings: [...this.skillWarnings(plan), ...(lint?.findings ?? [])], ...(lint ? { lint: lint.summary } : {}),
      undoUntil: at + QUICK_LIMITS.undoMs,
    };
  }

  /** «Annulla»: the files of edit `id` ("last" = the newest not undone) back as they were, within QUICK_LIMITS.undoMs. */
  async undo(id: string, by: string): Promise<{ id: string; diff: string; commit: string | null; commitSkipped?: string }> {
    const root = this.d.root();
    if (!root) throw new Error('No brain folder is configured.');
    const entries = this.journal();
    const e = id === 'last' ? [...entries].reverse().find(x => !x.undoneAt) : entries.find(x => x.id === id);
    if (!e) throw new Error(`No quick edit ${id === 'last' ? 'to undo' : id}: list them with action "recent".`);
    if (e.undoneAt) throw new Error(`Edit ${e.id} was already undone.`);
    if (this.now() - e.at > QUICK_LIMITS.undoMs) throw new Error(`Edit ${e.id} is more than ${QUICK_LIMITS.undoMs / 3_600_000} h old: «Annulla» no longer applies; change the text again (or git revert ${e.commit ?? ''} in the brain).`);
    const plan = e.files.map(f => ({ ...f, abs: this.target(root, f.path) }));
    const moved = plan.filter(f => read(f.abs) !== f.after).map(f => f.path);
    if (moved.length) throw new Error(`Not undone: ${moved.join(', ')} changed after this edit (a newer edit or the user's own): undo that first, or edit the text again.`);
    const done: typeof plan = [];
    try { for (const f of plan) { writeText(f.abs, f.before); done.push(f); } }
    catch (err) { for (const f of done.reverse()) try { writeText(f.abs, f.after); } catch { /* best effort */ } throw new Error(`Not undone: ${errText(err)}`); }
    e.undoneAt = this.now();
    try { this.save(entries); } catch { /* the files are back: a second «Annulla» is refused by the text check */ }
    const files = plan.map(f => f.path);
    const logged = this.changelog(files, `annullato: ${e.summary}`, by, 'restored');
    try { this.d.changed?.(); } catch { /* the pages re-read on their own too */ }
    const msg = `Revert "brain: ${e.summary.slice(0, 80)}"\n\n${e.commit ? `This reverts commit ${e.commit}.` : 'Undoes a quick edit that was not committed.'} («Annulla», ADR 0370)`;
    const commit = await this.commit(root, logged ? [...files, 'changelog.md'] : files, msg);
    log.info('brain-edit', 'quick brain edit undone', { data: { id: e.id, files } });
    return { id: e.id, diff: `↶ ${files.join(' · ')} come prima`, commit: 'sha' in commit ? commit.sha : null, ...('skipped' in commit ? { commitSkipped: commit.skipped } : {}) };
  }

  private changelog(files: string[], summary: string, by: string, action: 'edited' | 'restored'): boolean {
    if (!this.d.changelog) return false;
    const kind: ChangelogKind = files.every(f => /(^|\/)SKILL\.md$/i.test(f)) ? 'skill' : files.every(f => /^rules\/|rules\.md$/i.test(f)) ? 'rule' : 'note';
    try { this.d.changelog.add({ kind, action, target: files.join(', '), by: by || 'Orchestrator', summary }); return true; }
    catch (e) { log.info('brain-edit', 'changelog line not written', { cause: errText(e) }); return false; }
  }

  private async commit(root: string, files: string[], message: string): Promise<{ sha: string } | { skipped: string }> {
    if (!this.d.git) return { skipped: 'no git here' };
    try { return await this.d.git.commit(root, files, message); }
    catch (e) { return { skipped: errText(e).slice(0, 200) }; }
  }

  private async lint(root: string, files: string[]): Promise<{ summary: string; findings: string[] } | null> {
    try { return (await this.d.lint?.(root, files)) ?? null; } catch { return null; }
  }

  /** The skill lint (shared/skill-lint.ts) of every SKILL.md written. */
  private skillWarnings(plan: readonly { path: string; abs: string; after: string }[]): string[] {
    const out: string[] = [];
    for (const f of plan) {
      if (path.posix.basename(f.path) !== 'SKILL.md') continue;
      const dir = path.dirname(f.abs);
      let files: { path: string }[] = [];
      try { files = (fs.readdirSync(dir, { recursive: true }) as string[]).map(p => ({ path: p.replace(/\\/g, '/') })); } catch { /* none */ }
      for (const w of lintSkill(path.basename(dir), f.after, files)) out.push(`${f.path}: ${lintText(w)}`);
    }
    return out;
  }
}
