// E2E of navigation and notifications (frozen demo): an important event → a toast in the global layer → its action
// opens the right place with the element highlighted; the notification center (filter, mark all read, remembered);
// section badges (count, cleared on visit); back/forward; Ctrl+1 back to the chats; the Regia docked on a brain page;
// G-letter keys; copying an internal link and pasting it in Ctrl+K.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, layerPage, shot, windowShot } from './helpers';

const event = (app: ElectronApplication, e: { kind: string; title: string; detail?: string; chatId?: string }) =>
  app.evaluate((_e, ev) => (globalThis as unknown as { __sbDemo: { event(x: object): void } }).__sbDemo.event(ev), e);

test('an important event shows a toast above everything; its action opens the place and highlights it', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('nav-costi').click();
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await event(app, { kind: 'error', title: 'Test e2e rossi', detail: '2 falliti su 12', chatId: 'mappa' });
  const layer = await layerPage(app);
  await expect(layer.getByTestId('ev-toast-error')).toContainText('Test e2e rossi');
  await expect(layer.getByTestId('ev-toast-open-error')).toHaveText('Apri');
  await windowShot(app, 'event-toast');
  await layer.getByTestId('ev-toast-open-error').click();
  await expect(page.getByTestId('view-mosaico')).toBeVisible();
  await expect(page.locator('[data-sb-id="chat-mappa"][data-highlighted="true"]')).toBeVisible(); // the folded chat came back, highlighted
  await expect(layer.getByTestId('ev-toast-error')).toHaveCount(0);
  // a quiet kind (an idea) never toasts: only the center and the badge
  await event(app, { kind: 'idea', title: 'Riassunto automatico al ritorno' });
  await page.waitForTimeout(600);
  await expect(layer.getByTestId('ev-toast-idea')).toHaveCount(0);
  await app.close();
});

test('notification center: filter by kind, mark all read (remembered after a reload), mute a kind', async () => {
  const { app, page } = await launchDemo();
  await event(app, { kind: 'idea', title: 'Idea nuova' });
  await event(app, { kind: 'error', title: 'Errore nuovo' });
  await page.keyboard.press('Control+Shift+N');
  await expect(page.getByTestId('center')).toBeVisible();
  await page.getByTestId('nc-filter-idea').click();
  const kinds = await page.locator('[data-testid="nc-list"] [data-kind]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-kind')))]);
  expect(kinds).toEqual(['idea']);
  await shot(page, 'notification-center');
  await page.getByTestId('nc-filter-all').click();
  await expect(page.getByTestId('bell-count')).toBeVisible();
  await page.getByTestId('nc-read-all').click();
  await expect(page.locator('[data-testid="nc-list"] [data-unread]')).toHaveCount(0);
  await expect(page.getByTestId('bell-count')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('tile-regia')).toBeVisible();
  await expect(page.getByTestId('bell-count')).toHaveCount(0);
  // mute a kind from its row (settings mute.<kind>): its toasts stop
  await page.keyboard.press('Control+Shift+N');
  const row = page.locator('[data-testid="nc-list"] [data-kind="error"]').first();
  await row.hover();
  await row.locator('[data-testid^="nc-mute-"]').click();
  await page.keyboard.press('Escape');
  await event(app, { kind: 'error', title: 'Altro errore' });
  const layer = await layerPage(app);
  await page.waitForTimeout(600);
  await expect(layer.getByTestId('ev-toast-error')).toHaveCount(0);
  await app.close();
});

test('section badges count new events and clear when the section is visited', async () => {
  const { app, page } = await launchDemo();
  const badge = page.getByTestId('nav-badge-idee');
  const before = Number((await badge.textContent()) || 0);
  await event(app, { kind: 'idea', title: 'Una idea in più' });
  await expect(badge).toHaveText(String(before + 1));
  await page.getByTestId('nav-idee').click();
  await expect(page.getByTestId('page-idee')).toBeVisible();
  await expect(badge).toHaveText('');
  await app.close();
});

test('back/forward, recents, Ctrl+1, G-letter keys, the Regia docked on a page', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('nav-costi').click();
  await page.getByTestId('nav-idee').click();
  await expect(page.getByTestId('page-idee')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('view-mosaico')).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.getByTestId('nav-recent').click();
  await expect(page.getByTestId('nav-recent-pop')).toContainText('Idee');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('view-mosaico')).toBeVisible();
  // G then a letter, outside text fields
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('q');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
  // the Regia without leaving the page
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('regia-dock')).toBeVisible();
  await page.getByTestId('regia-dock-input').fill('che si fa adesso?');
  await page.getByTestId('regia-dock-input').press('Enter');
  // the Regia waits on its decision: the message is queued (sent when it is free), the decision answerable right here
  await expect(page.getByTestId('regia-dock-input-queued-0')).toContainText('che si fa adesso?');
  await page.locator('[data-testid="regia-dock"] [data-request-key="regia/regia-q1"]').focus();
  await page.keyboard.press('1');
  await expect(page.getByTestId('regia-dock')).toContainText('Ecco il quadro');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
  await shot(page, 'regia-dock');
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('regia-dock')).toHaveCount(0);
  // the map: full screen, browser views hidden, Esc closes
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('brain-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await app.close();
});

test('copy an internal link and paste it in Ctrl+K: it goes there and highlights the element', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('chat-menu-qa').click();
  await page.getByTestId('chat-link-qa').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('sb://workspace/chat-qa');
  const link = 'sb://workspace/chat-qa';
  await page.getByTestId('nav-costi').click();
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await expect(page.getByTestId('palette-item-link')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('view-mosaico')).toBeVisible();
  await expect(page.locator('[data-sb-id="chat-qa"][data-highlighted="true"]')).toBeVisible();
  // a page link from its frame
  await page.getByTestId('nav-idee').click();
  await page.getByTestId('page-copy-link').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('sb://idee');
  await app.close();
});
