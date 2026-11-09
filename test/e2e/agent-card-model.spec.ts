// UI acceptance for the owner's fixes of 2026-10-31 (ADR 0211), demo services only, no provider requests: the back of an
// agent card picks model and effort in the shared picker (the model's own levels by their real names) and the context window, and says when the
// chosen effort is not the model's; an agent's result row in the Orchestrator carries the ✦ summarize and → agent
// icons, folded with its first line until «Mostra il risultato» and no raw delivery line (#351); Andamento sits under Brain; a command left for the user takes free text instead of running it. Screenshots of
// the card back, the result row and the command card with its text field.
import { expect, test } from '@playwright/test';
import { choose, expandChats, launchDemo, openAgentOverview, openOrchestrator, shot } from './helpers';

type Demo = { turn(c: string, t: string): void };

test('the card back picks model, effort and context; the result row has icons; Andamento is under Brain', async () => {
  const { app, page } = await launchDemo();
  try {
    // Andamento is Brain's last entry: no group of its own
    await expect(page.getByTestId('nav-group-trends')).toHaveCount(0);
    await openAgentOverview(page);
    await page.getByTestId('catalog-flip-scout').click();
    const block = page.getByTestId('catalog-model-scout');
    await expect(block).toBeVisible();
    // model and effort in the shared picker (ModelPicker.tsx), saved to the role with «Salva nel ruolo»
    await page.getByTestId('catalog-model-pick-scout').click();
    await page.getByTestId('catalog-picker-scout-row-claude-claude-sonnet-4-6').click();
    // Sonnet 4.6 has no xhigh in the registry: the levels are the model's own
    await expect(page.getByTestId('catalog-picker-scout-effort-xhigh')).toHaveCount(0);
    await page.getByTestId('catalog-picker-scout-effort-max').click();
    await page.getByTestId('catalog-picker-scout-apply-role').click();
    await expect(page.getByTestId('catalog-picker-scout-pop')).toHaveCount(0);
    await expect(page.getByTestId('catalog-model-pick-scout')).toContainText(/sonnet[- ]4[.-]6 · max/i);
    // Esc closes the picker, not the card
    await page.getByTestId('catalog-model-pick-scout').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('catalog-picker-scout-pop')).toHaveCount(0);
    await expect(block).toBeVisible();
    await choose(page.getByTestId('catalog-context-pick-scout'), '400000');
    await expect(page.getByTestId('catalog-context-pick-scout')).toContainText('400k');
    await shot(page, 'agent-card-model');

    await openOrchestrator(page);
    const row = page.getByTestId('result-ready').first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId('result-synthesize')).toBeVisible();
    await expect(row.getByTestId('chatref-open')).toHaveAttribute('title', /.+/);
    // folded by default with the result's first line; «Mostra il risultato» opens it (#351)
    await expect(row.getByTestId('result-ready-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByTestId('result-ready-line')).not.toBeEmpty();
    await expect(row.locator('.result-ready-full')).toHaveCount(0);
    // the app's delivery message to the Orchestrator is for the model only (#351)
    await expect(page.getByTestId('orchestrator-overlay')).not.toContainText('consegna automatica del risultato');
    await shot(page, 'result-ready-icons');
    await row.getByTestId('result-ready-toggle').click();
    await expect(row.locator('.result-ready-full')).toBeVisible();
    await expect(row.getByTestId('result-ready-line')).toHaveCount(0);
    await shot(page, 'result-ready-open');

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
