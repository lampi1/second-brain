// Button presses and the backlog of the phone bridge: forged, stale, duplicate and replayed callbacks, a wrong
// message_id, an unknown or malformed callback_data, a request already closed or answered on the PC, a request that
// became reserved, permissions/non-simple requests getting only the "serve il PC" notice, the edit after the answer;
// backlog messages asked back and run only on a Sì press, once.
import { describe, expect, it } from 'vitest';
import { createBacklog } from '../../../src/main/phone/backlog';
import { createButtons, parseCallbackData } from '../../../src/main/phone/buttons';
import type { Outbound } from '../../../src/main/phone/outbound';
import type { InlineKeyboard, TgCallbackQuery } from '../../../src/main/phone/types';
import { capLog, fakePort, FX, ME, question } from './fakes';

interface Sent { id: number; text: string; keyboard?: InlineKeyboard; silent?: boolean }
function fakeOut() {
  const sent: Sent[] = [], edits: { id: number; text: string }[] = [], answers: { id: string; text?: string }[] = [];
  let next = 1;
  const out: Outbound = {
    async send(text, o = {}) { const id = next++; sent.push({ id, text, keyboard: o.keyboard, silent: o.silent }); return id; },
    async sendOutcome(text, o = {}) { const id = next++; sent.push({ id, text, silent: o.silent }); return id; },
    async edit(id, text) { edits.push({ id, text }); return true; },
    async answerCallback(id, text) { answers.push({ id, text }); },
    lastSent: () => sent.at(-1)?.id ?? null,
  };
  return { out, sent, edits, answers };
}
const cb = (data: string, messageId: number, from = ME, chat = ME): TgCallbackQuery => ({ id: `q${Math.random()}`, from: { id: from }, data, message: { message_id: messageId, date: 0, chat: { id: chat, type: 'private' } } });
const dataOf = (s: Sent, yes = true) => s.keyboard!.inline_keyboard[0]![yes ? 0 : 1]!.callback_data;

function setup() {
  let t = 1_000;
  const port = fakePort();
  const o = fakeOut();
  const b = createButtons({ now: () => t, port, out: o.out, log: capLog() });
  return { port, ...o, b, advance: (ms: number) => { t += ms; } };
}

