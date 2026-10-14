// What the app tells the live brain map (brain/lib/live.ts): its chats with their engine and state, their recent tool
// calls (the newest per chat, running or finished in the last seconds, with the moment each one ended as seen here)
// and the browser tabs each chat drives. Read from the app store on demand, so it costs nothing while the map is
// closed. Used by App.tsx (BrainMap's `live` prop).
import type { LiveSnapshot, LiveSource, LiveTool } from '../brain';
import { FADE_MS } from '../brain';
import { app } from '../store/store';
import { engineLabel } from './engines';
import { now } from './clock';

const ACTIVE = new Set(['starting', 'running', 'waiting']);
const PER_CHAT = 40;
/** tool call id → when it was seen finished (its start time when it was already finished the first time we looked) */
const ends = new Map<string, number>();
const running = new Set<string>();
/** when the map last looked: calls seen running before a long pause (the map closed) end at their start, not now */
let lastLook = 0;

export function liveSnapshot(): LiveSnapshot {
  const s = app.get();
  const t = now();
  if (t - lastLook > FADE_MS) running.clear();
  lastLook = t;
  const chats = s.order.map(id => s.chats[id]).filter(c => !!c).map(c => ({ id: c.id, title: c.title, harness: c.harness, engine: engineLabel(c.harness), state: c.state, isRegia: c.isRegia, cwd: c.cwd }));
  const tools: LiveTool[] = [];
  for (const [chatId, items] of Object.entries(s.items)) {
    const c = s.chats[chatId];
    if (!c) continue;
    for (let i = items.length - 1, n = 0; i >= 0 && n < PER_CHAT; i--, n++) {
      const it = items[i]!;
      if (it.kind !== 'tool') continue;
      let endAt: number | null = null;
      if (it.status === 'running') {
        if (!ACTIVE.has(c.state)) continue; // a call left "running" by a chat that stopped is not work
        running.add(it.id);
      } else {
        endAt = ends.get(it.id) ?? (running.has(it.id) ? t : it.at);
        ends.set(it.id, endAt);
        running.delete(it.id);
      }
      if (endAt != null && t - endAt > FADE_MS) continue;
      tools.push({ chatId, id: it.id, name: it.name, input: it.input, summary: it.summary, startAt: it.at, endAt, error: it.status === 'error' });
    }
  }
  if (ends.size > 2000) for (const [id, at] of ends) if (t - at > 4 * FADE_MS) ends.delete(id);
  const tabs = s.tabs.filter(tb => tb.ownerChatId).map(tb => ({ chatId: tb.ownerChatId!, env: tb.env ?? null, title: tb.title, url: tb.url }));
  return { now: t, chats, tools, tabs };
}

export const liveSource: LiveSource = { get: liveSnapshot, subscribe: (fn: () => void) => app.subscribe(fn) };
