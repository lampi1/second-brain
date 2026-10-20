// "Veloce" / "Strategist" from the Orchestrator and "Apri" from anywhere (ADR 0034, modes 2026-10-20), on the demo: one of
// the two toggles in the Orchestrator's input (never both) sends the message with the line that asks her for the quick
// path or a Strategist (hidden, shown as a badge) and resets; the demo Orchestrator opens the chat (an app_create_chat
// row) and the row's "Apri" brings that chat on screen from the Task page; Ctrl+Shift+Invio sends as "Veloce" at once.
// Screenshots in test-results/shots/orchestrator-newchat-*.png.
import { expect, test } from '@playwright/test';
import type { ChatItem } from '../../src/shared/contract';
import { MODE_TAGS } from '../../src/shared/newchat';
import { launchDemo, openOrchestrator, shot } from './helpers';

test('Veloce / Strategist: a toggle marks the message, the Orchestrator opens the chat, Apri focuses it from the Task page', async () => {
  const { app, page } = await launchDemo();
  try {
    await openOrchestrator(page);
    // her open decision first, so the message is sent at once (not queued)
    await expect(page.getByTestId('orchestrator-input')).toBeFocused();
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('request-orchestrator-orchestrator-q1')).toBeFocused();
    await page.keyboard.press('1');
    await expect(page.getByTestId('request-orchestrator-orchestrator-q1')).toHaveCount(0);

    const toggle = page.getByTestId('orchestrator-input-mode-quick');
    const plan = page.getByTestId('orchestrator-input-mode-plan');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(plan).toHaveAttribute('aria-pressed', 'false');
    // one at a time: Strategist, then Veloce takes its place
    await plan.click();
    await expect(plan).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('orchestrator-input')).toHaveAttribute('placeholder', 'Cosa deve pianificare lo Strategist…');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(plan).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('orchestrator-input')).toBeFocused();
    await expect(page.getByTestId('orchestrator-input')).toHaveAttribute('placeholder', 'Cosa ti serve in fretta…');
    await page.keyboard.type('Controlla i log ordini');
    await page.mouse.move(2, 2);
    await shot(page, 'orchestrator-newchat-toggle');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false'); // reset after the send

    // the Orchestrator got the line; the user sees only their words and the badge
    const tile = page.getByTestId('tile-orchestrator');
    const userItem = tile.locator('.msg-user[data-mode="quick"]').last();
    await expect(userItem.locator('.msg-newchat')).toHaveText('Veloce');
    await expect(userItem.locator('.bubble')).toHaveText('Controlla i log ordini');
    await expect(tile).not.toContainText(MODE_TAGS.quick);
    const sent = await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'orchestrator' })) as ChatItem[];
    const last = sent.filter(i => i.kind === 'user').pop();
    expect(last?.kind === 'user' && last.text.startsWith(`${MODE_TAGS.quick} `)).toBe(true);

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

    // Ctrl+Shift+Invio: sent as "Veloce" at once, without the toggle
    await page.getByTestId('orchestrator-input').click();
    await page.keyboard.type('Prepara il report QA');
    await page.keyboard.press('Control+Shift+Enter');
    await expect(page.getByTestId('tile-orchestrator').locator('.msg-user[data-mode="quick"] .bubble').last()).toHaveText('Prepara il report QA');
    await expect(page.getByTestId('tile-orchestrator').getByTestId('chatref-created').last()).toContainText('Demo · Prepara il report QA');

    // her tool rows fold behind one "Ragionamento" row; the "Apri" chips stay out
    const orch = page.getByTestId('tile-orchestrator');
    await expect(orch.locator('.process .tool')).toHaveCount(0);
    await orch.getByTestId('process-toggle').last().click();
    await expect(orch.locator('.process .tool').first()).toBeVisible();
    await orch.getByTestId('process-toggle').last().click();

    // a thanks needs no answer: her one-emoji reply sticks to the message as a reaction (WhatsApp style), not a bubble
    await page.getByTestId('orchestrator-input').click();
    await page.keyboard.type('grazie');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tile-orchestrator').locator('.msg-user .msg-react').last()).toHaveText('👍');
    await page.mouse.move(2, 2);
    await shot(page, 'orchestrator-newchat-reaction');
  } finally {
    await app.close();
  }
});
