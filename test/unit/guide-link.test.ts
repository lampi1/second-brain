// «Come funziona →» (components/GuideLink.tsx, ADR 0101): every Guida card a "?" or a page lead names exists, so no
// link is dead; the link renders for a known card and nothing for an unknown one; the new concept cards are there.
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../src/shared/concept-guide';
import { GuideLink, isConcept } from '../../src/renderer/components/GuideLink';

const SRC = path.resolve(import.meta.dirname, '../../src/renderer');
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []);
}

describe('guide links', () => {
  it('names only Guida cards that exist', () => {
    const used = new Set<string>();
    for (const f of files(SRC)) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bguide="([a-z-]+)"|<GuideLink concept="([a-z-]+)"/g)) used.add(m[1] ?? m[2]!);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const id of used) expect(isConcept(id), id).toBe(true);
  });

  it('renders «Come funziona →» for a card, nothing for an unknown id', () => {
    const html = renderToStaticMarkup(createElement(GuideLink, { concept: 'maintenance' }));
    expect(html).toContain('data-testid="guide-link-maintenance"');
    expect(html).toContain('Come funziona');
    expect(renderToStaticMarkup(createElement(GuideLink, { concept: 'nope' }))).toBe('');
  });

  it('has the cards the "?" of the app point to', () => {
    const ids = CONCEPTS.map(c => c.id);
    for (const id of ['maintenance', 'trials', 'auto-close', 'held-news', 'context', 'quality']) expect(ids).toContain(id);
  });

  it('keeps tool names out of the main text of every card (they live in the technical details)', () => {
    const TOOL = /\b([a-z]+_[a-z_]+|roleId)\b/;
    for (const c of CONCEPTS) {
      for (const x of [c.summary, c.analogy, ...c.points, ...(c.target ?? []), ...(c.diagram?.steps ?? [])]) {
        expect(TOOL.test(x.it), `${c.id}: ${x.it}`).toBe(false);
        expect(TOOL.test(x.en), `${c.id}: ${x.en}`).toBe(false);
      }
    }
  });
});
