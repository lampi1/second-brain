// The language the agents reply in (ADR 0120): one setting (`language`, the top bar's switch and Settings → Aspetto)
// drives the UI and the AI. A chat's context is told the language once, with its role text at the start of a context,
// and again with one short bracket line only on the first turn after the language changed, so an open chat follows a
// new choice without a restart (~15 tokens once, never every turn). Prompts stay English: only the reply language
// changes. Used by chats/manager.ts deliverNow; unit tests: test/unit/chats/reply-lang.test.ts.
import type { Lang } from '../../shared/contract';
import { LANG_NAME } from '../locale';

/** the engine-only line under a message: `fresh` = a new context (with the role text), else the language changed */
export function replyLangHint(lang: Lang, fresh: boolean): string {
  const name = LANG_NAME[lang];
  return fresh
    ? `\n\n[The user's language: ${name}. Reply to the user in it.]`
    : `\n\n[The user's language is now ${name}: reply in it from this message on.]`;
}

/** what this turn adds: the line, or '' when the context already knows `want` (`told`) and no role text goes now; a
 *  context never told one (a new chat, a chat saved before ADR 0120) gets the plain line, a changed one the "now" one */
export function replyLangTurn(want: Lang | undefined, told: Lang | undefined, roleNow: boolean): string {
  if (!want) return '';
  if (roleNow || told === undefined) return replyLangHint(want, true);
  return told === want ? '' : replyLangHint(want, false);
}
