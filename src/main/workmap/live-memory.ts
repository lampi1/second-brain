// What the live status of the work maps remembers (ADR 0342), over a restart too (userData/work-maps/live.json, through
// store.ts): when each chat was last confirmed to be what it is (the time a stale state shows), the owner chats whose
// engine died and did not come back, who closed an owner chat by hand, and the stops by themselves already told to
// the Orchestrator (once per stop). liveKey = what a chat's live status is made of, so a streaming event costs a
// comparison. Used by workmap/service.ts; pinned by test/unit/workmap-live-service.test.ts.
import type { ChatSummary } from '@shared/contract';
import type { WorkWorker } from '@shared/work-map';

/** What the live status of a chat is made of. */
export const liveKey = (c: ChatSummary): string => [c.state, c.pending, c.queued ? 1 : 0, (c.background ?? 0) > 0 ? 1 : 0, c.closedAt ?? 0, c.closedBy ?? '', c.waitsOn ?? '', c.waitsOnWork ? 1 : 0, (c.questions ?? []).map(q => `${q.id}:${q.answered ? 'x' : q.level}:${q.trail.length}`).join(','),
  c.lastResult ? `${c.lastResult.at}:${c.lastResult.isError ? 1 : 0}:${c.lastResult.interrupted ? 1 : 0}` : '', c.run?.runId ?? '', c.run?.report?.at ?? 0, c.delegation?.at ?? 0, c.delegation?.result?.at ?? 0, c.parentId ?? '', c.title].join('|');

type Times = Map<string, number>;
const times = (v: unknown): Times => new Map(v && typeof v === 'object' ? Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0) : []);

export class LiveMemory {
  private seen: Times;
  private crashes: Times;
  private gone: Map<string, 'user' | 'agent'>;
  private stops: Map<string, { at: number; told: boolean }>;
  private saved = '';

  /** v = the saved file, read leniently. */
  constructor(v: unknown) {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    this.seen = times(o.seen);
    this.crashes = times(o.crashes);
    this.gone = new Map(o.gone && typeof o.gone === 'object' ? Object.entries(o.gone).filter((e): e is [string, 'user' | 'agent'] => e[1] === 'user' || e[1] === 'agent') : []);
    this.stops = new Map(o.stops && typeof o.stops === 'object' ? Object.entries(o.stops as Record<string, { at?: unknown; told?: unknown } | null>).flatMap(([id, s]) => (typeof s?.at === 'number' ? [[id, { at: s.at, told: s.told === true }] as const] : [])) : []);
    this.saved = JSON.stringify(this.record());
  }

  confirmed(chatId: string): number | undefined { return this.seen.get(chatId); }
  /** A chat seen as it is: at work or waiting, now; else when its last turn ended. */
  confirm(w: WorkWorker, lastResultAt: number | undefined, now: number): void {
    const at = w.say === 'working' || w.say === 'waiting' ? now : w.say === 'unknown' || w.say === 'gone' ? undefined : lastResultAt;
    if (at !== undefined) this.seen.set(w.chatId, at);
  }

  crashed(chatId: string): boolean { return this.crashes.has(chatId); }
  crash(chatId: string, at: number): void { this.crashes.set(chatId, at); }
  /** Its engine works again; true = it was taken for dead. */
  alive(chatId: string): boolean { return this.crashes.delete(chatId); }

  /** Who closed an owner chat by hand; undefined = it is open, or nobody did. */
  removed(chatId: string, by: 'user' | 'agent' | undefined): void { if (by) this.gone.set(chatId, by); else this.gone.delete(chatId); }
  removedBy(chatId: string): 'user' | 'agent' | undefined { return this.gone.get(chatId); }
  forget(chatId: string): void { this.seen.delete(chatId); this.crashes.delete(chatId); }

  /** A map stopped by itself: to tell once. */
  stopped(mapId: string, at: number): void { if (!this.stops.has(mapId)) this.stops.set(mapId, { at, told: false }); }
  untold(): string[] { return [...this.stops].filter(([, s]) => !s.told).map(([id]) => id); }
  told(mapId: string): void { const s = this.stops.get(mapId); if (s) s.told = true; }
  /** It is not stopped by itself any more; true = it was. */
  unstop(mapId: string): boolean { return this.stops.delete(mapId); }

  private record(): unknown { return { seen: Object.fromEntries(this.seen), crashes: Object.fromEntries(this.crashes), gone: Object.fromEntries(this.gone), stops: Object.fromEntries(this.stops) }; }
  /** What to write, or null when nothing changed since the last time; what is no chat's and no map's is left out. */
  toSave(isChat: (id: string) => boolean, isOwner: (id: string) => boolean): unknown {
    for (const id of [...this.seen.keys()]) if (!isChat(id)) this.seen.delete(id);
    for (const id of [...this.crashes.keys()]) if (!isChat(id)) this.crashes.delete(id);
    for (const id of [...this.gone.keys()]) if (!isOwner(id)) this.gone.delete(id);
    const v = this.record(), text = JSON.stringify(v);
    if (text === this.saved) return null;
    this.saved = text;
    return v;
  }
}
