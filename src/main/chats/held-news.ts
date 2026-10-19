// "N novità in attesa" (#88): what the app holds back for the Orchestrators, gathered for the user. The delivery rule
// (regia-delivery.ts) holds a work chat's news (regia-wake.ts) and mail to a Regia (mail.ts) while the Regia waits for
// the user, groups it for REGIA_GROUP_MS, or lets quiet news ride along with the next delivery; to the user that looked
// like "news arrives only when I write" (2026-10-19). This module only reads both queues and tells the page
// ('heldNews:get', 'heldNews:changed'): it never delivers, never wakes a Regia, spends no token and changes no rule.
// Each source calls back when its queue may have changed; the page is told only when the list really changed.
// Used by wiring.ts / demo-wiring.ts (attachHeldNews), read by the Orchestrator's tile (renderer HeldNews.tsx);
// pinned by test/unit/chats/held-news.test.ts.
import type { EventMap, HeldNewsItem, HeldNewsState } from '../../shared/contract';
import { errText, log } from '../log';

/** A queue that holds news for a Regia: RegiaWake (heldNews) or ChatMail (heldMail). */
export interface HeldSource { list(): HeldNewsItem[]; onChange(fn: () => void): void }

export class HeldNewsHub {
  private state: HeldNewsState = { items: [] };
  private key = '[]';

  constructor(private readonly sources: HeldSource[], private readonly emit: (state: HeldNewsState) => void) {
    for (const s of sources) s.onChange(() => this.refresh());
  }

  /** The list now ('heldNews:get'): oldest first. */
  get(): HeldNewsState { return this.state; }

  /** Reads the sources again; tells the page when the list changed. */
  refresh(): void {
    const items: HeldNewsItem[] = [];
    for (const s of this.sources) {
      try { items.push(...s.list()); } catch (e) { log.warn('chats', 'held news not read', { cause: errText(e), hint: 'the count on the Orchestrator may be stale; delivery is not affected' }); }
    }
    items.sort((a, b) => a.at - b.at);
    const key = JSON.stringify(items);
    if (key === this.key) return;
    this.key = key;
    this.state = { items };
    this.emit(this.state);
  }
}

/** The wiring: the news of RegiaWake and, when there is one, ChatMail's held mail, sent as 'heldNews:changed'. */
export function attachHeldNews(
  emitter: { emit<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void },
  wake: { heldNews(): HeldNewsItem[]; onHeldChange(fn: () => void): void },
  mail?: { heldMail(): HeldNewsItem[]; onHeldChange(fn: () => void): void },
): HeldNewsHub {
  const sources: HeldSource[] = [{ list: () => wake.heldNews(), onChange: fn => wake.onHeldChange(fn) }];
  if (mail) sources.push({ list: () => mail.heldMail(), onChange: fn => mail.onHeldChange(fn) });
  return new HeldNewsHub(sources, state => emitter.emit('heldNews:changed', state));
}
