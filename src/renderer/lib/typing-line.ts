// The line of a working chat (owner, 2026-10-27: «al posto delle frasi divertenti … quello che sta realmente facendo»,
// ADR 0173): what the chat does now, read from its transcript at zero tokens, the same for every engine (Claude, Cursor,
// Codex, cloud): the tool or command running ("Lancia `npm test`", "Sto modificando login.ts", "Delega a Artisan"),
// else the engine's plan item in progress, else a plain "sta pensando…" / "sta lavorando…", "sta scrivendo…" while the
// reply streams. The words come from lib/run-steps.ts (the delegated cards' lines). Pure; used by components/ChatItems.tsx
// Typing and StripActivity.tsx, pinned by test/unit/typing-line.test.ts.
import type { ChatItem } from '@shared/contract';
import { enginePlan, lastActionStep } from './run-steps';
import { t } from '../i18n';

export interface LiveLine { text: string; code?: string }

/** What the chat does now; `what` is turnActivity's reading of the last item. */
export function liveLine(items: readonly ChatItem[] | undefined, what: 'scrive' | 'pensa' | 'lavora'): LiveLine {
  if (what === 'scrive') return { text: t('chat.items.typing.writing') };
  // only this turn: a plan item left "in progress" by a stopped earlier turn is no "now"
  const all = items ?? [];
  let from = all.length;
  while (from > 0 && all[from - 1]!.kind !== 'user') from--;
  const list = all.slice(from);
  const action = lastActionStep(list, true);
  if (action?.mark === 'cur') return { text: action.text, ...(action.code ? { code: action.code } : {}) };
  const planCur = enginePlan(list)?.find(p => p.mark === 'cur');
  if (planCur) return { text: planCur.text };
  return { text: t(what === 'lavora' ? 'chat.items.typing.working' : 'chat.items.typing.thinking') };
}
