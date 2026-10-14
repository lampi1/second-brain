// Unit tests of lib/tips.ts: where a HelpTip bubble goes (below, above, inside the window, the arrow on the mark) and how
// a data-tip value splits into text, shortcut keys or a second line of text.
import { describe, expect, it } from 'vitest';
import { placeBubble, splitTip } from '../../src/renderer/lib/tips';

const win = { width: 1200, height: 800 };
const bubble = { width: 300, height: 100 };

describe('placeBubble', () => {
  it('goes below the mark, centered on it, when it fits', () => {
    const p = placeBubble({ left: 500, top: 100, width: 16, height: 16 }, bubble, win);
    expect(p.side).toBe('below');
    expect(p.y).toBe(124);
    expect(p.x).toBe(358);
    expect(p.arrow).toBe(150);
  });
  it('goes above when there is no room below', () => {
    const p = placeBubble({ left: 500, top: 740, width: 16, height: 16 }, bubble, win);
    expect(p.side).toBe('above');
    expect(p.y).toBe(632);
  });
  it('stays inside the window near an edge, the arrow still pointing at the mark', () => {
    const p = placeBubble({ left: 1150, top: 100, width: 16, height: 16 }, bubble, win);
    expect(p.x).toBe(1200 - 300 - 8);
    expect(p.arrow).toBe(1158 - p.x);
    const l = placeBubble({ left: 0, top: 100, width: 16, height: 16 }, bubble, win);
    expect(l.x).toBe(8);
    expect(l.arrow).toBe(12);
  });
  it('fits nowhere: the roomier side, clamped inside the window', () => {
    const p = placeBubble({ left: 500, top: 60, width: 16, height: 16 }, { width: 300, height: 760 }, win);
    expect(p.side).toBe('below');
    expect(p.y).toBe(32);
    expect(p.y + 760).toBeLessThanOrEqual(800);
  });
});

describe('splitTip', () => {
  it('a plain text', () => expect(splitTip('Rileggi i rami')).toEqual({ text: 'Rileggi i rami' }));
  it('shortcuts become keys', () => {
    for (const k of ['Ctrl+K', 'Esc', 'F11', 'Ctrl+Shift+.', 'G U', 'Ctrl+1']) expect(splitTip(`Fai|${k}`)).toEqual({ text: 'Fai', keys: k });
  });
  it('words become a second line, never keys', () => {
    for (const m of ['clic per copiare', 'URL, utente e Copia password degli ambienti', 'Soglia del contesto lungo: 200k']) expect(splitTip(`Testo|${m}`)).toEqual({ text: 'Testo', more: m });
  });
});
