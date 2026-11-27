// The task estimate on screen (ADR 0087), on the frozen demo (its run history: src/main/agents/run-estimates.ts): each
// working strip reads «stima ~… · su N lavori simili» with a "?" that says how it is computed and how accurate the
// estimates have been, with the accuracy bars; a run that ends shows estimate → actual with ✓ or ✗. The Orchestrator's
// column has no plan panel (#124): it starts with its messages. Screenshots: test-results/shots/task-estimate-*.png
// (dark and light).
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
}

test('strips show readable estimates from similar tasks, with their accuracy', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000, orchestrator: true });
  try {
    // the QA run: the same agent on the same model; the SMS run (another model): the same agent on any model (ADR 0285)
    // closed, the strip carries time and cost so far; the estimate is in its ⓘ (ADR 0366), the chip in the open chat's details
    await expect(page.getByTestId('chat-meta-qa')).toContainText(/\d+ min/);
    await expect(page.getByTestId('strip-info-qa')).toHaveAttribute('aria-label', /stima ~\d+ min/);
    // one chat open at a time (its team on the bench): QA's details and the "?" of its estimate, back, then SMS's
    for (const id of ['qa', 'sms']) {
      await page.getByTestId(`chat-expand-${id}`).click();
      await page.getByTestId(`chat-facts-${id}`).click();
      const est = page.getByTestId(`chat-estimate-${id}`);
      await expect(est).toContainText('lavori simili');
      if (id !== 'qa') continue;
      await expect(est).toContainText(/~\d+ min · ~\d+,\d\d\s\$ · su \d+ lavori simili/);
      // the Orchestrator's column starts with its messages: no plan panel (#124)
      await expect(page.getByTestId('tile-orchestrator')).toBeVisible();
      await expect(page.getByTestId('orchestrator-plan')).toHaveCount(0);
      await shot(page, 'task-estimate-dark');
      // the "?" explains the figure and the accuracy (QA's run)
      await page.getByTestId('estimate-help-r_000000000002').click();
      const bubble = page.getByTestId('estimate-help-r_000000000002-bubble');
      await expect(bubble).toBeVisible();
      await expect(bubble).toContainText('Come si calcola la stima');
      await expect(bubble).toContainText('stesso agente (');
      await expect(bubble).toContainText('Quanto tengono le stime');
      await expect(bubble.getByTestId('estimate-accuracy')).toContainText(/entro ×2: \d+\/\d+/);
      await expect(bubble.getByTestId('estimate-accuracy')).not.toContainText(/precisione|pt in/); // ADR 0101
      await shot(page, 'task-estimate-help-dark');
      await page.keyboard.press('Escape');
      await page.getByTestId('bench-back').click();
    }
    await page.getByTestId('bench-back').click();

    // a run that ends: estimate → actual
    await page.getByTestId('chat-expand-mappa').click();
    await page.getByTestId('tile-chat-mappa').getByTestId('run-outcome-success').click();
    await page.getByTestId('chat-facts-mappa').click();
    const mappa = page.getByTestId('chat-estimate-mappa');
    await expect(mappa).toContainText('→');
    await expect(mappa).toHaveAttribute('data-hit', /true|false/);

    await theme(page, 'light');
    await page.mouse.move(2, 2);
    await shot(page, 'task-estimate-light');
  } finally { await app.close(); }
});
