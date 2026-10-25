// Real renderer voice module with fake IPC/audio: question playback, recovery, mic changes and late transcripts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';
import type * as VoiceModule from '../../src/renderer/lib/voice';
import type { VoiceHeard, VoiceSpeech } from '../../src/shared/voice';
const h = vi.hoisted(() => ({
  listeners: new Map<string, (event: never) => void>(), plays: [] as { onended?: () => void }[],
  invokes: vi.fn(), send: vi.fn(), toast: vi.fn(), micChanged: null as null | (() => void),
  effects: [] as (() => void)[],
  chats: { orchestrator: { id: 'orchestrator', isOrchestrator: true }, flash: { id: 'flash', quick: true } },
}));
vi.mock('react', async original => ({ ...await original<typeof React>(),
  useRef: (current: unknown) => ({ current }), useEffect: (fn: () => void) => { h.effects.push(fn); },
}));
vi.mock('../../src/renderer/store/store', () => ({ app: { get: () => ({ chats: h.chats, items: {} }), subscribe: vi.fn() }, send: h.send }));
vi.mock('../../src/renderer/store/ui', () => ({ toast: h.toast }));
vi.mock('../../src/renderer/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/renderer/lib/mic', () => ({ micAudio: () => ({}),
  onMicChange: (fn: () => void) => { h.micChanged = fn; }, openMicStream: async () => { throw new Error('No hardware in this unit test'); },
}));
const engine = { ready: { vad: true, asr: true, tts: true }, asr: 'fast', voice: 'paola', downloading: null, error: null, missingMb: 0, fake: true };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
let v: typeof VoiceModule;
let sequence = 0;
function capture(): string { return h.invokes.mock.calls.filter(([name, args]) => name === 'voice:listen' && args.on).at(-1)![1].session; }
function emit(name: string, event: VoiceSpeech | VoiceHeard) { h.listeners.get(name)!(event as never); }
function utterance(text: string, session = capture()) {
  const id = ++sequence;
  emit('voice:speech', { session, utterance: id, active: true });
  emit('voice:speech', { session, utterance: id, active: false });
  emit('voice:heard', { session, utterance: id, text, ms: 600 });
}
function question(id: string, answer: (a: unknown) => void) {
  v.useVoiceQuestion(id, { question: 'Procedo?' }, answer);
  for (const effect of h.effects.splice(0)) effect();
}
async function finishPlayback() {
  await flush();
  for (let i = 0; i < 20 && h.plays.length; i++) { h.plays.shift()!.onended?.(); await flush(); }
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); h.listeners.clear(); h.plays = []; h.effects = []; sequence = 0;
  h.invokes.mockImplementation(async (name: string) => name === 'voice:state' ? engine : name === 'voice:speak' ? { samples: new Float32Array(3), rate: 22050 } : undefined);
  vi.stubGlobal('window', { sb: { invoke: h.invokes, on: (name: string, fn: (event: never) => void) => h.listeners.set(name, fn) }, addEventListener: vi.fn() });
  vi.stubGlobal('AudioContext', class {
    destination = {}; resume = async () => {}; close = async () => {};
    createBuffer() { return { copyToChannel: vi.fn() }; }
    createBufferSource() { const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: undefined }; h.plays.push(source); return source; }
  });
  v = await import('../../src/renderer/lib/voice'); v.startVoice(); await flush();
});
afterEach(() => { v.stopVoice(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('voice question lifecycle', () => {
  it('does not open listening without its destination chat', async () => {
    const original = h.chats.orchestrator;
    Reflect.deleteProperty(h.chats, 'orchestrator');
    try {
      await v.setTalk(true);
      expect(v.voice.get().phase).toBe('off');
      expect(h.toast).toHaveBeenCalledWith('voice.noOrchestrator', 'info');
      expect(h.invokes.mock.calls.some(([name]) => name === 'voice:listen')).toBe(false);
    } finally { h.chats.orchestrator = original; }
  });
  it('answers once only after the exact prompt plays, with a complete thought', async () => {
    const answer = vi.fn(); question('q1', answer); await v.setTalk(true); await finishPlayback();
    utterance('Sì'); expect(answer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: 'yes' });
  });
  it('replays an interrupted prompt so a later answer can succeed without toggling voice', async () => {
    const answer = vi.fn(), drafted = vi.fn(); v.onDictated(drafted); question('q1', answer);
    await v.setTalk(true); await flush(); utterance('Sì'); vi.advanceTimersByTime(700); await flush();
    expect(answer).not.toHaveBeenCalled(); expect(drafted).toHaveBeenCalledWith('orchestrator', 'Sì');
    await finishPlayback(); utterance('Sì'); vi.advanceTimersByTime(700);
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: 'yes' });
  });
  it('drops a late old session transcript when dictation changes target', async () => {
    const drafted = vi.fn(); v.onDictated(drafted); await v.toggleVoice('orchestrator'); const old = capture();
    emit('voice:speech', { session: old, utterance: 1, active: true });
    await v.toggleVoice('flash');
    emit('voice:heard', { session: old, utterance: 1, text: 'wrong target', ms: 800 });
    expect(drafted).not.toHaveBeenCalled();
    utterance('right target'); expect(drafted).toHaveBeenCalledExactlyOnceWith('flash', 'right target');
  });
  it('preserves completed held words on a capture restart without sending them', async () => {
    const drafted = vi.fn(); v.onDictated(drafted); await v.setTalk(true);
    utterance('Keep this thought'); v.stopVoice(true); await v.setTalk(true); vi.advanceTimersByTime(1000);
    expect(drafted).toHaveBeenCalledExactlyOnceWith('orchestrator', 'Keep this thought');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('does not answer a new question with speech that started under the previous one', async () => {
    const one = vi.fn(), two = vi.fn(), drafted = vi.fn(); v.onDictated(drafted);
    question('q1', one); await v.setTalk(true); await finishPlayback();
    const session = capture(); emit('voice:speech', { session, utterance: 1, active: true });
    question('q2', two);
    emit('voice:heard', { session, utterance: 1, text: 'Sì', ms: 800 }); vi.advanceTimersByTime(700);
    expect(one).not.toHaveBeenCalled(); expect(two).not.toHaveBeenCalled();
    expect(drafted).toHaveBeenCalledWith('orchestrator', 'Sì');
  });
});
