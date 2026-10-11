// Live chats of the brain (/api/now, read from the Claude and Cursor transcripts by the brain's chats tool): which ones
// wait for the owner, which are working, which are done or stopped. "Now" means recent: working in the last 2 hours,
// waiting since less than a day; older ones are listed as stopped. Pure; unit-tested in test/unit/brain-ui/chats.test.ts.
import type { LiveChat } from '../types';
import { minutesAgo } from './format';

const recent = (c: Pick<LiveChat, 'ageMin'>, min: number) => c.ageMin == null || c.ageMin <= min;
export const isLive = (c: Pick<LiveChat, 'state' | 'ageMin'>): boolean => /in corso/.test(c.state) && recent(c, 120);
export const waitsYou = (c: Pick<LiveChat, 'state' | 'ageMin'>): boolean => /aspetta/.test(c.state) && recent(c, 24 * 60);
export type ChatTone = 'warn' | 'blue' | 'bad' | 'good' | 'neutral';
export function chatState(c: Pick<LiveChat, 'state' | 'ageMin'>): { label: string; tone: ChatTone } {
  if (waitsYou(c)) return { label: /permess/.test(c.state) ? 'permesso' : 'ti aspetta', tone: 'warn' };
  if (isLive(c)) return { label: 'al lavoro', tone: 'blue' };
  if (/fermo|error/.test(c.state)) return { label: 'fermo', tone: 'bad' };
  if (/in corso|aspetta/.test(c.state)) return { label: 'ferma da un po\'', tone: 'neutral' };
  return { label: 'finita', tone: 'good' };
}
export const chatAgo = (c: Pick<LiveChat, 'ageMin' | 'when'>): string => (c.ageMin == null ? c.when : minutesAgo(c.ageMin));
export const chatName = (c: Pick<LiveChat, 'title'>): string => c.title || '(senza titolo)';

/** Split for the page: waiting first, then working, then the rest (most recent first in each group). */
export function groupChats(chats: LiveChat[]): { wait: LiveChat[]; live: LiveChat[]; rest: LiveChat[] } {
  const byAge = (a: LiveChat, b: LiveChat) => (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9);
  const wait = chats.filter(waitsYou).sort(byAge);
  const live = chats.filter(c => !waitsYou(c) && isLive(c)).sort(byAge);
  const rest = chats.filter(c => !waitsYou(c) && !isLive(c)).sort(byAge);
  return { wait, live, rest };
}