describe('buttons', () => {
  it('a simple question gets Sì ⭐ / No; the press answers once and edits the message', async () => {
    const { port, sent, edits, b } = setup();
    const q = question(); port.open = [q];
    expect(await b.offer(q)).toBe('buttons');
    const msg = sent[0]!;
    expect(msg.text).toBe('❓ Artisan · lavoro 3\nFaccio il commit sul branch?');
    expect(msg.keyboard!.inline_keyboard[0]!.map(x => x.text)).toEqual(['Sì ⭐', 'No']);
    expect(Buffer.byteLength(dataOf(msg))).toBeLessThanOrEqual(64);
    expect(await b.press(cb(dataOf(msg), msg.id), ME)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: 'r1', yes: true }]);
    expect(edits[0]!.text).toMatch(/^Artisan · lavoro 3\n✅ Sì · dal telefono \d\d:\d\d$/);
  });

  it('a duplicate or replayed press has no effect', async () => {
    const { port, sent, answers, b } = setup();
    port.open = [question()];
    await b.offer(question());
    const msg = sent[0]!;
    const [r1, r2] = await Promise.all([b.press(cb(dataOf(msg), msg.id), ME), b.press(cb(dataOf(msg, false), msg.id), ME)]);
    expect(r1).toBe('ok');
    expect(['duplicate', 'stale']).toContain(r2);
    expect(port.answers).toHaveLength(1);
    expect(await b.press(cb(dataOf(msg), msg.id), ME)).toBe('stale');
    expect(port.answers).toHaveLength(1);
    expect(answers.length).toBeGreaterThanOrEqual(3);
  });

  it('forged: another account, another chat, a wrong message_id, an unknown or malformed data', async () => {
    const { port, sent, b } = setup();
    port.open = [question()];
    await b.offer(question());
    const msg = sent[0]!;
    expect(await b.press(cb(dataOf(msg), msg.id, 999), ME)).toBe('forged');
    expect(await b.press(cb(dataOf(msg), msg.id, ME, 999), ME)).toBe('forged');
    expect(await b.press(cb(dataOf(msg), msg.id + 1), ME)).toBe('forged');
    expect(await b.press(cb('a:AAAAAAAAAAAAAAAA:s', msg.id), ME)).toBe('stale');
    expect(await b.press(cb('a:short:s', msg.id), ME)).toBe('stale');
    expect(await b.press(cb(`${dataOf(msg)}x`, msg.id), ME)).toBe('stale');
    expect(port.answers).toHaveLength(0);
    // the genuine press still works after the forgeries
    expect(await b.press(cb(dataOf(msg), msg.id), ME)).toBe('ok');
  });

  it('stale: older than 24 h, or the request closed meanwhile', async () => {
    const s = setup();
    s.port.open = [question()];
    await s.b.offer(question());
    s.advance(24 * 3600_000 + 1);
    expect(await s.b.press(cb(dataOf(s.sent[0]!), s.sent[0]!.id), ME)).toBe('stale');
    const s2 = setup();
    s2.port.open = [question()];
    await s2.b.offer(question());
    s2.port.open = [];
    expect(await s2.b.press(cb(dataOf(s2.sent[0]!), s2.sent[0]!.id), ME)).toBe('gone');
    expect(s2.port.answers).toHaveLength(0);
  });

  it('a request that became reserved or not simple is not answered', async () => {
    const { port, sent, b } = setup();
    port.open = [question()];
    await b.offer(question());
    port.open = [question({ reserved: true })];
    expect(await b.press(cb(dataOf(sent[0]!), sent[0]!.id), ME)).toBe('needs-pc');
    expect(port.answers).toHaveLength(0);
  });

  it('reserved, non-simple items get a notice without buttons, once', async () => {
    const { sent, b } = setup();
    expect(await b.offer(question({ reserved: true, text: 'Faccio il push su main?' }))).toBe('notice');
    expect(await b.offer(question({ reserved: true }))).toBe('skip');
    expect(await b.offer(question({ ref: { kind: 'question', requestId: 'r2' }, simple: false }))).toBe('notice');
    expect(sent.map(s => s.text)).toEqual(['⚠️ Artisan · lavoro 3: serve il PC', '⚠️ Artisan · lavoro 3: serve il PC']);
    expect(sent.every(s => !s.keyboard)).toBe(true);
  });

  it('answered on the PC: "Risposta sul PC" and the button is dead; port says already → no effect', async () => {
    const { port, sent, edits, b } = setup();
    port.open = [question()];
    await b.offer(question());
    await b.resolved(question(), 'pc');
    expect(edits[0]!.text).toBe('Artisan · lavoro 3\nRisposta sul PC');
    expect(await b.press(cb(dataOf(sent[0]!), sent[0]!.id), ME)).toBe('stale');
    const s = setup();
    s.port.open = [question()]; s.port.result = 'already';
    await s.b.offer(question());
    expect(await s.b.press(cb(dataOf(s.sent[0]!), s.sent[0]!.id), ME)).toBe('already');
  });

  it('plans use decidePlanFromPhone with their `at`', async () => {
    const { port, sent, b } = setup();
    const plan = question({ ref: { kind: 'plan', at: '2026-11-05T10:00:00Z' }, role: 'Strategist', text: 'Piano in 3 passi' });
    port.open = [plan];
    await b.offer(plan);
    expect(sent[0]!.text.startsWith('📋 Piano Strategist · lavoro 3')).toBe(true);
    expect(await b.press(cb(dataOf(sent[0]!, false), sent[0]!.id), ME)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: '2026-11-05T10:00:00Z', yes: false }]);
  });

  it('question text is filtered', async () => {
    const { sent, b } = setup();
    await b.offer(question({ text: `Mando la mail a ${FX.mail} con \`git push\`?` }));
    expect(sent[0]!.text).not.toContain(FX.mail);
    expect(sent[0]!.text).not.toContain('git push');
  });

  it('parseCallbackData refuses anything over 64 bytes or off-format', () => {
    expect(parseCallbackData('a:AAAAAAAAAAAAAAAA:s')).toEqual({ prefix: 'a', shortId: 'AAAAAAAAAAAAAAAA', yes: true });
    expect(parseCallbackData('c:AAAAAAAAAAAAAAAA:s')).toBeNull();
    expect(parseCallbackData(`a:${'A'.repeat(70)}:s`)).toBeNull();
    expect(parseCallbackData(undefined)).toBeNull();
  });
});

