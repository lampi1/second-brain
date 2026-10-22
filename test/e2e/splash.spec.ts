// E2E of the opening splash (components/Splash.tsx): never shown in a test run unless asked (SB_SPLASH), it covers
// the app that renders under it, carries a sentence of the day, ends by itself in at most 2.4 s and a click or a key
// skips it. SB_SPLASH=hold keeps its last frame for the screenshot. Screenshots in test-results/shots/splash-*.png.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { launch, launchDemo, setSize, shot } from './helpers';

test('no splash in a test run unless asked', async () => {
  const { app, page } = await launchDemo();
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0);
  await app.close();
});

test('the splash cuts GRINDHOUSE with the day\'s sentence, then a key lets the user in', async () => {
  // launched without the demo's reduced motion (launchDemo asks it): the full animation
  const { app, page } = await launch({ SB_DEMO: '1', SB_DEMO_FREEZE: '1', SB_SPLASH: 'hold' });
  await setSize(app, 1600, 1000);
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible({ timeout: 15_000 });
  // mid-cut, as it is (sparks and all): a look, not an assertion
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.resolve(import.meta.dirname, '..', '..', 'test-results', 'shots', 'splash-cut.png') });
  await expect(splash).toHaveAttribute('data-phase', 'hot', { timeout: 10_000 });
  await expect(splash).toHaveAttribute('data-line', 'ready');
  // the frozen demo has no headline from the model: the splash's own line of the day
  await expect(splash.locator('.splash-line')).not.toBeEmpty();
  await page.waitForTimeout(1200); // the sentence and the glint settle
  await shot(page, 'splash-hold');
  // the app is already there under it
  await expect(page.getByTestId('orchestrator-overlay')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(splash).toHaveCount(0);
  await shot(page, 'splash-after');
  await app.close();
});

test('the splash ends by itself and a click skips it', async () => {
  const { app, page } = await launchDemo({ env: { SB_SPLASH: '1' }, questions: true });
  // a hidden test window may get few frames: the hard stop still ends it
  await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 10_000 });
  await app.close();
  const again = await launchDemo({ env: { SB_SPLASH: 'hold' }, questions: true });
  const splash = again.page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await splash.click({ position: { x: 20, y: 20 } });
  await expect(splash).toHaveCount(0);
  await again.app.close();
});
