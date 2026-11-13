// The Grindhouse is only the agents' strips (Brother, 18/10): collapsed by default with the key facts on screen, a click
// anywhere on a strip expands it and a click on its head collapses it, a decision waiting is a "Ti aspetta" pill that
// opens that strip's decision in the questions window (popups off too), and G D lands on Memoria.
// Frozen demo; screenshots in test-results/shots/strips-*.png.
import { expect, test } from '@playwright/test';
import { launchDemo, layerState, setQuestionsAside, shot } from './helpers';

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
      await expect(page.getByTestId(`chat-sub-${id}`)).toHaveCount(0); // one line (ADR 0287): model, cost and context show once it is open
    }
    await expect(page.getByTestId('chat-input-fix')).toBeHidden();
    // a strip's browser is folded: a globe among the strip's controls opens it beside the chat
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
    // the strip's title, what it is doing, its last-activity line: each click on a collapsed strip expands it
    for (const part of ['.th-title', '.strip-now', '.chat-strip-line']) {
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
    await setQuestionsAside({ app, page }); // a reload forgets «Rispondi dopo»
    await page.getByTestId('tile-chat-fix').locator('.chat-strip-line').click();
    await expect(page.getByTestId('chat-expand-fix')).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(2, 2);
    await shot(page, 'strips-expand-every-time');
  } finally {
    await app.close();
  }
});

test('a collapsed strip keeps its requests on its pill: none floats in the layer, Ctrl+J opens them in the questions window', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    // the Orchestrator's decision leaves: only the work chats' requests are open, set aside, on collapsed strips
    await app.evaluate(() => (globalThis as unknown as { __sbDemo: { stop(id: string): Promise<void> } }).__sbDemo.stop('orchestrator'));
    await expect(page.getByTestId('chat-wait-qa')).toBeVisible();
    await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'false');
    expect((await layerState(app)).attached).toBe(false); // the layer holds toasts only
    // Ctrl+J: the oldest request takes the keyboard in the questions window; the strip stays as it was
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+J');
    await expect(page.getByTestId('qwin')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.qwin [data-request-key]')?.getAttribute('data-request-key') ?? null)).not.toBeNull();
    await expect(page.getByTestId('chat-expand-qa')).toHaveAttribute('aria-expanded', 'false');
    expect((await layerState(app)).attached).toBe(false);
  } finally {
    await app.close();
  }
});

test('G D (the old Dashboard key) lands on Memoria, with no day sentence (ADR 0122, 0201)', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900 });
  try {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page.getByTestId('bm-memory-page')).toBeVisible();
    await expect(page.getByTestId('mh-hero').getByTestId('dash-headline')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
