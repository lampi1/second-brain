// Messages that reached Telegram while the app was closed (design §10): never run by themselves. Each one older than the
// bridge's start is asked back with Sì/No ("📨 Ricevuto alle HH:MM: «…», lo mando?"); only a Sì press on that very
// message runs it (as a fresh phone message), once. The original text stays in memory only, never in the state file;
// the echo shown on the phone is filtered and condensed. Buttons are "b:<shortId>:<s|n>", checked like buttons.ts
// (paired id, same message_id, one-time nonce, 24 h). Also the clean start/stop notices.
// Used by bridge.ts; tests: test/unit/phone/backlog.test.ts.
import { hhmm, newShortId, parseCallbackData, yesNoKeyboard } from './buttons';
import { condense } from './condense';
import type { Outbound } from './outbound';
import type { TgCallbackQuery, TgMessage, TgVoice } from './types';

export const START_NOTICE = '🟢 PC collegato';
export const STOP_NOTICE = '🔴 App chiusa';
const TTL_MS = 24 * 3600_000;

export type BacklogPayload = { kind: 'text'; text: string } | { kind: 'voice'; voice: TgVoice };

interface Item { shortId: string; payload: BacklogPayload; messageId: number | null; used: boolean; createdAt: number }

export const isBacklog = (m: TgMessage, startedAt: number): boolean => m.date * 1000 < startedAt;

export interface Backlog {
  ask(m: TgMessage): Promise<void>;
  /** a "b:" press: the payload to run on Sì, null otherwise (always answers the callback) */
  press(cb: TgCallbackQuery, pairedId: number): Promise<{ outcome: 'run' | 'discarded' | 'stale' | 'duplicate' | 'forged'; payload?: BacklogPayload }>;
  clear(): void;
}

export function createBacklog(o: { out: Outbound; now: () => number }): Backlog {
  const items = new Map<string, Item>();
  return {
    async ask(m) {
      const payload: BacklogPayload | null = typeof m.text === 'string' && m.text.trim()
        ? { kind: 'text', text: m.text }
        : m.voice ?? m.audio ? { kind: 'voice', voice: (m.voice ?? m.audio)! } : null;
      if (!payload) return;
      const at = hhmm(m.date * 1000);
      const shortId = newShortId();
      const body = payload.kind === 'text'
        ? `📨 Ricevuto alle ${at}: «${condense(payload.text, 200)}», lo mando?`
        : `📨 Vocale ricevuto alle ${at}, lo mando?`;
      const item: Item = { shortId, payload, messageId: null, used: false, createdAt: o.now() };
      items.set(shortId, item);
      item.messageId = await o.out.send(body, { silent: true, keyboard: yesNoKeyboard('b', shortId) });
      if (item.messageId === null) items.delete(shortId);
    },
    async press(cb, pairedId) {
      const p = parseCallbackData(cb.data);
      const it = p && p.prefix === 'b' ? items.get(p.shortId) : undefined;
      if (!p || !it) { await o.out.answerCallback(cb.id, 'Scaduta'); return { outcome: 'stale' }; }
      if (cb.from?.id !== pairedId || cb.message?.chat?.id !== pairedId) return { outcome: 'forged' };
      if (cb.message?.message_id !== it.messageId) { await o.out.answerCallback(cb.id, 'Scaduta'); return { outcome: 'forged' }; }
      if (it.used) { await o.out.answerCallback(cb.id, 'Già risposta'); return { outcome: 'duplicate' }; }
      it.used = true;
      items.delete(it.shortId);
      if (o.now() - it.createdAt > TTL_MS) { await o.out.answerCallback(cb.id, 'Scaduta'); return { outcome: 'stale' }; }
      await o.out.answerCallback(cb.id, p.yes ? 'Mandato' : 'Scartato');
      await o.out.edit(it.messageId!, p.yes ? '📨 Mandato all\'Orchestrator' : '🗑️ Scartato');
      return p.yes ? { outcome: 'run', payload: it.payload } : { outcome: 'discarded' };
    },
    clear() { items.clear(); },
  };
}
