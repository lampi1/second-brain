// E2E of the clicks on a role's little person (ADR 0297), on the frozen demo: a left click on the person of a strip
// plays the pat, a right click the crack of the whip, and neither opens the strip; the chat's run keeps the last one
// (its tooltip says so, the second same click writes nothing new); the person on the front of a role card reacts too
// and the card does not turn. Screenshot in test-results/shots/sprite-touch-*.png.
import { expect, test, type Locator } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

/** Every reaction the person shows from now on, as they come (an observer: the reaction lasts about a second). */
async function watch(person: Locator): Promise<() => Promise<string[]>> {
  await person.evaluate(el => {
    const seen: string[] = [];
    (el as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => { const r = el.getAttribute('data-react'); if (r && seen[seen.length - 1] !== r) seen.push(r); }).observe(el, { attributes: true, attributeFilter: ['data-react'] });
  });
  return () => person.evaluate(el => (el as unknown as { seen: string[] }).seen);
}

test('the little person reacts to a click: a pat, a whip, and the run keeps the last one', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const strip = page.getByTestId('tile-chat-mappa'), person = strip.locator('.strip-face .agent-sprite');
    await expect(person).toHaveAttribute('title', /Conta pochissimo/);
    const seen = await watch(person);
    await person.click();
    await expect.poll(seen).toEqual(['pat']);
    await shot(page, 'sprite-touch-pat');
    await expect(person).toHaveAttribute('title', /Buffetto dato/);
    await person.click({ button: 'right' });
    await expect.poll(seen).toEqual(['pat', 'whip']);
    await expect(person).toHaveAttribute('title', /Frustata data/);
    // the clicks stayed on the person: the strip is still closed, no menu opened
    await expect(page.getByTestId('chat-expand-mappa')).toHaveAttribute('aria-expanded', 'false');
    // the role card: the person reacts, the card does not turn
    await goPage(page, 'agenti');
    const card = page.getByTestId('catalog-card-artisan'), hero = card.locator('.catalog-hero .agent-sprite');
    await expect(hero).toBeVisible();
    const heroSeen = await watch(hero);
    await hero.click({ button: 'right' });
    await expect.poll(heroSeen).toEqual(['whip']);
    await expect(card).toHaveAttribute('data-flipped', 'false');
  } finally { await app.close(); }
});
