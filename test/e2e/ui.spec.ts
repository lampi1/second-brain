// E2E tests of the renderer UI on the demo (SB_DEMO=1; frozen = deterministic): the agents workspace, answering from the questions window with "1", sending and queueing from a tile input, Ferma tutto
// with its confirm, maximize/restore, the palette hiding every browser view, ui:command from main, new chat, brain
// pages and live demo streaming. Behavior and geometry are asserted; screenshots for native visual review
// (including 1280x800 and light theme) are captured in test-results/shots/.
import { expect, test } from '@playwright/test';
import { choose, demoLayout, expandChats, showBrowsers, launch, launchDemo, setSize, shot, waitThumbs } from './helpers';

test('agents workspace: one column of chat strips, each browser right under its chat', async () => {
  const { app, page } = await launchDemo();
  await expandChats(page, 'feedback'); await showBrowsers(page, 'qa', 'sms'); // open strips: their transcripts and browsers in sight
  await expect(page.getByTestId('view-agents')).toBeVisible();
  await expect(page.getByTestId('needs-lane')).toHaveCount(0); // no "Ti aspettano" strip
  await expect(page.locator('[data-request-key]')).toHaveCount(0); // every request is in the questions window (set aside here), none in a tile
  for (const id of ['qa', 'fix', 'sms', 'feedback']) await expect(page.getByTestId(`tile-chat-${id}`)).toBeVisible();
  await expect(page.getByTestId('tile-browser-tab-qa')).toBeVisible();
  // no "Finite oggi" dock: a finished chat stays a tile until it closes by itself (autoclose.spec.ts)
  await expect(page.getByTestId('tile-chat-mappa')).toBeVisible();
  await expect(page.getByTestId('folded-dock')).toHaveCount(0);
  // the Orchestrator column is always open beside the Grindhouse (ADR 0068)
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  // one column: each browser follows the chat that drives it
  const panes = await page.locator('[data-workspace-pane]').evaluateAll(els => els.map(e => e.getAttribute('data-workspace-pane')));
  expect(panes.indexOf('browser:tab-qa')).toBe(panes.indexOf('chat:qa') + 1);
  expect(panes.indexOf('browser:tab-sms')).toBe(panes.indexOf('chat:sms') + 1);
  // a native view is placed while its tile is in the window (the column scrolls): each one, brought into view
  const rect = (tabId: string) => async () => (await demoLayout(app)).find(l => l.tabId === tabId)?.rect ?? null;
  await page.getByTestId('tile-browser-tab-sms').scrollIntoViewIfNeeded();
  await expect.poll(rect('tab-sms')).not.toBeNull();
  await page.getByTestId('tile-browser-tab-qa').scrollIntoViewIfNeeded();
  await expect.poll(rect('tab-qa')).not.toBeNull();
  await waitThumbs(page);
  await shot(page, 'agents');
  await app.close();
});

test('answering from the questions window with "1" resolves the request without opening the chat', async () => {
  const { page, app } = await launchDemo({ questions: true });
  const said = (chatId: string) => async () => JSON.stringify(await page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), chatId));
  const card = page.getByTestId('qwin-card');
  await page.keyboard.press('Control+J'); // the oldest first: the Orchestrator's decision, with the keyboard
  await expect(card).toHaveAttribute('data-request-key', 'orchestrator/orchestrator-q1');
  await expect(card).toBeFocused();
  await page.keyboard.press('1');
  await expect.poll(said('orchestrator')).toContain('Segnato: riparto da **QA rimborsi**');
  // the next request takes the card and the keyboard: QA's question, then Feedback's permission
  await expect(card).toHaveAttribute('data-request-key', 'qa/qa-q1');
  await expect(card).toBeFocused();
  await page.keyboard.press('1');
  await expect.poll(said('qa')).toContain('Apro il bug');
  await expect(card).toHaveAttribute('data-request-key', 'feedback/feedback-p1');
  await expect(card).toBeFocused();
  await page.keyboard.press('3'); // «Non procedere»
  await expect.poll(said('feedback')).toContain('non lancio i test');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.locator('[data-request-key]')).toHaveCount(0);
  await expect(page.getByTestId('maximized')).toHaveCount(0); // the chat was not opened
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
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await expect(page.getByTestId('tile-chat-qa')).toBeVisible();
  await showBrowsers(page, 'sms'); // its browser unfolds under its strip (folded until its globe is pressed)
  const sms = async () => (await demoLayout(app)).find(l => l.tabId === 'tab-sms')?.rect ?? null;
  await page.getByTestId('tile-browser-tab-sms').scrollIntoViewIfNeeded();
  await expect.poll(sms).not.toBeNull();
  const before = (await sms())!;
  await page.getByTestId('browser-url-tab-sms').focus();
  await page.keyboard.press('F11');
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'browser:tab-sms');
  // maximized, the page takes the Grindhouse's whole height and width (the Orchestrator column keeps its side, ADR 0068)
  await expect.poll(async () => (await sms())?.height ?? 0).toBeGreaterThan(before.height + 100);
  expect((await sms())!.width).toBeGreaterThanOrEqual(before.width);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFullScreen()))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await app.close();
});

