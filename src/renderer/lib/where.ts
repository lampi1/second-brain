// What the user has on screen right now, in one short line for the Orchestrator (ADR 0276; the owner, 2026-11-13:
// «l'orchestrator deve sempre sapere dove è l'utente e che mappa sta visualizzando ma in generale ogni punto dell'app»).
// Sent with each message to the Orchestrator (store.ts → chat:send `where`); main tells the engine only when it changed
// (chats/manager.ts whereHint), so it costs a line now and then, never a tool call. Page ids are app_ui's own, map ids
// are the plans tool's: the Orchestrator can act on them as they are.
import { ui } from '../store/ui';

/** titleOf: a chat's title by id (the caller holds the chats: this file must not import the store that imports it). */
export function whereNow(titleOf: (chatId: string) => string | undefined = () => undefined): string {
  const s = ui.get();
  const parts: string[] = [];
  if (s.modal && s.modal !== 'palette') parts.push(`window "${s.modal}"`);
  if (s.map) parts.push('the 3D brain map');
  else if (s.page === 'piani') parts.push(s.pageArg ? `page plan "${s.pageArg}"` : 'page plans');
  else parts.push(`page "${s.page}${s.pageArg ? `/${s.pageArg}` : ''}"`);
  const max = s.maximized?.startsWith('chat:') ? s.maximized.slice(5) : undefined;
  if (max) parts.push(`chat "${titleOf(max) ?? max}" enlarged (chatId ${max})`);
  return parts.join(' · ').slice(0, 300);
}
