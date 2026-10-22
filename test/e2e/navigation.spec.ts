// E2E of navigation and notifications (frozen demo): an important event → a toast in the global layer → its action
// opens the right place with the element highlighted; the notification center (filter, mark all read, remembered);
// role-specific section badges (count, cleared on visit); back/forward; Ctrl+1 back to the chats; the persistent Orchestrator on a brain page;
// G-letter keys; copying an internal link and pasting it in Ctrl+K.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchDemo, layerPage, shot, windowShot, openNotesMap } from './helpers';

const event = (app: ElectronApplication, e: { kind: string; title: string; detail?: string; chatId?: string }) =>
  app.evaluate((_e, ev) => (globalThis as unknown as { __sbDemo: { event(x: object): void } }).__sbDemo.event(ev), e);
// "nothing happened" is checked after a loud event sent last has shown: events reach the page in order, so the quiet
// ones before it were handled by then (a fixed pause can end before they even arrive on a busy machine)
const SENTINEL = { kind: 'sync-blocked', title: 'Segnale di fine' };

// Secondary pages remain in Ctrl+K after the Grindhouse redesign removed their default rail entries.
async function openPage(page: Page, id: 'costi' | 'idee') {
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(`sb://${id}`);
  await page.getByTestId('palette-item-link').click();
  await expect(page.getByTestId(`page-${id}`)).toBeVisible();
}

test('an important event shows a toast above everything; its action opens the place and highlights it', async () => {
  const { app, page } = await launchDemo();
  await openPage(page, 'costi');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await event(app, { kind: 'chat-failed', title: 'Test e2e rossi', detail: 'il turno è finito con un errore', chatId: 'mappa' });
  const layer = await layerPage(app);
  await expect(layer.getByTestId('ev-toast-chat-failed')).toContainText('Test e2e rossi');
  await expect(layer.getByTestId('ev-toast-open-chat-failed')).toHaveText('Apri');
  await windowShot(app, 'event-toast');
  await layer.getByTestId('ev-toast-open-chat-failed').click();
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await expect(page.locator('[data-sb-id="chat-mappa"][data-highlighted="true"]')).toBeVisible(); // the chat is highlighted
  await expect(layer.getByTestId('ev-toast-chat-failed')).toHaveCount(0);
  // quiet kinds (an idea, a finished chat, a logged error) never toast: only the center
  await event(app, { kind: 'idea', title: 'Riassunto automatico al ritorno' });
  await event(app, { kind: 'chat-done', title: 'QA', chatId: 'qa' });
  await event(app, { kind: 'error', title: 'Comando lanciato due volte' });
  await event(app, SENTINEL);
  await expect(layer.getByTestId('ev-toast-sync-blocked')).toContainText(SENTINEL.title);
  await expect(layer.locator('.ev-toast')).toHaveCount(1);
  await app.close();
});

test('notification center: filter by kind, mark all read (remembered after a reload), mute a kind', async () => {
  const { app, page } = await launchDemo();
  await event(app, { kind: 'idea', title: 'Idea nuova' });
  await event(app, { kind: 'chat-failed', title: 'Errore nuovo', chatId: 'qa' });
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
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('bell-count')).toHaveCount(0);
  // mute a kind from its row (settings mute.<kind>): its toasts stop
  await page.keyboard.press('Control+Shift+N');
  const row = page.locator('[data-testid="nc-list"] [data-kind="chat-failed"]').first();
  await row.hover();
  await row.locator('[data-testid^="nc-mute-"]').click();
  await page.keyboard.press('Escape');
  await event(app, { kind: 'chat-failed', title: 'Altro errore', chatId: 'qa' });
  await event(app, SENTINEL);
  const layer = await layerPage(app);
  await expect(layer.getByTestId('ev-toast-sync-blocked')).toContainText(SENTINEL.title);
  await expect(layer.getByTestId('ev-toast-chat-failed')).toHaveCount(0);
  await app.close();
});

test('section badges count new events and clear when the section is visited', async () => {
  // a live clock: frozen, the visit and the event share one instant and the event is never newer than the visit
  const { app, page } = await launchDemo({ freeze: false });
  // Badges are still available when a saved role explicitly includes these secondary pages.
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}');
    prefs.role = { schemaVersion: 1, presetId: 'cto', presetRevision: 1, overrides: { addPageIds: ['idee'] } };
    localStorage.setItem('sb.prefs.v1', JSON.stringify(prefs));
  });
  await page.reload();
  await expect(page.getByTestId('nav-idee')).toBeVisible();
  // Costi's badge is a warning mark, not a number (WARN_SECTIONS): it shows with a new budget event
  const badge = page.getByTestId('nav-badge-costi');
  await page.getByTestId('nav-costi').click();
  await expect(badge).toHaveText('');
  await page.getByTestId('nav-idee').click();
  // logged-only kinds never badge (policy 2026-10-13): an idea leaves Idee's badge as it was; the budget event after it
  // shows Costi's mark, so the idea was handled by then
  const ideas = page.getByTestId('nav-badge-idee');
  const ideasBefore = await ideas.textContent();
  await event(app, { kind: 'idea', title: 'Una idea in più' });
  await event(app, { kind: 'budget', title: 'Claude al 80 % del limite di oggi' });
  await expect(badge).toHaveText('!');
  await expect(ideas).toHaveText(ideasBefore ?? '');
  await page.getByTestId('nav-costi').click();
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await expect(badge).toHaveText('');
  await app.close();
});

