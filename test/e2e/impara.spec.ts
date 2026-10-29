// E2E of Impara (ADR 0183) on the frozen demo, whose lessons are written by hand about the real PR #251
// (main/learn/demo.ts) and whose voice is the fake one: the page lists the saved lessons, a GitHub PR link starts a
// lesson (preparing, then the first pieces while the rest is written), the blackboard lights the piece's nodes, the
// code of the piece shows, a check marks the answer and says why, «Spiegamelo meglio» adds a piece after the current
// one, the end grades «Spiegalo tu», and the lesson reopens where it was. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

const PR = 'https://github.com/lampi1/second-brain/pull/251';

test('learn a PR on the blackboard: pieces, check, better explanation, explain it yourself, saved', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo();
  try {
    await goPage(page, 'impara');
    await expect(page.getByTestId('impara-start')).toBeVisible();
    await expect(page.getByTestId('impara-lessons').locator('.ip-card')).toHaveCount(2);
    await shot(page, 'impara-start-dark');

    // a GitHub PR by its link: preparing, then the first piece
    await page.getByTestId('impara-kind-pr').click();
    await page.getByTestId('impara-pr-url').fill(PR);
    await page.getByTestId('impara-start-btn').click();
    await expect(page.getByTestId('impara-preparing')).toBeVisible();
    const player = page.getByTestId('impara-player');
    await expect(page.getByTestId('impara-say')).toContainText('a blocchi', { timeout: 15_000 });
    await expect(page.getByTestId('impara-title')).toHaveText('Risposte parola per parola (PR #251)');
    await expect(page.getByTestId('impara-diagram')).toHaveAttribute('data-focus', 'engine,view');
    await expect(page.getByTestId('impara-diagram').locator('img.in')).toBeVisible();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 1 di 5');

    // piece 2: its nodes, its real code, its new words
    await page.getByTestId('impara-next').click();
    await expect(page.getByTestId('impara-diagram')).toHaveAttribute('data-focus', 'manager');
    await expect(page.getByTestId('impara-code-panel')).toContainText('ITEM_FRAME_MS');
    await expect(page.getByTestId('impara-note')).toContainText('100 ms → 16 ms');
    await page.waitForTimeout(700);
    await shot(page, 'impara-player-dark');

    // the check after piece 2: a wrong answer is marked, the right one shown, and why
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('impara-check')).toBeVisible();
    await page.getByTestId('impara-opt-1').click();
    await expect(page.getByTestId('impara-opt-0')).toHaveClass(/good/);
    await expect(page.getByTestId('impara-opt-1')).toHaveClass(/bad/);
    await expect(page.getByTestId('impara-check-why')).toContainText('due attese in fila');
    await page.getByTestId('impara-conf-2').click();
    await expect(page.getByTestId('impara-conf-2')).toHaveAttribute('aria-checked', 'true');
    await shot(page, 'impara-check-dark');

    // the rest arrived meanwhile: piece 3, then «Spiegamelo meglio» adds a piece after it and lands on it
    await page.getByTestId('impara-check-next').click();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 3 di 5', { timeout: 15_000 });
    await page.getByTestId('impara-better').click();
    await expect(page.getByTestId('impara-busy')).toBeVisible();
    await expect(page.getByTestId('impara-say')).toContainText('due semafori', { timeout: 10_000 });
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Spiegato meglio');
    await expect(page.getByTestId('impara-rail').locator('.ip-st-x')).toHaveCount(1);

    // the end: «Spiegalo tu», graded
    await page.getByTestId('impara-rail-end').click();
    await expect(page.getByTestId('impara-end')).toBeVisible();
    await page.getByTestId('impara-explain-input').fill('Prima il testo si fermava due volte per 100 ms, nel main e nello store; ora aspetta un fotogramma di 16 ms.');
    await page.getByTestId('impara-explain-send').click();
    await expect(page.getByTestId('impara-grade')).toContainText('finestra nascosta', { timeout: 10_000 });
    await expect(page.getByTestId('impara-score')).toContainText('0%');
    await shot(page, 'impara-end-dark');

    // saved: the list has it, and it reopens at the end
    await page.getByTestId('impara-back').click();
    const cards = page.getByTestId('impara-lessons').locator('.ip-card');
    await expect(cards).toHaveCount(3);
    await cards.first().locator('.ip-card-open').click();
    await expect(player).toHaveAttribute('data-at', 'end');
    await expect(page.getByTestId('impara-explain-answer')).toContainText('fotogramma');
  } finally {
    await app.close();
  }
});

test('a saved lesson reopens where it was, light theme, rail with numbers beside the Orchestrator', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchDemo({ scheme: 'light' });
  try {
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await goPage(page, 'impara');
    const card = page.getByTestId('impara-lessons').locator('.ip-card', { hasText: 'PR #249' });
    await card.locator('.ip-card-open').click();
    await expect(page.getByTestId('impara-piece-label')).toHaveText('Pezzo 2 di 3');
    await expect(page.getByTestId('impara-diagram')).toHaveAttribute('data-focus', 'agents,cpu');
    await expect(page.getByTestId('impara-rail-1')).toHaveAttribute('data-tip', 'Il sintomo');
    await page.waitForTimeout(700);
    await shot(page, 'impara-player-light');
    // voice off: the written text in place of the spoken one
    await page.getByTestId('impara-voice').click();
    await expect(page.getByTestId('impara-text')).toContainText('cpuMs');
  } finally {
    await app.close();
  }
});
