// E2E of the Brain section (ADR 0077, #84, #81) on the frozen demo, whose made-up brain has the former runbook and
// routines sections already migrated into skills: the Skill page (cards, migration report, a link toggle logged in the
// maintenance panel and undone), Regole, Memoria, Classificatori (read-only cards; each detail holds its tables, "nessun dato ancora" where there is none)
// and Mappa (agent → skills → rules → memory, plus the notes view), then the agent card's 3D flip (click, Esc back) and
// its fade under reduced motion. Screenshots dark and light in test-results/shots/brain-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(250);
}

test('Brain pages: skills with links and undo, rules, memory, classifiers, map; the agent card flips', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchDemo();
  try {
    // ── Skill: the migrated skills as cards, the report, a link logged and undone
    await goPage(page, 'skill');
    const skills = page.getByTestId('skills-page');
    await expect(skills.getByTestId('bm-migration')).toBeVisible();
    await expect(skills.getByTestId('bm-migration')).toContainText('Spostata');
    const cards = skills.getByTestId('bm-skill-grid').locator('article.catalog-card');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('Procedure', { exact: true })).toHaveCount(0);
    await shot(page, 'brain-skills-dark');

    const unused = skills.locator('article.catalog-card[data-unused=true]').first();
    await expect(unused).toBeVisible();
    const name = (await unused.getAttribute('data-testid'))!.replace(/^bm-skill-/, '');
    const target = page.getByTestId(`bm-skill-${name}`);
    await target.getByTestId(`bm-toggles-${name}`).locator('summary').click();
    const box = target.getByTestId(`bm-toggles-${name}`).locator('input[type=checkbox]').first();
    const agentName = (await target.getByTestId(`bm-toggles-${name}`).locator('label').first().innerText()).trim();
    await box.check();
    await expect(page.getByTestId(`bm-skill-${name}`)).toHaveAttribute('data-unused', 'false');
    await expect(page.getByTestId(`bm-skill-${name}`)).toContainText(agentName);
    const maint = skills.getByTestId('bm-maintenance');
    await expect(maint.getByTestId('bm-change').first()).toContainText(name);
    await expect(maint).toContainText('Parte solo quando premi «Manutenzione»');
    await target.getByTestId(`bm-toggles-${name}`).locator('summary').click(); // folds the popover
    await maint.scrollIntoViewIfNeeded();
    await shot(page, 'brain-skills-linked-dark');
    await maint.getByTestId('bm-undo').first().click();
    await expect(maint.getByTestId('bm-change').first()).toContainText('Annullata');
    await expect(page.getByTestId(`bm-skill-${name}`)).toHaveAttribute('data-unused', 'true');

    // ── Regole
    await goPage(page, 'regole');
    const rules = page.getByTestId('bm-rules-page');
    await expect(rules.locator('article.catalog-card').first()).toBeVisible();
    await expect(rules.getByTestId('bm-rule-loaded').first()).toBeVisible();
    await shot(page, 'brain-rules-dark');

    // ── Memoria: knowledge, what happened, the agents' memories; "Unisci i doppioni"
    await goPage(page, 'memoria');
    const memory = page.getByTestId('bm-memory-page');
    await memory.getByTestId('mh-tab-file').click(); // the files are Memoria's File tab (ADR 0122)
    for (const s of ['knowledge', 'happened', 'agents']) await expect(memory.getByTestId(`bm-mem-section-${s}`)).toBeVisible();
    await expect(memory.getByTestId('bm-mem-section-agents').locator('article.catalog-card').first()).toBeVisible();
    await expect(memory.getByTestId('bm-maint-memory').getByTestId('bm-run')).toHaveCount(0);
    await expect(page.getByTestId('topbar-maint')).toBeVisible();
    await shot(page, 'brain-memory-dark');

    // ── Classificatori: read only, "nessun dato ancora" where nothing was measured
    await goPage(page, 'classificatori');
    const cls = page.getByTestId('bm-classifiers-page');
    // a grid of cards (stats-cards.spec.ts covers them); the tables of before live in each classifier's detail
    await expect(cls.getByTestId('cls-grid')).toBeVisible();
    await expect(cls.locator('input, textarea, select')).toHaveCount(0);
    await shot(page, 'brain-classifiers-dark');
    for (const [card, tables] of [['model', ['routing', 'quality']], ['kind', ['kinds']], ['skills', ['choices']]] as const) {
      await cls.getByTestId(`cls-card-${card}`).locator('h3 button').click();
      for (const p of tables) await expect(cls.getByTestId(`bm-cls-${p}`)).toBeVisible();
      if (card === 'model') await expect(cls.getByText('nessun dato ancora').first()).toBeVisible();
      await cls.getByTestId('cls-back').click();
    }

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
    await goPage(page, 'classificatori');
    await expect(page.getByTestId('cls-grid')).toBeVisible();
    await shot(page, 'brain-classifiers-light');
    await goPage(page, 'collegamenti');
    await expect(page.getByTestId('bm-map-graph').locator('.dash-node').first()).toBeVisible();
    await shot(page, 'brain-map-light');
  } finally { await app.close(); }
});
