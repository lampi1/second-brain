// E2E: the app window may open the microphone (ADR 0152, window.ts micAllowed). The request layer's view (overlay.ts)
// shares the window's session and once set its own deny-all handler over the window's: every getUserMedia was refused
// by the app itself and Windows never even saw the request (owner, 2026-10-24). Here Chromium's fake microphone must open.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('the app window is allowed to ask for the microphone', async () => {
  // Chromium's fake microphone: without a device the request fails as "not found" before any permission is asked
  const before = process.env.SB_E2E_ELECTRON_ARGS;
  process.env.SB_E2E_ELECTRON_ARGS = `${before ?? ''} --use-fake-device-for-media-stream`;
  const { app, page } = await launchDemo().finally(() => { process.env.SB_E2E_ELECTRON_ARGS = before; if (before === undefined) delete process.env.SB_E2E_ELECTRON_ARGS; });
  try {
    await page.waitForTimeout(1000); // the request layer is up by now
    const r = await page.evaluate(async () => {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'ok'; }
      catch (e) { return (e as Error).name; }
    });
    expect(r).toBe('ok');
  } finally {
    await app.close();
  }
});

test('Settings → Voce lists the microphones and keeps the one chosen', async () => {
  const before = process.env.SB_E2E_ELECTRON_ARGS;
  process.env.SB_E2E_ELECTRON_ARGS = `${before ?? ''} --use-fake-device-for-media-stream`;
  const { app, page } = await launchDemo().finally(() => { process.env.SB_E2E_ELECTRON_ARGS = before; if (before === undefined) delete process.env.SB_E2E_ELECTRON_ARGS; });
  try {
    await goPage(page, 'impostazioni');
    const row = page.getByTestId('st-voice-mic');
    await row.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('st-voice-mic-desc')).toContainText('USB');
    await page.getByTestId('st-voice-mic-pick').click();
    const opts = page.getByTestId('st-voice-mic-pick-list').locator('[role="option"]');
    await expect(opts.first()).toContainText('Predefinito di sistema');
    expect(await opts.count()).toBeGreaterThan(1); // Chromium's fake microphone
    const id = await opts.nth(1).getAttribute('data-value');
    await opts.nth(1).click();
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('sb.mic') ?? 'null')).id).toBe(id);
    // that device opens
    const r = await page.evaluate(async dev => {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: dev } } }); s.getTracks().forEach(t => t.stop()); return 'ok'; }
      catch (e) { return (e as Error).name; }
    }, id!);
    expect(r).toBe('ok');
    await shot(page, 'voice-mic-picker');
  } finally {
    await app.close();
  }
});
