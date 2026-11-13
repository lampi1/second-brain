// What the bots say at the board (ADR 0304, src/renderer/lib/chess-lines.ts): every role has at least two lines for
// every moment in Italian, English and German, each short enough for a bubble with any piece written in, with no
// placeholder left and none where the moment gives no piece; a line follows the moment and is not repeated twice in a row.
import { describe, expect, it } from 'vitest';
import { CHESS_BOT_IDS } from '../../src/shared/chess';
import { CHESS_LINES, CHESS_MOMENTS, LINE_MAX, chessLine, fill } from '../../src/renderer/lib/chess-lines';
import type { ChessMoment } from '../../src/renderer/lib/chess-game';

const LANGS = ['it', 'en', 'de'] as const;
/** The moments whose event names a piece, and the placeholder their lines may use. */
const PIECE: Partial<Record<ChessMoment, string[]>> = { take: ['{yours}'], lost: ['{mine}'], promo: ['{piece}'], userPromo: ['{piece}'] };

describe('the bots\' lines', () => {
  it('cover every role and moment in the three languages, short and with valid placeholders', () => {
    for (const lang of LANGS) {
      const set = CHESS_LINES[lang];
      expect(Object.keys(set.says).sort()).toEqual([...CHESS_BOT_IDS].sort());
      for (const bot of CHESS_BOT_IDS) {
        expect(Object.keys(set.says[bot]).sort(), `${lang} ${bot}`).toEqual([...CHESS_MOMENTS].sort());
        for (const moment of CHESS_MOMENTS) {
          const lines = set.says[bot][moment], where = `${lang} ${bot} ${moment}`;
          expect(lines.length, where).toBeGreaterThanOrEqual(2);
          expect(new Set(lines).size, where).toBe(lines.length);
          for (const line of lines) {
            const used = line.match(/\{\w+\}/g) ?? [];
            for (const u of used) expect(PIECE[moment] ?? [], `${where}: ${line}`).toContain(u);
            for (const p of ['p', 'n', 'b', 'r', 'q'] as const) {
              const text = fill(line, set, p);
              expect(text, where).not.toMatch(/[{}]/);
              expect(text.length, `${where}: ${text}`).toBeLessThanOrEqual(LINE_MAX);
              expect(text.charAt(0), where).toBe(text.charAt(0).toUpperCase());
            }
          }
        }
      }
    }
  });
  it('has the same number of lines in each language', () => {
    for (const bot of CHESS_BOT_IDS) for (const m of CHESS_MOMENTS) {
      expect(CHESS_LINES.en.says[bot][m].length, `en ${bot} ${m}`).toBe(CHESS_LINES.it.says[bot][m].length);
      expect(CHESS_LINES.de.says[bot][m].length, `de ${bot} ${m}`).toBe(CHESS_LINES.it.says[bot][m].length);
    }
  });
  it('writes the piece in and starts with a capital', () => {
    const it = CHESS_LINES.it;
    expect(fill('{yours} era nel mio piano.', it, 'n')).toBe('Il tuo cavallo era nel mio piano.');
    expect(fill('Via {mine}.', it, 'r')).toBe('Via la mia torre.');
    expect(fill('Da pedone a {piece}.', it, 'q')).toBe('Da pedone a donna.');
    expect(fill('Via {yours}.', it, undefined)).toBe('Via il tuo pedone.');
  });
  it('picks a line of the moment and does not say the same one twice in a row', () => {
    const first = chessLine('scout', { moment: 'check' }, 'it', () => 0);
    expect(CHESS_LINES.it.says.scout.check).toContain(first);
    const second = chessLine('scout', { moment: 'check' }, 'it', () => 0, first);
    expect(second).not.toBe(first);
    expect(CHESS_LINES.it.says.scout.check).toContain(second);
    expect(chessLine('herald', { moment: 'take', piece: 'b' }, 'en', () => 0.99)).not.toMatch(/[{}]/);
  });
});
