// Sì/No buttons on the phone for simple questions and Strategist plans (design §5.4, §5.6, §6), and the check of every
// button press. callback_data is "a:<shortId>:<s|n>" (≤ 64 bytes); shortId is 16 random base64url characters (96 bits,
// unguessable) and is the one-time nonce: it maps, in memory only, to {chat, request id or plan `at`, the Telegram
// message_id it was sent on, used flag, createdAt}. A press counts only when: the presser is the paired id, the press
// comes from that very message, the nonce was never used, the entry is younger than 24 h and the request is still open
// and still simple and not reserved (read again from the PhonePort). The nonce is spent before the port is called, so a
// double tap or a replayed callback never answers twice. Every press gets answerCallbackQuery. After a phone answer the
// message becomes "✅ Sì · dal telefono HH:MM" (or ❌ No) without buttons; answered on the PC → "Risposta sul PC".
// Buttons only for simple && !reserved items whose whole text fits (a decision is never taken on a cut text); a question
// whose full text (with the options' descriptions) does not fit is sent in its short form (the question alone, with the
// fixed Sì / No buttons; #370). Everything else gets a no-button notice "⚠️ <role · label>: serve il PC".
// A typed «sì» / «no» also answers (#370, textAnswer): as a Telegram reply to the question's message, or right after it
// when it is the only open question and nothing else was sent or written since (the bridge passes lastSent = null after
// the user's own other message); any other text goes to the Orchestrator. A plan is approved only with its button.
// Permissions reach this module only when one of the user's brain rules sent them to him (phone-port.ts, ADR 0254).
// Used by bridge.ts; tests: test/unit/phone/buttons.test.ts.
import crypto from 'node:crypto';
import type { PhoneDecidable, PhonePort } from '../../shared/contract/phone';
import { yesNoOf } from '../../shared/yes-no';
import { condense, CONDENSE_MAX } from './condense';
import { filterOutgoing } from './filter';
import type { Outbound } from './outbound';
import type { InlineKeyboard, PhoneLog, TgCallbackQuery } from './types';

export const BUTTON_TTL_MS = 24 * 3600_000;
const DATA = /^([ab]):([A-Za-z0-9_-]{16}):([sn])$/;

export const newShortId = (): string => crypto.randomBytes(12).toString('base64url');
export const hhmm = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function parseCallbackData(data: unknown): { prefix: 'a' | 'b'; shortId: string; yes: boolean } | null {
  if (typeof data !== 'string' || Buffer.byteLength(data) > 64) return null;
  const m = DATA.exec(data);
  return m ? { prefix: m[1] as 'a' | 'b', shortId: m[2]!, yes: m[3] === 's' } : null;
}

export function yesNoKeyboard(prefix: 'a' | 'b', shortId: string, recommended?: 'yes' | 'no'): InlineKeyboard {
  return { inline_keyboard: [[
    { text: recommended === 'yes' ? 'Sì ⭐' : 'Sì', callback_data: `${prefix}:${shortId}:s` },
    { text: recommended === 'no' ? 'No ⭐' : 'No', callback_data: `${prefix}:${shortId}:n` },
  ]] };
}

export const refKey = (d: Pick<PhoneDecidable, 'chatId' | 'ref'>): string =>
  `${d.chatId}|${d.ref.kind === 'question' ? `q:${d.ref.requestId}` : `p:${d.ref.at}`}`;
const fits = (t: string): boolean => filterOutgoing(t).length <= CONDENSE_MAX;
/** The text the phone shows with buttons: the whole text, else the short form; null when neither fits uncut. */
export const buttonText = (d: Pick<PhoneDecidable, 'text' | 'short'>): string | null => fits(d.text) ? d.text : d.short && fits(d.short) ? d.short : null;
export const canUseButtons = (d: PhoneDecidable): boolean => d.simple === true && d.reserved !== true && buttonText(d) !== null;
/** Role and neutral label only: never the chat title. */
export const header = (d: Pick<PhoneDecidable, 'role' | 'neutralLabel'>): string => `${d.role} · ${d.neutralLabel}`;
export const noticeText = (d: PhoneDecidable): string => `⚠️ ${header(d)}: serve il PC`;
export const decidableText = (d: PhoneDecidable): string => `${d.ref.kind === 'plan' ? '📋 Piano' : '❓'} ${header(d)}\n${condense(buttonText(d) ?? d.text)}`;

interface Entry { shortId: string; key: string; item: PhoneDecidable; messageId: number | null; used: boolean; createdAt: number }

export type PressOutcome = 'ok' | 'already' | 'gone' | 'stale' | 'forged' | 'duplicate' | 'needs-pc' | 'error';

export interface Buttons {
  /** sends a decidable: buttons when simple and not reserved, else the "serve il PC" notice; once per request */
  offer(item: PhoneDecidable, opts?: { silent?: boolean }): Promise<'buttons' | 'notice' | 'skip'>;
  /** a button press (already through the guard); always answers the callback */
  press(cb: TgCallbackQuery, pairedId: number): Promise<PressOutcome>;
  /** a typed message: a bare «sì» / «no» that answers an offered question (see the header); null = not an answer */
  textAnswer(m: { text: string; replyTo?: number }, lastSent: number | null): Promise<PressOutcome | null>;
  /** the request was answered elsewhere (or by the phone, already shown) */
  resolved(item: Pick<PhoneDecidable, 'chatId' | 'ref'>, by?: 'phone' | 'pc'): Promise<void>;
  isOffered(item: Pick<PhoneDecidable, 'chatId' | 'ref'>): boolean;
  clear(): void;
}

