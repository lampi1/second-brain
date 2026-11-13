// What the user has on screen right now, in one short line for the Orchestrator (ADR 0276; the owner, 2026-11-13:
// «l'orchestrator deve sempre sapere dove è l'utente e che mappa sta visualizzando ma in generale ogni punto dell'app»).
// Sent with each message to the Orchestrator (store.ts → chat:send `where`); main tells the engine only when it changed
// (chats/manager.ts whereHint), so it costs a line now and then, never a tool call. Page ids are app_ui's own, map ids
// are app_project_map's: the Orchestrator can act on them as they are.
import { ui } from '../store/ui';

/** `<project>/<system>` → «project map "p", inside "s"» with the box picked on it, if any. */
const mapPlace = (arg: string | null, picked: string | null): string => {
  const [project, level] = (arg ?? '').split('/');
  if (!project) return 'project maps';
  return `project map "${project}"${level ? `, inside "${level}"` : ''}${picked ? `, box "${picked}" selected` : ''}`;
};

/** titleOf: a chat's title by id (the caller holds the chats: this file must not import the store that imports it). */
export function whereNow(titleOf: (chatId: string) => string | undefined = () => undefined): string {
  const s = ui.get();
  const parts: string[] = [];
  if (s.modal && s.modal !== 'palette') parts.push(`window "${s.modal}"`);
  if (s.map) parts.push('the 3D brain map');
  else if (s.page === 'collegamenti' && (s.pageArg ?? '').startsWith('progetti')) parts.push(`page ${mapPlace((s.pageArg ?? '').split('/').slice(1).join('/') || null, s.mapPicked)}`);
  else parts.push(`page "${s.page}${s.pageArg ? `/${s.pageArg}` : ''}"`);
  const max = s.maximized?.startsWith('chat:') ? s.maximized.slice(5) : undefined;
  if (max) parts.push(`chat "${titleOf(max) ?? max}" enlarged (chatId ${max})`);
  return parts.join(' · ').slice(0, 300);
}
