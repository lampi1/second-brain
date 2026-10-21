// The task estimate on screen (ADR 0087), on the frozen demo (its run history: src/main/agents/run-estimates.ts): each
// working strip reads «stima ~… · su N lavori simili» with a "?" that says how it is computed and how accurate the
// estimates have been, with the accuracy bars; a run that ends shows estimate → actual with ✓ or ✗. The Orchestrator's
// column has no plan panel (#124): it starts with its messages. Screenshots: test-results/shots/task-estimate-*.png
// (dark and light).
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function theme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(t => window.sb.invoke('settings:set', { theme: t }), scheme);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
}

test('strips show readable estimates from similar tasks, with their accuracy', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1000, orchestrator: true });
  try {
    // the QA run: same agent and same kind; the SMS run: no Sentinel fix yet, so fixes on any agent
    const qa = page.getByTestId('chat-estimate-qa');
    await expect(qa).toBeVisible();
    await expect(qa).toContainText(/~\d+ min · ~\d+,\d\d\s\$ · su \d+ lavori simili/);
    await expect(page.getByTestId('chat-estimate-sms')).toContainText('lavori simili');

    // the Orchestrator's column starts with its messages: no plan panel (#124)
    await expect(page.getByTestId('tile-orchestrator')).toBeVisible();
    await expect(page.getByTestId('orchestrator-plan')).toHaveCount(0);
    await shot(page, 'task-estimate-dark');

    // the "?" explains the figure and the accuracy
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

    // a run that ends: estimate → actual
    await page.getByTestId('tile-chat-mappa').click();
    await page.getByTestId('tile-chat-mappa').getByTestId('run-outcome-success').click();
    const mappa = page.getByTestId('chat-estimate-mappa');
    await expect(mappa).toContainText('→');
    await expect(mappa).toHaveAttribute('data-hit', /true|false/);

    await theme(page, 'light');
    await page.mouse.move(2, 2);
    await shot(page, 'task-estimate-light');
  } finally { await app.close(); }
});
