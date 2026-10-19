// Browsers in the agents column: on the demo, each browser sits right beside the chat that drives it, opened and folded
// by the strip's globe; the retired "Nascondi browser" switch (#82) is gone and a saved "on" from before hides nothing.
// On the real app with an MCP agent: with the Grindhouse off screen (another page) the tab is parked and the agent keeps
// reading and taking screenshots at the same size as on screen.
// Screenshots in test-results/shots/zones-*.png.
import { expect, test } from '@playwright/test';
import { closeSetup, showBrowsers, launch, launchDemo, shot, waitThumbs } from './helpers';
import { McpClient, imageSize, startSites } from './fixture-server';

test('each browser beside its chat, folded by its globe; a saved hide-browsers choice hides nothing', async () => {
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

  // the strip's globe folds its browser again; the strip stays open
  await page.getByTestId('chat-browser-qa').click();
  await expect(page.getByTestId('chat-browser-qa')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('tile-browser-tab-qa')).toHaveCount(0);
  await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'true');

  // the retired "Nascondi browser" switch (#82): no menu item, no shortcut, a saved "on" no longer hides anything
  await page.getByTestId('topbar-more').click();
  await expect(page.getByTestId('more-browsers')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('tile-browser-tab-sms')).toBeVisible();
  await page.waitForTimeout(300); // the prefs are saved 150 ms after a change
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}'); localStorage.setItem('sb.prefs.v1', JSON.stringify({ ...p, browsersHidden: true })); });
  await page.reload();
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('view-agents').getByTestId('tile-browser-tab-sms')).toBeVisible();
  await page.mouse.move(2, 2);
  await shot(page, 'zones-browser-migrated');
  await app.close();
});

test('with the Grindhouse off screen, an agent tab keeps working parked at the same size', async () => {
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

    // another page in front: the tab is parked, still alive
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect.poll(async () => agent.ok('tabs_list'), { timeout: 10_000 }).not.toMatch(/\[on screen\]/);
    // parked: reads, acts and screenshots like before, at the size it had on screen
    expect(await agent.ok('get_page_text')).toContain('Pagina di prova');
    const parked = imageSize((await agent.call('screenshot')).images[0]!.data);
    expect(parked).toEqual(onScreen);
    await shot(page, 'zones-agente-nascosto');
  } finally {
    await app.close();
    await sites.close();
  }
});
