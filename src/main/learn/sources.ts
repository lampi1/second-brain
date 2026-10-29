// What Impara's research may use besides the material (ADR 0188): the engines the user may pick to explain, with their
// models and efforts (the start form's «Chi spiega»), and the app's own guide as one markdown file the files research
// reads when the ask is about the app (the Guida page's concepts, shared/concept-guide.ts: written from the code, so
// the lesson explains the app as it is). Used by wiring.ts and demo-wiring.ts.
import type { Lang } from '@shared/contract';
import { CONCEPTS, cardText, type GuideLang } from '@shared/concept-guide';
import { TEACHER_EFFORTS, type TeacherOption } from '@shared/lesson';

/** Claude's CLI aliases, always valid whatever its version: the strongest first (the default of a lesson). */
const CLAUDE_ALIASES = [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: 'haiku', name: 'Haiku' }];

/** One engine as the start form offers it: its models (Claude: its aliases, then the ids seen; Fable never: a lesson
 *  is many runs and the hidden runs refuse it, compare/headless.ts askRefusal), its efforts when it takes one, and
 *  whether it can run the web research (Claude only). */
export function teacherOption(e: { id: string; label: string; kind: string; caps: { effort: boolean } }, seen: readonly { id: string; name?: string }[]): TeacherOption {
  const own = seen.filter(m => !/fable/i.test(m.id)).map(m => ({ id: m.id, name: m.name || m.id }));
  const models = e.kind === 'claude' ? [...CLAUDE_ALIASES, ...own.filter(m => !CLAUDE_ALIASES.some(a => a.id === m.id))] : own;
  return { engine: e.id, label: e.label, models: models.slice(0, 20), efforts: e.caps.effort ? [...TEACHER_EFFORTS] : [], web: e.kind === 'claude' };
}

/** The app's guide: every concept card of the Guida page, in the user's language. */
export function appGuide(lang: Lang): string {
  const l: GuideLang = lang === 'en' || lang === 'de' ? lang : 'it';
  return CONCEPTS.map(c => cardText(c, l)).join('\n\n---\n\n');
}
