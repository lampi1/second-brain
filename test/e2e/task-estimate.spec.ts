// The task estimate on screen (ADR 0087), on the frozen demo (its run history: src/main/agents/run-estimates.ts): each
// working strip reads «stima ~… · su N lavori simili» with a "?" that says how it is computed and how accurate the
// estimates have been; the Orchestrator's plan lists the agents it started today with their estimates, the sum and the
// accuracy bars; a run that ends shows estimate → actual with ✓ or ✗. Screenshots: test-results/shots/task-estimate-*.png
// (dark and light).
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
}

test('strips and the Orchestrator plan show readable estimates from similar tasks, with their accuracy', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000, orchestrator: true });
  try {
    // the QA run: same agent and same kind; the SMS run: no Sentinel fix yet, so fixes on any agent
    const qa = page.getByTestId('chat-estimate-qa');
    await expect(qa).toBeVisible();
    await expect(qa).toContainText(/~\d+ min · ~\d+,\d\d\s\$ · su \d+ lavori simili/);
    await expect(page.getByTestId('chat-estimate-sms')).toContainText('lavori simili');

    const plan = page.getByTestId('orchestrator-plan');
    await expect(plan).toBeVisible();
    await expect(plan.locator('[data-testid^="orchestrator-plan-row-"]')).toHaveCount(4);
    await expect(page.getByTestId('orchestrator-plan-row-feedback')).toContainText('via rapida');
    await expect(page.getByTestId('orchestrator-plan-total')).toContainText(/~\d.* · ~\d+,\d\d/);
    await expect(plan.getByTestId('estimate-accuracy')).toContainText(/entro ×2: \d+\/\d+/);
    await expect(plan.getByTestId('estimate-accuracy')).not.toContainText(/precisione|pt in/); // ADR 0101
    await shot(page, 'task-estimate-dark');

    // the "?" explains the figure and the accuracy
    await page.getByTestId('estimate-help-r_000000000002').click();
    const bubble = page.getByTestId('estimate-help-r_000000000002-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('Come si calcola la stima');
    await expect(bubble).toContainText('stesso agente (');
    await expect(bubble).toContainText('Precisione delle stime');
    await shot(page, 'task-estimate-help-dark');
    await page.keyboard.press('Escape');

    // a run that ends: estimate → actual
    await page.getByTestId('tile-chat-mappa').click();
    await page.getByTestId('tile-chat-mappa').getByTestId('run-outcome-success').click();
    const mappa = page.getByTestId('chat-estimate-mappa');
    await expect(mappa).toContainText('→');
    await expect(mappa).toHaveAttribute('data-hit', /true|false/);
    await expect(page.getByTestId('orchestrator-plan-row-mappa')).toContainText('→');

    await theme(page, 'light');
    await page.mouse.move(2, 2);
    await shot(page, 'task-estimate-light');
    await page.getByTestId('orchestrator-plan-help').click();
    await expect(page.getByTestId('orchestrator-plan-help-bubble')).toContainText('via rapida');
    await shot(page, 'task-estimate-plan-help-light');
  } finally { await app.close(); }
});
