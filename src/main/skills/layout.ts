// One copy of the brain's skills (#361, ADR 0241): the skills live in `.agents/skills` (Codex and the Agent Skills
// tools read it) and `.claude/skills` is a link to it (Claude Code reads only that one), so an edit made from either
// side is the same file. A brain made before this keeps its skills in `.claude/skills`: unifySkillFolders moves each one
// to `.agents/skills` once (a same-name skill already there with the same files simply loses its duplicate; one with
// different files stops the move and the link, logged by name: nothing is overwritten), then makes the link (a junction
// on Windows: no admin rights needed), keeps it out of git (`/.claude/skills` in .gitignore) and drops the old paths
// from git's index, so a synced PC gets the move. Where a link cannot be made the folders stay as they are: the app reads
// both (agents/pack/shared-skills.ts, brain/adapters/claude-plugin.ts). Used by skills/library.ts; pinned by
// test/unit/skills/layout.test.ts.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { errText, log } from '../log';

/** Where the brain's skills live (the one copy). */
export const brainSkillsDir = (root: string): string => path.join(root, '.agents', 'skills');
/** The folder Claude Code reads: a link to brainSkillsDir once unified. */
export const claudeSkillsDir = (root: string): string => path.join(root, '.claude', 'skills');

export type UnifyResult = { state: 'linked' | 'already' | 'kept'; moved: string[]; conflicts: string[]; error?: string };

const isLink = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const exists = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** Same files with the same bytes (a folder tree, links refused). */
function sameTree(a: string, b: string): boolean {
  const list = (d: string, rel = ''): string[] => fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) return [`L ${r}`];
    return e.isDirectory() ? list(d, r) : [r];
  }).sort();
  try {
    const fa = list(a), fb = list(b);
    return fa.length === fb.length && fa.every((f, i) => f === fb[i] && !f.startsWith('L ') && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  } catch { return false; }
}

/** Keeps the link out of git: a junction would otherwise list every skill twice. */
function ignoreLink(root: string): void {
  const file = path.join(root, '.gitignore');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text.split(/\r?\n/).some(l => l.trim() === '/.claude/skills' || l.trim() === '/.claude/skills/')) return;
  fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# the brain's skills live in .agents/skills (this is a link to it)\n/.claude/skills\n`);
}

/** git rm --cached of the old paths (the files are in .agents/skills now); a brain without git skips it. */
export type GitRm = (root: string) => Promise<void>;
const gitRmCached: GitRm = root => new Promise(resolve => {
  if (!exists(path.join(root, '.git'))) { resolve(); return; }
  execFile('git', ['-C', root, 'rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', '.claude/skills'], { windowsHide: true, timeout: 30_000 }, error => {
    if (error) log.warn('skills', 'old skill paths not dropped from git', { cause: errText(error), hint: 'run `git rm -r --cached .claude/skills` in the brain folder: the files are in .agents/skills now' });
    resolve();
  });
});

/** Moves the brain's `.claude/skills` into `.agents/skills` and links it back; safe to call at every start. */
export async function unifySkillFolders(root: string, o: { gitRm?: GitRm; link?: (target: string, at: string) => void } = {}): Promise<UnifyResult> {
  const agents = brainSkillsDir(root), claude = claudeSkillsDir(root);
  if (isLink(claude)) {
    // a link that still leads somewhere stays; a dangling one (the brain folder moved) is made again below
    if (fs.existsSync(claude)) return { state: 'already', moved: [], conflicts: [] };
    try { fs.unlinkSync(claude); } catch (e) { log.warn('skills', 'dangling skills link not removed', { cause: errText(e) }); return { state: 'already', moved: [], conflicts: [] }; }
  }
  const moved: string[] = [], conflicts: string[] = [];
  try {
    fs.mkdirSync(agents, { recursive: true });
    if (exists(claude)) {
      for (const e of fs.readdirSync(claude, { withFileTypes: true })) {
        const from = path.join(claude, e.name), to = path.join(agents, e.name);
        if (!exists(to)) { fs.renameSync(from, to); moved.push(e.name); continue; }
        if (e.isDirectory() && !e.isSymbolicLink() && sameTree(from, to)) { fs.rmSync(from, { recursive: true, force: true }); moved.push(e.name); continue; }
        conflicts.push(e.name);
      }
      if (conflicts.length) {
        log.warn('skills', 'skills not unified: the same name holds different files in both folders', { data: { conflicts }, hint: 'keep one of the two copies (in .agents/skills or .claude/skills) and remove the other: the app links them at the next start' });
        return { state: 'kept', moved, conflicts };
      }
      fs.rmdirSync(claude);
    }
    fs.mkdirSync(path.dirname(claude), { recursive: true });
    // relative on macOS and Linux (it survives a move of the brain folder); a Windows junction needs the full path
    (o.link ?? ((target, at) => fs.symlinkSync(process.platform === 'win32' ? target : path.relative(path.dirname(at), target), at, process.platform === 'win32' ? 'junction' : 'dir')))(agents, claude);
    ignoreLink(root);
    if (moved.length) await (o.gitRm ?? gitRmCached)(root);
    log.info('skills', 'brain skills unified in .agents/skills', { data: { moved: moved.length } });
    return { state: 'linked', moved, conflicts };
  } catch (e) {
    // a folder emptied by the moves above comes back as a real folder: Claude Code keeps reading .claude/skills through
    // the plugin, which takes .agents/skills too
    log.warn('skills', 'skill folder link not made', { cause: errText(e), data: { moved: moved.length }, hint: 'the skills are in .agents/skills and the app reads them there; on Windows check the brain folder is on an NTFS drive' });
    return { state: 'kept', moved, conflicts, error: errText(e) };
  }
}
