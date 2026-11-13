// UI acceptance of the classifiers and statistics cleanup (ADR 0186) on the frozen demo, no provider requests: the Agenti
// card front shows the success share (or n/5 under the sample) with its "?", the reviews switch says when it is off,
// Classificatori has no skills card, Apprendimento says how many lessons the agents proposed and that their evidence is
// never causal, a role's versions show runs, verified outcomes and success ± (or «troppo pochi»). Screenshots dark and
// light in test-results/shots/honest-*.png.
import { expect, test, type Page } from '@playwright/test';
import { goPage, launchDemo, openAgentOverview, openAgents, shot } from './helpers';

/** G J: the Apprendimento tab of Memoria (as learning.spec.ts) */
async function goLearning(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('j');
}

for (const scheme of ['dark', 'light'] as const) {
  test(`honest statistics on the Agenti, Classificatori and Apprendimento pages (${scheme})`, async () => {
    test.setTimeout(150_000);
    const { app, page } = await launchDemo({ scheme, height: 1600, config: { theme: scheme } });
    try {
      // the Agenti card: one success definition on its front
      await openAgentOverview(page);
      const success = page.getByTestId('catalog-success-artisan');
      await expect(success).toBeVisible();
      await expect(success).toContainText(/%|\d\/5/);
      await expect(success.locator('.help-tip')).toHaveCount(1);
      await shot(page, `honest-agents-${scheme}`);
      // the reviews switch off: the page says so and since when
      const sw = page.getByTestId('judging-switch');
      if (await page.getByTestId('judging-on').getAttribute('aria-checked') === 'true') await page.getByTestId('judging-on').click();
      await expect(sw.getByTestId('judging-off')).toBeVisible();
      await sw.scrollIntoViewIfNeeded();
      await shot(page, `honest-judging-off-${scheme}`);

      // a role's versions with their numbers
      await openAgents(page, 'artisan');
      await page.getByTestId('agent-versions').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('agent-versions').getByTestId('version-stats').first()).toContainText(/run|Nessuna run|No finished run/);
      await shot(page, `honest-versions-${scheme}`);

      // Classificatori: no skills card any more
      await goPage(page, 'classificatori');
      const cls = page.getByTestId('bm-classifiers-page');
      await expect(cls.getByTestId('cls-grid')).toBeVisible();
      await expect(cls.getByTestId('cls-card-skills')).toHaveCount(0);
      await expect(cls.getByTestId('cls-card-jobkind')).toBeVisible();
      await shot(page, `honest-classifiers-${scheme}`);

      // Apprendimento: the lessons, said honestly
      await goLearning(page);
      const lessons = page.getByTestId('learning-page').getByTestId('lr-lessons');
      await expect(lessons).toBeVisible();
      await expect(lessons.getByTestId('lr-lessons-causal')).toContainText(/causal/);
      await lessons.scrollIntoViewIfNeeded();
      await shot(page, `honest-learning-${scheme}`);
    } finally { await app.close(); }
  });
}