describe('phone answers to worker Sì/No questions (#370)', () => {
  const long = (o = {}) => question({ text: `Faccio il commit sul branch?\nSì (consigliato): ${'tutti i file cambiati vanno nel commit locale. '.repeat(15)}\nNo: lascio i file come sono.`, short: 'Faccio il commit sul branch?', ...o });

  it('a question too long for the phone gets its short form with fixed Sì / No buttons, never a cut text', async () => {
    const { port, sent, b } = setup();
    const q = long(); port.open = [q];
    expect(await b.offer(q)).toBe('buttons');
    expect(sent[0]!.text).toBe('❓ Artisan · lavoro 3\nFaccio il commit sul branch?');
    expect(sent[0]!.keyboard!.inline_keyboard[0]!.map(x => x.text)).toEqual(['Sì ⭐', 'No']);
    expect(await b.press(cb(dataOf(sent[0]!), sent[0]!.id), ME)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: 'r1', yes: true }]);
  });

  it('a long question without a short form still needs the PC', async () => {
    const { port, sent, b } = setup();
    const q = long({ short: undefined }); port.open = [q];
    expect(await b.offer(q)).toBe('notice');
    expect(sent[0]!.keyboard).toBeUndefined();
  });

  it('a typed «sì» in reply to the question answers that request id, once', async () => {
    const { port, sent, edits, b } = setup();
    const q = question(); port.open = [q];
    await b.offer(q);
    const id = sent[0]!.id;
    expect(await b.textAnswer({ text: 'Sì', replyTo: id }, 99)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: 'r1', yes: true }]);
    expect(edits[0]!.text).toMatch(/✅ Sì · dal telefono/);
    // a second answer, typed or pressed, is ignored
    expect(await b.textAnswer({ text: 'no', replyTo: id }, 99)).toBeNull();
    expect(await b.press(cb(dataOf(sent[0]!, false), id), ME)).toBe('stale');
    expect(port.answers).toHaveLength(1);
  });

  it('a bare «no» right after the only open question answers it; otherwise it is not an answer', async () => {
    const { port, sent, b } = setup();
    const q = question(); port.open = [q];
    await b.offer(q);
    const id = sent[0]!.id;
    // something else was sent after the question: «no» may be about that
    expect(await b.textAnswer({ text: 'no' }, id + 1)).toBeNull();
    expect(await b.textAnswer({ text: 'no.' }, id)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: 'r1', yes: false }]);
  });

  it('ambiguous text is never an answer: other words, two open questions, a reply to another message', async () => {
    const { port, sent, b } = setup();
    const q1 = question(), q2 = question({ ref: { kind: 'question', requestId: 'r2' }, text: 'Aggiungo i test?' });
    port.open = [q1, q2];
    await b.offer(q1); await b.offer(q2);
    const last = sent[1]!.id;
    expect(await b.textAnswer({ text: 'sì, ma prima spiegami' }, last)).toBeNull();
    expect(await b.textAnswer({ text: 'ok' }, last)).toBeNull();
    expect(await b.textAnswer({ text: 'sì' }, last)).toBeNull();
    expect(await b.textAnswer({ text: 'sì', replyTo: 12345 }, last)).toBeNull();
    expect(port.answers).toEqual([]);
    // a reply names its question even with two open
    expect(await b.textAnswer({ text: 'sì', replyTo: sent[0]!.id }, last)).toBe('ok');
    expect(port.answers).toEqual([{ chatId: 'c1', id: 'r1', yes: true }]);
  });

  it('a typed «sì» never approves a plan: only its button does', async () => {
    const { port, sent, b } = setup();
    const plan = question({ ref: { kind: 'plan', at: '7' }, text: '1. Trovo il bug' }); port.open = [plan];
    await b.offer(plan);
    expect(await b.textAnswer({ text: 'sì', replyTo: sent[0]!.id }, sent[0]!.id)).toBeNull();
    expect(await b.textAnswer({ text: 'sì' }, sent[0]!.id)).toBeNull();
    expect(port.answers).toEqual([]);
  });

  it('a typed answer to a question answered on the PC meanwhile, or stale, does not answer', async () => {
    const { port, sent, b, advance } = setup();
    const q = question(); port.open = [q];
    await b.offer(q);
    await b.resolved(q, 'pc');
    expect(await b.textAnswer({ text: 'sì', replyTo: sent[0]!.id }, sent[0]!.id)).toBeNull();
    const q2 = question({ ref: { kind: 'question', requestId: 'r2' } }); port.open = [q2];
    await b.offer(q2);
    port.result = 'already';
    expect(await b.textAnswer({ text: 'sì', replyTo: sent.at(-1)!.id }, null)).toBe('already');
    const q3 = question({ ref: { kind: 'question', requestId: 'r3' } }); port.open = [q3];
    await b.offer(q3);
    advance(25 * 3600_000);
    expect(await b.textAnswer({ text: 'sì', replyTo: sent.at(-1)!.id }, null)).toBeNull();
  });
});

