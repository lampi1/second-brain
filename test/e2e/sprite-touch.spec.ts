// E2E of the clicks on a role's little person (ADR 0297), on the frozen demo: a left click on the person of a strip
// plays the pat, a right click the whack of the stick, and neither opens the strip; the chat's run keeps the last one
// (its tooltip says so, the second same click writes nothing new); the person on the front of a role card reacts too
// and the card does not turn. At each click the person says a line of its own in a small bubble (ADR 0303).
// Screenshot in test-results/shots/sprite-touch-*.png.
import { expect, test, type Locator } from '@playwright/test';
import { quips } from '../../src/shared/agent-quips';
import { goPage, launchDemo, shot } from './helpers';

/** Every reaction the person shows from now on, and every line it says, as they come (an observer: the reaction
 *  lasts about a second and the bubble a little more, so neither is read later from the page). */
async function watch(person: Locator): Promise<{ seen: () => Promise<string[]>; said: () => Promise<string[]> }> {
  await person.evaluate(el => {
    const seen: string[] = [], said: string[] = [];
    Object.assign(el, { seen, said });
    new MutationObserver(() => {
      const r = el.getAttribute('data-react'), q = el.querySelector('.quip')?.textContent;
      if (r && seen[seen.length - 1] !== r) seen.push(r);
      if (q && said[said.length - 1] !== q) said.push(q);
    }).observe(el, { attributes: true, attributeFilter: ['data-react'], childList: true, subtree: true, characterData: true });
  });
  return { seen: () => person.evaluate(el => (el as unknown as { seen: string[] }).seen), said: () => person.evaluate(el => (el as unknown as { said: string[] }).said) };
}

test('the little person reacts to a click: a pat, a whack, and the run keeps the last one', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const strip = page.getByTestId('tile-chat-mappa'), person = strip.locator('.strip-face .agent-sprite');
    await expect(person).toHaveAttribute('title', /Conta pochissimo/);
    const { seen, said } = await watch(person);
    await person.click();
    await expect.poll(seen).toEqual(['pat']);
    // it says one of its own lines for a pat, in a bubble (the demo's «mappa» chat is the Artisan's)
    await expect.poll(async () => (await said()).length).toBe(1);
    expect(quips('artisan', 'pat', 'it')).toContain((await said())[0]);
    await shot(page, 'sprite-touch-pat');
    await expect(person).toHaveAttribute('title', /Buffetto dato/);
    await person.click({ button: 'right' });
    await expect.poll(seen).toEqual(['pat', 'whack']);
    await expect.poll(async () => (await said()).length).toBe(2);
    expect(quips('artisan', 'whack', 'it')).toContain((await said())[1]);
    await expect(person).toHaveAttribute('title', /Bastonata data/);
    // the clicks stayed on the person: the strip is still closed, no menu opened
    await expect(page.getByTestId('chat-expand-mappa')).toHaveAttribute('aria-expanded', 'false');
    // the role card: the person reacts, the card does not turn
    await goPage(page, 'agenti');
    const card = page.getByTestId('catalog-card-artisan'), hero = card.locator('.catalog-hero .agent-sprite');
    await expect(hero).toBeVisible();
    const { seen: heroSeen } = await watch(hero);
    await hero.click({ button: 'right' });
    await expect.poll(heroSeen).toEqual(['whack']);
    await expect(card).toHaveAttribute('data-flipped', 'false');
  } finally { await app.close(); }
});
