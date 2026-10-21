// E2E of the one «Manutenzione» (#150) on the frozen demo: the icon on the Orchestrator's head runs every brain job plus
// the log step; the dialog shows the "Log dell'app" row with the new groups (the demo logs: an elicitation warning and a
// news-read error) and the one already marked "noto" apart, says the result went to the Orchestrator, and the
// Orchestrator's chat gets one message with the job results and the groups, never the known one. «Noto, ignora» marks a
// group. Also the Orchestrator card's line (#153): today's chats and the cost. Screenshot: test-results/shots/maintenance-logs-dark.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Manutenzione from the Orchestrator: brain jobs, grouped logs, hand-off to the Orchestrator', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ orchestrator: true, height: 1100 });
  try {
    const tile = page.getByTestId('tile-orchestrator');
    await expect(tile.getByTestId('orchestrator-tally-cost')).toContainText('Costo:');
    await shot(page, 'orchestrator-tally-dark');
    await tile.getByTestId('orchestrator-maint-run').click();
    const dlg = page.getByTestId('orchestrator-maint-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('mm-job-logs')).toHaveAttribute('data-status', 'note');
    await expect(dlg.getByTestId('mm-job-logs')).toContainText('2 gruppi nuovi');
    await expect(dlg.getByTestId('mm-maint-handoff')).toContainText('mandato all’Orchestrator');
    const rows = dlg.getByTestId('mm-log');
    await expect(rows).toHaveCount(3);
    await expect(dlg.locator('.mm-log.known')).toContainText('thinking_tokens');
    await expect(tile).toContainText('Manutenzione finita');
    await shot(page, 'maintenance-logs-dark');
    // «Noto, ignora» on the elicitation group: it joins the known ones
    const elicitation = rows.filter({ hasText: 'unsupported control request' });
    await elicitation.getByTestId('mm-log-known').click();
    await expect(dlg.locator('.mm-log.known')).toHaveCount(2);
    await dlg.getByTestId('orchestrator-maint-close').click();
    await expect(dlg).toHaveCount(0);
  } finally { await app.close(); }
});
