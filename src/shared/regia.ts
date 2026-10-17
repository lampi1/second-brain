// Several Regie (ADR 0021): which Regia a chat answers to, and a Regia's tab label. Pure, shared by main (appctl,
// mail's list_chats) and the renderer (tabs, the Regia a chat answers to), so both sides agree.
import type { ChatSummary } from './contract';

type Chat = Pick<ChatSummary, 'id' | 'isRegia' | 'regiaOf' | 'regiaSince'>;

/** The Regie in tab order: by regiaSince (inherited through `replaces`), then list order (creation order, as main's
 *  chats:list and the store); a Regia from before regiaSince comes first. */
export const regieOf = <T extends Chat>(chats: readonly T[]): T[] => chats.filter(c => c.isRegia).sort((a, b) => (a.regiaSince ?? 0) - (b.regiaSince ?? 0));

/** The id of the Regia a chat answers to: itself for a Regia; its regiaOf while that chat is still a Regia; else
 *  the first Regia (null with none). */
export function regiaOfChat(chat: Chat | undefined, chats: readonly Chat[]): string | null {
  if (chat?.isRegia) return chat.id;
  const regie = regieOf(chats);
  return (chat?.regiaOf && regie.some(r => r.id === chat.regiaOf) ? chat.regiaOf : regie[0]?.id) ?? null;
}

/** A Regia's tab label: its name, "Lavoro" for the Regia from before names existed. */
export const regiaLabel = (c: Pick<ChatSummary, 'regiaName' | 'appRegia'>): string => (c.appRegia ? 'App' : c.regiaName?.trim() || 'Lavoro');

/** How a chat is named in lists and cards: a Regia is "Regia", or "Regia · <name>" when it has a tab name; any
 *  other chat its title. */
export const chatName = (c: Pick<ChatSummary, 'isRegia' | 'regiaName' | 'title'>): string =>
  c.isRegia ? (c.regiaName?.trim() ? `Orchestrator · ${c.regiaName.trim()}` : 'Orchestrator') : c.title;

/** A valid tab name: 1-30 characters, no line breaks. */
export function cleanRegiaName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= 30 ? s : null;
}