test('Ctrl+K opens the palette, hides every browser view, and jumps to a chat', async () => {
  const { page, app } = await launchDemo();
  await showBrowsers(page, 'qa'); // its browser is under the open strip; SMS stays collapsed
  await page.getByTestId('tile-browser-tab-qa').scrollIntoViewIfNeeded(); // a view is placed while its tile is in the window
  await expect.poll(async () => (await demoLayout(app)).filter(l => l.rect).length).toBe(1);
  await page.keyboard.press('Control+K');
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect.poll(async () => (await demoLayout(app)).every(l => l.rect === null)).toBe(true);
  await waitThumbs(page);
  await shot(page, 'palette');
  await page.getByTestId('palette-input').fill('sms');
  await expect(page.getByTestId('palette-item-chat:sms')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(page.getByTestId('chat-input-sms')).toBeFocused(); // the jump opened its collapsed strip
  // the palette closed: the views it hid come back (QA's, in the window again; SMS's stays folded under its globe)
  await page.getByTestId('tile-browser-tab-qa').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await demoLayout(app)).find(l => l.tabId === 'tab-qa')?.rect ?? null).not.toBeNull();
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
  await send('page', 'oggi'); // an old name: Oggi is now Task
  await expect(page.getByTestId('brain-page-task')).toBeVisible();
  await send('page', 'workspace');
  await expect(page.getByTestId('brain-page-task')).toHaveCount(0);
  await send('palette');
  await expect(page.getByTestId('palette')).toBeVisible();
  await app.close();
});

test('Ctrl+N is a new request to the Orchestrator: its input takes the keyboard, the request goes to it', async () => {
  const { page, app } = await launchDemo({ orchestrator: true });
  await page.keyboard.press('Control+N');
  const input = page.getByTestId('orchestrator-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('Controlla i log di oggi');
  await shot(page, 'new-request');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tile-orchestrator')).toContainText('Controlla i log di oggi');
  await app.close();
});

test('the live demo streams text and finishes running tools', async () => {
  const { page, app } = await launchDemo({ freeze: false });
  await expandChats(page, 'fix'); await showBrowsers(page, 'sms'); // transcripts, requests and SMS's tab on the open strips
  // the fix's running test finishes, then its next message streams in (a transcript out of the window keeps its last
  // snapshot, ChatTranscript.tsx: the fix's is brought into view)
  await page.getByTestId('tile-chat-fix').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('tool-fix-t4')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(page.getByTestId('tile-chat-fix')).toContainText('Tutti verdi', { timeout: 10_000 });
  // the Cursor chat keeps driving its browser: new tool rows and a new last action on the tab
  await page.getByTestId('tile-chat-sms').scrollIntoViewIfNeeded();
  const rows = page.getByTestId('tile-chat-sms').locator('.tool');
  const n = await rows.count();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThan(n);
  await page.getByTestId('tile-browser-tab-sms').scrollIntoViewIfNeeded();
  // A narrow split card intentionally hides this caption; inspect it in the user's expanded browser view.
  await page.getByTestId('browser-max-tab-sms').click();
  await expect(page.getByTestId('browser-action-tab-sms')).toBeVisible();
  await expect(page.getByTestId('browser-action-tab-sms')).not.toHaveText('click ref_12 · «Attività»', { timeout: 10_000 });
  // and the permission it asks for is an open request (the questions window shows it; set aside here, launchDemo)
  await expect.poll(async () => (await page.evaluate(() => window.sb.invoke('chat:pending', undefined))).some(p => p.chatId === 'fix' && p.type === 'permission' && p.detail.includes('git commit')), { timeout: 15_000 }).toBe(true);
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
    // the app's theme setting (default dark), on the Settings page: light
    await page.getByTestId('settings').click();
    await page.getByTestId('settings-all').click();
    await choose(page.getByTestId('st-theme-select'), 'light');
    await page.getByTestId('nav-home').click();
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
    await expect(page.getByTestId('orchestrator-create')).toBeVisible();
    await expect(page.getByTestId('agents-empty')).toBeVisible();
    await shot(page, 'empty');
    await app.close();
  }
});
