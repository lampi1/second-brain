// E2E of Impara's «Giornale» and «Pull Request» tabs (ADR 0265, editions ADR 0279) on the frozen demo, whose paper has
// two editions read offline (src/main/news/demo.ts) and summarized by a fake AI: the editions on top, the three
// columns, a short front page, a story read in place (why it matters, summary, links), J/K, S and the edition keys ([ and ]),
// the edition's panel with its sources and «Prova», a new edition from the form, the daily refresh off by default, and
// the PR tab with its filters and «Impara».
import { expect, test } from '@playwright/test';
import { goImpara, goPage, launchDemo, shot } from './helpers';

test('the News: editions, three columns, a story read in place, keys, the edition panel, the PR tab', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    // a fresh start opens the Giornale
    await goPage(page, 'impara');
    await expect(page.getByTestId('impara-tab-giornale')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('news-page')).toBeVisible();
    const items = page.getByTestId('news-list').getByTestId('news-item');
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    // a few stories only: the front page holds at most the edition's cap (7)
    expect(await items.count()).toBeGreaterThanOrEqual(3);
    expect(await items.count()).toBeLessThanOrEqual(7);
    await expect(page.getByTestId('news-edition-ai')).toHaveAttribute('aria-pressed', 'true');
    // the first story is open: the launch carried by the lab, Hacker News and more, with its summary and why
    const reader = page.getByTestId('news-reader');
    await expect(reader.locator('.nw-h')).toHaveText('Introducing Claude Fable 5.2 and Claude Mythos 5.2');
    await expect(page.getByTestId('news-why')).toBeVisible();
    await expect(page.getByTestId('news-links').locator('a')).toHaveCount(2);
    await expect(page.getByTestId('news-cost')).toContainText('token');
    await shot(page, 'news-dark');

    // J moves, S saves; the saved story is in «Salvate»
    await page.mouse.move(2, 2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('j');
    const second = await reader.getAttribute('data-id');
    await expect(items.nth(1)).toHaveClass(/sel/);
    await page.keyboard.press('s');
    await page.getByTestId('news-view-saved').click();
    await expect(page.getByTestId('news-list').getByTestId('news-item')).toHaveCount(1);
    await expect(page.getByTestId('news-list').getByTestId('news-item').first()).toHaveAttribute('data-id', second!);

    // a section shows only its stories
    await page.getByTestId('news-view-harness').click();
    await expect(page.getByTestId('news-list')).toContainText('Claude Code 2.1.321');

    // the edition's panel: the edition itself, each source with how it is read and its last reading; the daily refresh is off
    await page.getByTestId('news-sources-btn').click();
    const panel = page.getByTestId('news-sources');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('news-ed-name')).toHaveValue('AI per chi costruisce agenti');
    await expect(panel.getByTestId('news-ed-cap')).toHaveValue('7');
    await expect(panel.getByTestId('news-src-claude-code')).toContainText('RSS');
    await expect(panel.getByTestId('news-src-claude-code').locator('.ok')).toBeVisible();
    await expect(panel.getByTestId('news-auto')).toHaveAttribute('aria-checked', 'false');
    await expect(panel.getByTestId('news-estimate')).toBeVisible();
    await shot(page, 'news-sources-dark');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // the second edition is another subject, with its own sections and stories (key ])
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(']');
    await expect(page.getByTestId('news-editions').locator('[aria-pressed="true"]')).toContainText('Auto elettriche');
    await expect(page.getByTestId('news-list')).toContainText('autonomia');
    await expect(page.getByTestId('news-view-ricarica')).toBeVisible();
    await shot(page, 'news-cars-dark');

    // a new edition from the form, made empty: it has no source yet
    await page.getByTestId('news-edition-new').click();
    const form = page.getByTestId('news-new');
    await form.getByTestId('news-new-name').fill('Vela');
    await form.getByTestId('news-new-interest').fill('Regate oceaniche e nuove barche a foil.');
    await shot(page, 'news-new-dark');
    await form.getByTestId('news-new-empty').click();
    await expect(page.getByTestId('news-editions').locator('[aria-pressed="true"]')).toContainText('Vela');

    // the PR tab: the same three columns, the user's PRs and «Impara»
    await goImpara(page, 'pr');
    await expect(page.getByTestId('impara-pr-tab')).toBeVisible();
    // the demo has read no PR yet: the tab reads them (the Task page's refresh)
    await page.getByTestId('impara-prs-refresh').click();
    await expect(page.getByTestId('impara-pr-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('impara-pr-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'news-prs-dark');
  } finally {
    await app.close();
  }
});
