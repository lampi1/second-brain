// E2E of the chat composer's inline suggestion (issue #167, ADR 0118) on the frozen demo, in the Orchestrator's input:
// grey text after the caret from local sources (a past prompt, a role, a chat title), Tab accepts it, Esc hides it and
// typing goes on normally; with no suggestion Tab moves the focus (accessibility). No model call ever leaves the demo
// (suggest:state counts none after a long pause); the spend line shows in Costi and the three rows in Settings →
// Scrittura, where turning the switch off removes the grey text. Screenshots dark.
import { expect, test } from '@playwright/test';
import { goPage, launchDemo, shot } from './helpers';

test('ghost text: local sources, Tab accepts, Esc hides, Tab moves focus without one; cost and settings in sight', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchDemo();
  try {
    // a prompt sent before (this viewer's history), read the first time the input suggests
    await page.evaluate(() => localStorage.setItem('sb.composer.history.v1', JSON.stringify(['fai girare i test e dimmi cosa fallisce'])));
    const input = page.getByTestId('orchestrator-input');
    const ghost = page.getByTestId('orchestrator-input-ghost');
    await input.click();
    await input.pressSequentially('fai gir');
    await expect(ghost).toHaveText('are i test e dimmi cosa fallisce');
    await shot(page, 'composer-suggest-history-dark');
    await input.press('Tab');
    await expect(input).toHaveValue('fai girare i test e dimmi cosa fallisce');
    await expect(input).toBeFocused();
    await expect(ghost).toHaveCount(0);

    // a role: Tab completes it, typing goes on after it
    await input.fill('');
    await input.pressSequentially('chiedi allo Strat');
    await expect(ghost).toHaveText('egist');
    await input.press('Tab');
    await expect(input).toHaveValue('chiedi allo Strategist');
    await input.pressSequentially(' di guardare Fix totale ord');
    await expect(ghost).toHaveText('ine'); // a chat title of several words
    // Esc hides it, the text stays; the next key types as usual and a fitting suggestion may come back
    await input.press('Escape');
    await expect(ghost).toHaveCount(0);
    await expect(input).toHaveValue('chiedi allo Strategist di guardare Fix totale ord');
    await expect(input).toBeFocused();
    await input.pressSequentially('i');
    await expect(input).toHaveValue('chiedi allo Strategist di guardare Fix totale ordi');
    await expect(ghost).toHaveText('ne');
    // the caret moved off the end: no grey text
    await input.press('ArrowLeft');
    await expect(ghost).toHaveCount(0);
    await input.press('End');

    // nothing local fits: no grey text, and after the pause no model call in the demo (zero network)
    await input.fill('');
    await input.pressSequentially('qualcosa di molto specifico che nessuno ha mai scritto');
    await page.waitForTimeout(900);
    await expect(ghost).toHaveCount(0);
    const st = await page.evaluate(() => window.sb.invoke('suggest:state', undefined));
    expect(st.calls).toBe(0);
    expect(st.budgetUsd).toBe(0.05);
    // Tab with no suggestion moves the focus as always
    await input.press('Tab');
    await expect(input).not.toBeFocused();

    // Costi: today's suggestion spend against its budget
    await goPage(page, 'costi');
    await expect(page.getByTestId('bx-suggest-today')).toContainText('Suggerimenti oggi');
    await expect(page.getByTestId('bx-suggest-today')).toContainText('0,05');
    await page.getByTestId('bx-suggest-today').scrollIntoViewIfNeeded();
    await shot(page, 'composer-suggest-costs-dark');

    // Settings → Scrittura: the switch, the model part, the budget with today's spend; off = no grey text
    await goPage(page, 'impostazioni');
    await expect(page.getByTestId('st-suggest')).toBeVisible();
    await expect(page.getByTestId('st-suggest-budget')).toHaveValue('0.05');
    await expect(page.getByTestId('st-suggest-today')).toContainText('Oggi');
    await page.getByTestId('st-suggest').scrollIntoViewIfNeeded();
    await shot(page, 'composer-suggest-settings-dark');
    await page.getByTestId('st-suggest-on').click();
    await expect(page.getByTestId('st-suggest-on')).toHaveAttribute('aria-checked', 'false');
    await input.click();
    await input.fill('');
    await input.pressSequentially('chiedi allo Strat');
    await page.waitForTimeout(300);
    await expect(ghost).toHaveCount(0);
  } finally {
    await app.close();
  }
});
