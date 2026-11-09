// Lessons for skills (#365, ADR 0242): what a role learns no longer becomes a role note injected at launch. A line from
// agent_report's `remember` or from memory_propose becomes a proposal to change a skill: the role's own skill
// (`ruolo-<id>`, read at every start of that role) or the skill of the task. Davide decides each one in Memoria →
// Proposte; an approved lesson is appended to the skill's «## Lezioni» section through the skill library (one change
// with its Undo in the skill's History), a rejected one is kept as rejected so the same line is not asked again.
// Stored in the app's data folder (skill-lessons.json), bounded. Pinned by test/unit/skills/lessons.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SKILL_NAME } from '../../shared/skill-library';
import { nearSame } from '../rules/memory-worth';
import { errText, log } from '../log';
import type { SkillLibrary } from './library';

/** The role's own skill: read in full at every start of the role (agents/pack/flows.ts runtime). */
export const roleSkillName = (roleId: string): string => `ruolo-${roleId}`;
/** The section of a skill that approved lessons go to. */
export const LESSONS_HEADING = '## Lezioni';
const MAX_LINE = 300, MAX_OPEN = 200, MAX_KEPT = 600;

export interface SkillLesson {
  id: string;
  at: number;
  /** the role that learned it (a catalog role id) */
  role: string;
  /** the skill it changes: the role's own skill or the task's */
  skill: string;
  text: string;
  chatId?: string;
  runId?: string;
  state: 'open' | 'approved' | 'rejected';
  decidedAt?: number;
  /** the change-log entry the approval wrote (its Undo) */
  changeId?: string | null;
}
export interface LessonProposal { role: string; text: string; skill?: string; chatId?: string; runId?: string }
export interface LessonsDeps {
  file: string;
  library: () => SkillLibrary | null;
  /** the role's display name, for the role skill's description */
  roleName?: (roleId: string) => string;
  changed?: () => void;
  now?: () => number;
}

/** The skill text with one more lesson line in its «## Lezioni» section (added at the end when missing). */
export function withLesson(text: string, line: string): string {
  const body = text.replace(/\s+$/, '');
  const lines = body.split('\n');
  const at = lines.findIndex(l => l.trim() === LESSONS_HEADING);
  if (at < 0) return `${body}\n\n${LESSONS_HEADING}\n\n- ${line}\n`;
  let end = at + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end] ?? '')) end++;
  let last = end - 1;
  while (last > at && !lines[last]?.trim()) last--;
  const insert = last === at ? ['', `- ${line}`] : [`- ${line}`];
  lines.splice(last + 1, 0, ...insert);
  return `${lines.join('\n')}\n`;
}

export class SkillLessons {
  constructor(private readonly d: LessonsDeps) {}
  private now(): number { return this.d.now?.() ?? Date.now(); }

