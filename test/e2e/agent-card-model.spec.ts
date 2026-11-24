// UI acceptance for the owner's fixes of 2026-10-31 (ADR 0211), demo services only, no provider requests (the card
// back's model picker is gone, ADR 0347: models live on the role's page): an agent's result row in the Orchestrator carries the ✦ summarize and → agent
// icons; Andamento sits under Brain; a command left for the user takes free text instead of running it. Screenshots of
// the result row and the command card with its text field.
import { expect, test } from '@playwright/test';
import { expandChats, launchDemo, openOrchestrator, shot } from './helpers';

type Demo = { turn(c: string, t: string): void };

test('the result row has icons; Andamento is under Brain', async () => {
  const { app, page } = await launchDemo();
  try {
    // Andamento is Brain's last entry: no group of its own
    await expect(page.getByTestId('nav-group-trends')).toHaveCount(0);

    await openOrchestrator(page);
    const row = page.getByTestId('result-ready').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('result-synthesize')).toBeVisible();
    await expect(row.getByTestId('chatref-open')).toHaveAttribute('title', /.+/);
    await shot(page, 'result-ready-icons');

    // a command for the user: free text instead of «Non serve», sent to the chat at once
    await page.getByTestId('nav-home').click();
    await expandChats(page, 'mappa');
    await app.evaluate((_e, t) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.turn('mappa', t); }, 'Ora lancia il controllo:\n\n```powershell\necho ok\n```');
    await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-kind', 'command');
    await page.getByTestId('qwin-card-reply').fill('Non lo lancio: prima controlla i log di ieri');
    await shot(page, 'command-ask-reply');
    await page.getByTestId('qwin-card-reply-send').click();
    await expect(page.getByTestId('qwin')).toHaveCount(0);
    await expect(page.getByTestId('tile-chat-mappa')).toContainText('prima controlla i log di ieri');
  } finally {
    await app.close();
  }
});
