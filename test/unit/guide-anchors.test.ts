// The Guida knows when it is stale (ADR 0196): the anchor extraction (a symbol's block, the whole file, CRLF ignored), the
// comparison with the stored hashes, and the real check: every card has an anchor, every anchor still names code that
// exists, and its code is the code the card's text was written against (src/shared/guide-anchors.json). A failure names
// the card and the point to re-read; then `node scripts/guide-anchors.mjs` stores the new hash. Also (ADR 0208) every page
// of BRAIN_PAGES and every Settings section names a card that exists in it, en and de (src/shared/guide-coverage.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';
import { anchorSource, anchorUses, blockFrom, findDeclaration, normalize, parseAnchor, staleCards, type CardAnchors } from '@shared/guide-anchors';
import { coverageGaps } from '@shared/guide-coverage';
import { computeHashes, hashText, repoRootOf, staleInRepo, staleMessage, storedAnchors } from '../../src/main/guide/anchors';
import { coverageInRepo, pageIdsOf, sectionIdsOf } from '../../src/main/guide/coverage';
import { guideMaintenanceSection } from '../../src/main/guide/maintenance';
import { BRAIN_PAGES } from '../../src/renderer/brain';
import { SETTINGS_SECTION_IDS } from '../../src/renderer/lib/settings-sections';

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

// ADR 0208: every page and Settings section has its card in it, en and de (src/shared/guide-coverage.ts)
describe('the Guida covers every page and Settings section', () => {
  const card = (id: string, de = true) => ({ id, title: { it: 'T', en: `T ${id}` }, summary: { it: 'S', en: `S ${id}` }, de });
  const deOf = (cards: ReturnType<typeof card>[]) => Object.fromEntries(cards.filter(c => c.de).flatMap(c => [[c.title.en, 'x'], [c.summary.en, 'x']]));
  it('reads the page ids of BRAIN_PAGES without comments or aliases, and the Settings section ids', () => {
    const src = "export const PAGE_ALIAS = { fatto: 'log' };\nexport const BRAIN_PAGES: X[] = [\n  page('home', 'G H'),\n  // page('old', 'G O') is gone\n  page('guida', 'G E'),\n];\nconst IDS = page('nope', 'x');";
    expect(pageIdsOf(src)).toEqual(['home', 'guida']);
    expect(sectionIdsOf("export const SETTINGS_SECTION_IDS = ['profile', 'voice'] as const;")).toEqual(['profile', 'voice']);
    expect(pageIdsOf('nothing')).toEqual([]);
  });
  it('names a page or section without a card, a missing card, a missing language and stale lines', () => {
    const cards = [card('a'), card('b', false)];
    const gaps = coverageGaps({ pages: ['p1', 'p2', 'p3', 'p4'], sections: ['s1'], cards, de: deOf(cards),
      pageCards: { p1: 'a', p2: 'nope', p3: 'b', gone: 'a' }, settingsCards: { s1: 'a' }, exempt: { 'page:p4': 'going away', 'settings:old': 'x' } });
    expect(gaps.map(g => g.key)).toEqual(['page:p2', 'page:p3', 'page:gone:stale', 'settings:old:stale']);
    expect(gaps[1]!.message).toContain('title de, summary de');
    expect(coverageGaps({ pages: ['p5'], sections: [], cards, de: deOf(cards), pageCards: {}, settingsCards: {}, exempt: {} })[0]!.message).toContain('has no Guida card');
    expect(coverageGaps({ pages: ['p1'], sections: [], cards, de: deOf(cards), pageCards: { p1: 'a' }, settingsCards: {}, exempt: { 'page:p1': 'x' } })[0]!.message).toContain('both mapped and exempt');
  });
  it('has no gap in this checkout (else: the message says which card to write or which line to fix)', () => {
    expect(coverageInRepo(root).map(g => g.message)).toEqual([]);
    expect(pageIdsOf(readFileSync(path.join(root, 'src/renderer/brain/index.tsx'), 'utf8'))).toEqual(BRAIN_PAGES.map(p => p.id));
    expect(sectionIdsOf(readFileSync(path.join(root, 'src/renderer/lib/settings-sections.ts'), 'utf8'))).toEqual([...SETTINGS_SECTION_IDS]);
  });
});
