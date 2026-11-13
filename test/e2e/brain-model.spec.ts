// E2E of the Brain section (ADR 0077, #84, #81) on the frozen demo, whose made-up brain has the former runbook and
// routines sections already migrated into skills: the Skill page (list, migration report, a role switched on from the
// skill's Ruoli tab and off again), Sempre caricato, Memoria
// and Mappa (agent → skills → rules → memory, plus the notes view), then the agent card's 3D flip (click, Esc back) and
// its fade under reduced motion; Memoria's «Diario e note» searches the journal. Screenshots dark and light in test-results/shots/brain-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Brain pages: skills with links and undo, rules, memory, map; the agent card flips', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchDemo();
  try {
    // ── Skill: the migrated skills in the list, the report, a role link switched on from the skill and off again
    await goPage(page, 'skill');
    const skills = page.getByTestId('skills-page');
    await expect(skills.getByTestId('bm-migration')).toBeVisible();
    await expect(skills.getByTestId('bm-migration')).toContainText('Spostata');
    const rows = skills.getByTestId('bm-skill-grid').locator('[data-testid^="bm-skill-"]');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText('Procedure', { exact: true })).toHaveCount(0);
    await shot(page, 'brain-skills-dark');

    const unused = skills.locator('[data-testid^="bm-skill-"][data-unused=true][data-origin=brain]').first();
    await expect(unused).toBeVisible();
    const name = (await unused.getAttribute('data-testid'))!.replace(/^bm-skill-/, '');
    await unused.click();
    await skills.getByTestId('sl-tab-roles').click();
    const box = skills.getByTestId('sl-roles').locator(`input[data-testid^="bm-link-${name}-"]:not([disabled])`).first();
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await shot(page, 'brain-skills-linked-dark');
    await box.uncheck();
    await expect(box).not.toBeChecked();

    // ── Sempre caricato (the old Regole tab, #366): the fixed core as cards, the characters against the budget
    await goPage(page, 'regole');
    const rules = page.getByTestId('bm-rules-page');
    await expect(rules.getByTestId('bm-rules-core').locator('article.catalog-card').first()).toBeVisible();
    await expect(rules.getByTestId('bm-rules-core').getByTestId('bm-rule-loaded').first()).toHaveText('Sempre');
    await expect(rules).toContainText('caratteri su');
    await shot(page, 'brain-rules-dark');

    // ── Memoria → Diario e note (#368, ADR 0245): now.md, the journal, ideas, errors and notes, searchable
    await goPage(page, 'memoria');
    const memory = page.getByTestId('bm-memory-page');
    await memory.getByTestId('mh-tab-file').click();
    const browser = memory.getByTestId('mb-page');
    await expect(browser.getByTestId('mb-row-now.md')).toBeVisible();
    await expect(browser.getByTestId('mb-detail')).toContainText('Rimborsi parziali');
    await browser.getByTestId('mb-search').fill('rimborsi');
    await expect(browser.getByTestId('mb-list').locator('li')).toHaveCount(2); // now.md and one journal day
    await browser.getByTestId('mb-list').locator('li').nth(1).locator('button').first().click();
    await expect(browser.getByTestId('mb-text')).toContainText('scritto il primo test e2e');
    await browser.getByTestId('mb-search').fill('');
    await browser.getByTestId('mb-shelf-errors').click();
    await expect(browser.getByTestId('mb-row-ai-errors.md')).toBeVisible();
    await expect(memory.getByTestId('bm-maint-memory').getByTestId('bm-run')).toHaveCount(0);
    await browser.getByTestId('mb-shelf-all').click();
    await browser.getByTestId('mb-search').fill('rilascio test');
    await expect(browser.getByTestId('mb-text')).toBeVisible();
    await shot(page, 'brain-memory-dark');

    // ── Mappa: agent → skills → rules → memory, with an inspector
    await goPage(page, 'collegamenti');
    const map = page.getByTestId('bm-map-page');
    const graph = map.getByTestId('bm-map-graph');
    await expect(graph.locator('.dash-node').first()).toBeVisible();
    await graph.locator('.dash-node').first().click();
    await expect(map.getByTestId('bm-map-inspector')).toBeVisible();
    await shot(page, 'brain-map-dark');
    await map.getByRole('button', { name: 'Note del brain' }).click();
    await expect(map.getByTestId('dash-map')).toBeVisible();

    // ── Agenti: no Avvia, no Dettagli; a click flips the card to its details and skills, Esc turns it back
    await goPage(page, 'agenti');
    const overview = page.getByTestId('agent-overview');
    const card = overview.locator('article.catalog-card').first();
    await expect(card).toBeVisible();
    await expect(overview.locator('[data-testid^="catalog-run-"]')).toHaveCount(0);
    await expect(overview.getByRole('button', { name: 'Dettagli' })).toHaveCount(0);
    const id = (await card.getAttribute('data-testid'))!.replace(/^catalog-card-/, '');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await card.getByTestId(`catalog-flip-${id}`).click();
    await expect(card).toHaveAttribute('data-flipped', 'true');
    await expect(card.getByTestId(`catalog-unflip-${id}`)).toBeFocused();
    await expect(card.getByTestId(`catalog-skills-${id}`)).toBeVisible();
    await expect(card.getByTestId(`catalog-front-${id}`)).toHaveAttribute('inert', '');
    await expect.poll(() => card.locator('.bm-flip-inner').evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
    await page.waitForTimeout(700);
    await shot(page, 'brain-agent-flipped-dark');
    await page.keyboard.press('Escape');
    await expect(card).toHaveAttribute('data-flipped', 'false');
    await expect(page.getByTestId('agent-overview')).toBeVisible(); // Esc turned the card, it did not leave the page
    await expect(card.getByTestId(`catalog-flip-${id}`)).toBeFocused();
    // reduced motion: no turn, the faces fade
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.getByTestId(`catalog-flip-${id}`).click();
    await expect(card).toHaveAttribute('data-flipped', 'true');
    expect(await card.locator('.bm-flip-inner').evaluate(el => getComputedStyle(el).transform)).toBe('none');
    await expect.poll(() => card.getByTestId(`catalog-back-${id}`).evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    // "Apri profilo" on the back opens the agent's page, with its skills and memory card
    await card.getByTestId(`catalog-open-${id}`).click();
    await expect(page.getByTestId('agent-skills')).toBeVisible();

    // ── light theme
    await theme(page, 'light');
    await goPage(page, 'agenti');
    const lightCard = page.getByTestId('agent-overview').locator('article.catalog-card').first();
    await lightCard.locator('[data-testid^="catalog-flip-"]').click();
    await expect(lightCard).toHaveAttribute('data-flipped', 'true');
    await shot(page, 'brain-agent-flipped-light');
    await goPage(page, 'skill');
    await expect(page.getByTestId('bm-skill-grid')).toBeVisible();
    await shot(page, 'brain-skills-light');
    await goPage(page, 'memoria');
    await expect(page.getByTestId('bm-memory-page')).toBeVisible();
    await shot(page, 'brain-memory-light');
    await goPage(page, 'collegamenti');
    await expect(page.getByTestId('bm-map-graph').locator('.dash-node').first()).toBeVisible();
    await shot(page, 'brain-map-light');
  } finally { await app.close(); }
});
