// "Nuova chat" from the Orchestrator and "Apri" from anywhere (ADR 0034), on the demo: the toggle in the Orchestrator's input sends
// the message with the line that asks her for a new chat (hidden, shown as a "Nuova chat" badge) and resets; the demo
// Orchestrator opens the chat (an app_create_chat row) and the row's "Apri" brings that chat on screen from the Task page;
// Ctrl+Shift+Invio sends as a new chat at once. Screenshots in test-results/shots/orchestrator-newchat-*.png.
import { expect, test } from '@playwright/test';
import type { ChatItem } from '../../src/shared/contract';
import { NEW_CHAT_TAG } from '../../src/shared/newchat';
import { launchDemo, openOrchestrator, shot } from './helpers';

test('Nuova chat: the toggle marks the message, the Orchestrator opens the chat, Apri focuses it from the Task page', async () => {
  const { app, page } = await launchDemo();
  try {
    await openOrchestrator(page);
    // her open decision first, so the message is sent at once (not queued)
    await expect(page.getByTestId('orchestrator-input')).toBeFocused();
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('request-orchestrator-orchestrator-q1')).toBeFocused();
    await page.keyboard.press('1');
    await expect(page.getByTestId('request-orchestrator-orchestrator-q1')).toHaveCount(0);

    const toggle = page.getByTestId('orchestrator-input-newchat');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('orchestrator-input')).toBeFocused();
    await expect(page.getByTestId('orchestrator-input')).toHaveAttribute('placeholder', 'Cosa deve fare la nuova chat…');
    await page.keyboard.type('Controlla i log ordini');
    await page.mouse.move(2, 2);
    await shot(page, 'orchestrator-newchat-toggle');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false'); // reset after the send

    // the Orchestrator got the line; the user sees only their words and the badge
    const tile = page.getByTestId('tile-orchestrator');
    const userItem = tile.locator('.msg-user[data-new-chat]').last();
    await expect(userItem.locator('.msg-newchat')).toHaveText('Nuova chat');
    await expect(userItem.locator('.bubble')).toHaveText('Controlla i log ordini');
    await expect(tile).not.toContainText(NEW_CHAT_TAG);
    const sent = await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'orchestrator' })) as ChatItem[];
    const last = sent.filter(i => i.kind === 'user').pop();
    expect(last?.kind === 'user' && last.text.startsWith(`${NEW_CHAT_TAG} `)).toBe(true);

    // she opened it: the app_create_chat row says which chat, with Apri
    const created = tile.getByTestId('chatref-created').last();
    await expect(created).toContainText('Chat aperta');
    await expect(created).toContainText('Demo · Controlla i log ordini');
    const open = created.getByTestId('chatref-open');
    const newId = await open.getAttribute('data-chat-id');
    expect(newId).toBeTruthy();
    // her reply names it too, but the row already shows it: no second chip for the same turn
    await expect(tile.getByTestId('chatref-named')).toHaveCount(0);
    await page.mouse.move(2, 2);
    await shot(page, 'orchestrator-newchat-created');

    // from the Task page: Apri switches back to the chats and focuses that chat
    await page.getByTestId('nav-task').click();
    await expect(page.getByTestId('brain-page-task')).toBeVisible();
    await openOrchestrator(page);
    await page.getByTestId('tile-orchestrator').getByTestId('chatref-open').last().click();
    await expect(page.getByTestId('brain-page-task')).toHaveCount(0);
    await expect(page.getByTestId(`tile-chat-${newId}`)).toBeVisible();
    await expect(page.getByLabel('Messaggio a Demo · Controlla i log ordini')).toBeFocused();
    await page.mouse.move(2, 2);
    await shot(page, 'orchestrator-newchat-opened');

    // Ctrl+Shift+Invio: sent as a new chat at once, without the toggle
    await page.getByTestId('orchestrator-input').click();
    await page.keyboard.type('Prepara il report QA');
    await page.keyboard.press('Control+Shift+Enter');
    await expect(page.getByTestId('tile-orchestrator').locator('.msg-user[data-new-chat] .bubble').last()).toHaveText('Prepara il report QA');
    await expect(page.getByTestId('tile-orchestrator').getByTestId('chatref-created').last()).toContainText('Demo · Prepara il report QA');
  } finally {
    await app.close();
  }
});
