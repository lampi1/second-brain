// Live costs, zero tokens: today's total and every chat of the day by cost, updated at each message. Why: the brain's
// cost.mjs (Usage.todayUsd, Usage.claudeChats) runs every 3 minutes, while each app chat's costUsd moves with its
// stream (main/chats/live-cost.ts). So: cost.mjs's figure at the time it read (Usage.costAt) + what the app's Claude
// chats spent after that time. The chats' costs over time are noted here (store.ts, on every chat:updated) to know
// each one's cost at costAt. Cursor and the other engines are not in cost.mjs's Claude figure: their own numbers; a
// Cursor chat with a turn of a model that has no price is listed as «prezzo sconosciuto», never dropped as a 0.
// Used by UsageBar (top bar, popup) and the brain's Costi page ("Adesso").
import type { ChatSummary, Harness, Usage } from '@shared/contract';

/** samples older than this are dropped (the latest one before stays: it is the cost at an older costAt) */
const KEEP_MS = 15 * 60e3;

/** Each chat's costUsd over time, to read what it was when cost.mjs read the transcripts. */
export class CostHistory {
  private m = new Map<string, [number, number][]>();

  note(id: string, usd: number, t: number): void {
    const list = this.m.get(id) ?? [];
    const last = list[list.length - 1];
    if (last && last[1] === usd) return;
    list.push([t, usd]);
    // keep the recent samples and the newest one before them
    let cut = 0;
    while (cut < list.length - 1 && list[cut + 1]![0] < t - KEEP_MS) cut++;
    this.m.set(id, cut ? list.slice(cut) : list);
  }

  /** the chat's cost at time t: the last sample at or before it; none that old = the oldest known; undefined = never seen */
  at(id: string, t: number): number | undefined {
    const list = this.m.get(id);
    if (!list?.length) return undefined;
    let v = list[0]![1];
    for (const [ts, usd] of list) { if (ts > t) break; v = usd; }
    return v;
  }

  forget(id: string): void { this.m.delete(id); }
}

export const costHistory = new CostHistory();

/** What a Claude chat of the app spent after cost.mjs read (0 when it is not newer). */
function since(c: ChatSummary, u: Usage, h: CostHistory): number {
  if (u.costAt === undefined) return 0;
  const base = h.at(c.id, u.costAt) ?? c.costUsd;
  return Math.max(0, c.costUsd - base);
}

const isClaude = (c: ChatSummary) => c.harness === 'claude';

export interface LiveTotal { usd: number; partial: boolean; estimated: boolean }

/** Today's total, live: cost.mjs's Claude + Cursor's ledger or export + what the app's Claude chats spent since cost.mjs
 *  read. null = not known (no cost.mjs). estimated = a part is an estimate (Cursor's ledger, a running turn). */
export function liveTotal(u: Usage | null, chats: ChatSummary[], h: CostHistory = costHistory): LiveTotal | null {
  if (!u || u.costKnown === false) return null;
  let extra = 0, running = false;
  for (const c of chats) if (isClaude(c)) { extra += since(c, u, h); running ||= !!c.costLiveUsd; }
  const usd = Math.round((u.todayUsd + extra + (u.cursorTodayUsd ?? 0)) * 1e6) / 1e6;
  return { usd, partial: u.cursorTodayUsd == null, estimated: (u.cursorTodayUsd != null && u.cursorExact === false) || running };
}

export interface CostRow {
  key: string;
  /** the app chat; absent = a Claude session outside the app (Claude Code, desktop) or an older session of a chat */
  chatId?: string;
  title: string;
  harness: Harness;
  isOrchestrator?: boolean;
  usd: number;
  /** "≈": a running turn's estimate or Cursor's ledger estimate */
  approx: boolean;
  /** working now (its cost is moving) */
  running: boolean;
  /** some of today's turns have no price (Cursor "auto" or a model missing from the price table): usd is only a part */
  unpriced?: boolean;
  closed: boolean;
}

/** Every chat of the day with a cost, most first: the app's chats (Claude: cost.mjs's today + since it read; Cursor: the
 *  ledger's turns of today, not the chat's total; other engines: their own count since the app opened them) and
 *  cost.mjs's sessions outside the app. */
export function costRows(u: Usage | null, chats: ChatSummary[], h: CostHistory = costHistory): CostRow[] {
  const day = new Map((u?.claudeChats ?? []).map(s => [s.sessionId, s]));
  const used = new Set<string>();
  const unpricedIds = new Set(u?.cursorUnpriced?.chats ?? []);
  const rows: CostRow[] = [];
  for (const c of chats) {
    let usd: number, approx = !!c.costLiveUsd;
    if (isClaude(c) && u && u.costKnown !== false && u.costAt !== undefined) {
      const s = c.sessionId ? day.get(c.sessionId) : undefined;
      if (s) used.add(s.sessionId);
      usd = (s?.usd ?? 0) + since(c, u, h);
    } else if (c.harness === 'cursor' && c.sessionId && u?.cursorChatsToday) { usd = u.cursorChatsToday[c.sessionId] ?? 0; approx = true; }
    else if (c.costLedgerUsd !== undefined) { usd = c.costLedgerUsd; approx = true; }
    else usd = c.costKnown === false ? 0 : c.costUsd;
    const unpriced = c.harness === 'cursor' && !!c.sessionId && unpricedIds.has(c.sessionId);
    if (!(usd > 0) && !unpriced) continue;
    const running = c.state === 'running' || c.state === 'starting';
    rows.push({ key: c.id, chatId: c.id, title: c.title, harness: c.harness, isOrchestrator: c.isOrchestrator, usd, approx, running, closed: !!c.closedAt || c.state === 'closed', ...(unpriced ? { unpriced } : {}) });
  }
  for (const s of day.values()) {
    if (used.has(s.sessionId) || !(s.usd > 0)) continue;
    rows.push({ key: `s:${s.sessionId}`, title: s.title, harness: 'claude', usd: s.usd, approx: false, running: false, closed: true });
  }
  return rows.sort((a, b) => b.usd - a.usd || a.title.localeCompare(b.title));
}
