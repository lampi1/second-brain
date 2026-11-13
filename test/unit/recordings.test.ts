// Call recordings' shared rules (ADR 0154, src/shared/recordings.ts): the WAV header, the clock, the microphone's echo
// of the call dropped, a speaker's lines joined into turns, the transcript text the Orchestrator reads, default names.
import { describe, expect, it } from 'vitest';
import { clock, defaultTitle, dropEchoes, recExtensionOk, transcriptText, turns, wavHeader, wavMs, type RecSegment } from '../../src/shared/recordings';

describe('wav', () => {
  it('writes a PCM 16-bit header with the sizes', () => {
    const h = wavHeader(64_000, 2);
    const v = new DataView(h.buffer);
    expect(String.fromCharCode(...h.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 64_000);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(28, true)).toBe(64_000);
    expect(v.getUint32(40, true)).toBe(64_000);
    expect(wavMs(64_000, 2)).toBe(1000);
    expect(wavMs(32_000, 1)).toBe(1000);
  });
});

it('clock', () => {
  expect(clock(0)).toBe('0:00');
  expect(clock(245_000)).toBe('4:05');
  expect(clock(3_729_000)).toBe('1:02:09');
});

describe('echo and turns', () => {
  const s = (start: number, end: number, who: RecSegment['who'], text: string): RecSegment => ({ start, end, who, text });
  it('drops a «Tu» line that repeats an «Altri» line at the same time', () => {
    const segs = [s(0, 3000, 'others', 'Il bug è nella pagina di login'), s(100, 2900, 'me', 'il bug è nella pagina login'), s(4000, 6000, 'me', 'Ok lo prendo io')];
    expect(dropEchoes(segs).map(x => x.text)).toEqual(['Il bug è nella pagina di login', 'Ok lo prendo io']);
  });
  it('keeps the user talking over someone else', () => {
    const segs = [s(0, 3000, 'others', 'Serve per venerdì'), s(500, 2500, 'me', 'Aspetta, quale ambiente?')];
    expect(dropEchoes(segs)).toHaveLength(2);
  });
  it('joins one speaker\'s close lines and keeps time order', () => {
    const out = turns([s(5000, 6000, 'me', 'b'), s(0, 1000, 'others', 'x'), s(1500, 2000, 'others', 'y'), s(6500, 7000, 'me', 'c')]);
    expect(out.map(x => `${x.who}:${x.text}`)).toEqual(['others:x y', 'me:b c']);
  });
});

it('transcript text: header, then [time] who: words', () => {
  const at = new Date(2026, 9, 22, 15, 2).getTime();
  const txt = transcriptText({ title: 'Call bug SMS', startedAt: at, durationMs: 61_000, source: 'call', channels: 2 },
    [{ start: 12_000, end: 14_000, who: 'others', text: 'Il totale è sbagliato.' }, { start: 21_000, end: 23_000, who: 'me', text: 'Lo riproduco.' }]);
  expect(txt).toContain('# Call bug SMS');
  expect(txt).toContain('2026-10-22 15:02');
  expect(txt).toContain('[0:12] Altri: Il totale è sbagliato.');
  expect(txt).toContain('[0:21] Tu: Lo riproduco.');
  const mono = transcriptText({ title: 'x', startedAt: at, durationMs: 1000, source: 'file', channels: 1 }, [{ start: 0, end: 1, who: null, text: 'ciao' }]);
  expect(mono).toContain('[0:00] ciao');
});

it('default names and accepted files', () => {
  expect(defaultTitle(new Date(2026, 9, 24, 15, 30).getTime(), 'call')).toBe('Call del 24 ottobre, 15:30');
  expect(defaultTitle(0, 'file', 'Riunione cliente.mp4')).toBe('Riunione cliente');
  expect(recExtensionOk('Meeting.MP4')).toBe(true);
  expect(recExtensionOk('note.txt')).toBe(false);
});
