// E2E of the "Stato" dialog (components/StatoDialog.tsx) on the demo data, opened from the palette (its buttons and
// Ctrl+Shift+S open the project maps since ADR 0275); the headline, every open chat with its state, folder and
// git branch, last line and the requests waiting for the user; the PRs of the last DevOps read named after their bug,
// QA-blocked first; a chat row brings that chat on screen. Zero tokens: only data the app holds. Screenshot.
import { expect, test } from '@playwright/test';
import { launchDemo, shot } from './helpers';

test('Stato: chats, waiting requests, branches and PRs in one click; a row opens its chat', async () => {
  const { app, page } = await launchDemo();
  try {
    const openStato = async () => { await page.keyboard.press('Control+KeyK'); await page.getByTestId('palette-input').fill('come siamo messi'); await page.keyboard.press('Enter'); };
    // before any Task read: only the chats, and where to read them
    await openStato();
    const st = page.getByTestId('stato');
    await expect(st).toBeVisible();
    await expect(st.getByTestId('stato-tasks-at')).toHaveText('Task non ancora letti');
    await expect(st.getByTestId('stato-chat-qa')).toContainText('QA · Rimborsi');
    await expect(st.getByTestId('stato-chat-qa')).toContainText('ti aspetta');
    await expect(st.getByTestId('stato-branch-qa')).toHaveText('alfa-e2e · feat/rimborsi-parziali');
    await expect(st.getByTestId('stato-branch-fix')).toHaveText('alfa-shop · fix/totale-ordine');
    await expect(st.getByTestId('stato-chat-qa').locator('.stato-ask')).toHaveCount(1);
    // waiting chats come first
    await expect(st.locator('.stato-chat').first()).toHaveClass(/tone-wait/);
    await page.keyboard.press('Escape');
    await expect(st).toBeHidden();

    // the last Task read (the demo's fixture through the real service)
    await page.evaluate(() => window.sb.invoke('tasks:refresh', undefined));
    await openStato();
    await expect(st).toBeVisible();
    const pr = st.getByTestId('stato-pr-812');
    await expect(pr.locator('a.stato-name')).toContainText('Il totale del rimborso ignora lo sconto applicato');
    await expect(pr.locator('a.stato-name')).toHaveAttribute('href', /pullrequest\/812$/);
    await expect(st.getByTestId('stato-qa-812')).toHaveText('Bloccata dalla QA: 1 test fallito');
    await expect(pr).toContainText('build fallita');
    await expect(pr).toContainText('Giulia: approvata');
    await expect(st.locator('.stato-pr').first()).toHaveAttribute('data-testid', 'stato-pr-812');
    await expect(st.getByTestId('stato-headline')).toContainText('PR aperte: 1 bloccata dalla QA');
    await shot(page, 'stato');

    // a chat row brings that chat on screen
    await st.getByTestId('stato-chat-fix').locator('.stato-row').click();
    await expect(st).toBeHidden();
    await expect(page.getByTestId('tile-chat-fix')).toBeVisible();

  } finally {
    await app.close();
  }
});
