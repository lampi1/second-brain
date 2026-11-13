// agent_wake_later (ADR 0238; cloudroom's `loop create --in 30m`): a chat schedules its own next turn, for work that
// waits on something the app does not announce (a CI run, a review chat it did not start, a deploy, a slow job). When
// it is due, the app writes one line to the chat ("[sveglia app] <reason>"), which reopens a closed chat. Kept in
// userData/wake-later.json, so a restart keeps it; one overdue at the start goes at once. At most one per chat: a new
// call replaces it, minutes 0 cancels it. Never for a chat the user closed himself. Used by wiring.ts (the chat
// endpoint's tool and the minute tick); pinned by test/unit/chats/wake-later.test.ts (fake clock).
import { readLocal, writeLocal } from '../agents/local-store';
import { callerOf } from '../mcp/caller';
import type { McpTool } from '../mcp/server';
import type { ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';

export const WAKE_MAX_MIN = 24 * 60;
const REASON_MAX = 300;
export interface WakeEntry { chatId: string; at: number; reason: string; setAt: number }

export const wakeText = (reason: string): string =>
  `[sveglia app] Ti eri chiesto di riprendere ora: «${reason}». Controlla lo stato e continua il lavoro; se serve aspettare ancora, richiama agent_wake_later.`;

export interface WakeLaterDeps {
  file: string;
  chats(): ChatSummary[];
  /** an app line to the chat (ChatManager.send: a closed chat reopens) */
  send(chatId: string, text: string): Promise<unknown>;
  now?(): number;
}

export class WakeLater {
  private entries = new Map<string, WakeEntry>();
  constructor(private readonly d: WakeLaterDeps) {
    try {
      const saved = readLocal(d.file);
      if (Array.isArray(saved)) for (const e of saved as WakeEntry[]) {
        if (e && typeof e.chatId === 'string' && Number.isFinite(e.at) && typeof e.reason === 'string') this.entries.set(e.chatId, e);
      }
    } catch (e) { log.warn('chats', 'wake-later list unreadable', { cause: errText(e), hint: 'scheduled wake-ups are lost; the chats can schedule them again' }); }
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  private save(): void {
    try { writeLocal(this.d.file, [...this.entries.values()]); } catch (e) { log.warn('chats', 'wake-later list not saved', { cause: errText(e), hint: 'the next change retries' }); }
  }

  /** Schedules (or with minutes 0 cancels) the chat's wake-up. */
  set(chatId: string, minutes: number, reason: string): WakeEntry | null {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > WAKE_MAX_MIN) throw new Error(`minutes must be between 0 (cancel) and ${WAKE_MAX_MIN}.`);
    if (minutes === 0) { this.entries.delete(chatId); this.save(); return null; }
    const text = reason.replace(/\s+/g, ' ').trim();
    if (!text || text.length > REASON_MAX) throw new Error(`reason: what to check when you wake up, at most ${REASON_MAX} characters.`);
    const at = this.now();
    const e: WakeEntry = { chatId, at: at + Math.round(minutes * 60_000), reason: text, setAt: at };
    this.entries.set(chatId, e);
    this.save();
    return e;
  }

  list(): WakeEntry[] { return [...this.entries.values()]; }

  /** Sends what is due; drops the wake-ups of chats gone or closed by the user. Returns how many went. */
  tick(): number {
    const now = this.now(), chats = new Map(this.d.chats().map(c => [c.id, c]));
    let n = 0, changed = false;
    for (const e of [...this.entries.values()]) {
      const c = chats.get(e.chatId);
      if (!c || c.closedAt && c.closedBy === 'user') { this.entries.delete(e.chatId); changed = true; continue; }
      if (e.at > now) continue;
      this.entries.delete(e.chatId); changed = true; n++;
      log.info('chats', 'scheduled wake-up', { chat: e.chatId, data: { lateMs: now - e.at } });
      void this.d.send(e.chatId, wakeText(e.reason)).catch(err => log.warn('chats', 'scheduled wake-up not delivered', { chat: e.chatId, cause: errText(err), hint: 'open the chat and write to it' }));
    }
    if (changed) this.save();
    return n;
  }

  tool(): McpTool {
    return {
      name: 'agent_wake_later',
      description: 'Schedule your own next turn: in `minutes` (1-1440) the app writes to you «[sveglia app] <reason>» and you go on, even if your chat was closed or the app restarted. Use it when you wait for something nobody will tell you about (CI, a deploy, a review, a slow job) instead of stopping. One per chat: a new call replaces it; minutes 0 cancels it.',
      inputSchema: { type: 'object', required: ['minutes', 'reason'], additionalProperties: false, properties: {
        minutes: { type: 'number', minimum: 0, maximum: WAKE_MAX_MIN }, reason: { type: 'string', description: 'what to check when you wake up' },
      } },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => {
        const e = this.set(callerOf(ctx.params), Number(a.minutes), String(a.reason ?? ''));
        return e ? `Sveglia alle ${new Date(e.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}: ${e.reason}` : 'Sveglia annullata.';
      },
    };
  }
}
