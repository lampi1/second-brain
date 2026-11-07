// E2E of the phone marks in a chat (phone bridge, ChatItems.tsx): a message the user sent from the paired phone shows
// «📱 dal telefono» above its bubble («🎙️ 📱 vocale dal telefono» for a voice note), a message typed on the PC shows
// none, and a decision made with the phone's buttons leaves the line «Risposto dal telefono, HH:MM». Items are injected
// over chat:item on the demo Orchestrator (no tokens). Screenshot: test-results/shots/phone-badge.png.
import { test, expect } from '@playwright/test';
import type { ChatItem } from '../../src/shared/contract';
import { launchDemo, shot } from './helpers';

test('phone messages carry 📱 and a phone decision leaves its line', async () => {
  const { app, page } = await launchDemo({ orchestrator: true });
  try {
    const chatId = await page.evaluate(async () => (await window.sb.invoke('chat:list', undefined)).find(c => c.isOrchestrator)!.id);
    const now = Date.now();
    const items: ChatItem[] = [
      { kind: 'user', id: 'ph1', at: now, text: 'A che punto è la QA?', via: 'phone' },
      { kind: 'user', id: 'ph2', at: now + 1, text: 'Allora aspetta Marco', via: 'phone', voice: true },
      { kind: 'user', id: 'pc1', at: now + 2, text: 'Scritto dal PC' },
      { kind: 'system', id: 'ph3', at: now + 3, level: 'info', text: 'Risposto dal telefono, 09:41', code: 'phoneDecided', params: { time: '09:41', what: 'question' } },
    ];
    await app.evaluate(({ BrowserWindow }, { chatId, items }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('file:')) for (const item of items) w.webContents.send('chat:item', { chatId, item });
    }, { chatId, items });
    await expect(page.getByTestId('item-ph1-phone')).toHaveText('📱 dal telefono');
    await expect(page.getByTestId('item-ph2-phone')).toHaveText('🎙️ 📱 vocale dal telefono');
    await expect(page.getByTestId('item-pc1-phone')).toHaveCount(0);
    await expect(page.getByText('Risposto dal telefono, 09:41')).toBeVisible();
    await page.mouse.move(2, 2);
    await shot(page, 'phone-badge');
  } finally {
    await app.close();
  }
});
