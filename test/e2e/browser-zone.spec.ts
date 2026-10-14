// Mosaico zones and "Nascondi browser": on the demo, chats sit in the left zone and browsers in the right one (in the
// chats' order); the top-bar toggle and Ctrl+Shift+B hide every browser tile, the chats take the room, the choice
// survives a reload. On the real app with an MCP agent: with the browsers hidden the tab is parked off screen and the
// agent keeps reading and taking screenshots at the same size as on screen; a hand-off brings its tab back until it
// is resolved. Hiding with a browser maximized restores the grid.
// Screenshots in test-results/shots/zones-*.png.
import { expect, test } from '@playwright/test';
import { launch, launchDemo, shot, waitThumbs } from './helpers';
import { McpClient, pngSize, startSites } from './fixture-server';

test('chats left, browsers right; Nascondi browser hides them, the chats grow, the choice is remembered', async () => {
  const { app, page } = await launchDemo();
  await waitThumbs(page);
  const chats = page.getByTestId('zone-chats');
  const browsers = page.getByTestId('zone-browsers');
  await expect(browsers.locator('[data-testid^="tile-browser-"]')).toHaveCount(2);
  await expect(chats.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  await expect(chats.getByTestId('tile-chat-qa')).toBeVisible();
  // the browsers follow their chats' order
  const chatOrder = await chats.locator('[data-testid^="tile-chat-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.slice(10)));
  const tabOwners = await browsers.locator('[data-testid^="tile-browser-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')!.slice(13)));
  expect(tabOwners).toEqual(['tab-qa', 'tab-sms'].sort((a, b) => chatOrder.indexOf(a.slice(4)) - chatOrder.indexOf(b.slice(4))));
  await expect(page.getByTestId('splitter-zones')).toBeVisible();
  const before = (await chats.boundingBox())!.width;
  await shot(page, 'zones-mosaico');

  // the top-bar toggle
  const toggle = page.getByTestId('topbar-browsers');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  await expect(browsers).toHaveCount(0);
  await expect(page.getByTestId('topbar-browsers-count')).toHaveText('2');
  expect((await chats.boundingBox())!.width).toBeGreaterThan(before + 300);
  await page.mouse.move(2, 2);
  await shot(page, 'zones-browser-nascosti');

  // remembered across a reload
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('regia-pill')).toBeVisible();
  await expect(page.getByTestId('topbar-browsers')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);

  // Ctrl+Shift+B brings them back
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('topbar-browsers')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('zone-browsers').locator('[data-testid^="tile-browser-"]')).toHaveCount(2);

  // hiding with a browser maximized (F11) restores the grid
  await page.getByTestId('tile-browser-tab-qa').locator('.tile-head').click();
  await page.keyboard.press('F11');
  await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'browser:tab-qa');
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('maximized')).toHaveCount(0);
  await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+B');

  // Corsie: hidden drops the thumbnail strip too
  await page.getByTestId('view-toggle-corsie').click();
  await expect(page.getByTestId('thumb-tab-qa')).toBeVisible();
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByTestId('thumb-tab-qa')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+B');
  await app.close();
});

test('with the browsers hidden, an agent tab keeps working off screen at the same size', async () => {
  const sites = await startSites();
  const { app, page } = await launch();
  try {
    const info = await page.evaluate(() => window.sb.invoke('app:info', undefined));
    const agent = new McpClient(info.mcpUrl);
    await agent.init();
    await agent.ok('navigate', { url: `${sites.a}/index.html` });
    await expect(page.getByTestId('zone-browsers').locator('[data-testid^="tile-browser-"]')).toHaveCount(1);
    await expect.poll(async () => agent.ok('tabs_list'), { timeout: 10_000 }).toMatch(/\[on screen\]/);
    const onScreen = pngSize((await agent.call('screenshot')).images[0]!.data);

    await page.keyboard.press('Control+Shift+B');
    await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
    await expect.poll(async () => agent.ok('tabs_list'), { timeout: 10_000 }).not.toMatch(/\[on screen\]/);
    // parked, still alive: reads, acts and screenshots like before, at the size it had on screen
    expect(await agent.ok('get_page_text')).toContain('Pagina di prova');
    const parked = pngSize((await agent.call('screenshot')).images[0]!.data);
    expect(parked).toEqual(onScreen);
    await shot(page, 'zones-agente-nascosto');

    // a hand-off (the agent waits for the user) brings its tab back, in Mosaico and in Corsie, until it is resolved
    expect(await agent.ok('handoff_to_user', { reason: 'Login richiesto', wait_seconds: 1 })).toMatch(/Still waiting/);
    await expect(page.getByTestId('zone-browsers').getByTestId(/^handoff-t[0-9]+$/)).toBeVisible();
    await page.getByTestId('view-toggle-corsie').click();
    await expect(page.getByTestId('browser-strip').locator('button.thumb')).toHaveCount(1);
    await page.getByTestId('view-toggle-mosaico').click();
    const [h] = await page.evaluate(() => window.sb.invoke('browser:handoffs', undefined));
    await page.evaluate(id => window.sb.invoke('browser:handoffResolve', { id, outcome: 'done' }), h!.id);
    await expect(page.locator('[data-testid^="tile-browser-"]')).toHaveCount(0);
  } finally {
    await app.close();
    await sites.close();
  }
});
