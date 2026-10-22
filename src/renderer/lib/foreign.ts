// Which user-role chat items the user did NOT type: mail from another chat, a prompt or message an agent wrote
// (app_create_chat / app_send_to_chat), the app's news to the Orchestrator ("[evento app]"), an Esegui result, the app's own
// "riprendi" after a restart, a hook's note. The chat view folds them to one muted line (sender + first words) so they
// never read like the user's own messages (the user, 2026-10-13: "quando delle chat ti scrivono lo vedo proprio
// nell'editor e mi fa confusione, vorrei fosse collassata quella parte"). The structured origin wins (item.from, set
// by main when mail or an agent sends); the fixed label lines the app writes first are the fallback, which also covers
// items read back from a transcript (no from there). One kind the user did make, with a click and not by typing: the
// notes of Mandato / Copiato / Non serve (lib/sendable.ts, ADR 0038), folded the same way so they are never noise.
// Pure: no React, no store. Used by ChatItems.tsx.
import type { ChatItem } from '@shared/contract';
import { splitNotes } from './sendable';
import { t } from '../i18n';

export type ForeignKind = 'mail' | 'agent' | 'event' | 'run' | 'resume' | 'hook' | 'done';

/** kind; who sent it (a chat's title, "Orchestrator", "App"); one line of what it says; the text to show when opened */
export interface Foreign { kind: ForeignKind; sender: string; summary: string; body: string }

type UserItem = Extract<ChatItem, { kind: 'user' }>;

// the label lines main writes as the first line (chats/mail.ts render, appctl/tools.ts AGENT_LABEL,
// chats/orchestrator-wake.ts APP_EVENT_LABEL, run/results.ts RUN_RESULT_LABEL, chats/manager.ts RESUME_TEXT)
const MAIL = /^\[Messaggio dalla chat "(.*?)" tramite second-brain[^\n]*\]/;
const AGENT = /^\[Messaggio di un agente tramite second-brain[^\n]*\]/;
const EVENT = /^\[evento app[^\n]*\]/;
const RUN = /^\[esito di Esegui[^\n]*\]/;
/** The outcome of an Esegui run as main writes it for the chat (run/results.ts runResultText, in Italian: the chats read
 *  it) in the UI language: «riuscito (exit code 0)», «fallito (exit code 1)», «fermato dall'utente…», then « · N s» and the
 *  production mark. Anything else stays as written. */
export function runOutcome(how: string): string {
  const parts = how.split(' · ');
  const head = parts[0] ?? '';
  const ok = /^riuscito \(exit code (-?\d+)\)$/.exec(head), bad = /^fallito(?: \(exit code (-?\d+)\))?$/.exec(head);
  const first = ok ? t('tools.foreign.runOk', { code: ok[1]! }) : bad ? t('tools.foreign.runFail', { code: bad[1] ?? '' }) : /^fermato dall.utente prima della fine$/.test(head) ? t('tools.foreign.runStopped') : head;
  return [first, ...parts.slice(1).map(p => (/^comando di produzione/.test(p) ? t('tools.foreign.runProd') : p))].join(' · ');
}
const RESUME = /^\[second-brain\][^\n]*/;
const HOOK = /^(?:<user-prompt-submit-hook>|UserPromptSubmit hook additional context:)/;

const oneLine = (s: string, n = 120): string => {
  const t = s.replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(l => l && !/^```/.test(l)) ?? '';
const after = (text: string, re: RegExp): string => text.replace(re, '').replace(/^\s*\n/, '').trim();

/** null = the user's own message (shown as is). */
export function foreignOf(item: UserItem): Foreign | null {
  const text = item.text.trim();
  let m: RegExpMatchArray | null;
  if ((m = text.match(MAIL))) {
    // each message: "(da "X" · 12:03 · id … · chiave …)" then its text; the last line says how to answer
    const body = after(text, MAIL);
    const words = body.split('\n').filter(l => l.trim() && !/^\(da "/.test(l) && !/^Rispondi solo se/.test(l));
    return { kind: 'mail', sender: item.from ?? m[1] ?? t('tools.foreign.otherChat'), summary: oneLine(words[0] ?? ''), body };
  }
  if (AGENT.test(text)) {
    const body = after(text, AGENT).replace(/^(?:La tuo Orchestrator|Il tuo Orchestrator) è «[^»]*»[^\n]*\n*/, '').trim();
    return { kind: 'agent', sender: item.from ?? t('tools.foreign.anAgent'), summary: oneLine(firstLine(body)), body };
  }
  if (EVENT.test(text)) {
    const body = after(text, EVENT);
    const news = body.split('\n').find(l => l.startsWith('- '));
    return { kind: 'event', sender: 'App', summary: oneLine(news ? news.slice(2) : firstLine(body)), body };
  }
  if (RUN.test(text)) {
    const body = after(text, RUN);
    const code = body.match(/```powershell\n([^\n]*)/)?.[1] ?? '';
    const how = runOutcome(body.match(/^Esito: ([^\n]*)/m)?.[1] ?? '');
    return { kind: 'run', sender: t('chat.command.exec'), summary: oneLine([code, how].filter(Boolean).join(' · ')), body };
  }
  if (RESUME.test(text)) return { kind: 'resume', sender: 'App', summary: oneLine(after(text, /^\[second-brain\]\s*/)), body: text };
  if (HOOK.test(text)) return { kind: 'hook', sender: 'Hook', summary: oneLine(firstLine(after(text, HOOK))), body: text };
  if (!item.from) {
    const n = splitNotes(text);
    if (n.notes.length && !n.text) return { kind: 'done', sender: t('tools.foreign.you'), summary: oneLine(n.notes.join(' · ')), body: n.notes.join('\n') };
  }
  if (item.from) {
    const body = text.replace(/^\[Messaggio [^\n]*\]\s*\n+/, '');
    return { kind: 'agent', sender: item.from, summary: oneLine(firstLine(body)), body };
  }
  return null;
}

/** the folded line's tag; mail and agent also name their sender */
export const getForeignLabel = (): Record<ForeignKind, string> => ({
  mail: t('tools.foreign.labelMail'), agent: t('tools.foreign.labelAgent'), event: t('tools.foreign.labelEvent'), run: t('tools.foreign.labelRun'), resume: t('tools.foreign.labelResume'), hook: t('tools.foreign.labelHook'),
  done: t('tools.foreign.labelDone'),
});
export const showsSender = (f: Foreign): boolean => f.kind === 'mail' || f.kind === 'agent';
