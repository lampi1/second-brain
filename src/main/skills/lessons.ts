// Lessons for skills (#365, ADR 0242; ADR 0257): what a role learns no longer becomes a role note injected at launch. A
// line from agent_report's `remember` or from memory_propose is NOTED for the next Maintenance (state `noted`, never a
// card): the maintenance research reads the noted lines with the chats and work threads since the previous maintenance
// and, with the strongest model, proposes a skill change or a new skill only when it is really needed (research.ts,
// section «lessons»); the lines it read are then `reviewed`. Davide (2026-11-10): one card per run was too many. An
// `open` lesson (a card in Memoria → Proposte, approved into the skill's «## Lezioni» section through the skill library,
// one change with its Undo) was made only before ADR 0257; those wait for Maintenance like the noted ones now.
// Stored in the app's data folder (skill-lessons.json), bounded. Pinned by test/unit/skills/lessons.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SKILL_NAME } from '../../shared/skill-library';
import { nearSame } from '../rules/memory-worth';
import { errText, log } from '../log';

/** The role's own skill: read in full at every start of the role (agents/pack/flows.ts runtime). */
export const roleSkillName = (roleId: string): string => `ruolo-${roleId}`;
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
  /** noted: waits for Maintenance (ADR 0257); reviewed: Maintenance read it; open: a card (only lessons made before
   *  ADR 0257 were, and they read as noted now) */
  state: 'noted' | 'reviewed' | 'open' | 'approved' | 'rejected';
  /** how many times a run noted the same line (a signal for Maintenance) */
  seen?: number;
  decidedAt?: number;
  /** the change-log entry an approval wrote (before ADR 0257) */
  changeId?: string | null;
}
export interface LessonProposal { role: string; text: string; skill?: string; chatId?: string; runId?: string }
export interface LessonsDeps {
  file: string;
  changed?: () => void;
  now?: () => number;
}

export class SkillLessons {
  constructor(private readonly d: LessonsDeps) {}
  private now(): number { return this.d.now?.() ?? Date.now(); }

  all(): SkillLesson[] { return this.read().lessons; }
  /** Lines noted once that left beyond MAX_OPEN since the last Maintenance read (#381): its section says how many. */
  dropped(): number { return this.read().dropped; }
  private read(): { lessons: SkillLesson[]; dropped: number } {
    try {
      const raw = JSON.parse(fs.readFileSync(this.d.file, 'utf8')) as { lessons?: SkillLesson[]; dropped?: number };
      const dropped = Number.isFinite(raw.dropped) && (raw.dropped ?? 0) > 0 ? Math.floor(raw.dropped!) : 0;
      // a card from before ADR 0257 waits for Maintenance too: the user is no longer asked one line at a time
      return { dropped, lessons: Array.isArray(raw.lessons) ? raw.lessons.filter(l => l && typeof l.id === 'string' && typeof l.text === 'string' && typeof l.skill === 'string')
        .map(l => (l.state === 'open' ? { ...l, state: 'noted' as const } : l)) : [] };
    } catch { return { lessons: [], dropped: 0 }; }
  }
  /** what runs noted for the next Maintenance, least recently noted first */
  noted(): SkillLesson[] { return this.all().filter(l => l.state === 'noted'); }
  /** Maintenance read these (its research read the section and ended): they are not shown to it again. A line noted
   *  again after the research took its copy (more `seen` than it was shown) came back meanwhile and keeps waiting. */
  reviewed(shown: readonly Pick<SkillLesson, 'id' | 'seen'>[]): void {
    if (!shown.length) return;
    const seen = new Map(shown.map(l => [l.id, l.seen ?? 1])), at = this.now();
    let count = 0;
    this.save(this.all().map(l => {
      if (l.state !== 'noted' || seen.get(l.id) !== (l.seen ?? 1)) return l;
      count++;
      return { ...l, state: 'reviewed', decidedAt: at };
    }), 0);
    log.info('skills', 'lessons reviewed by maintenance', { data: { count } });
  }
  /** `dropped`: the count since the last Maintenance read (default: as stored). */
  private save(list: SkillLesson[], dropped = this.dropped()): void {
    // decided lessons beyond the cap leave first (oldest first). Beyond MAX_OPEN waiting lines, the ones noted only once
    // leave, oldest first, never the line just noted: a line runs keep noting is the stronger signal (#381: 63 drops between two Maintenances,
    // each a warning; bounded by design, so the count goes to Maintenance's section instead, logged once per cycle)
    const noted = list.filter(l => l.state === 'noted');
    const over = Math.max(0, noted.length - MAX_OPEN);
    const leave = new Set(noted.slice(0, -1).map((l, i) => ({ l, i })).sort((a, b) => (a.l.seen ?? 1) - (b.l.seen ?? 1) || a.i - b.i).slice(0, over).map(x => x.l));
    const waiting = noted.filter(l => !leave.has(l)), done = list.filter(l => l.state !== 'noted').slice(-Math.max(0, MAX_KEPT - waiting.length));
    if (over && !dropped) log.info('skills', 'noted lessons over the cap: the least noted leave until the next Maintenance', { data: { kept: MAX_OPEN } });
    const keep = list.filter(l => waiting.includes(l) || done.includes(l));
    fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
    const tmp = `${this.d.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, lessons: keep, ...(dropped + over ? { dropped: dropped + over } : {}) }, null, 1));
    fs.renameSync(tmp, this.d.file);
  }

  /** One noted lesson. The same line already noted for the same skill is the same entry: a waiting one counts one more
   *  `seen`, one Maintenance read waits again; the oldest waiting lines leave beyond MAX_OPEN. */
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
    if (same) {
      // noted again: Maintenance sees how often it came back; one it already read comes back to it as new (the line
      // returned after that pass); one the user decided before ADR 0257 stays decided
      if (same.state === 'approved' || same.state === 'rejected') return { lesson: same, duplicate: true };
      // `at`, chat and run are the latest noting (the research reads that chat); the entry moves to the end of the list
      const latest = { at: this.now(), ...(p.chatId ? { chatId: p.chatId } : {}), ...(p.runId ? { runId: p.runId } : {}) };
      const again: SkillLesson = same.state === 'reviewed' ? { ...same, ...latest, state: 'noted', seen: 1, decidedAt: undefined } : { ...same, ...latest, seen: (same.seen ?? 1) + 1 };
      this.save([...list.filter(l => l.id !== same.id), again]);
      return { lesson: again, duplicate: true };
    }
    const lesson: SkillLesson = { id: randomUUID(), at: this.now(), role, skill, text: line, state: 'noted', ...(p.chatId ? { chatId: p.chatId } : {}), ...(p.runId ? { runId: p.runId } : {}) };
    this.save([...list, lesson]);
    log.info('skills', 'lesson noted for maintenance', { data: { id: lesson.id, role, skill } });
    this.d.changed?.();
    return { lesson, duplicate: false };
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