  all(): SkillLesson[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.d.file, 'utf8')) as { lessons?: SkillLesson[] };
      return Array.isArray(raw.lessons) ? raw.lessons.filter(l => l && typeof l.id === 'string' && typeof l.text === 'string' && typeof l.skill === 'string') : [];
    } catch { return []; }
  }
  open(): SkillLesson[] { return this.all().filter(l => l.state === 'open'); }
  private save(list: SkillLesson[]): void {
    // decided lessons beyond the cap leave first (oldest first); open ones stay
    const open = list.filter(l => l.state === 'open'), done = list.filter(l => l.state !== 'open').slice(-Math.max(0, MAX_KEPT - open.length));
    const keep = list.filter(l => l.state === 'open' || done.includes(l));
    fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
    const tmp = `${this.d.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, lessons: keep }, null, 1));
    fs.renameSync(tmp, this.d.file);
  }

  /** One proposed lesson. The same line already proposed for the same skill (open, approved or rejected) is not asked
   *  again: its existing entry comes back. */
  propose(p: LessonProposal): { lesson: SkillLesson; duplicate: boolean } {
    const role = String(p.role ?? '').trim();
    if (!role) throw new Error('A lesson needs the role that learned it.');
    const skill = (p.skill?.trim() || roleSkillName(role)).toLowerCase();
    if (!SKILL_NAME.test(skill) || skill.length > 64) throw new Error(`Skill name not valid: ${skill}`);
    // another role's own skill is read at every start of that role: a role never proposes lessons for it
    if (skill.startsWith('ruolo-') && skill !== roleSkillName(role)) throw new Error(`${skill} is another role's own skill: propose for yours (default) or for the task's skill.`);
    const text = String(p.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('A lesson needs its text.');
    const line = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
    const list = this.all();
    const same = list.find(l => l.skill === skill && nearSame(l.text, line, 0.9));
    if (same) return { lesson: same, duplicate: true };
    if (list.filter(l => l.state === 'open').length >= MAX_OPEN) throw new Error(`Too many lessons wait for the user (${MAX_OPEN}): propose this one later.`);
    const lesson: SkillLesson = { id: randomUUID(), at: this.now(), role, skill, text: line, state: 'open', ...(p.chatId ? { chatId: p.chatId } : {}), ...(p.runId ? { runId: p.runId } : {}) };
    this.save([...list, lesson]);
    log.info('skills', 'lesson proposed', { data: { id: lesson.id, role, skill } });
    this.d.changed?.();
    return { lesson, duplicate: false };
  }

  /** The user's decision. Approve appends the line to the skill (creating the role's own skill when it is missing) as one
   *  change with its Undo; the answer names that change. */
  async decide(id: string, approve: boolean): Promise<string | null> {
    const list = this.all(), l = list.find(x => x.id === id);
    if (!l) throw new Error('Lezione non trovata.');
    if (l.state !== 'open') throw new Error('Questa lezione è già stata decisa.');
    let changeId: string | null = null;
    if (approve) {
      const lib = this.d.library();
      if (!lib) throw new Error('Scegli prima la cartella del brain.');
      let text: string, mtime: number | undefined;
      if (await lib.has(l.skill)) {
        const doc = await lib.read(l.skill, 'SKILL.md');
        if (doc.text === null) throw new Error(`SKILL.md di «${l.skill}» non è leggibile.`);
        // already there (a save that failed after the write): nothing to append again
        text = doc.text.split(/\r?\n/).some(x => x.trim() === `- ${l.text}`) ? doc.text : withLesson(doc.text, l.text);
        mtime = doc.mtime;
      } else if (l.skill === roleSkillName(l.role)) {
        const name = this.d.roleName?.(l.role) ?? l.role;
        text = withLesson(`---\nname: ${l.skill}\ndescription: ${JSON.stringify(`Cosa sa il ruolo ${name}: letta per intero a ogni suo avvio.`)}\n---\n\n# ${name}\n`, l.text);
      } else throw new Error(`La skill «${l.skill}» non c’è più: rifiuta la lezione o creala prima.`);
      const r = await lib.write({ skill: l.skill, path: 'SKILL.md', text, ...(mtime !== undefined ? { mtime } : {}) }, { who: 'tu, approvando una lezione', reason: `Lezione di ${l.role} approvata in Proposte: ${l.text}` });
      if (!r.ok) throw new Error(r.error);
      changeId = r.changeId;
    }
    const at = this.now();
    this.save(this.all().map(x => (x.id === id ? { ...x, state: approve ? 'approved' : 'rejected', decidedAt: at, changeId } : x)));
    log.info('skills', `lesson ${approve ? 'approved' : 'rejected'}`, { data: { id, skill: l.skill, change: changeId } });
    this.d.changed?.();
    return changeId;
  }
}

/** The role's own skill text, without its frontmatter, for the launch (null when the role has none yet). */
export function roleSkillText(skillsDir: string | null, roleId: string, max = 12_000): string | null {
  if (!skillsDir) return null;
  try {
    const raw = fs.readFileSync(path.join(skillsDir, roleSkillName(roleId), 'SKILL.md'), 'utf8');
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    if (!body) return null;
    return body.length > max ? `${body.slice(0, max - 1)}…` : body;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('skills', 'role skill not read', { cause: errText(e), data: { role: roleId } });
    return null;
  }
}
