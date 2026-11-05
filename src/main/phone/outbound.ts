// The only way the bridge writes to the phone: every outgoing text and every button label passes filterOutgoing
// (filter.ts) here, so no caller can send an unfiltered text (design §9: one filter on every outgoing text). It also
// fixes the destination to the paired chat (no other chat id can be passed) and turns API failures into a logged
// warning, so a failed send never breaks the polling loop. answerCallbackQuery texts are fixed short strings, filtered too.
// Used by bridge.ts, buttons.ts, backlog.ts, voice.ts, commands.ts; tests: test/unit/phone/bridge.test.ts.
import type { TelegramClient } from './client';
import { filterOutgoing } from './filter';
import type { InlineKeyboard, PhoneLog } from './types';

export interface Outbound {
  /** sends to the paired chat; returns the Telegram message_id, or null when not paired or the send failed */
  send(text: string, opts?: { silent?: boolean; keyboard?: InlineKeyboard }): Promise<number | null>;
  /** replaces a sent message's text and buttons (none = buttons removed) */
  edit(messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
}

const filterKeyboard = (k: InlineKeyboard): InlineKeyboard => ({
  inline_keyboard: k.inline_keyboard.map(row => row.map(b => ({ text: filterOutgoing(b.text), callback_data: b.callback_data }))),
});

export function createOutbound(client: () => TelegramClient | null, chatId: () => number | null, log: PhoneLog): Outbound {
  const warn = (method: string, e: unknown) => log.warn('phone', 'telegram send failed', { data: { method, code: (e as { code?: unknown }).code ?? 'error' } });
  return {
    async send(text, opts = {}) {
      const c = client(), to = chatId();
      const body = filterOutgoing(text);
      if (!c || to === null || !body) return null;
      try {
        const m = await c.sendMessage(to, body, { silent: opts.silent, replyMarkup: opts.keyboard ? filterKeyboard(opts.keyboard) : undefined });
        return m.message_id;
      } catch (e) { warn('sendMessage', e); return null; }
    },
    async edit(messageId, text, keyboard) {
      const c = client(), to = chatId();
      const body = filterOutgoing(text);
      if (!c || to === null || !body) return;
      try { await c.editMessageText(to, messageId, body, keyboard ? filterKeyboard(keyboard) : undefined); } catch (e) { warn('editMessageText', e); }
    },
    async answerCallback(callbackId, text) {
      const c = client();
      if (!c) return;
      try { await c.answerCallbackQuery(callbackId, text ? filterOutgoing(text) : undefined); } catch (e) { warn('answerCallbackQuery', e); }
    },
  };
}
