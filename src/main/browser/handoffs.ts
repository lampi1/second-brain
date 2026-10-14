// Human hand-off: an agent asks the user to act in a tab (login, MFA, CAPTCHA) through the handoff_to_user tool; the app
// shows a banner (event browser:handoff) until they click Fatto or Non riesco (invoke browser:handoffResolve). The tool
// waits (with progress notifications, see mcp/server.ts) and can be called again to keep waiting. When the user answers
// and no tool call takes the outcome (the agent ended its turn), service.ts wakes the chat with a message (delivered()).
// Pure (no Electron), unit-tested; used by browser/tabs.ts, browser/tools.ts and browser/service.ts.
import type { BrowserHandoff, HandoffAccount } from '../../shared/contract';

export class Handoffs {
  private readonly items = new Map<string, BrowserHandoff>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly given = new Set<string>();   // outcomes an agent's tool call has returned
  private readonly polls = new Map<string, number>();   // last "still waiting" answer given to the agent
  private seq = 0;

  constructor(private readonly onChange: (h: BrowserHandoff) => void, private readonly now: () => number = Date.now) {}

  /** Opens a hand-off on a tab, or returns the one already open there. */
  open(p: { tabId: string; chatId: string | null; reason: string; instructions: string; url: string; env?: string; kind?: 'login' | 'other'; account?: HandoffAccount }): BrowserHandoff {
    const existing = this.openFor(p.tabId);
    if (existing) return existing;
    const h: BrowserHandoff = { id: `h${++this.seq}`, ...p, state: 'open', at: this.now() };
    this.items.set(h.id, h);
    this.onChange({ ...h });
    return h;
  }

  get(id: string): BrowserHandoff | undefined { return this.items.get(id); }
  openFor(tabId: string): BrowserHandoff | undefined { return [...this.items.values()].find(h => h.tabId === tabId && h.state === 'open'); }
  list(): BrowserHandoff[] { return [...this.items.values()].filter(h => h.state === 'open').map(h => ({ ...h })); }

  resolve(id: string, outcome: 'done' | 'failed' | 'cancelled', note?: string): BrowserHandoff {
    const h = this.items.get(id);
    if (!h) throw new Error(`No hand-off ${id}`);
    if (h.state !== 'open') return h;
    h.state = outcome;
    h.resolvedAt = this.now();
    if (note) h.note = note.slice(0, 1000);
    this.onChange({ ...h });
    for (const w of this.waiters.get(id) ?? []) w();
    this.waiters.delete(id);
    return h;
  }

  /** A tool call returned this hand-off's outcome to its agent (no wake-up message needed). */
  delivered(id: string): void { this.given.add(id); }
  wasDelivered(id: string): boolean { return this.given.has(id); }
  /** The agent got "still waiting" now: it will likely call again after its turn (no wake-up message meanwhile). */
  polled(id: string): void { this.polls.set(id, this.now()); }
  lastPoll(id: string): number | undefined { return this.polls.get(id); }

  cancelTab(tabId: string): void { for (const h of this.items.values()) if (h.tabId === tabId && h.state === 'open') this.resolve(h.id, 'cancelled'); }
  cancelAll(): void { for (const h of this.items.values()) if (h.state === 'open') this.resolve(h.id, 'cancelled'); }

  /** Resolves with the hand-off once it is no longer open, or after ms / on abort (still open). */
  wait(id: string, ms: number, signal?: AbortSignal): Promise<BrowserHandoff> {
    const h = this.items.get(id);
    if (!h) return Promise.reject(new Error(`No hand-off ${id}: call handoff_to_user without handoff_id to open one.`));
    if (h.state !== 'open') return Promise.resolve(h);
    return new Promise(resolve => {
      const set = this.waiters.get(id) ?? new Set<() => void>();
      this.waiters.set(id, set);
      const done = () => { clearTimeout(timer); set.delete(done); signal?.removeEventListener('abort', done); resolve(h); };
      const timer = setTimeout(done, ms);
      set.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
