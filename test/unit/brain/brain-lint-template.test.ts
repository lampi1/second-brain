// The brain's lint tool (brain-template/ops/tools/brain-lint.mjs, #382): it never walks tmp/, and the near-duplicate
// check finds its pairs through an index of word triples instead of comparing every pair of sentences.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs template tool, no types
import { SKIP_DIR, nearDuplicates } from '../../../brain-template/ops/tools/brain-lint.mjs';

const unit = (file: string, line: number, text: string) => {
  const w = text.toLowerCase().split(/\s+/);
  return { file, line, text, key: w.join(' '), tri: new Set(w.slice(2).map((_, k) => w.slice(k, k + 3).join(' '))) };
};
const words = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ');

describe('brain-lint template', () => {
  it('skips scratch and history folders', () => {
    for (const d of ['tmp', 'temp', '.git', 'worktrees', 'journal']) expect(SKIP_DIR.test(d)).toBe(true);
    for (const d of ['rules', 'notes', 'tmpl']) expect(SKIP_DIR.test(d)).toBe(false);
  });
  it('pairs near-duplicates across files only, scored on all their triples', () => {
    const units = [unit('a.md', 1, words(14)), unit('b.md', 3, `${words(12)} x y`), unit('a.md', 2, words(14)), unit('c.md', 1, words(14, 100))];
    expect(nearDuplicates(units).map((d: { a: string; b: string }) => `${d.a}|${d.b}`)).toEqual(['a.md:1|b.md:3', 'b.md:3|a.md:2']);
  });
  it('still pairs a sentence repeated in many files, whose triples are all common', () => {
    const units = Array.from({ length: 60 }, (_, i) => unit(`f${i}.md`, 1, words(14)));
    expect(nearDuplicates(units)).toHaveLength(60 * 59 / 2);
  });
});
