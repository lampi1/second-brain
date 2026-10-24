// Voice mode's main side (ADR 0152, src/main/voice/service.ts): the voice process is started on first use only, the
// download progress and the transcripts are relayed, a spoken reply comes back by its id, a crash fails what waited
// and the next use starts a new process; the fake engine needs no process at all.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
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
    changed: s => states.push(s), heard: t => heard.push(t), speech: () => {}, fake,
  });
  return { svc, children, states, heard };
}

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
    svc.listen(true);
    children[0]!.reply({ type: 'heard', text: 'ciao', ms: 800 });
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
    svc.listen(true);
    expect(children).toHaveLength(2);
  });
  it('oversized or wrong audio chunks are dropped', () => {
    const { svc, children } = make();
    svc.audio(new Float32Array(100_000));
    svc.audio([1, 2, 3] as unknown as Float32Array);
    expect(children).toHaveLength(0);
  });
  it('the fake engine hears its sentence once per session, without a process', async () => {
    vi.useFakeTimers();
    const { svc, children, heard } = make({ text: 'prova' });
    expect(svc.state().fake).toBe(true);
    svc.listen(true);
    vi.advanceTimersByTime(700);
    expect(heard).toEqual(['prova']);
    expect((await svc.speak('ciao')).samples.length).toBeGreaterThan(0);
    expect(children).toHaveLength(0);
    vi.useRealTimers();
  });
});
