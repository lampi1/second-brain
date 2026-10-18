// E2E of the "?" explanation marks (components/HelpTip.tsx) on the frozen demo: on Impostazioni, hovering the mark of
// "Instradamento modelli" opens the styled bubble inside the window (dark and light screenshots); keyboard focus on the
// "Domande in finestra" mark opens its bubble (aria-describedby points at it) and Esc closes it without leaving the page;
// a click pins it until a press elsewhere. Screenshots: test-results/shots/helptip-*.png.
import { expect, test, type Page } from '@playwright/test';
import { launchDemo, shot } from './helpers';

async function openSettings(page: Page) {
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-all').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
}

for (const scheme of ['dark', 'light'] as const) {
  test(`a setting's "?" opens a styled explanation on hover (${scheme})`, async () => {
    const { page } = await launchDemo({ scheme });
    await openSettings(page);
    if (scheme === 'light') {
      await page.getByTestId('st-theme-choice-light').click();
      await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
    }
    const mark = page.getByTestId('st-help-routing');
    await mark.scrollIntoViewIfNeeded();
    const bubble = page.getByTestId('st-help-routing-bubble');
    await expect(bubble).toBeHidden();
    await mark.hover();
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute('role', 'tooltip');
    await expect(bubble).toContainText('Una tabella di regole');
    await expect(bubble).toContainText('Esempio:');
    // inside the window, readable width, the theme's surface
    const box = (await bubble.boundingBox())!;
    const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })); // Electron: no Playwright viewport
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(box.width).toBeGreaterThan(200);
    expect(box.width).toBeLessThanOrEqual(321);
    const bg = await bubble.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(23, 26, 33)' : 'rgb(246, 247, 249)');
    await shot(page, `helptip-hover-${scheme}`);
    // the pointer leaves: it closes
    await page.mouse.move(5, 5);
    await expect(bubble).toBeHidden();
  });
}

test('keyboard focus opens the explanation, Esc closes it and stays on the page; a click pins it', async () => {
  const { page } = await launchDemo();
  await openSettings(page);
  const mark = page.getByTestId('st-help-qwin');
  const bubble = page.getByTestId('st-help-qwin-bubble');
  // Tab from the control just before it: a real keyboard focus (focus-visible)
  await page.getByTestId('st-run-results-switch').focus();
  await page.keyboard.press('Tab');
  await expect(mark).toBeFocused();
  await expect(bubble).toBeVisible();
  const id = await bubble.getAttribute('id');
  await expect(mark).toHaveAttribute('aria-describedby', id!);
  await expect(mark).toHaveAccessibleName('Spiegazione: Domande in finestra');
  await expect(mark).toHaveAccessibleDescription(/arrivano davanti a tutto/);
  await shot(page, 'helptip-focus');
  await page.keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(mark).toBeFocused();

  // a click pins it: the pointer can leave, a press elsewhere closes it
  await mark.click();
  await expect(bubble).toBeVisible();
  await expect(mark).toHaveAttribute('data-hover', '');
  await page.mouse.move(5, 5);
  await expect(mark).not.toHaveAttribute('data-hover'); // the leave was handled: a pinned bubble schedules no close
  await expect(bubble).toBeVisible();
  await page.getByTestId('st-run-results').locator('.st-title').click(); // the row above: the bubble opens below the mark
  await expect(bubble).toBeHidden();
});
