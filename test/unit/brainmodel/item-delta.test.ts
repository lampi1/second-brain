// Itemized changes (ADR 0194, M1, brainmodel/item-delta.ts): the items of a markdown text are its lines, compared as a
// multiset; a write that loses a line it does not list as removed with a reason is refused; a whole file needs WHOLE_FILE;
// a fact's rewrite that shrinks it to a stub is refused.
import { describe, expect, it } from 'vitest';
import { addedItems, checkDelta, checkFactEdit, declareRemoved, guarded, items, removedItems, WHOLE_FILE } from '../../../src/main/brainmodel/item-delta';

describe('items and their diff', () => {
  it('reads non-blank lines, folding whitespace, and diffs them as a multiset', () => {
    expect(items('# T\n\n-  a   b\n\n- c\r\n')).toEqual(['# T', '- a b', '- c']);
    expect(removedItems('- a\n- a\n- b\n', '- a\n- b\n- c\n')).toEqual(['- a']);
    expect(addedItems('- a\n', '- a\n- c\n')).toEqual(['- c']);
    // re-indenting is not a loss
    expect(removedItems('  - a\n', '- a\n')).toEqual([]);
  });
});

describe('checkDelta', () => {
  const before = '# Skill\n\n## Passi\n\n- uno\n- due\n- tre\n';
  it('lets additions and new files through', () => {
    expect(checkDelta(before, `${before}- quattro\n`)).toEqual({ ok: true, added: 1, removed: 0 });
    expect(checkDelta(null, 'x\n')).toMatchObject({ ok: true, added: 1 });
  });
  it('refuses a rewrite that loses items it does not list, with cause and hint', () => {
    const v = checkDelta(before, '# Skill\n\nFai tutto bene.\n');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toEqual(['## Passi', '- uno', '- due', '- tre']);
    expect(v.cause).toMatch(/4 item\(s\) removed without being listed/);
    expect(v.hint).toMatch(/never rewrite the file whole/);
  });
  it('accepts an edit or a removal listed with a reason (an empty reason does not count)', () => {
    const edit = before.replace('- due', '- due, con i test');
    expect(checkDelta(before, edit, [{ item: '- due', reason: 'più preciso' }])).toEqual({ ok: true, added: 1, removed: 1 });
    expect(checkDelta(before, edit, [{ item: '- due', reason: '  ' }]).ok).toBe(false);
    // one copy listed covers one copy lost
    expect(checkDelta('- a\n- a\n', '', [{ item: '- a', reason: 'x' }]).ok).toBe(false);
    expect(checkDelta('- a\n- a\n', '', declareRemoved('- a\n- a\n', '', 'x')).ok).toBe(true);
  });
  it('a whole file removed needs WHOLE_FILE with its reason', () => {
    expect(checkDelta(before, null).ok).toBe(false);
    expect(checkDelta(before, null, [{ item: WHOLE_FILE, reason: 'mai usata in 60 giorni' }])).toMatchObject({ ok: true, removed: 4 + 1 });
  });
  it('covers markdown files only', () => {
    expect(guarded('/b/rules/lessons.md')).toBe(true);
    expect(guarded('/b/brain.json')).toBe(false);
  });
});

describe('checkFactEdit (brevity bias)', () => {
  it('keeps a generalization, refuses a stub', () => {
    expect(checkFactEdit('App locale su http://localhost:44309', 'Read the local port from the launch profile').ok).toBe(true);
    const v = checkFactEdit('Il deploy di staging richiede prima la migrazione del database, poi il riavvio del worker e la verifica dei log', 'Deploy.');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.cause).toMatch(/keeps \d+ of \d+ characters/);
  });
});
