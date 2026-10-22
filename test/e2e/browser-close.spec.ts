// Closing a browser tile like a chat (#168), in the demo: the ✕ in the tile header closes it at once and its native
// view leaves the layout.
import { test, expect } from '@playwright/test';
import { demoLayout, launchDemo, shot, showBrowsers, waitThumbs } from './helpers';

// the demo (fake chats and tabs, frozen clock): the ✕ sits at the right end of the browser tile's header, as on a chat
// tile; once closed the native view leaves the layout, so no page stays drawn over the grid
test('demo: the ✕ closes a browser tile and its native view leaves the layout', async () => {
  const { app: demo, page: p } = await launchDemo();
  try {
    await showBrowsers(p, 'qa'); // a strip's browsers are folded until its globe is pressed
    const tile = p.locator('[data-testid^="tile-browser-"]').first();
    await tile.scrollIntoViewIfNeeded(); // under its strip: a native view is placed while its tile is in the window
    await waitThumbs(p);
    const tabId = (await tile.getAttribute('data-tab-id'))!;
    await expect.poll(async () => (await demoLayout(demo)).find(v => v.tabId === tabId)?.rect ?? null).not.toBeNull();
    await shot(p, 'browser-close-demo-before');
    await p.getByTestId(`browser-x-${tabId}`).click();
    await expect(p.getByTestId(`tile-browser-${tabId}`)).toHaveCount(0);
    await expect.poll(async () => (await demoLayout(demo)).find(v => v.tabId === tabId)?.rect ?? null).toBeNull();
    await shot(p, 'browser-close-demo-after');
    await expect.poll(async () => (await p.evaluate(() => window.sb.invoke('browser:list', undefined))).some(t => t.id === tabId), { timeout: 10_000 }).toBe(false);
  } finally { await demo.close(); }
});
