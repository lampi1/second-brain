// E2E of Impara's «Spiegazione» (ADR 0230) on the frozen demo (main/learn/demo.ts): the default kind of lesson, shown
// first in the options line and picked in the options' «Tipo di lezione». A PR lesson started in it plays its pieces
// with no check between them (the service drops the plan's checks), the narration short with «Testo completo», the
// tutor without the coach switch; «Fammi un esempio» answers with a before/after compare whose «Dopo» joins at the
// second beat, each side drawn on its own; the last piece offers «Spiegalo tu», never opened by itself, with no score,
// no «Eri sicuro?» and no review cards. impara.spec.ts keeps the quiz lessons. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

const PR = 'https://github.com/lampi1/second-brain/pull/251';

test('an explanation lesson (ADR 0230): the default, no checks, a before/after compare, an optional «Spiegalo tu» with no score', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impara');
    await expect(page.getByTestId('impara-start')).toBeVisible();
    // the default kind of lesson, first in the options line and in the options
    await expect(page.getByTestId('impara-options-summary')).toContainText('Spiegazione');
    await page.getByTestId('impara-options-open').click();
    await expect(page.getByTestId('impara-mode-explain')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('impara-mode-quiz')).toHaveAttribute('aria-checked', 'false');
    await shot(page, 'impara-mode-dark');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('impara-options-pop')).toHaveCount(0);

    // a PR lesson: the research as in a quiz lesson, then the pieces
    await page.getByTestId('impara-ask-what').fill(PR);
    await page.getByTestId('impara-start-btn').click();
    await expect(page.getByTestId('impara-preparing')).toBeVisible();
    await expect(page.getByTestId('impara-topics')).toHaveAttribute('data-state', 'wait', { timeout: 10_000 });
    await page.getByTestId('impara-topics-go').click();
    await expect(page.getByTestId('impara-say')).toContainText('a blocchi', { timeout: 15_000 });
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 1 di 6');
    // the short narration, the full text behind «Testo completo»
    await expect(page.getByTestId('impara-full')).toBeVisible();
    // no graded end on the rail
    await expect(page.getByTestId('impara-rail-end')).toHaveCount(0);

    // piece 2, then piece 3: no check between them
    await page.getByTestId('impara-next').click();
    await expect(page.getByTestId('impara-visual')).toHaveAttribute('data-kind', 'code', { timeout: 10_000 });
    await page.getByTestId('impara-next').click();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 3 di 6', { timeout: 15_000 });
    await expect(page.getByTestId('impara-check')).toHaveCount(0);
    await page.waitForTimeout(700);
    await shot(page, 'impara-explain-dark');

    // «Fammi un esempio»: a before/after compare; «Dopo» joins at the second beat
    await page.getByTestId('impara-unclear').click();
    await page.getByTestId('impara-example').click();
    const compare = page.getByTestId('impara-compare');
    await expect(compare).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('impara-visual')).toHaveAttribute('data-kind', 'compare');
    await expect(compare.locator('.lv-side[data-side="before"] img')).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId('impara-say').locator('span').nth(1).click();
    await expect(compare).toHaveAttribute('data-after', '1');
    await expect(compare.locator('.lv-side[data-side="after"] img')).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(700);
    await shot(page, 'impara-compare-dark');

    // the tutor tells: no coach switch
    await page.getByTestId('impara-unclear').click();
    await page.getByTestId('impara-ask').click();
    await expect(page.getByTestId('impara-tutor')).toBeVisible();
    await expect(page.getByTestId('impara-tutor-coach')).toHaveCount(0);
    await page.getByTestId('impara-tutor-input').press('Escape');
    await expect(page.getByTestId('impara-tutor')).toHaveCount(0);

    // to the last piece: never a check on the way
    for (let i = 0; i < 8 && await page.getByTestId('impara-next').isEnabled(); i++) {
      await page.getByTestId('impara-next').click();
      await expect(page.getByTestId('impara-check')).toHaveCount(0);
    }
    await expect(page.getByTestId('impara-next')).toBeDisabled();
    // «Spiegalo tu»: offered, never opened by itself; no score, no confidence, no review cards
    await expect(page.getByTestId('impara-end')).toHaveCount(0);
    await page.getByTestId('impara-teach-back').click();
    await expect(page.getByTestId('impara-end')).toBeVisible();
    await expect(page.getByTestId('impara-explain-input')).toBeVisible();
    await expect(page.getByTestId('impara-score')).toHaveCount(0);
    await expect(page.getByTestId('impara-end-cards')).toHaveCount(0);
    await shot(page, 'impara-teach-back-dark');
    await page.getByTestId('impara-explain-skip').click();
    await expect(page.getByTestId('impara-end')).toHaveCount(0);
    await expect(page.getByTestId('impara-teach-back')).toBeVisible();
  } finally {
    await app.close();
  }
});
