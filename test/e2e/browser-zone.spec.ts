// Browsers in the agents column and "Nascondi browser": on the demo, each browser strip sits right under the chat that
// drives it; the top-bar toggle and Ctrl+Shift+B hide every browser strip, the choice survives a reload.
// On the real app with an MCP agent: with the browsers hidden the tab is parked off screen and the agent keeps reading and taking screenshots at the same size as on screen; a hand-off brings its tab back until it
// is resolved. Hiding with a browser maximized restores the column.
// Screenshots in test-results/shots/zones-*.png.
import { expect, test } from '@playwright/test';
import { closeSetup, showBrowsers, launch, launchDemo, shot, waitThumbs } from './helpers';
import { McpClient, imageSize, startSites } from './fixture-server';

test('each browser under its chat; Nascondi browser hides them, the choice is remembered', async () => {
  const { app, page } = await launchDemo();
  await showBrowsers(page, 'qa', 'sms'); // a strip's browser shows once opened beside the open strip
  await waitThumbs(page);
  const column = page.getByTestId('view-agents');
  await expect(column.locator('[data-testid^="tile-browser-"]')).toHaveCount(2);
  await expect(column.getByTestId('tile-chat-qa')).toBeVisible();
  // each browser follows the chat that drives it
  const panes = await column.locator('[data-workspace-pane]').evaluateAll(els => els.map(e => e.getAttribute('data-workspace-pane')));
  for (const [chat, tab] of [['qa', 'tab-qa'], ['sms', 'tab-sms']]) expect(panes.indexOf(`browser:${tab}`)).toBe(panes.indexOf(`chat:${chat}`) + 1);
  await shot(page, 'zones-agents');

  // the toggle in the top bar's "…"
  await page.getByTestId('topbar-more').click();
  await expect(page.getByTestId('more-browsers')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('more-browsers').click();
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  await expect(page.getByTestId('topbar-browsers-count')).toHaveText('2');
  await page.mouse.move(2, 2);
  await shot(page, 'zones-browser-nascosti');

  // remembered across a reload
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('regia-overlay')).toBeVisible();
  await expect(page.getByTestId('topbar-browsers-count')).toHaveText('2');
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);

  // Ctrl+Shift+B brings them back
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('topbar-browsers-count')).toHaveCount(0);
  await expect(column.locator('[data-testid^="tile-browser-"]')).toHaveCount(2);

  // hiding with a browser maximized (F11) restores the column
  await page.getByTestId('tile-browser-tab-qa').locator('.tile-head').click();
  await page.keyboard.press('F11');
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'browser:tab-qa');
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+B');
  await app.close();
});

test('with the browsers hidden, an agent tab keeps working off screen at the same size', async () => {
  const sites = await startSites();
  const { app, page } = await launch();
  try {
    await closeSetup(page); // its modal covers the browser views
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    const agent = new McpClient(info.mcpUrl);
    await agent.init();
    await agent.ok('navigate', { url: `${sites.a}/index.html` });
    await expect(page.getByTestId('view-agents').locator('[data-testid^="tile-browser-"]')).toHaveCount(1);
    await expect.poll(async () => agent.ok('tabs_list'), { timeout: 10_000 }).toMatch(/\[on screen\]/);
    const onScreen = imageSize((await agent.call('screenshot')).images[0]!.data);
    // app_screenshot: the UI and the tab on screen, each scaled for the agent (long side ~1000 px) with its factor
    const appCtl = new McpClient(new URL('/mcp/app', info.mcpUrl).href);
    await appCtl.init();
    const ui = await appCtl.call('app_screenshot');
    expect(ui.images.length).toBeGreaterThanOrEqual(2);
    for (const im of ui.images) { expect(im.mimeType).toBe('image/jpeg'); expect(Math.max(...Object.values(imageSize(im.data)))).toBeLessThanOrEqual(1100); }
    expect(ui.text).toMatch(/image 1: app UI \d+x\d+, image \d+x\d+ \(UI px = image px × [\d.]+\)/);
    expect(ui.text).toMatch(/image 2: browser tab http:\/\/\S+\/index\.html at x=/);

    await page.keyboard.press('Control+Shift+B');
    await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
    await expect.poll(async () => agent.ok('tabs_list'), { timeout: 10_000 }).not.toMatch(/\[on screen\]/);
    // parked, still alive: reads, acts and screenshots like before, at the size it had on screen
    expect(await agent.ok('get_page_text')).toContain('Pagina di prova');
    const parked = imageSize((await agent.call('screenshot')).images[0]!.data);
    expect(parked).toEqual(onScreen);
    await shot(page, 'zones-agente-nascosto');

    // a hand-off (the agent waits for the user) brings its tab back until it is resolved
    expect(await agent.ok('handoff_to_user', { reason: 'Login richiesto', wait_seconds: 1 })).toMatch(/Still waiting/);
    await expect(page.getByTestId('view-agents').getByTestId(/^handoff-t[0-9]+$/)).toBeVisible();
    const [h] = await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined));
    await page.evaluate(id => window.sb.invoke('browser:handoffResolve', { id, outcome: 'done' }), h!.id);
    await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  } finally {
    await app.close();
    await sites.close();
  }
});
