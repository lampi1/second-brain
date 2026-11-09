// The Orchestrator chat stays clean (#351, ADR 0250), in the frozen demo: an agent's result is one folded row (name,
// role, its first line) until «Mostra il risultato», and the app's delivery message for the model is never drawn.
// Screenshots: test-results/shots/orchestrator-clean-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, openOrchestrator, shot } from './helpers';

test('a delivered result is folded with its first line; the delivery message is not drawn', async () => {
  const { app, page } = await launchDemo();
  try {
    await openOrchestrator(page);
    const row = page.getByTestId('result-ready').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('result-ready-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByTestId('result-ready-line')).toHaveText('Oggi 3 errori 500, tutti da POST /api/feedback quando il testo supera 2000 caratteri.');
    await expect(row.getByTestId('canonical-result')).toHaveCount(0);
    await expect(page.getByTestId('tile-orchestrator')).not.toContainText('consegna automatica del risultato');
    await shot(page, 'orchestrator-clean-folded');
    await row.getByTestId('result-ready-toggle').click();
    await expect(row.getByTestId('canonical-result')).toContainText('Errori di oggi trovati');
    await expect(row.getByTestId('result-ready-line')).toHaveCount(0);
    await shot(page, 'orchestrator-clean-open');
  } finally {
    await app.close();
  }
});
