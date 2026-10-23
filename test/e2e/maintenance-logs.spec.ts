// E2E of the one «Manutenzione» (#150, ADR 0132) on the frozen demo: the icon on the Orchestrator's head opens the dialog,
// «Avvia la pulizia» runs every brain job plus the log step; the dialog shows the "Log dell'app" row with the new groups
// (the demo logs: an elicitation warning and a news-read error) and the one already marked "noto" apart, and each new
// group became a bug card in «Idee dell'app» (no message to the Orchestrator). «Noto, ignora» marks a group. Also the
// Orchestrator card's line (#153): today's chats and the cost. Screenshot: test-results/shots/maintenance-logs-dark.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Manutenzione from the Orchestrator: brain jobs, grouped logs, bug cards', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ orchestrator: true, height: 1100 });
  try {
    const tile = page.getByTestId('tile-orchestrator');
    await expect(tile.getByTestId('orchestrator-tally-cost')).toContainText('Costo:');
    await shot(page, 'orchestrator-tally-dark');
    await tile.getByTestId('orchestrator-maint-run').click();
    const dlg = page.getByTestId('orchestrator-maint-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('mm-r-toggle')).not.toBeChecked();
    await dlg.getByTestId('orchestrator-maint-start').click();
    await expect(dlg.getByTestId('mm-job-logs')).toHaveAttribute('data-status', 'note');
    await expect(dlg.getByTestId('mm-job-logs')).toContainText('2 gruppi nuovi');
    await expect(dlg.getByTestId('mm-r-to-ideas')).toHaveText('Idee dell’app: 2 bug nuovi');
    const rows = dlg.getByTestId('mm-log');
    await expect(rows).toHaveCount(3);
    await expect(dlg.locator('.mm-log.known')).toContainText('thinking_tokens');
    await shot(page, 'maintenance-logs-dark');
    // «Noto, ignora» on the elicitation group: it joins the known ones
    const elicitation = rows.filter({ hasText: 'unsupported control request' });
    await elicitation.getByTestId('mm-log-known').click();
    await expect(dlg.locator('.mm-log.known')).toHaveCount(2);
    await dlg.getByTestId('orchestrator-maint-close').click();
    await expect(dlg).toHaveCount(0);
  } finally { await app.close(); }
});