describe('backlog', () => {
  it('asks back with Sì/No and runs only on a Sì press, once', async () => {
    const o = fakeOut();
    const bl = createBacklog({ out: o.out, now: () => 0 });
    await bl.ask({ message_id: 1, date: 1_700_000_000, chat: { id: ME, type: 'private' }, from: { id: ME }, text: `apri un'attività per ${FX.mail}` });
    const msg = o.sent[0]!;
    expect(msg.text).toMatch(/^📨 Ricevuto alle \d\d:\d\d: «apri un'attività per \[email\]», lo mando\?$/);
    expect(msg.silent).toBe(true);
    const data = dataOf(msg);
    expect(data.startsWith('b:')).toBe(true);
    expect(await bl.press(cb(data, msg.id + 1), ME)).toEqual({ outcome: 'forged' });
    expect(await bl.press(cb(data, msg.id, 999), ME)).toEqual({ outcome: 'forged' });
    const r = await bl.press(cb(data, msg.id), ME);
    expect(r).toEqual({ outcome: 'run', payload: { kind: 'text', text: `apri un'attività per ${FX.mail}` } });
    expect((await bl.press(cb(data, msg.id), ME)).outcome).toBe('stale');
  });

  it('No discards; a voice note is asked too', async () => {
    const o = fakeOut();
    const bl = createBacklog({ out: o.out, now: () => 0 });
    await bl.ask({ message_id: 1, date: 1_700_000_000, chat: { id: ME, type: 'private' }, from: { id: ME }, voice: { file_id: 'v', duration: 3 } });
    expect(o.sent[0]!.text).toMatch(/Vocale ricevuto alle/);
    expect(await bl.press(cb(dataOf(o.sent[0]!, false), o.sent[0]!.id), ME)).toEqual({ outcome: 'discarded' });
    expect(o.edits[0]!.text).toBe('🗑️ Scartato');
  });
});
