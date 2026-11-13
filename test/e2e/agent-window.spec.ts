// E2E of the agent window and the one full screen (ADR 0287), on the frozen demo: a strip is one line with no ✕ and
// no "?"; an agent's chat and its browser are one window with three views (Chat, Affiancati, Browser) and a line to
// drag between them; full screen covers the whole app window for the chat and for the browser, Ctrl+R shows the
// Orchestrator beside it, Esc closes the column first and then the full screen; the top bar's extras live under the
// gear. Screenshots in test-results/shots/agent-window-*.png.
import { expect, test } from '@playwright/test';
import { demoLayout, launchDemo, shot, waitThumbs } from './helpers';

test('one window per agent: three views, a line to drag, one full screen over the whole app', async () => {
  const W = 1600, H = 900;
  const { app, page } = await launchDemo({ width: W, height: H });
  try {
    // a strip is one line: no ✕, no "?", the views only once it has a browser to show
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid^="chat-x-"], [data-testid^="chat-help-"]')).toHaveCount(0);
    expect((await page.getByTestId('tile-chat-sms').boundingBox())!.height).toBeLessThan(48);
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0); // an owned browser is never a row of its own
    await page.mouse.move(2, 2);
    await shot(page, 'agent-window-strips');

    // «Affiancati» from the closed strip opens it with the browser beside the chat, in one frame
    const split = page.getByTestId('chat-browser-sms');
    await split.click();
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'true');
    const body = page.getByTestId('strip-pair-sms'), browser = body.getByTestId('tile-browser-tab-sms');
    await expect(browser).toBeVisible();
    await body.scrollIntoViewIfNeeded();
    const chatBox = async () => (await body.locator('.chat-work').boundingBox())!;
    const before = await chatBox(), browserBox = (await browser.boundingBox())!;
    expect(browserBox.x).toBeGreaterThanOrEqual(before.x + before.width - 1);
    const sms = async () => (await demoLayout(app)).find(l => l.tabId === 'tab-sms')?.rect ?? null;
    await expect.poll(sms).not.toBeNull();
    await waitThumbs(page);
    await shot(page, 'agent-window-split');

    // the line between them, from the keyboard: the chat gets wider, and a double click puts it back
    const divider = page.getByTestId('chat-divider-sms');
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await chatBox()).width).toBeGreaterThan(before.width + 10);
    await divider.dblclick();
    await expect.poll(async () => Math.abs((await chatBox()).width - before.width)).toBeLessThan(3);

    // «Browser»: the page with the reply field under it; «Chat»: the chat alone, the page keeps working off screen
    await page.getByTestId('chat-view-browser-sms').click();
    await expect(body.locator('.chat-work .items')).toBeHidden();
    await expect(page.getByTestId('chat-input-sms')).toBeVisible(); // the reply field stays under the page
    await expect(browser).toBeVisible();
    await page.getByTestId('chat-view-chat-sms').click();
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0);
    await expect.poll(sms).toBeNull();
    await split.click();

    // full screen covers the whole window (no top bar, no navigation, no Orchestrator), with the page drawn in it
    await page.getByTestId('tile-chat-sms').hover();
    await page.getByTestId('chat-max-sms').click();
    const full = page.getByTestId('maximized');
    await expect(full).toHaveAttribute('data-key', 'chat:sms');
    const box = (await full.boundingBox())!;
    expect(Math.round(box.width)).toBe(W);
    expect(Math.round(box.height)).toBe(H);
    await expect.poll(async () => (await sms())?.height ?? 0).toBeGreaterThan(H - 140);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFullScreen()))).toBe(false);
    await waitThumbs(page);
    await page.mouse.move(2, 2);
    await shot(page, 'agent-window-full');

    // Ctrl+R: the Orchestrator beside it, the page still drawn and not under the column
    await page.keyboard.press('Control+r');
    await expect(page.getByTestId('full-orchestrator')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
    const col = (await page.getByTestId('orchestrator-overlay').boundingBox())!;
    await expect.poll(async () => { const r = await sms(); return r ? r.x + r.width : 0; }).toBeLessThanOrEqual(Math.ceil(col.x) + 1);
    expect((await sms())!.x + (await sms())!.width).toBeGreaterThan(0);
    await waitThumbs(page);
    await shot(page, 'agent-window-full-orchestrator');

    // Esc closes the column first, then the full screen; F11 on the selected strip is the same mode
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('full-orchestrator')).toHaveAttribute('aria-pressed', 'false');
    await expect(full).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(full).toHaveCount(0);
    await expect(page.getByTestId('tile-chat-qa')).toBeVisible();
    await page.getByTestId('tile-chat-fix').locator('.th-title').click();
    await page.keyboard.press('F11');
    await expect(full).toHaveAttribute('data-key', 'chat:fix');
    await page.getByTestId('focus-exit').click();
    await expect(full).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the top bar keeps the controls of every minute; the rest is under the gear', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    for (const gone of ['topbar-more', 'topbar-lang', 'nav-recent']) await expect(page.getByTestId(gone)).toHaveCount(0);
    await page.getByTestId('settings').click();
    const menu = page.getByTestId('settings-pop');
    await expect(menu).toBeVisible();
    for (const item of ['topbar-new-browser', 'topbar-maint-run', 'more-credentials', 'topbar-lang-system', 'settings-shortcuts', 'settings-all']) await expect(menu.getByTestId(item)).toBeVisible();
    await shot(page, 'agent-window-gear-menu');
    await menu.getByTestId('settings-shortcuts').click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('shortcuts')).toBeVisible();
  } finally {
    await app.close();
  }
});
