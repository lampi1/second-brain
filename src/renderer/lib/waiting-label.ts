// A held work chat's one status on its tile (#359): what main says it waits for, from real state only (an open question
// or permission, a plan to approve, a command left to Esegui, a step of the user's written in the Orchestrator (#411),
// a browser hand-off, its sub-chats or background tasks, a command of its own, mail, a missing report, unsaved work),
// as a label of at most three words. Waits that need the
// user (USER_WAITS) are what the tile's «Ti aspetta» button answers. Used by AutoCloseNotice.tsx and ChatTile.tsx.
import { t } from '../i18n';
import type { AutoCloseStatus, AutoCloseWaiting } from '@shared/auto-close';

/** the waits the user answers (the tile's request button opens them) */
export const USER_WAITS: ReadonlySet<AutoCloseWaiting> = new Set(['answer', 'permission', 'plan', 'command', 'step', 'browser']);

/** The short label of what the row waits for; null when it shows a countdown, is kept open or waits for nothing. */
export function waitingLabel(row: Pick<AutoCloseStatus, 'waitingFor' | 'waitingN' | 'keptOpen' | 'deadline'> | undefined): string | null {
  if (!row?.waitingFor || row.keptOpen || row.deadline !== null) return null;
  const w = row.waitingFor;
  if (w === 'children' || w === 'background') return t(`cmp.autoClose.waiting.${w}`, { n: Math.max(1, row.waitingN ?? 1) });
  return t(`cmp.autoClose.waiting.${w}`);
}
