// The notification policy table of the phone bridge (design §8: phone conversation, at the PC, away, Focus, night,
// urgent, /pausa, quiet hours, the 2-minute wait) and the bot commands (/stato with neutral labels, /pausa, /riprendi,
// /stop, unknown commands, @bot suffix).
import { describe, expect, it } from 'vitest';
import { parseCommand, runCommand, statoText } from '../../../src/main/phone/commands';
import { CONVERSATION_MS, decide, inQuietHours, WAIT_BEFORE_PHONE_MS, type PolicyContext } from '../../../src/main/phone/policy';

const NOW = 1_000_000_000;
const base = (o: Partial<PolicyContext> = {}): PolicyContext => ({ now: NOW, hour: 12, lastPhoneMessageAt: null, atPc: false, nightMode: false, focusChatId: null, quietHours: { from: 22, to: 7 }, paused: false, ...o });
const dec = (o: { chatId?: string; orchestrator?: boolean; waitingMs?: number } = {}) => ({ kind: 'decidable' as const, chatId: o.chatId ?? 'c1', orchestrator: o.orchestrator ?? false, waitingMs: o.waitingMs ?? WAIT_BEFORE_PHONE_MS });

describe('policy', () => {
  it('urgent always passes with sound: paused, night, Focus, at the PC, quiet hours', () => {
    for (const c of [base({ paused: true }), base({ nightMode: true }), base({ focusChatId: 'x' }), base({ atPc: true }), base({ hour: 23 })]) {
      expect(decide({ kind: 'urgent' }, c)).toEqual({ send: true, silent: false });
    }
  });

  it('night mode and /pausa stop everything else', () => {
    expect(decide({ kind: 'reply', fromPhone: true }, base({ nightMode: true })).send).toBe(false);
    expect(decide(dec(), base({ paused: true })).send).toBe(false);
  });

  it('a reply to a phone message always goes back; other replies only during a phone conversation', () => {
    expect(decide({ kind: 'reply', fromPhone: true }, base({ atPc: true })).send).toBe(true);
    expect(decide({ kind: 'reply', fromPhone: false }, base()).send).toBe(false);
    expect(decide({ kind: 'reply', fromPhone: false }, base({ lastPhoneMessageAt: NOW - 1000 })).send).toBe(true);
    expect(decide({ kind: 'reply', fromPhone: false }, base({ lastPhoneMessageAt: NOW - CONVERSATION_MS })).send).toBe(false);
  });

  it('during a phone conversation Orchestrator questions go at once, other chats follow the away rules', () => {
    const talking = base({ lastPhoneMessageAt: NOW - 1000, atPc: true });
    expect(decide(dec({ orchestrator: true, waitingMs: 0 }), talking).send).toBe(true);
    expect(decide(dec({ waitingMs: WAIT_BEFORE_PHONE_MS * 5 }), talking).send).toBe(false);
  });

  it('at the PC nothing but urgent', () => {
    expect(decide(dec({ waitingMs: 10 * 60_000 }), base({ atPc: true })).send).toBe(false);
    expect(decide({ kind: 'failed', chatId: 'c1', orchestrator: false }, base({ atPc: true })).send).toBe(false);
  });

  it('away without Focus: questions waiting over 2 minutes and failed chats; earlier questions deferred', () => {
    expect(decide(dec({ waitingMs: WAIT_BEFORE_PHONE_MS }), base()).send).toBe(true);
    expect(decide(dec({ waitingMs: 30_000 }), base())).toEqual({ send: false, retryInMs: WAIT_BEFORE_PHONE_MS - 30_000 });
    expect(decide({ kind: 'failed', chatId: 'c9', orchestrator: false }, base()).send).toBe(true);
  });

  it('Focus on a chat: only that chat', () => {
    const c = base({ focusChatId: 'c1' });
    expect(decide(dec({ chatId: 'c1' }), c).send).toBe(true);
    expect(decide(dec({ chatId: 'c2' }), c).send).toBe(false);
    expect(decide({ kind: 'failed', chatId: 'c2', orchestrator: false }, c).send).toBe(false);
  });

  it('quiet hours make non-urgent messages silent, across midnight', () => {
    expect(decide(dec(), base({ hour: 23 }))).toEqual({ send: true, silent: true });
    expect(decide(dec(), base({ hour: 6 }))).toEqual({ send: true, silent: true });
    expect(decide(dec(), base({ hour: 7 }))).toEqual({ send: true, silent: false });
    expect(decide(dec(), base({ hour: 23, quietHours: null }))).toEqual({ send: true, silent: false });
    expect(inQuietHours(13, { from: 12, to: 14 })).toBe(true);
    expect(inQuietHours(14, { from: 12, to: 14 })).toBe(false);
    expect(inQuietHours(3, { from: 5, to: 5 })).toBe(false);
  });
});

describe('commands', () => {
  it('parses commands, the @bot suffix and arguments; plain text is not a command', () => {
    expect(parseCommand('/stato')).toEqual({ name: 'stato', arg: '' });
    expect(parseCommand('/STATO@MioBot')).toEqual({ name: 'stato', arg: '' });
    expect(parseCommand('/start 123456')).toEqual({ name: 'start', arg: '123456' });
    expect(parseCommand('/boh')).toEqual({ name: 'unknown', arg: '' });
    expect(parseCommand('ciao /stato')).toBeNull();
  });

  it('/stato shows neutral labels and the pause', () => {
    expect(statoText({ waiting: 0, orchestratorBusy: false, labels: [] }, false)).toBe('🟢 PC acceso · Orchestrator libero\nNessuna chat ti aspetta.');
    const t = statoText({ waiting: 2, orchestratorBusy: true, labels: ['Artisan · lavoro 3', 'Scout · lavoro 4'] }, true);
    expect(t).toContain('occupato');
    expect(t).toContain('2 chat ti aspettano: «Artisan · lavoro 3», «Scout · lavoro 4»');
    expect(t).toContain('In pausa');
  });

  it('/pausa, /riprendi and /stop change the bridge', () => {
    let paused = false, stopped = false;
    const ctx = { summary: () => ({ waiting: 0, orchestratorBusy: false, labels: [] }), paused: () => paused, setPaused: (p: boolean) => { paused = p; }, stopFromPhone: () => { stopped = true; } };
    runCommand('pausa', ctx); expect(paused).toBe(true);
    runCommand('riprendi', ctx); expect(paused).toBe(false);
    expect(runCommand('stop', ctx)).toContain('Riaccendilo dal PC');
    expect(stopped).toBe(true);
    expect(runCommand('unknown', ctx)).toContain('/stato');
  });
});
