// Main's wiring of the phone bridge (src/main/phone/wiring.ts): the fake Telegram base is read only in a dev instance and
// only on loopback; the voice engine transcribes only with its models on disk; «at the PC» = the window active or input
// in the last 5 minutes; the urgent sources send neutral text for a budget at 100 % and a /urgente typed on the PC only.
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { AT_PC_IDLE_S, createAppPhone, phonePresence, phoneTestApi, transcribeForPhone, urgentSources, type PhoneVoice } from '../../../src/main/phone/wiring';
import { capLog, fakePort } from './fakes';
import type { EventChannel, EventMap } from '../../../src/shared/contract';

const voice = (ready: { vad: boolean; asr: boolean }, out: { lines: { text: string }[]; error?: string } = { lines: [] }): PhoneVoice & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, state: () => ({ ready }), transcribe: wav => { calls.push(wav); return { result: Promise.resolve(out) }; } };
};

describe('phoneTestApi', () => {
  it('the stable instance ignores the variable', () => {
    expect(phoneTestApi(true, { SB_PHONE_TEST_API: 'http://127.0.0.1:4000' })).toBeUndefined();
  });
  it('dev takes only a loopback http base, without the trailing slash', () => {
    expect(phoneTestApi(false, { SB_PHONE_TEST_API: 'http://127.0.0.1:4000/' })).toBe('http://127.0.0.1:4000');
    expect(phoneTestApi(false, { SB_PHONE_TEST_API: 'http://localhost:9' })).toBe('http://localhost:9');
    expect(phoneTestApi(false, { SB_PHONE_TEST_API: 'https://api.telegram.org' })).toBeUndefined();
    expect(phoneTestApi(false, { SB_PHONE_TEST_API: 'http://127.0.0.1.evil.com:80' })).toBeUndefined();
    expect(phoneTestApi(false, {})).toBeUndefined();
  });
});

describe('transcribeForPhone', () => {
  it('null without the models; nothing transcribed', async () => {
    const v = voice({ vad: true, asr: false });
    expect(await transcribeForPhone(v, 'a.wav')).toBeNull();
    expect(v.calls).toEqual([]);
  });
  it('joins the lines; an engine error throws', async () => {
    expect(await transcribeForPhone(voice({ vad: true, asr: true }, { lines: [{ text: ' ciao ' }, { text: '' }, { text: 'come va' }] }), 'a.wav')).toBe('ciao come va');
    await expect(transcribeForPhone(voice({ vad: true, asr: true }, { lines: [], error: 'boom' }), 'a.wav')).rejects.toThrow('boom');
  });
});

describe('createAppPhone', () => {
  it('a dev instance without the variable stays dev-disabled and never calls fetch', async () => {
    const fetches: string[] = [];
    const b = createAppPhone({ userData: path.join(os.tmpdir(), `sb-phone-wiring-${process.pid}`), isStable: false, env: {}, port: fakePort(),
      token: { get: () => null, set() {}, clear() {} }, decodeVoice: async x => x, voice: voice({ vad: false, asr: false }),
      windowActive: () => false, idleSeconds: () => 0, nightMode: () => false, addRedaction() {}, log: capLog(),
      fetch: (async (u: string) => { fetches.push(u); throw new Error('no network'); }) as unknown as typeof fetch });
    await b.start();
    expect(b.status().state).toBe('dev-disabled');
    expect(fetches).toEqual([]);
    await b.stop();
  });

  it('presence: the window active or input in the last 5 minutes; an unreadable idle time counts as away', () => {
    let active = false, idle: number | null = AT_PC_IDLE_S + 1, night = true;
    const p = phonePresence({ windowActive: () => active, idleSeconds: () => { if (idle === null) throw new Error('n/a'); return idle; }, nightMode: () => night });
    expect(p()).toEqual({ atPc: false, nightMode: true });
    idle = AT_PC_IDLE_S - 1; night = false;
    expect(p()).toEqual({ atPc: true, nightMode: false });
    idle = null;
    expect(p().atPc).toBe(false);
    active = true;
    expect(p().atPc).toBe(true);
  });
});

describe('urgentSources', () => {
  const rig = () => {
    const sent: [string, string][] = [];
    const tap = urgentSources({ notifyUrgent: async (k, t) => { sent.push([k, t]); } },
      () => [{ id: 'o', isOrchestrator: true }, { id: 'c', isOrchestrator: false, agent: { name: 'Scout' } }]);
    const emit = <K extends EventChannel>(ch: K, p: EventMap[K]) => tap(ch, p);
    return { sent, emit };
  };
  const user = (text: string, extra: Record<string, unknown> = {}) => ({ kind: 'user', id: 'u', at: 1, text, ...extra }) as unknown as EventMap['chat:item']['item'];

  it('a budget alert notifies only at 100 %, neutral', () => {
    const r = rig();
    r.emit('budget:alert', { threshold: 80, scope: 'day', pct: 82, text: 'Chat «Cliente Rossi» all\'80 %' } as EventMap['budget:alert']);
    r.emit('budget:alert', { threshold: 100, scope: 'chat', pct: 100.4, text: 'Chat «Cliente Rossi» al limite' } as EventMap['budget:alert']);
    expect(r.sent).toEqual([['budget', 'Limite di spesa raggiunto (una chat, 100 %): guarda sul PC.']]);
  });

  it('/urgente only from a fresh PC message; never the message itself', () => {
    const r = rig();
    r.emit('chat:item', { chatId: 'o', item: user('/urgente Air giù da Rossi') });
    r.emit('chat:item', { chatId: 'c', item: user('/urgente'), replace: true });
    r.emit('chat:item', { chatId: 'c', item: user('/urgente', { via: 'phone' }) });
    r.emit('chat:item', { chatId: 'c', item: user('/urgente', { from: { kind: 'agent' } }) });
    r.emit('chat:item', { chatId: 'c', item: user('niente /urgente qui') });
    r.emit('chat:item', { chatId: 'c', item: user('/urgente') });
    expect(r.sent).toEqual([['urgente', 'Triage /urgente avviato al PC (Orchestrator).'], ['urgente', 'Triage /urgente avviato al PC (Scout).']]);
  });
});
