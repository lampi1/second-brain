// The Guida knows when it is stale (ADR 0196): the anchor extraction (a symbol's block, the whole file, CRLF ignored), the
// comparison with the stored hashes, and the real check: every card has an anchor, every anchor still names code that
// exists, and its code is the code the card's text was written against (src/shared/guide-anchors.json). A failure names
// the card and the point to re-read; then `node scripts/guide-anchors.mjs` stores the new hash.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';
import { anchorSource, anchorUses, blockFrom, findDeclaration, normalize, parseAnchor, staleCards, type CardAnchors } from '@shared/guide-anchors';
import { computeHashes, hashText, repoRootOf, staleInRepo, staleMessage, storedAnchors } from '../../src/main/guide/anchors';
import { guideMaintenanceSection } from '../../src/main/guide/maintenance';

const root = path.resolve(import.meta.dirname, '../..');

const SRC = [
  "import x from 'y';",
  'export const LIMIT = 5;',
  'export function settle(a: number): number {',
  '  const s = "}{";',
  '  // a } in a comment',
  '  return a + 1;',
  '}',
  'export interface Shape {',
  '  a: string;',
  '}',
  'class Box {',
  '  private open(x: number): void {',
  '    if (x) { run(); }',
  '  }',
  '}',
  'const handlers = {',
  "  'chat:list': () => list(),",
  "  'chat:send': a => send(a),",
  '};',
  'export const arrow = (a: number) =>',
  '  a * 2;',
].join('\n');

describe('anchor extraction', () => {
  it('cuts a function, a const, an interface, a method and a quoted key by name', () => {
    expect(anchorSource(SRC, 'LIMIT')).toBe('export const LIMIT = 5;');
    expect(anchorSource(SRC, 'settle')).toBe(SRC.split('\n').slice(2, 7).join('\n'));
    expect(anchorSource(SRC, 'Shape')).toBe('export interface Shape {\n  a: string;\n}');
    expect(anchorSource(SRC, 'open')).toBe('  private open(x: number): void {\n    if (x) { run(); }\n  }');
    expect(anchorSource(SRC, 'chat:list')).toBe("  'chat:list': () => list(),");
    expect(anchorSource(SRC, 'arrow')).toBe('export const arrow = (a: number) =>\n  a * 2;');
  });
  it('takes the whole file without a symbol, and null for a symbol that is gone', () => {
    expect(anchorSource(SRC, null)).toBe(SRC);
    expect(anchorSource(SRC, 'nothere')).toBeNull();
  });
  it('ignores line endings and trailing blanks, so a Windows checkout hashes the same', () => {
    const crlf = SRC.replace(/\n/g, '  \r\n');
    expect(hashText(anchorSource(crlf, 'settle')!)).toBe(hashText(anchorSource(SRC, 'settle')!));
    expect(normalize('a \r\nb\t\r\n\n')).toBe('a\nb');
  });
  it('prefers the declaration over a call of the same name', () => {
    const lines = ['  settle(1);', 'function settle() {', '}'];
    expect(findDeclaration(lines, 'settle')).toBe(1);
    expect(blockFrom(lines, 1)).toBe('function settle() {\n}');
  });
  it('parses refs', () => {
    expect(parseAnchor('src/a.ts#b')).toEqual({ file: 'src/a.ts', symbol: 'b' });
    expect(parseAnchor('src/a.ts')).toEqual({ file: 'src/a.ts', symbol: null });
  });
});

describe('stale cards', () => {
  const cards: { id: string; anchors: CardAnchors }[] = [{ id: 'one', anchors: { 0: ['f#a'], 2: ['f#b'], [-1]: ['g'] } }, { id: 'two', anchors: { 1: ['f#a'] } }];
  it('names each card and point whose code changed, is gone or was never stored', () => {
    const uses = anchorUses(cards);
    const now: Record<string, string | null> = { 'f#a': 'new', 'f#b': 'same', g: null };
    const out = staleCards(uses, { 'f#a': 'old', 'f#b': 'same', g: 'x' }, r => now[r] ?? null);
    expect(out).toEqual([
      { id: 'one', points: [0], anchors: [{ ref: 'f#a', point: 0, why: 'changed' }, { ref: 'g', point: -1, why: 'missing' }] },
      { id: 'two', points: [1], anchors: [{ ref: 'f#a', point: 1, why: 'changed' }] },
    ]);
    expect(staleCards(uses, {}, () => 'h')[0]!.anchors[0]!.why).toBe('new');
    expect(staleMessage(out[1]!)).toBe('card two point 2: f#a code changed, re-read and update the text, then run node scripts/guide-anchors.mjs');
  });
});

describe('the Guida against this checkout', () => {
  it('every card has at least one anchor, on a point it has', () => {
    for (const c of CONCEPTS) {
      const keys = Object.keys(c.anchors ?? {}).map(Number);
      expect(keys.length, c.id).toBeGreaterThan(0);
      for (const k of keys) expect(k === -1 || (k >= 0 && k < c.points.length), `${c.id} point ${k}`).toBe(true);
    }
  });
  it('every anchor names code that exists', () => {
    const { missing } = computeHashes(root);
    expect(missing.map(m => `card ${m.card} point ${m.point + 1}: ${m.ref} not found, fix the anchor in src/shared/concept-guide.ts`)).toEqual([]);
  });
  it('no card describes code that changed after its text (else: re-read it, update it, run node scripts/guide-anchors.mjs)', () => {
    const stale = staleInRepo(root);
    expect(stale.map(staleMessage).join('\n')).toBe('');
    // and nothing stored that no card uses any more
    const used = new Set(anchorUses(CONCEPTS).map(u => u.ref));
    expect(Object.keys(storedAnchors().hashes).filter(k => !used.has(k))).toEqual([]);
  });
  it('knows the repo it runs from only in a checkout', () => {
    expect(repoRootOf(path.join(root, 'out', 'main'))).toBe(root);
    expect(repoRootOf(path.join(root, 'test', 'fixtures', 'x', 'y', 'z'))).toBeNull();
  });
  it('gives the maintenance nothing to do when every card is current and translated', () => {
    expect(guideMaintenanceSection(root)).toBe('');
    expect(guideMaintenanceSection(null)).toBe('');
  });
});
