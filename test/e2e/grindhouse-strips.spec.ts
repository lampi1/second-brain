// The Grindhouse is only the agents' strips (Brother, 18/10): collapsed by default with the key facts on screen, a click
// anywhere on a strip expands it and a click on its head collapses it, a decision waiting is a "Ti aspetta" pill that
// opens that strip's decision in the questions window (popups off too), and the headline moved to the Dashboard.
// Frozen demo; screenshots in test-results/shots/strips-*.png and dashboard-headline.png.
import { expect, test } from '@playwright/test';
import { launchDemo, layerState, shot } from './helpers';

test('strips: collapsed with their facts, click to expand and collapse, "Ti aspetta" opens the decision', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const home = page.getByTestId('home');
    await expect(home).toBeVisible();
    // nothing but the strips: no greeting, no headline, no counts, no "Aspetta te" list
    await expect(home.locator('h1')).toHaveCount(0);
    await expect(page.getByTestId('dash-headline')).toHaveCount(0);
    await expect(page.locator('[data-testid^="home-request-"]')).toHaveCount(0);
    for (const id of ['qa', 'fix', 'sms', 'feedback']) {
      await expect(page.getByTestId(`chat-expand-${id}`)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId(`chat-sub-${id}`)).toBeVisible(); // model, cost, work time, context: collapsed too
    }
    await expect(page.getByTestId('chat-input-fix')).toBeHidden();
    // a strip's browser is folded: a quiet globe on the strip says it has one
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0);
    await expect(page.getByTestId('chat-browser-sms')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('chat-browser-fix')).toHaveCount(0);
    // a decision waiting: one pill on the strip, no panel inside the collapsed strip
    await expect(page.getByTestId('chat-wait-qa')).toBeVisible();
    await expect(page.getByTestId('chat-state-qa')).toBeHidden(); // the pill takes the state's place
    await expect(page.getByTestId('tile-chat-qa').locator('[data-request-key]')).toHaveCount(0);
    await page.mouse.move(2, 2);
    await shot(page, 'strips-collapsed');

    // a click on the strip's text expands it; a click on its head collapses it
    await page.getByTestId('tile-chat-sms').locator('.chat-strip-line').click();
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('chat-input-sms')).toBeVisible();
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0); // still folded until its globe is pressed
    await page.mouse.move(2, 2);
    await shot(page, 'strips-expanded');
    await page.getByTestId('tile-chat-sms').locator('.th-title').click();
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0);
    // the strip's own controls do not toggle it
    await page.getByTestId('chat-menu-qa').click();
    await expect(page.getByTestId('chat-menu-pop-qa')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'false');

    // popups off (the demo's default): the pill opens that strip's decision in the questions window
    await page.getByTestId('chat-wait-qa').click();
    await expect(page.getByTestId('qwin')).toBeVisible();
    await expect(page.getByTestId('qwin-card')).toHaveAttribute('data-request-key', 'qa/qa-q1');
    await page.mouse.move(2, 2);
    await shot(page, 'strips-wait-popup');
    await page.getByTestId('qwin-card').focus();
    await page.keyboard.press('1');
    await expect(page.getByTestId('chat-wait-qa')).toHaveCount(0);
    await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'false'); // answered without opening it
  } finally {
    await app.close();
  }
});

test('a click expands a strip every time: repeated, on any part of it, with text selected elsewhere (#78)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    const expand = page.getByTestId('chat-expand-fix');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    // the strip's title, its facts line, its last-answer line: each click on a collapsed strip expands it
    for (const part of ['.th-title', '.strip-facts', '.chat-strip-line']) {
      await page.getByTestId('tile-chat-fix').locator(part).first().click();
      await expect(expand, part).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('chat-input-fix')).toBeVisible();
      await page.getByTestId('tile-chat-fix').locator('.th-title').click();
      await expect(expand, part).toHaveAttribute('aria-expanded', 'false');
    }
    // text selected somewhere else (an answer in the Orchestrator's column) used to swallow every strip click: the
    // body is not selectable, so the click never cleared the selection and the strip read it as a drag-select
    const selected = await page.evaluate(() => {
      const el = document.querySelector('[data-orchestrator-overlay] .md, [data-orchestrator-overlay] .bubble');
      if (!el) return '';
      const range = document.createRange(); range.selectNodeContents(el);
      const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
      return sel.toString();
    });
    expect(selected.length).toBeGreaterThan(0);
    await page.getByTestId('tile-chat-fix').locator('.chat-strip-line').click();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('tile-chat-fix').locator('.th-title').click();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    // the same after a reload (the saved choice is read back, a click still flips it)
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
    await page.getByTestId('tile-chat-fix').locator('.chat-strip-line').click();
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(2, 2);
    await shot(page, 'strips-expand-every-time');
  } finally {
    await app.close();
  }
});

