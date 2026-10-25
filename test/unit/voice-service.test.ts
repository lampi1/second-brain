// Voice mode's main side (ADR 0152, src/main/voice/service.ts): the voice process is started on first use only, the
// download progress and the transcripts are relayed, a spoken reply comes back by its id, a crash fails what waited
// and the next use starts a new process; the fake engine needs no process at all.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { VoiceService } from '../../src/main/voice/service';
import type { VoiceIn, VoiceOut } from '../../src/main/voice/protocol';
import type { VoiceState } from '../../src/shared/voice';

class FakeChild extends EventEmitter {
  sent: VoiceIn[] = [];
  postMessage(m: VoiceIn) { this.sent.push(m); }
  reply(m: VoiceOut) { this.emit('message', m); }
  kill() { this.emit('exit', 0); return true; }
}

function make(fake: { text: string } | null = null) {
  const children: FakeChild[] = [], states: VoiceState[] = [], heard: string[] = [];
  const svc = new VoiceService({
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-voice-svc-')), script: 'w.js',
    settings: () => ({ asr: 'fast', voice: 'paola' }),
    fork: () => { const c = new FakeChild(); children.push(c); return c as never; },
    changed: s => states.push(s), heard: t => heard.push(t.text), speech: () => {}, fake,
  });
  return { svc, children, states, heard };
}

afterEach(() => { vi.useRealTimers(); });

describe('VoiceService', () => {
  it('no process until used; state says what is missing', () => {
    const { svc, children } = make();
    const st = svc.state();
    expect(children).toHaveLength(0);
    expect(st.ready).toEqual({ vad: false, asr: false, tts: false });
    expect(st.missingMb).toBeGreaterThan(400);
  });
  it('prepare starts the process, relays progress, clears it when done', () => {
    const { svc, children, states } = make();
    svc.prepare();
    expect(children).toHaveLength(1);
    expect(children[0]!.sent.map(m => m.type)).toEqual(['init', 'prepare']);
    children[0]!.reply({ type: 'progress', done: 5, total: 10 });
    expect(states.at(-1)!.downloading).toEqual({ done: 5, total: 10 });
    children[0]!.reply({ type: 'prepared' });
    expect(states.at(-1)!.downloading).toBeNull();
  });
  it('transcripts are relayed; spoken audio comes back by id', async () => {
    const { svc, children, heard } = make();
    svc.listen(true, 'one');
    children[0]!.reply({ type: 'speech', session: 'one', utterance: 1, active: true });
    children[0]!.reply({ type: 'heard', session: 'one', utterance: 1, text: 'ciao', ms: 800 });
    expect(heard).toEqual(['ciao']);
    const p = svc.speak('Buongiorno');
    const req = children[0]!.sent.find(m => m.type === 'speak') as Extract<VoiceIn, { type: 'speak' }>;
    expect(req.voice).toBe('paola');
    children[0]!.reply({ type: 'spoken', id: req.id, samples: new Float32Array(3), rate: 22050 });
    expect((await p).samples.length).toBe(3);
  });
  it('a crash fails the waiting speech and the next use starts a new process', async () => {
    const { svc, children, states } = make();
    svc.prepare();
    const p = svc.speak('Ciao');
    children[0]!.emit('exit', 1);
    expect((await p).error).toBeTruthy();
    expect(states.at(-1)!.error).toMatch(/riprova/);
    svc.listen(true, 'one');
    expect(children).toHaveLength(2);
  });
  it('oversized or wrong audio chunks are dropped', () => {
    const { svc, children } = make();
    svc.audio(new Float32Array(100_000), 'one');
    svc.audio([1, 2, 3] as unknown as Float32Array, 'one');
    expect(children).toHaveLength(0);
  });
  it('the fake engine hears its sentence once per session, without a process', async () => {
    vi.useFakeTimers();
    const { svc, children, heard } = make({ text: 'prova' });
    expect(svc.state().fake).toBe(true);
    svc.listen(true, 'one');
    vi.advanceTimersByTime(700);
    expect(heard).toEqual(['prova']);
    expect((await svc.speak('ciao')).samples.length).toBeGreaterThan(0);
    expect(children).toHaveLength(0);
    vi.useRealTimers();
  });
  it('drops old sessions, unpaired/duplicate transcripts, old audio and delayed stops', () => {
    const { svc, children, heard } = make();
    svc.listen(true, 'one');
    const c = children[0]!;
    c.reply({ type: 'speech', session: 'one', utterance: 1, active: true });
    svc.listen(false, 'one');
    svc.listen(true, 'two');
    svc.listen(false, 'one');
    c.reply({ type: 'heard', session: 'one', utterance: 1, text: 'wrong chat', ms: 800 });
    c.reply({ type: 'heard', session: 'two', utterance: 9, text: 'unpaired', ms: 800 });
    const before = c.sent.length;
    svc.audio(new Float32Array(10), 'one');
    expect(c.sent).toHaveLength(before);
    c.reply({ type: 'speech', session: 'two', utterance: 2, active: true });
    const result = { type: 'heard', session: 'two', utterance: 2, text: 'right chat', ms: 800 } as const;
    c.reply(result); c.reply(result);
    expect(heard).toEqual(['right chat']);
    svc.dispose();
  });
  it('cancels every pending synthesis, ignores late output and accepts new speech', async () => {
    const { svc, children } = make();
    const first = svc.speak('old'), second = svc.speak('queued');
    svc.cancelSpeech();
    expect(children[0]!.sent.at(-1)).toEqual({ type: 'cancel-speech', through: 2 });
    expect((await first).samples).toHaveLength(0);
    expect((await second).samples).toHaveLength(0);
    const next = svc.speak('new');
    children[0]!.reply({ type: 'spoken', id: 1, samples: new Float32Array(20), rate: 22050 });
    children[0]!.reply({ type: 'spoken', id: 3, samples: new Float32Array(3), rate: 22050 });
    expect((await next).samples).toHaveLength(3);
    svc.dispose();
  });
  it('bounds pending synthesis and cancels timed out work in the worker too', async () => {
    vi.useFakeTimers();
    const { svc, children } = make();
    const requests = Array.from({ length: 8 }, () => svc.speak('queued'));
    expect((await svc.speak('overflow')).error).toMatch(/piena/);
    vi.advanceTimersByTime(30_001);
    expect((await Promise.all(requests)).every(r => !!r.error)).toBe(true);
    expect(children[0]!.sent.some(m => m.type === 'cancel-speech')).toBe(true);
    await svc.speak('').then(r => expect(r.samples).toHaveLength(0));
    svc.listen(true, 'after-timeout');
    expect(children).toHaveLength(2);
    svc.dispose();
  });
  it('fails a stuck decoder explicitly, and ignores messages from the replaced process', () => {
    vi.useFakeTimers();
    const { svc, children, states, heard } = make();
    svc.listen(true, 'one');
    const old = children[0]!;
    old.reply({ type: 'speech', session: 'one', utterance: 1, active: true });
    vi.advanceTimersByTime(75_001);
    expect(states.at(-1)!.error).toMatch(/trascrizione/);
    svc.listen(true, 'two');
    old.reply({ type: 'speech', session: 'two', utterance: 2, active: true });
    old.reply({ type: 'heard', session: 'two', utterance: 2, text: 'stale', ms: 800 });
    expect(heard).toEqual([]);
    expect(children).toHaveLength(2);
    svc.dispose();
  });

});
