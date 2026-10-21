// "N novità in attesa" (#88): what the app holds back for the Orchestrators, gathered for the user. The delivery rule
// (orchestrator-delivery.ts) holds a work chat's news (orchestrator-wake.ts) and mail to an Orchestrator (mail.ts) while the Orchestrator waits for
// the user, groups it for ORCHESTRATOR_GROUP_MS, or lets quiet news ride along with the next delivery; to the user that looked
// like "news arrives only when I write" (2026-10-19). This module only reads both queues and tells the page
// ('orchestrator:held', 'orchestrator:heldChanged'): it never delivers, never wakes an Orchestrator, spends no token and changes no rule.
// Each source calls back when its queue may have changed; the page is told only when the list really changed.
// Read (#123, owner 2026-10-21: «nelle novità clicco e mi porta alla chat … poi non fosse più in attesa»): a row the user
// opened is read: its chat's items leave the list, and a source that can (OrchestratorWake) keeps them only as quiet news
// that never wakes the Orchestrator. Mail still reaches it (it is a message for it), only out of the list.
// Used by wiring.ts / demo-wiring.ts (attachHeldNews), read by the Orchestrator's tile (renderer HeldNews.tsx);
// pinned by test/unit/chats/held-news.test.ts.
import type { EventMap, HeldNewsItem, HeldNewsState } from '../../shared/contract';
import { errText, log } from '../log';

/** A queue that holds news for an Orchestrator: OrchestratorWake (heldNews) or ChatMail (heldMail). */
export interface HeldSource { list(): HeldNewsItem[]; onChange(fn: () => void): void; /** the user read this chat's news */ seen?(chatId: string): void }
const keyOf = (i: HeldNewsItem): string => `${i.orchestratorId}|${i.kind}|${i.chatId ?? ''}|${i.at}`;

export class HeldNewsHub {
  private state: HeldNewsState = { items: [] };
  private key = '[]';
  /** items the user opened (keyOf): out of the list while their source still holds them */
  private read = new Set<string>();

  constructor(private readonly sources: HeldSource[], private readonly emit: (state: HeldNewsState) => void) {
    for (const s of sources) s.onChange(() => this.refresh());
  }

  /** The list now ('orchestrator:held'): oldest first. */
  get(): HeldNewsState { return this.state; }

  /** The user opened this chat from the list: its news is read (out of the list, never a wake). */
  seen(chatId: string): HeldNewsState {
    const all: HeldNewsItem[] = [];
    for (const s of this.sources) {
      try { all.push(...s.list()); s.seen?.(chatId); } catch (e) { log.warn('chats', 'held news not marked read', { chat: chatId, cause: errText(e), hint: 'the item may stay in the list; delivery is not affected' }); }
    }
    for (const i of all) if (i.chatId === chatId) this.read.add(keyOf(i));
    this.refresh();
    return this.state;
  }

  /** Reads the sources again; tells the page when the list changed. */
  refresh(): void {
    const all: HeldNewsItem[] = [];
    for (const s of this.sources) {
      try { all.push(...s.list()); } catch (e) { log.warn('chats', 'held news not read', { cause: errText(e), hint: 'the count on the Orchestrator may be stale; delivery is not affected' }); }
    }
    // a read item that left its source is forgotten: the set never outgrows what is held
    const keys = new Set(all.map(keyOf));
    for (const k of this.read) if (!keys.has(k)) this.read.delete(k);
    const items = all.filter(i => !this.read.has(keyOf(i)));
    items.sort((a, b) => a.at - b.at);
    const key = JSON.stringify(items);
    if (key === this.key) return;
    this.key = key;
    this.state = { items };
    this.emit(this.state);
  }
}

/** The wiring: the news of OrchestratorWake and, when there is one, ChatMail's held mail, sent as 'orchestrator:heldChanged'. */
export function attachHeldNews(
  emitter: { emit<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void },
  wake: { heldNews(): HeldNewsItem[]; onHeldChange(fn: () => void): void; seen?(chatId: string): void },
  mail?: { heldMail(): HeldNewsItem[]; onHeldChange(fn: () => void): void },
): HeldNewsHub {
  const sources: HeldSource[] = [{ list: () => wake.heldNews(), onChange: fn => wake.onHeldChange(fn), seen: id => wake.seen?.(id) }];
  if (mail) sources.push({ list: () => mail.heldMail(), onChange: fn => mail.onHeldChange(fn) });
  return new HeldNewsHub(sources, state => emitter.emit('orchestrator:heldChanged', state));
}
