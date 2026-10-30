// The Guida's content (src/shared/concept-guide.ts): every card is complete in both languages, cites source files that
// exist, keeps diagram labels short, has every text in German too (concept-guide.de.ts, no stale entry), and «Discuti»
// sends the card's content to the Orchestrator.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS, cardText, discussText, orchestratorText, textOf, type Bi } from '@shared/concept-guide';
import { GUIDE_DE } from '@shared/concept-guide.de';

const root = path.resolve(import.meta.dirname, '../..');
const full = (b: Bi) => b.it.trim().length > 0 && b.en.trim().length > 0;

describe('concept guide content', () => {
  it('has unique ids and the prominent card «Ogni compito passa da un ruolo» first', () => {
    expect(new Set(CONCEPTS.map(c => c.id)).size).toBe(CONCEPTS.length);
    expect(CONCEPTS.filter(c => c.prominent)).toHaveLength(1);
    expect(CONCEPTS[0]!.prominent).toBe(true);
    expect(CONCEPTS[0]!.title.it).toBe('Ogni compito passa da un ruolo');
    // the target (not today's behaviour) is stated apart on the prominent card
    expect(CONCEPTS[0]!.target?.length).toBeGreaterThan(0);
  });

  it('covers the core concepts the guide promises', () => {
    const ids = CONCEPTS.map(c => c.id);
    for (const id of ['agents', 'orchestrator', 'runs', 'metrics', 'errors-rules', 'classifiers', 'permissions', 'questions',
      'grindhouse', 'memory-hub', 'tasks', 'brain', 'search', 'file-viewer', 'costs', 'updates', 'flash', 'orchestrator-app',
      'voice', 'recordings', 'personal-browser', 'notifications', 'routines']) expect(ids).toContain(id);
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

    if (c.diagram) it(`card ${c.id}: diagram has 2-6 short steps`, () => {
      expect(c.diagram!.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.diagram!.steps.length).toBeLessThanOrEqual(6);
      for (const s of c.diagram!.steps) { expect(full(s)).toBe(true); expect(s.it.length).toBeLessThanOrEqual(24); expect(s.en.length).toBeLessThanOrEqual(24); }
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
    const en = discussText(card, 'en');
    expect(en).toContain(card.title.en);
    expect(en).toContain('How it works:');
    expect(en).not.toContain(card.points[0]!.it);
  });
});

describe('«Discuti» text for the Orchestrator', () => {
  const card = CONCEPTS[0]!;
  it('asks the Orchestrator to explain the card, with its content, in the language asked for', () => {
    const it = orchestratorText(card, 'it'), en = orchestratorText(card, 'en');
    expect(en).toContain(card.points[0]!.en);
    expect(it).toContain(card.points[0]!.it);
    expect(en).toContain('Scout');
  });
  it('has every English text in German, and no German entry for a text that is gone', () => {
    const texts = new Set<string>();
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.it === 'string' && typeof o.en === 'string') { texts.add(o.en); return; }
      for (const x of Object.values(o)) walk(x);
    };
    walk(CONCEPTS);
    expect([...texts].filter(t => !(t in GUIDE_DE))).toEqual([]);
    expect(Object.keys(GUIDE_DE).filter(k => !texts.has(k))).toEqual([]);
    expect(textOf(CONCEPTS[0]!.title, 'de')).toBe('Jede Aufgabe läuft über eine Rolle');
    expect(cardText(CONCEPTS[0]!, 'de')).toContain('So funktioniert es:');
  });
});
