// Cloud agents in the Grindhouse (ADR 0080, issue #79), on the frozen demo's fake cloud agents (no CLI, no network):
// one strip per agent under the local ones, grouped by area with a "cloud" badge and the engine; the Cursor strip
// expands to its streamed messages and takes a follow-up; Codex says follow-up and stop are on its page; Claude shows
// "stato su claude.ai". "Nuovo agente" offers "Dove: Locale / Cloud" with each engine's readiness. Screenshots in
// test-results/shots/cloud-strips.png, cloud-strip-expanded.png, cloud-newchat.png (dark) and cloud-strips-light.png.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('cloud agents: strips with badge and engine, expand + follow-up, Locale / Cloud in Nuovo agente', async () => {
  const { app, page } = await launchDemo({ width: 1500, height: 1000 });
  try {
    const strips = page.getByTestId('cloud-strips');
    await expect(strips).toBeVisible();
    for (const [id, engine] of [['bc-demo-checkout', 'cursor'], ['task_e_demo_payments', 'codex'], ['session_demo_refunds', 'claude']] as const) {
      const strip = page.getByTestId(`cloud-strip-${id}`);
      await expect(strip).toHaveAttribute('data-engine', engine);
      await expect(strip.locator('.cloud-badge')).toBeVisible();
    }
    await expect(strips.locator('.workspace-area')).toHaveText(['alfa-shop · cloud', 'alfa-e2e · cloud']);
    await expect(page.getByTestId('cloud-state-bc-demo-checkout')).toHaveText('al lavoro');
    await expect(page.getByTestId('cloud-state-session_demo_refunds')).toHaveText('stato su claude.ai');
    await expect(page.getByTestId('cloud-sub-bc-demo-checkout')).toContainText('cursor/checkout-veloce-a1b2');
    await expect(page.getByTestId('cloud-sub-task_e_demo_payments')).toContainText('dal piano');
    await expect(page.getByTestId('cloud-stop-bc-demo-checkout')).toBeVisible();
    await expect(page.getByTestId('cloud-stop-task_e_demo_payments')).toHaveCount(0); // Codex: stop only on its page
    await strips.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'cloud-strips');

    // Codex: messages and stop on its page (one strip open at a time: the next one closes it)
    await page.getByTestId('cloud-expand-task_e_demo_payments').click();
    await expect(page.getByTestId('cloud-work-task_e_demo_payments')).toContainText('sulla sua pagina');
    await expect(page.getByTestId('cloud-apply-task_e_demo_payments')).toBeVisible();
    // the Cursor strip expands to its messages and takes a follow-up
    await page.getByTestId('cloud-strip-bc-demo-checkout').locator('.chat-strip-line').click();
    await expect(page.getByTestId('cloud-expand-bc-demo-checkout')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('cloud-work-bc-demo-checkout')).toContainText('debounce');
    await page.getByTestId('cloud-input-bc-demo-checkout').fill('Aggiungi anche un test per i coupon');
    await page.getByTestId('cloud-send-bc-demo-checkout').click();
    await expect(page.getByTestId('cloud-input-bc-demo-checkout')).toHaveValue('');
    await expect(page.getByTestId('cloud-apply-bc-demo-checkout')).toBeVisible();
    await expect(page.getByTestId('cloud-expand-task_e_demo_payments')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('cloud-strip-bc-demo-checkout').scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'cloud-strip-expanded');

    // Nuovo agente: Dove → Cloud, each engine's readiness for the folder
    await page.keyboard.press('Control+N');
    await expect(page.getByTestId('newchat')).toBeVisible();
    await page.getByTestId('newchat-prompt').fill('Rendi più veloce la ricerca prodotti');
    // a work agent, not an Orchestrator: only then is "Dove" offered
    if (await page.getByTestId('newchat-orchestrator').isChecked()) await page.getByTestId('newchat-orchestrator').uncheck();
    await page.getByTestId('newchat-where-pick').getByRole('radio', { name: 'Cloud' }).click();
    await expect(page.getByTestId('newchat-cloud-cursor')).toContainText('pronto');
    await expect(page.getByTestId('newchat-cloud-cursor')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('newchat-create')).toHaveText('Avvia nel cloud');
    await page.mouse.move(2, 2);
    await shot(page, 'cloud-newchat');
    await page.getByTestId('newchat-create').click();
    await expect(page.getByTestId('newchat')).toHaveCount(0);
    await expect(page.locator('[data-testid^="cloud-strip-cursor-demo-"]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('cloud strips in the light theme', async () => {
  const { app, page } = await launchDemo({ width: 1500, height: 1000, scheme: 'light' });
  try {
    // the app's theme setting (default dark): light
    await goPage(page, 'impostazioni');
    await page.locator('[aria-label="Tema"]').first().click();
    await page.locator('[role="option"][data-value="light"]').click();
    await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
    await goPage(page, 'home');
    const strips = page.getByTestId('cloud-strips');
    await expect(strips).toBeVisible();
    await strips.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'cloud-strips-light');
  } finally {
    await app.close();
  }
});
