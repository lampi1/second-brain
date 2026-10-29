// The Orchestrator and Impara (ADR 0190; owner, 2026-10-29: «devo poter capire concetti informatici cose di lavoro»):
// app_learn starts a lesson when the user asks to understand something («spiegami come funziona X», «fammi capire
// questa PR») and opens it in Impara, where it is researched, verified and taught (ADR 0188); without `ask` it says
// what Impara holds (the lessons, the cards due today). Only on the Orchestrator's own endpoint, and a start only on a
// turn the user wrote (`userTurn`: the latest message is his, typed in the last minutes; never app news or an agent's
// mail), at most one lesson per message: a lesson spends the user's tokens, so only his own words start one.
import type { ImparaState, Lesson, LessonDepth, LessonKind, LessonStart } from '../../shared/lesson';
import { LESSON_DEPTHS, LESSON_LEVELS } from '../../shared/lesson';
import type { EventMap } from '../../shared/contract';

export interface ImparaControl { start(req: LessonStart): Lesson; state(): ImparaState }
interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): object }

const KINDS: readonly LessonKind[] = ['topic', 'pr', 'text'];

/** per Orchestrator, the user message that already started a lesson (the tools are built again for each request) */
const used = new Map<string, number>();

/** `userTurn`: the calling Orchestrator and the time of the user's own latest message to it when this turn is his, else null */
export function imparaTools(learn: ImparaControl, emitUi: (cmd: EventMap['ui:command']) => void, userTurn: () => { who: string; at: number } | null): Tool[] {
  return [{
    name: 'app_learn',
    description: 'Impara, the app\'s learning section: a lesson that first researches (the web, and the user\'s files, brain and the app\'s own code, never both in one run), verifies every fact, then teaches on an animated full-screen diagram with the app\'s voice, checks, a tutor and spaced review cards. Use it when the user asks to understand or learn something («spiegami come funziona…», «fammi capire questa PR», «voglio imparare…»), about any topic, a PR, their brain or the app itself; after you deliver a PR you may OFFER «Vuoi capirla in 5 minuti?» and call it (kind pr, depth quick) only when they say yes. With `ask` (or `prUrl`): starts the lesson (it costs tokens and takes a few minutes; the user\'s chosen teacher in Impara is not known here: the app\'s choice explains) and opens it in Impara; say it is being prepared, do not explain the topic yourself. A start is refused unless your latest message is the user\'s own, written in the last minutes (never on a turn woken by app news or an agent), and one message starts at most one lesson. Without them: the lessons (title, subject, state) and the review cards due today.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      ask: { type: 'string', description: 'what the user wants to understand, in their words (topic and text: required)' },
      kind: { type: 'string', enum: [...KINDS], description: 'topic (default), pr (with prUrl), text (with text: a pasted text to explain)' },
      prUrl: { type: 'string', description: 'kind pr: the PR\'s address (GitHub, or one of the Task page\'s DevOps PRs)' },
      text: { type: 'string', description: 'kind text: the text to explain' },
      depth: { type: 'string', enum: [...LESSON_DEPTHS], description: 'quick (~5 min), lesson (default, ~15 min), deep' },
      subject: { type: 'string', description: 'the subject it belongs to, only when the user named one; else the lesson picks it' },
    }, required: [] },
    run: a => {
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const ask = str(a.ask, 600), prUrl = str(a.prUrl, 500), text = str(a.text, 60_000);
      if (!ask && !prUrl && !text) {
        const s = learn.state();
        return {
          lessons: s.lessons.slice(0, 30).map(l => ({ id: l.id, title: l.title, subject: l.subject, state: l.done ? 'finita' : l.state, page: `impara/${l.id}` })),
          reviewDue: s.review?.due ?? 0, reviewNew: s.review?.fresh ?? 0,
          ...(s.canTeach ? {} : { cannotTeach: s.why }),
        };
      }
      const turn = userTurn();
      if (turn === null) throw new Error('bloccato: una lezione parte solo quando l’utente te lo chiede nel suo ultimo messaggio');
      if (used.get(turn.who) === turn.at) throw new Error('bloccato: per questo messaggio dell’utente una lezione è già partita');
      const kind: LessonKind = KINDS.includes(a.kind as LessonKind) ? a.kind as LessonKind : prUrl ? 'pr' : text ? 'text' : 'topic';
      const depth: LessonDepth = LESSON_DEPTHS.includes(a.depth as LessonDepth) ? a.depth as LessonDepth : 'lesson';
      const l = learn.start({ kind, ask, depth, level: LESSON_LEVELS[1]!, ...(prUrl ? { prUrl } : {}), ...(text ? { text } : {}), ...(str(a.subject, 40) ? { subject: str(a.subject, 40) } : {}) });
      used.set(turn.who, turn.at);
      emitUi({ action: 'page', value: `impara/${l.id}` });
      return { id: l.id, state: 'preparing', page: `impara/${l.id}`, note: 'La lezione si prepara in Impara (ricerca e verifica, qualche minuto) ed è già aperta: l’utente la segue lì.' };
    },
  }];
}
