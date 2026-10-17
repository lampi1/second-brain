// "Nuova chat" through the routing table (ADR 0032; the user, 2026-10-14): on the demo table the dialog shows in one
// line the model the table picks for the title and prompt and why, its fields follow it; an effort picked by hand
// beats the row ("scelto da te") and the chat starts with it, recorded as an override; "torna automatico" undoes the
// pick. Screenshots in test-results/shots/newchat-route-*.png.
import { expect, test } from '@playwright/test';
import type { ChatSummary } from '../../src/shared/contract';
import { launchDemo, shot } from './helpers';

test('Nuova chat: the table picks the model, the line says why, a hand pick wins', async () => {
  const { app, page } = await launchDemo();
  try {
    await page.keyboard.press('Control+N');
    await expect(page.getByTestId('newchat')).toBeVisible();
    await page.getByTestId('newchat-engine-options').locator('summary').click();
    const line = page.getByTestId('newchat-route');

    // a fix: the bug-fix row (Opus, high)
    await page.getByTestId('newchat-prompt').fill('Correggi il crash del login');
    await expect(line).toContainText('Opus 5.5 · ragionamento alta');
    await expect(line).toContainText('dalla tabella (Fix di bug)');

    // the same fix on the app: the app row wins over the kind row (Opus, medium)
    await page.getByTestId('newchat-advanced').locator('summary').click();
    await page.getByTestId('newchat-title').fill('App · Login');
    await expect(line).toContainText('Opus 5.5 · ragionamento media');
    await expect(line).toContainText('dalla tabella (Fix di bug · App): chat sull’app');
    await expect(page.getByTestId('newchat-model')).toHaveValue('claude-opus-5-5');
    await expect(page.getByTestId('newchat-effort-default')).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(2, 2);
    await shot(page, 'newchat-route-table');

    // the user picks an effort: it wins, and can be undone
    await page.getByTestId('newchat-effort-low').click();
    await expect(line).toContainText('ragionamento bassa');
    await expect(line).toContainText('scelto da te');
    await page.getByTestId('newchat-route-reset').click();
    await expect(line).toContainText('dalla tabella');
    await expect(page.getByTestId('newchat-effort-default')).toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('newchat-effort-high').click();
    await expect(line).toContainText('scelto da te');
    await page.mouse.move(2, 2);
    await shot(page, 'newchat-route-picked');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('newchat')).toHaveCount(0);

    const chats = await page.evaluate(() => window.sb.invoke('chat:list', undefined)) as ChatSummary[];
    const c = chats.find(x => x.title === 'App · Login');
    expect(c).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high', route: { source: 'override', kind: 'bug-fix', area: 'App' } });
  } finally {
    await app.close();
  }
});
