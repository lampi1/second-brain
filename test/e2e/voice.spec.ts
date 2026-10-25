// E2E of voice (ADR 0152) on the frozen demo, whose voice engine is the fake one (main/voice/service.ts: no models, no
// microphone needed, it "hears" one sentence per listening session and speaks a short silence). The Orchestrator's and
// Flash's inputs show the mic and no «Invio» hint; Ctrl+M turns dictation on (red border, «Detta»), the heard sentence
// is written into the input and NOT sent, Ctrl+M turns it off again. Settings → Voce «Conversazione a voce» is the
// spoken conversation: the heard sentence goes to the Orchestrator as the user's message. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('voice: the mic dictates into the input, the conversation is switched on in Settings → Voce', async () => {
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

    await expect(bar).toHaveAttribute('data-mode', 'dictate');
    // the fake engine hears one sentence: dictation writes it into the input, nothing is sent
    const said = 'Ciao, cosa c’è di nuovo?';
    await expect(input).toHaveValue(said, { timeout: 10_000 });
    await page.waitForTimeout(1200);
    await input.fill('');
    await expect(page.getByTestId('tile-orchestrator').getByText(said)).toHaveCount(0); // never sent

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

    // the conversation: switched on here, the heard sentence is the user's message to the Orchestrator
    const talk = page.getByTestId('st-voice-talk-on');
    await talk.click();
    await expect(talk).toHaveAttribute('aria-checked', 'true');
    await expect(bar).toHaveAttribute('data-mode', 'talk');
    await expect(page.getByTestId('tile-orchestrator').getByText(said).first()).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveValue('');
    await talk.click();
    await expect(talk).toHaveAttribute('aria-checked', 'false');
    await expect(bar).toHaveCount(0);

    // its own shortcut: Ctrl+Shift+Space on and off
    await page.keyboard.press('Control+Shift+Space');
    await expect(bar).toHaveAttribute('data-mode', 'talk');
    await expect(talk).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Control+Shift+Space');
    await expect(bar).toHaveCount(0);
  } finally {
    await app.close();
  }
});
