// The only way the bridge writes to the phone: every outgoing text and every button label passes filterOutgoing
// (filter.ts) here, so no caller can send an unfiltered text (design §9: one filter on every outgoing text). It also
// fixes the destination to the paired chat (no other chat id can be passed) and turns API failures into a logged
// warning, so a failed send never breaks the polling loop. answerCallbackQuery texts are fixed short strings, filtered too.
// Used by bridge.ts, buttons.ts, backlog.ts, voice.ts, commands.ts; tests: test/unit/phone/outbound.test.ts.
import { TelegramError, type TelegramClient } from './client';
import { filterOutgoing } from './filter';
import type { InlineKeyboard, PhoneLog } from './types';

export interface Outbound {
  /** sends to the paired chat; returns the Telegram message_id, or null when not paired or the send failed */
  send(text: string, opts?: { silent?: boolean; keyboard?: InlineKeyboard }): Promise<number | null>;
  /** like send, but says whether a failure is certain: 'refused' = not sent (not paired, nothing to send, or Telegram
   *  answered with an error); null = unknown (the network failed, the message may have arrived) */
  sendOutcome(text: string, opts?: { silent?: boolean }): Promise<number | 'refused' | null>;
  /** replaces a sent message's text and buttons (none = buttons removed); true only when Telegram confirmed it */
  edit(messageId: number, text: string, keyboard?: InlineKeyboard): Promise<boolean>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** the message_id of the last message sent, or null (buttons.ts: a typed «sì» right after a question answers it) */
  lastSent(): number | null;
}

const filterKeyboard = (k: InlineKeyboard): InlineKeyboard => ({
  inline_keyboard: k.inline_keyboard.map(row => row.map(b => ({ text: filterOutgoing(b.text), callback_data: b.callback_data }))),
});

export function createOutbound(client: () => TelegramClient | null, chatId: () => number | null, log: PhoneLog): Outbound {
  let last: number | null = null;
  const warn = (method: string, e: unknown) => log.warn('phone', 'telegram send failed', { data: { method, code: (e as { code?: unknown }).code ?? 'error' } });
  return {
    async send(text, opts = {}) {
      const c = client(), to = chatId();
      const body = filterOutgoing(text);
      if (!c || to === null || !body) return null;
      try {
        const m = await c.sendMessage(to, body, { silent: opts.silent, replyMarkup: opts.keyboard ? filterKeyboard(opts.keyboard) : undefined });
        last = m.message_id;
        return m.message_id;
      } catch (e) { last = null; warn('sendMessage', e); return null; }
    },
    async sendOutcome(text, opts = {}) {
      const c = client(), to = chatId();
      const body = filterOutgoing(text);
      if (!c || to === null || !body) return 'refused';
      try { last = (await c.sendMessage(to, body, { silent: opts.silent })).message_id; return last; } catch (e) {
        warn('sendMessage', e);
        last = null; // it may have arrived: what was last on the phone is not known
        // Telegram answered 4xx: certainly not sent; 5xx or a proxy's error page: it may have arrived (unknown)
        return e instanceof TelegramError && typeof e.code === 'number' && e.code >= 400 && e.code < 500 ? 'refused' : null;
      }
    },
    async edit(messageId, text, keyboard) {
      const c = client(), to = chatId();
      const body = filterOutgoing(text);
      if (!c || to === null || !body) return false;
      try { await c.editMessageText(to, messageId, body, keyboard ? filterKeyboard(keyboard) : undefined); return true; } catch (e) {
        // the phone already shows this text (a correction past the condensed length): nothing to change, so done
        if (e instanceof TelegramError && e.code === 400 && /message is not modified/i.test(e.message)) return true;
        warn('editMessageText', e); return false;
      }
    },
    lastSent: () => last,
    async answerCallback(callbackId, text) {
      const c = client();
      if (!c) return;
      try { await c.answerCallbackQuery(callbackId, text ? filterOutgoing(text) : undefined); } catch (e) { warn('answerCallbackQuery', e); }
    },
  };
}