test('a blocked GitHub sync toasts, with since when GitHub is behind and what blocks it', async () => {
  const { app } = await launchDemo();
  const detail = 'Ultimo aggiornamento riuscito di GitHub: 11/10 20:22\nguard: BLOCKED, 2 findings (deny-list 2)\ntest/unit/a.test.ts:3  deny-list';
  await event(app, { kind: 'sync-blocked', title: 'GitHub fermo: pubblicazione bloccata dal controllo (prodotto nel brain)', detail });
  const layer = await layerPage(app);
  const toast = layer.getByTestId('ev-toast-sync-blocked');
  await expect(toast).toContainText('GitHub fermo: pubblicazione bloccata dal controllo');
  await expect(toast).toContainText('Ultimo aggiornamento riuscito di GitHub: 11/10 20:22');
  await windowShot(app, 'sync-blocked-toast');
  await app.close();
});

test('the bell counts only what needs the user; the center keeps everything else as a list to read', async () => {
  const { app, page } = await launchDemo();
  // the frozen demo stamps every event at the same time: no "read all" (it would cover the new ones too), a baseline
  const bell = page.getByTestId('bell');
  const count = async () => Number((await bell.getAttribute('aria-label'))?.match(/(\d+) da leggere/)?.[1] ?? NaN);
  await expect(bell).toBeVisible();
  const before = await count();
  // noise: none of these counts in the bell
  for (const e of [
    { kind: 'chat-done', title: 'Fix totale ordine', chatId: 'qa' }, { kind: 'error', title: 'Comando lanciato due volte' }, { kind: 'idea', title: 'Riassunto al ritorno' },
    { kind: 'now', title: 'Filo aggiornato' }, { kind: 'sync-ok', title: 'GitHub aggiornato' }, { kind: 'proposal', title: 'Proposta' },
  ]) await event(app, e);
  // what needs him: counted (sent after the noise: once both are in the list, the noise was handled too)
  await event(app, { kind: 'chat-failed', title: 'Mappa', detail: 'il turno è finito con un errore', chatId: 'mappa' });
  await event(app, { kind: 'sync-blocked', title: 'Pubblicazione bloccata (prodotto nel brain)', detail: 'src/a.ts:3 rule secret' });
  await page.keyboard.press('Control+Shift+N');
  await expect(page.locator('[data-testid="nc-list"] [data-kind="sync-blocked"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="nc-list"] [data-kind="chat-failed"]').first()).toBeVisible();
  expect(await count()).toBe(before + 2);
  await expect(page.getByTestId('nc-unread')).toHaveText(String(before + 2));
  await expect(page.locator('[data-testid="nc-list"] [data-kind="chat-done"]').first()).toBeVisible(); // still in the list
  await shot(page, 'notifications-bell-center');
  await app.close();
});

test('back/forward, recents, Ctrl+1, G-letter keys, the persistent Orchestrator on a page', async () => {
  const { app, page } = await launchDemo();
  await openPage(page, 'costi');
  await openPage(page, 'idee');
  await expect(page.getByTestId('page-idee')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.getByTestId('nav-recent').click();
  await expect(page.getByTestId('nav-recent-pop')).toContainText('Idee');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('view-agents')).toBeVisible();
  // G then a letter, outside text fields
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('q');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
  // the Orchestrator without leaving the page
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  await page.getByTestId('orchestrator-input').fill('che si fa adesso?');
  await page.getByTestId('orchestrator-input').press('Enter');
  // the Orchestrator waits on its decision: the message is queued (sent when it is free), the decision answerable right here
  await expect(page.getByTestId('orchestrator-input-queued-0')).toContainText('che si fa adesso?');
  await page.locator('[data-testid="orchestrator-overlay"] [data-request-key="orchestrator/orchestrator-q1"]').focus();
  await page.keyboard.press('1');
  await expect(page.getByTestId('orchestrator-overlay')).toContainText('Ecco il quadro');
  await expect(page.getByTestId('page-qualita')).toBeVisible();
  await shot(page, 'orchestrator-overlay');
  await page.keyboard.press('Control+R');
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('orchestrator-input')).toBeFocused();
  // the map: full screen, browser views hidden, Esc closes
  await openNotesMap(page);
    await page.getByRole('button', { name: 'Esplora in 3D' }).click();
  await expect(page.getByTestId('brain-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brain-map')).toHaveCount(0);
  await app.close();
});

test('copy an internal link and paste it in Ctrl+K: it goes there and highlights the element', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('chat-menu-qa').click();
  await page.getByTestId('chat-link-qa').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('sb://home/chat-qa');
  const link = 'sb://workspace/chat-qa'; // a link copied before SPEC 19 still lands on the chat, in the Grindhouse
  await openPage(page, 'costi');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill(link);
  await expect(page.getByTestId('palette-item-link')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await expect(page.locator('[data-sb-id="chat-qa"][data-highlighted="true"]')).toBeVisible();
  // a page link through the palette (the page bar's «Copia link» button is gone, ADR 0125)
  await openPage(page, 'idee');
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('Copia il link');
  await page.getByTestId('palette-item-copylink').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('sb://idee');
  await app.close();
});