export function createButtons(o: { now: () => number; port: PhonePort; out: Outbound; log: PhoneLog; ttlMs?: number }): Buttons {
  const ttl = o.ttlMs ?? BUTTON_TTL_MS;
  const byId = new Map<string, Entry>();
  const byKey = new Map<string, Entry>();
  const forget = (e: Entry) => { byId.delete(e.shortId); if (byKey.get(e.key) === e) byKey.delete(e.key); };

  /** the decision of one spent entry (a press or a typed «sì»/«no»), checked again on the live request */
  async function decideEntry(e: Entry, yes: boolean, answer: (text: string) => Promise<void>): Promise<PressOutcome> {
    const head = header(e.item);
    const messageId = e.messageId!;
    const current = o.port.listDecidable().find(d => refKey(d) === e.key);
    if (!current) { forget(e); await answer('Scaduta'); await o.out.edit(messageId, `${head}\nScaduta`); return 'gone'; }
    if (!canUseButtons(current)) { forget(e); await answer('Serve il PC'); await o.out.edit(messageId, `⚠️ ${head}: serve il PC`); return 'needs-pc'; }
    let result: 'ok' | 'already' | 'gone';
    try {
      result = current.ref.kind === 'question'
        ? await o.port.answerFromPhone(current.chatId, current.ref.requestId, yes)
        : await o.port.decidePlanFromPhone(current.chatId, current.ref.at, yes);
    } catch (err) {
      o.log.warn('phone', 'phone answer failed', { data: { kind: current.ref.kind, error: err instanceof Error ? err.name : 'error' } });
      forget(e);
      await answer('Errore: rispondi dal PC');
      return 'error';
    }
    forget(e);
    if (result === 'ok') {
      await answer(yes ? 'Sì' : 'No');
      await o.out.edit(messageId, `${head}\n${yes ? '✅ Sì' : '❌ No'} · dal telefono ${hhmm(o.now())}`);
      return 'ok';
    }
    if (result === 'already') { await answer('Già risposta'); await o.out.edit(messageId, `${head}\nRisposta sul PC`); return 'already'; }
    await answer('Scaduta');
    await o.out.edit(messageId, `${head}\nScaduta`);
    return 'gone';
  }

  return {
    isOffered: item => byKey.has(refKey(item)),
    async offer(item, opts = {}) {
      const key = refKey(item);
      if (byKey.has(key)) return 'skip';
      if (!canUseButtons(item)) {
        // remembered too, so the notice is sent once; no shortId reaches Telegram
        const e: Entry = { shortId: newShortId(), key, item, messageId: null, used: true, createdAt: o.now() };
        byKey.set(key, e);
        e.messageId = await o.out.send(noticeText(item), { silent: opts.silent });
        return 'notice';
      }
      const e: Entry = { shortId: newShortId(), key, item, messageId: null, used: false, createdAt: o.now() };
      byKey.set(key, e);
      const id = await o.out.send(decidableText(item), { silent: opts.silent, keyboard: yesNoKeyboard('a', e.shortId, item.recommended) });
      if (id === null) { byKey.delete(key); return 'skip'; }
      e.messageId = id;
      byId.set(e.shortId, e);
      return 'buttons';
    },
    async press(cb, pairedId) {
      const answer = (text: string) => o.out.answerCallback(cb.id, text);
      const p = parseCallbackData(cb.data);
      const e = p && p.prefix === 'a' ? byId.get(p.shortId) : undefined;
      if (!p || !e) { await answer('Scaduta'); return 'stale'; }
      if (!cb.from || cb.from.id !== pairedId || cb.message?.chat?.id !== pairedId) return 'forged';
      if (e.messageId === null || cb.message?.message_id !== e.messageId) { await answer('Scaduta'); return 'forged'; }
      if (e.used) { await answer('Già risposta'); return 'duplicate'; }
      if (o.now() - e.createdAt > ttl) { e.used = true; forget(e); await answer('Scaduta'); return 'stale'; }
      e.used = true; // spent before anything else: a second press, even concurrent, is a duplicate
      return decideEntry(e, p.yes, answer);
    },
    async textAnswer(m, lastSent) {
      const said = yesNoOf(m.text);
      if (!said) return null;
      // questions only (a brain-rule permission too, as its button); a plan is approved only with its button
      const open = [...byId.values()].filter(x => !x.used && x.messageId !== null && x.item.ref.kind === 'question');
      // a reply names its message; without one, only the single open question that is the last thing sent
      const e = m.replyTo !== undefined ? open.find(x => x.messageId === m.replyTo)
        : open.length === 1 && open[0]!.messageId === lastSent ? open[0] : undefined;
      if (!e) return null;
      if (o.now() - e.createdAt > ttl) { e.used = true; forget(e); return null; }
      e.used = true;
      // no callback to answer: the question's message is edited; only a failure gets a short line of its own
      return decideEntry(e, said === 'yes', async t => { if (t !== 'Sì' && t !== 'No') await o.out.send(t, { silent: true }); });
    },
    async resolved(item, by) {
      const e = byKey.get(refKey(item));
      if (!e) return;
      e.used = true;
      forget(e);
      if (by === 'phone' || e.messageId === null) return;
      await o.out.edit(e.messageId, `${header(e.item)}\nRisposta sul PC`);
    },
    clear() { byId.clear(); byKey.clear(); },
  };
}
