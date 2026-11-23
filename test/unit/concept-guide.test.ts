// The concept cards app_guide and Impara read (src/shared/concept-guide.ts): every card is complete in Italian and
// English, cites source files that exist and keeps tool names out of its main text; cardText writes it in one language.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS, cardText, textOf, type Bi } from '@shared/concept-guide';

const root = path.resolve(import.meta.dirname, '../..');
const full = (b: Bi) => b.it.trim().length > 0 && b.en.trim().length > 0;

describe('concept guide content', () => {
  it('has unique ids and the card «Ogni compito passa da un ruolo» first', () => {
    expect(new Set(CONCEPTS.map(c => c.id)).size).toBe(CONCEPTS.length);
    expect(CONCEPTS[0]!.title.it).toBe('Ogni compito passa da un ruolo');
    // the target (not today's behaviour) is stated apart on it
    expect(CONCEPTS[0]!.target?.length).toBeGreaterThan(0);
  });

  it('covers the core concepts', () => {
    const ids = CONCEPTS.map(c => c.id);
    for (const id of ['agents', 'orchestrator', 'runs', 'metrics', 'errors-rules', 'classifiers', 'permissions', 'questions',
      'grindhouse', 'memory-hub', 'tasks', 'brain', 'search', 'file-viewer', 'costs', 'updates', 'fast', 'orchestrator-app',
      'voice', 'recordings', 'notifications']) expect(ids).toContain(id);
  });

  for (const c of CONCEPTS) {
    it(`card ${c.id}: summary, 4-8 points, analogy, technical part, all in it and en`, () => {
      expect(full(c.title)).toBe(true);
      expect(full(c.summary)).toBe(true);
      expect(c.points.length).toBeGreaterThanOrEqual(4);
      expect(c.points.length).toBeLessThanOrEqual(8);
      expect(c.points.every(full)).toBe(true);
      expect(full(c.analogy)).toBe(true);
      expect(c.tech.length).toBeGreaterThan(0);
      expect(c.tech.every(x => full(x.label) && full(x.text))).toBe(true);
      expect((c.target ?? []).every(full)).toBe(true);
      expect((c.coming ?? []).every(x => Number.isInteger(x.pr) && x.pr > 0 && full(x.text))).toBe(true);
    });

    it(`card ${c.id}: cites source files that exist in the repo`, () => {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) expect(existsSync(path.join(root, s)), s).toBe(true);
    });

    it(`card ${c.id}: keeps tool names out of the main text (they are in the technical part)`, () => {
      const main = [c.summary, c.analogy, ...c.points, ...(c.target ?? [])].flatMap(x => [x.it, x.en]);
      for (const t of main) expect(t).not.toMatch(/\b([a-z]+_[a-z_]+|roleId)\b/);
    });

  }
});

describe('card text for a chat', () => {
  it('marks what is still in a pull request apart from today\'s behaviour', () => {
    const search = CONCEPTS.find(c => c.id === 'search')!;
    // the hybrid search is on main (ADR 0094): the card describes it as today's behaviour
    expect(search.coming).toBeUndefined();
    expect(search.summary.it).toContain('significato');
    const pending = { ...search, coming: [{ pr: 99, text: { it: 'In arrivo', en: 'Coming' } }] };
    expect(cardText(pending, 'it')).toContain('- PR #99: In arrivo');
  });
  const card = CONCEPTS.find(c => c.id === 'every-task-agent')!;
  it('carries title, numbered points, analogy, technical details, target and sources', () => {
    const txt = cardText(card, 'it');
    expect(txt).toContain(`# ${card.title.it}`);
    card.points.forEach((p, i) => expect(txt).toContain(`${i + 1}. ${p.it}`));
    expect(txt).toContain(card.analogy.it);
    expect(txt).toContain(card.tech[0]!.text.it);
    expect(txt).toContain(card.target![0]!.it);
    expect(txt).toContain(card.sources.join(', '));
  });
  it('is written in the language asked for', () => {
    const en = cardText(card, 'en');
    expect(en).toContain(card.title.en);
    expect(en).toContain('How it works:');
    expect(en).not.toContain(card.points[0]!.it);
    expect(cardText(card, 'de')).toBe(en); // no German cards: a German UI reads the English
    expect(textOf(card.title, 'de')).toBe(card.title.en);
  });
});
