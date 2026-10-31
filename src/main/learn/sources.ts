// What Impara's research may use besides the material (ADR 0188): the engines the user may pick to explain, with their
// models and efforts (the start form's «Chi spiega»), and the app's own guide as one markdown file the files research
// reads when the ask is about the app (the Guida page's concepts, shared/concept-guide.ts: written from the code, so
// the lesson explains the app as it is). Used by wiring.ts and demo-wiring.ts.
import type { Lang } from '@shared/contract';
import { CONCEPTS, cardText, type GuideLang } from '@shared/concept-guide';
import { TEACHER_EFFORTS, type TeacherOption } from '@shared/lesson';

/** Claude's CLI aliases, always valid whatever its version: the strongest first (the default of a lesson). */
const CLAUDE_ALIASES = [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }];

/** Cursor's `auto` on its command line, the model its ACP sessions list as `auto-smart` («Auto»). */
const CURSOR_AUTO = { acp: 'auto-smart', cli: 'auto' };

/** One engine as the start form offers it: its models (Claude: its aliases, then the ids seen; Fable never: a lesson
 *  is many runs and the hidden runs refuse it, compare/headless.ts askRefusal), its efforts when it takes one, and
 *  whether it can run the web research (Claude only). A lesson runs hidden with the model on the command line, which
 *  may not take the ids a chat lists (learn/accepted-models.ts): once the engine listed what it accepts, only those;
 *  until then Cursor offers only `auto` (the one id both name), any other engine the ids seen. Every model, however
 *  many: the form searches them. */
export function teacherOption(e: { id: string; label: string; kind: string; caps: { effort: boolean } }, seen: readonly { id: string; name?: string }[], accepted: readonly string[] | null = null): TeacherOption {
  const noFable = (id: string) => !/fable/i.test(id);
  const own = seen.filter(m => noFable(m.id)).map(m => ({ id: m.id, name: m.name || m.id }));
  const auto = { id: CURSOR_AUTO.cli, name: own.find(m => m.id === CURSOR_AUTO.acp)?.name ?? 'Auto' };
  const nameOf = (id: string) => own.find(m => m.id === id)?.name ?? (e.id === 'cursor' && id === auto.id ? auto.name : id);
  const listed = accepted?.length ? accepted.filter(noFable).map(id => ({ id, name: nameOf(id) })) : null;
  const models = e.kind === 'claude' ? [...CLAUDE_ALIASES, ...(listed ?? own).filter(m => !CLAUDE_ALIASES.some(a => a.id === m.id))]
    : listed ?? (e.id === 'cursor' ? [auto] : own);
  return { engine: e.id, label: e.label, models, efforts: e.caps.effort ? [...TEACHER_EFFORTS] : [], web: e.kind === 'claude' };
}

/** The app's guide: every concept card of the Guida page, in the user's language. */
export function appGuide(lang: Lang): string {
  const l: GuideLang = lang === 'en' || lang === 'de' ? lang : 'it';
  return CONCEPTS.map(c => cardText(c, l)).join('\n\n---\n\n');
}
