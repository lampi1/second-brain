// E2E: the app window may open the microphone (ADR 0152, window.ts micAllowed). The request layer's view (overlay.ts)
// shares the window's session and once set its own deny-all handler over the window's: every getUserMedia was refused
// by the app itself and Windows never even saw the request (owner, 2026-10-24). Here Chromium's fake microphone must open.
import { expect, test } from '@playwright/test';
import { launchDemo } from './helpers';

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
