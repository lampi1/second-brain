// E2E of voice mode (ADR 0152) on the frozen demo, whose voice engine is the fake one (main/voice/service.ts: no
// models, no microphone needed, it "hears" one sentence per listening session and speaks a short silence). The
// Orchestrator's and Flash's inputs show the mic and no «Invio» hint; Ctrl+M turns voice on (red border, the steady red
// dot «In ascolto»), the heard sentence goes to the Orchestrator as the user's message, Ctrl+M turns it off again.
// Settings → Voce shows the three rows. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('voice mode: mic instead of «Invio», Ctrl+M on and off, the heard words go to the Orchestrator, Settings → Voce', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    const input = page.getByTestId('orchestrator-input');
    const mic = page.getByTestId('orchestrator-input-mic');
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.composer-orchestrator .composer-hint')).toHaveCount(0);
    await input.click();
    await shot(page, 'voice-muted-dark');

    // on: the bar with the red dot, the mic pressed, the input framed in red
    await page.keyboard.press('Control+m');
    const bar = page.getByTestId('orchestrator-input-voice');
    await expect(bar).toBeVisible();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.composer-box.is-voice')).toHaveCount(1);
    await expect(bar).toHaveAttribute('data-phase', /listening|hearing|transcribing/);
    await expect(bar.locator('.voice-dot')).toBeVisible();
    await shot(page, 'voice-listening-dark');

    // the fake engine hears one sentence: it is the user's message in the Orchestrator's chat
    const said = 'Ciao, cosa c’è di nuovo?';
    await expect(page.getByTestId('tile-orchestrator').getByText(said).first()).toBeVisible({ timeout: 10_000 });

    // off again: no bar, mic released
    await page.keyboard.press('Control+m');
    await expect(bar).toHaveCount(0);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');

    // the mic button does the same as Ctrl+M
    await mic.click();
    await expect(bar).toBeVisible();
    await page.getByTestId('orchestrator-input-voice-off').click();
    await expect(bar).toHaveCount(0);

    // Settings → Voce: transcription, voice, models (the fake engine has them all)
    await goPage(page, 'impostazioni');
    await page.getByTestId('st-voice-asr').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('st-voice-asr-fast')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('st-voice-name-paola')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('st-voice-models')).toContainText('Pronti');
    await page.getByTestId('st-voice-name-miro').click();
    await expect(page.getByTestId('st-voice-name-miro')).toHaveAttribute('aria-checked', 'true');
    await shot(page, 'voice-settings-dark');
  } finally {
    await app.close();
  }
});
