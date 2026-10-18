// E2E tests of the renderer UI on the demo (SB_DEMO=1; frozen = deterministic): the agents workspace, answering a tile's panel with "1", sending and queueing from a tile input, Ferma tutto
// with its confirm, maximize/restore, the palette hiding every browser view, ui:command from main, new chat, brain
// pages, the live (unfrozen) demo streaming. Visual baselines (toHaveScreenshot) for a maximized chat and the
// palette; extra screenshots (1280x800, light theme) in test-results/shots/.
import { expect, test } from '@playwright/test';
import { demoLayout, expandChats, launch, launchDemo, openRegia, setSize, shot, VISUAL, waitThumbs } from './helpers';

test('agents workspace: one column of chat strips, each browser right under its chat', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'qa', 'sms', 'feedback'); // open strips: their requests and browsers in sight
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await expect(page.getByTestId('needs-lane')).toHaveCount(0); // no "Ti aspettano" strip: each chat asks in its tile
  await expect(page.locator('[data-request-key]')).toHaveCount(2); // QA and Feedback; the reduced Regia's own floats in the layer
  for (const id of ['qa', 'fix', 'sms', 'feedback']) await expect(page.getByTestId(`tile-chat-${id}`)).toBeVisible();
  await expect(page.getByTestId('tile-browser-tab-qa')).toBeVisible();
  // no "Finite oggi" dock: a finished chat stays a tile until it closes by itself (autoclose.spec.ts)
  await expect(page.getByTestId('tile-chat-mappa')).toBeVisible();
  await expect(page.getByTestId('folded-dock')).toHaveCount(0);
  // the Orchestrator column is always open beside the Grindhouse (ADR 0068)
  await expect(page.getByTestId('regia-overlay')).toBeVisible();
  // one column: each browser follows the chat that drives it
  const panes = await page.locator('[data-workspace-pane]').evaluateAll(els => els.map(e => e.getAttribute('data-workspace-pane')));
  expect(panes.indexOf('browser:tab-qa')).toBe(panes.indexOf('chat:qa') + 1);
  expect(panes.indexOf('browser:tab-sms')).toBe(panes.indexOf('chat:sms') + 1);
  await expect.poll(async () => (await demoLayout(app)).filter(l => l.rect).length).toBe(2);
  await waitThumbs(page);
  await shot(page, 'agents');
  await app.close();
});

test('answering a tile panel with "1" resolves the request without opening the chat', async () => {
  const { page, app } = await launchDemo();
  await openRegia(page); // her decision on screen (reduced, it would float in the layer)
  await expect(page.getByTestId('regia-input')).toBeFocused(); // opened: the keyboard is in her input first
  await expandChats(page, 'qa', 'feedback'); // their cards are on the open strips
  await page.keyboard.press('Control+J'); // the oldest first: the Regia's decision
  await expect(page.getByTestId('request-regia-regia-q1')).toBeFocused();
  await page.keyboard.press('1');
  await expect(page.getByTestId('request-regia-regia-q1')).toHaveCount(0);
  await expect(page.getByTestId('request-qa-qa-q1')).toBeFocused(); // focus moved to the next card
  await page.keyboard.press('1');
  await expect(page.getByTestId('request-qa-qa-q1')).toHaveCount(0);
  await expect(page.locator('[data-request-key]')).toHaveCount(1);
  await expect(page.getByTestId('tile-chat-qa')).toContainText('Apro il bug');
  await expect(page.getByTestId('maximized')).toHaveCount(0); // the chat was not opened
  await openRegia(page);
  await expect(page.getByTestId('tile-regia')).toContainText('Segnato: riparto da QA rimborsi');
  // a permission: Esc on the focused card rejects it
  await page.keyboard.press('Control+J');
  await expect(page.getByTestId('request-feedback-feedback-p1')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-request-key]')).toHaveCount(0);
  await expect(page.getByTestId('tile-chat-feedback')).toContainText('non lancio i test');
  await app.close();
});

test('a tile input: Enter sends, Shift+Enter is a new line, a busy chat queues the message', async () => {
  const { page, app } = await launchDemo();
  await expandChats(page, 'mappa', 'fix'); // the inputs are on the open strips
  const input = page.getByTestId('chat-input-mappa');
  await input.click();
  await expect(input).toBeFocused();
  await input.pressSequentially('Aggiungi la legenda');
  await page.keyboard.press('Shift+Enter');
  await input.pressSequentially('e i colori');
  await expect(input).toHaveValue('Aggiungi la legenda\ne i colori');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('tile-chat-mappa').locator('.bubble').last()).toHaveText('Aggiungi la legenda\ne i colori');
  await expect(page.getByTestId('tile-chat-mappa')).toContainText('Ricevuto');
  // the fix is running: the message waits in its queue
  await page.getByTestId('chat-input-fix').fill('poi aggiorna la PR');
  await page.getByTestId('chat-input-fix').press('Enter');
  await expect(page.getByTestId('chat-input-fix-queued-0')).toContainText('poi aggiorna la PR');
  await app.close();
});

test('Ferma tutto asks to confirm when more than one chat runs, then stops them', async () => {
  const { page, app } = await launchDemo();
  await expandChats(page, 'fix'); // its transcript is on the open strip
  await expect(page.getByTestId('chat-state-fix')).toHaveAttribute('data-state', 'running');
  await page.getByTestId('topbar-stopall').click();
  await expect(page.getByTestId('confirm')).toContainText('Fermare 2 chat');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('chat-state-fix')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('chat-state-sms')).toHaveAttribute('data-state', 'idle');
  await expandChats(page, 'fix');
  await expect(page.getByTestId('tile-chat-fix')).toContainText('Interrotto da te');
  await expect(page.getByTestId('topbar-stopall')).toBeDisabled();
  await app.close();
});

