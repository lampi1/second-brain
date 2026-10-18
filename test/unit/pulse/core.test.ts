// Battito evidence boundary: malformed output, stale/foreign refs, secrets, dedupe and file traversal.
import { expect, it } from 'vitest';
import { buildDigest, safeRelative } from '../../../src/main/pulse/digest';
import { parseCards } from '../../../src/main/pulse/cards';
const digest = () => buildDigest({ now: '- finish review', ideas: '', journal: '', errors: '', chats: [], agents: [], files: [] });
it('scrubs secrets and email addresses and caps the complete digest', () => {
  const d = buildDigest({ now: Array(40).fill('- token=not-for-export me@example.com ' + 'word '.repeat(50)).join('\n'),
    ideas: '', journal: '', errors: '', chats: [], agents: [], files: ['../secret', '.brain.env', 'notes/a.md'] });
  expect(d.text.length).toBeLessThanOrEqual(6000);
  expect(d.text).not.toContain('not-for-export'); expect(d.text).not.toContain('me@example.com');
  expect(d.entries.filter(e => e.ref.kind === 'file').map(e => e.ref.ref)).toEqual(['notes/a.md']);
  expect(safeRelative('C:/private')).toBe(false); expect(safeRelative('a/../private')).toBe(false);
});
it('uses opaque citations even for sensitive filenames and prioritizes due idea headings', () => {
  const ideas = '## Old due idea\nRiprendere: 2026-10-01\nprivate description\n' + Array.from({ length: 20 }, (_, i) => `## New idea ${i}\ntext`).join('\n');
  const d = buildDigest({ now: '', ideas, journal: '', errors: '', agents: [], chats: [], files: ['notes/person@example.com'] }, new Date(2026, 9, 18).getTime());
  expect(d.text).toContain('Old due idea'); expect(d.text).not.toContain('private description');
  expect(d.text).not.toContain('person@example.com'); expect(d.text).toContain('[d1]');
});
it('accepts only known refs and places, rejects repeats and malformed JSON', () => {
  const d = digest();
  const card = { type: 'consiglio', title: 'Controlla la revisione', body: 'Rileggi il diff.', why: 'La revisione è aperta.', refs: [d.entries[0]!.id], places: ['board'] };
  const parse = (c: unknown) => parseCards(JSON.stringify({ cards: [c] }), d, [], [], 'r_123', 'claude', 100);
  const accepted = parse(card); expect(accepted).toHaveLength(1);
  expect(parse({ ...card, refs: ['foreign'] })).toEqual([]);
  expect(parse({ ...card, places: ['file:../secret'] })).toEqual([]);
  expect(parseCards('```json {} ```', d, [], [], '', null, 0)).toEqual([]);
  expect(parseCards(JSON.stringify({ cards: [card] }), d, accepted, [], '', null, 0)).toEqual([]);
  expect(accepted[0]!.expiresAt).toBe(100 + 48 * 3600_000);
});
