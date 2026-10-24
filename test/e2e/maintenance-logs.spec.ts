// E2E of the «Manutenzione» from the Orchestrator's head (#150, ADR 0132, 0152) on the frozen demo: one click on the
// icon runs every brain job plus the log step and the research; each new log group (the demo logs: an elicitation
// warning and a news-read error) becomes an «Apri issue» card in Proposte, the one already marked known does not; the
// Orchestrator gets no message. Rejecting a log bug's card marks its group known. Also the Orchestrator card's line
// (#153): today's chats and the cost. Screenshot: test-results/shots/maintenance-logs-dark.png.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Manutenzione from the Orchestrator: brain jobs, log bugs as issue cards', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchDemo({ orchestrator: true, height: 1100 });
  try {
    const tile = page.getByTestId('tile-orchestrator');
    await expect(tile.getByTestId('orchestrator-tally-cost')).toContainText('Costo:');
    await shot(page, 'orchestrator-tally-dark');
    await tile.getByTestId('orchestrator-maint-run').click();
    await expect(page.locator('.notif.tone-celebrate')).toBeVisible({ timeout: 30_000 });
    await expect(tile).not.toContainText('GitHub issue');
    await page.locator('.notif.tone-celebrate').getByTestId('toast-action').click();
    const deck = page.getByTestId('proposals-deck');
    await deck.getByTestId('pd-chip-issue').click();
    await expect(deck).toContainText('Apro su GitHub la issue');
    await page.mouse.move(2, 2);
    await shot(page, 'maintenance-logs-dark');
    // the deck's own list: the new log groups are issue cards, the known one is not
    const titles = await page.evaluate(async () => (await window.sb.invoke('proposals:list', undefined)).items.filter(c => c.group === 'issue').map(c => `${c.title} ${c.content}`));
    expect(titles.some(x => x.includes('unsupported control request'))).toBe(true);
    expect(titles.some(x => x.includes('thinking_tokens'))).toBe(false);
  } finally { await app.close(); }
});