test('⤢ maximizes a tile, Esc restores it; F11 maximizes the focused tile', async () => {
  const { page, app } = await launchDemo();
  await page.getByTestId('chat-max-fix').click();
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'chat:fix');
  await expect(page.getByTestId('tile-chat-qa')).toHaveCount(0);
  await expect.poll(async () => (await demoLayout(app)).every(l => l.rect === null)).toBe(true);
  await page.mouse.move(2, 2);
  await shot(page, 'maximized');
  await expect(page).toHaveScreenshot('maximized.png', VISUAL);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await expect(page.getByTestId('tile-chat-qa')).toBeVisible();
  await page.getByTestId('browser-url-tab-sms').focus();
  await page.keyboard.press('F11');
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'browser:tab-sms');
  await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-sms')?.rect?.width ?? 0).toBeGreaterThan(1000);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFullScreen()))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await app.close();
});

test('Ctrl+K opens the palette, hides every browser view, and jumps to a chat', async () => {
  const { page, app } = await launchDemo();
  await expandChats(page, 'qa'); // its browser is on the open strip; SMS stays collapsed
  await expect.poll(async () => (await demoLayout(app)).filter(l => l.rect).length).toBe(1);
  await page.keyboard.press('Control+K');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect.poll(async () => (await demoLayout(app)).every(l => l.rect === null)).toBe(true);
  await waitThumbs(page);
  await shot(page, 'palette');
  await expect(page).toHaveScreenshot('palette.png', VISUAL);
  await page.getByTestId('palette-input').fill('sms');
  await expect(page.getByTestId('palette-item-chat:sms')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('chat-input-sms')).toBeFocused(); // the jump opened its collapsed strip
  await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-sms')?.rect ?? null).not.toBeNull();
  // a brain page from the palette; Esc goes back
  await page.keyboard.press('Control+K');
  await page.getByTestId('palette-input').fill('costi');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-costi')).toBeVisible();
  await shot(page, 'ui-palette-costi');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await app.close();
});

test('ui:command from main steers the UI (maximize, restore, page, palette)', async () => {
  const { page, app } = await launchDemo();
  const send = (action: string, value?: string) => app.evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'))?.webContents.send('ui:command', cmd);
  }, { action, value });
  await send('maximize', 'qa');
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'chat:qa');
  await send('restore');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await send('page', 'oggi'); // an old name: Oggi is now DevOps
  await expect(page.getByTestId('brain-page-devops')).toBeVisible();
  await send('page', 'workspace');
  await expect(page.getByTestId('brain-page-devops')).toHaveCount(0);
  await send('palette');
  await expect(page.getByTestId('palette')).toBeVisible();
  await app.close();
});

test('Ctrl+N creates a chat: its tile appears with the first message and gets the focus', async () => {
  const { page, app } = await launchDemo();
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('newchat')).toBeVisible();
  // the folder is not asked: it defaults to the brain folder, the rest lives under Avanzate
  await expect(page.getByTestId('newchat-cwd')).toBeHidden();
  await page.getByTestId('newchat-advanced').locator('summary').click();
  await page.getByTestId('newchat-title').fill('Prova nuova chat');
  await page.getByTestId('newchat-prompt').fill('Controlla i log di oggi');
  await shot(page, 'new-chat');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('newchat')).toHaveCount(0);
  const tile = page.locator('[data-testid^="tile-chat-"]', { hasText: 'Prova nuova chat' });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText('Controlla i log di oggi');
  await expect(tile.locator('textarea')).toBeFocused();
  await app.close();
});

test('the live demo streams text and finishes running tools', async () => {
  const { page, app } = await launchDemo({ freeze: false });
  await expandChats(page, 'fix', 'sms'); // transcripts and requests are on the open strips
  // the fix's running test finishes, then its next message streams in
  await expect(page.getByTestId('tool-fix-t4')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(page.getByTestId('tile-chat-fix')).toContainText('Tutti verdi', { timeout: 10_000 });
  // the Cursor chat keeps driving its browser: new tool rows and a new last action on the tab
  const rows = page.getByTestId('tile-chat-sms').locator('.tool');
  const n = await rows.count();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThan(n);
  await expect(page.getByTestId('browser-action-tab-sms')).not.toHaveText('click ref_12 · «Attività»', { timeout: 10_000 });
  // and the permission it asks for shows up in its tile
  await expect(page.locator('[data-request-key]', { hasText: 'Esegue git commit' })).toBeVisible({ timeout: 15_000 });
  await app.close();
});

test('screenshots at 1280x800, in light theme, and with no data (empty states)', async () => {
  test.setTimeout(120_000); // three launches: 38-44 s on a loaded machine, over the default 60 s at times
  {
    const { page, app } = await launchDemo({ width: 1280, height: 800 });
    await waitThumbs(page);
    await shot(page, 'agents-1280');
    await app.close();
  }
  {
    const { page, app } = await launchDemo({ scheme: 'light' });
    await page.getByTestId('settings').click(); // the app's theme setting (default dark): light
    await page.getByTestId('theme-light').click();
    await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
    await waitThumbs(page);
    await page.mouse.move(2, 2);
    await shot(page, 'agents-light');
    await app.close();
  }
  {
    const { page, app } = await launch();
    await setSize(app, 1600, 1000);
    await page.emulateMedia({ colorScheme: 'dark' });
    // no Orchestrator yet: the column offers to create one
    await expect(page.getByTestId('regia-create')).toBeVisible();
    await expect(page.getByTestId('agents-empty')).toBeVisible();
    await shot(page, 'empty');
    await app.close();
  }
});