test('an expanded strip opens its own browser beside its chat from its globe, each with its own full-screen control', async () => {
  // a wide window: under 640 px of strips column (AgentStrips.tsx NARROW_PX; at 1600 px beside the Orchestrator's
  // column it is ~630) the browser stacks under its chat instead
  const { app, page } = await launchDemo({ width: 1920, height: 900 });
  try {
    await page.getByTestId('tile-chat-sms').locator('.chat-strip-line').click();
    await page.getByTestId('chat-browser-sms').click();
    await expect(page.getByTestId('chat-browser-sms')).toHaveAttribute('aria-pressed', 'true');
    const browser = page.getByTestId('tile-browser-tab-sms');
    await expect(browser).toBeVisible();
    // one frame on the strip's accent: chat left, browser right, both in view
    const pair = page.getByTestId('strip-pair-sms');
    await expect(pair.getByTestId('tile-chat-sms')).toBeVisible();
    await expect(pair.getByTestId('tile-browser-tab-sms')).toBeVisible();
    await expect(page.getByTestId('browser-owner-tab-sms')).toContainText('Bug notifiche SMS');
    await pair.scrollIntoViewIfNeeded();
    const chatBox = (await page.getByTestId('tile-chat-sms').boundingBox())!, browserBox = (await browser.boundingBox())!;
    expect(browserBox.x).toBeGreaterThanOrEqual(chatBox.x + chatBox.width - 1);
    expect(Math.abs(browserBox.y - chatBox.y)).toBeLessThan(2);
    expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(900);
    await expect(page.getByTestId('chat-max-sms')).toHaveAttribute('aria-label', /Chat a tutto schermo/);
    await expect(page.getByTestId('browser-max-tab-sms')).toHaveAttribute('aria-label', /Browser a tutto schermo/);
    await page.mouse.move(2, 2);
    await shot(page, 'strips-owned-browser');
    // each one goes full screen on its own, and back
    await page.getByTestId('browser-max-tab-sms').click();
    await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'browser:tab-sms');
    await page.getByTestId('browser-max-tab-sms').click();
    await page.getByTestId('chat-max-sms').click();
    await expect(page.getByTestId('maximized')).toHaveAttribute('data-key', 'chat:sms');
  } finally {
    await app.close();
  }
});

test('the globe of a collapsed strip opens the strip and shows its browser; a second click hides it (#74)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    // the old "Nascondi browser" switch left on (#82, the cause of #74): it is dropped and hides nothing
    await page.waitForTimeout(300);
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('sb.prefs.v1') ?? '{}'); localStorage.setItem('sb.prefs.v1', JSON.stringify({ ...p, browsersHidden: true })); });
    await page.reload();
    await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'false');
    const globe = page.getByTestId('chat-browser-sms');
    await globe.click();
    await expect(globe).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('strip-pair-sms').getByTestId('tile-browser-tab-sms')).toBeVisible();
    await page.mouse.move(2, 2);
    await shot(page, 'strips-globe-from-collapsed');
    await globe.click();
    await expect(globe).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('tile-browser-tab-sms')).toHaveCount(0);
    // collapsed again with its browser left on: the globe reads off, one click shows the browser again
    await globe.click();
    await page.getByTestId('tile-chat-sms').locator('.th-title').click();
    await expect(page.getByTestId('chat-expand-sms')).toHaveAttribute('aria-expanded', 'false');
    await expect(globe).toHaveAttribute('aria-pressed', 'false');
    await globe.click();
    await expect(page.getByTestId('tile-browser-tab-sms')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a narrow column stacks an expanded strip with its browser: the browser goes under its chat', async () => {
  const { app, page } = await launchDemo({ width: 1100, height: 900 });
  try {
    await expect(page.locator('.agent-strips.is-narrow')).toHaveCount(1);
    await page.getByTestId('tile-chat-sms').locator('.chat-strip-line').click();
    await page.getByTestId('chat-browser-sms').click();
    const browser = page.getByTestId('strip-pair-sms').getByTestId('tile-browser-tab-sms');
    await expect(browser).toBeVisible();
    const chatBox = (await page.getByTestId('tile-chat-sms').boundingBox())!, browserBox = (await browser.boundingBox())!;
    expect(browserBox.y).toBeGreaterThanOrEqual(chatBox.y + chatBox.height - 1);
    await browser.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await shot(page, 'strips-owned-browser-narrow');
  } finally {
    await app.close();
  }
});

test('a collapsed strip keeps its requests on its pill: none floats in the layer, Ctrl+J opens the strip on it', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    // the Orchestrator's decision leaves: only the work chats' requests are open, on collapsed strips
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { stop(id: string): Promise<void> } }).__sbDemo.stop('orchestrator'));
    await expect(page.locator('[data-orchestrator-overlay] [data-request-key]')).toHaveCount(0);
    await expect(page.getByTestId('chat-wait-qa')).toBeVisible();
    await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await layerState(app)).cards).toBe(0);
    // Ctrl+J: the oldest request takes the keyboard on its strip, opened for it
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+J');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-request-key]')?.getAttribute('data-request-key') ?? null)).not.toBeNull();
    const chat = (await page.evaluate(() => document.activeElement!.closest('[data-request-key]')!.getAttribute('data-request-key')!)).split('/')[0]!;
    await expect(page.getByTestId(`chat-expand-${chat}`)).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await layerState(app)).cards).toBe(0);
  } finally {
    await app.close();
  }
});

test('the headline sentence heads Memoria (G D, the old Dashboard key, lands there: ADR 0122)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page.getByTestId('bm-memory-page')).toBeVisible();
    const line = page.getByTestId('mh-hero').getByTestId('dash-headline');
    await expect(line).toHaveAttribute('data-source', 'builtin'); // the demo has no API key: the built-in line
    await expect(line).not.toBeEmpty();
    await shot(page, 'memoria-headline');
  } finally {
    await app.close();
  }
});
