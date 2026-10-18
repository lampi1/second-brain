// Claim audit of PR #29 (in-app «Guida», src/shared/concept-guide.ts), card 'routing', point 1: "The app works out the
// kind of work ... and the area from the chat's title". On main (src/main/brain/routing.ts taskOf / routeChat) the kind
// comes from the title AND the first prompt (a prompt that builds or fixes wins over a topic-only title), or from the
// agent's own `kind`; the area may come from the caller (req.area) or the "Migliora l'app" space. Fails while the point
// says the title alone. Review-only test.
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';
import { taskOf } from '../../../../src/main/brain/routing';

const card = CONCEPTS.find(c => c.id === 'routing')!;

describe("card 'routing': where kind and area come from", () => {
  it('the first prompt decides the kind too, not only the title', () => {
    // same title, different prompts: different kinds (no brain rules needed)
    expect(taskOf('Portale · ordini', 'implement the export', undefined)).toBe('app-feature');
    expect(taskOf('Portale · ordini', 'fix the crash on save', undefined)).toBe('bug-fix');
    expect(taskOf('Portale · ordini', 'just look around', undefined)).toBe('altro');
    const point = card.points[0]!;
    expect(point.en).toMatch(/prompt/i);
    expect(point.it).toMatch(/prompt|messaggio/i);
  });
});
