// E2E of the question and permission panels in the questions window (frozen demo, dark and light; the window is
// always on since 2026-10-22): the recommended option highlighted with its badge, descriptions under the labels,
// "Rispondi a parole tue…" always last with its own digit (a box: Enter sends, Esc goes back), multi-select as
// checkboxes with a counted "Conferma", several questions as "1 di 2"; Cursor questions get the free answer too, with a
// note on how Cursor receives it. Screenshots in test-results/shots/panels-*.png (looked at for every change of RequestPanel.tsx).
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { ask(c: string, r: object): void };
const ask = (app: ElectronApplication, chatId: string, req: object) =>
  app.evaluate((_e, [c, r]) => { (globalThis as unknown as { __sbDemo: Demo }).__sbDemo.ask(c, r); }, [chatId, req] as const);

const multi = {
  type: 'question', tool: 'AskUserQuestion', title: 'Quali controlli lancio prima del commit?', detail: '', input: {},
  questions: [
    { header: 'Controlli', question: 'Quali controlli lancio prima del commit?', multiSelect: true, options: [
      { label: 'Unit test', description: 'veloci, 20 secondi' },
      { label: 'E2E (consigliato)', description: 'provano l’app vera, 4 minuti' },
      { label: 'Lint', description: 'stile del codice' },
    ] },
    { header: 'Dopo', question: 'Poi cosa faccio?', multiSelect: false, options: [{ label: 'Commit locale' }, { label: 'Mi fermo' }] },
  ],
};

for (const scheme of ['dark', 'light'] as const) {
  test(`question panels look like a product and answer from the keyboard (${scheme})`, async () => {
    const { app, page } = await launchDemo({ scheme, questions: true });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    const pick = (key: string) => page.locator(`[data-testid="qwin-pick"][data-key^="${key}"]`).click();
    const card = page.getByTestId('qwin-card');
    // a single-choice question with a recommended option and descriptions (Claude)
    await pick('qa/qa-q1');
    await expect(card).toHaveAttribute('data-request-key', 'qa/qa-q1');
    await expect(card.getByText('Consigliata')).toBeVisible();
    await expect(card.locator('.gu-choice.rec')).toHaveCount(1);
    await expect(page.getByTestId('qwin-card-other')).toContainText('Rispondi a parole tue…');
    await page.mouse.move(2, 2);
    await shot(page, `panels-question-${scheme}`);
    // the free answer by its digit (3 options → 4): a box, Esc goes back to the choices, the text is kept out
    await card.focus();
    await page.keyboard.press('4');
    const input = page.getByTestId('qwin-card-other-input');
    await expect(input).toBeFocused();
    await input.fill('Prima ricontrollo i dati del test case 7');
    await shot(page, `panels-altro-${scheme}`);
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(card).toBeFocused();

    // multi-select, two questions: checkboxes, a counted Conferma, then "2 di 2"
    await ask(app, 'fix', multi);
    await pick('fix/');
    await expect(card).toContainText('Quali controlli');
    await expect(page.getByTestId('qwin-card-confirm')).toBeDisabled();
    await card.focus();
    await page.keyboard.press('Enter'); // nothing ticked: Enter sends nothing
    await expect(page.getByTestId('qwin-card-step')).toHaveText('1 di 2');
    await page.getByTestId('qwin-card-opt-1').click();
    await page.getByTestId('qwin-card-opt-2').click();
    await expect(page.getByTestId('qwin-card-opt-2')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('qwin-card-count')).toContainText('2 scelte');
    await page.mouse.move(2, 2);
    await shot(page, `panels-multi-${scheme}`);
    await page.keyboard.press('Enter'); // after a click on an option the panel has the keyboard: Enter confirms
    await expect(page.getByTestId('qwin-card-step')).toHaveText('2 di 2');
    // the free answer on a middle step would leave the keyboard nowhere: the panel takes it back
    await expect(card).toBeFocused();

    // a free answer sent with Enter answers the question
    await pick('qa/qa-q1');
    await page.getByTestId('qwin-card-other').click();
    await expect(page.getByTestId('qwin-card-other-input')).toBeFocused();
    await page.getByTestId('qwin-card-other-input').fill('scrivo io');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-request-key="qa/qa-q1"]')).toHaveCount(0);

    // a permission: Tab to "Non procedere" then Enter is that button (it refuses), never the panel's Enter (allow)
    await pick('feedback/feedback-p1');
    await page.getByTestId('qwin-card-opt-3').focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => JSON.stringify(await page.evaluate(() => window.sb.invoke('chat:items', { chatId: 'feedback' })))).toContain('non lancio i test');

    // Cursor: the same panel, the free answer included, with its note
    await ask(app, 'sms', { type: 'question', tool: 'AskQuestion', title: 'Quale ambiente uso?', detail: '', input: {}, questions: [{ header: 'Ambiente', question: 'Quale ambiente uso?', multiSelect: false, options: [{ label: 'Test 2 (consigliato)' }, { label: 'Test 3' }] }] });
    await pick('sms/');
    await expect(card).toContainText('Quale ambiente uso?');
    await card.focus();
    await page.keyboard.press('3');
    await expect(page.getByTestId('qwin-card-other-note')).toBeVisible();
    await page.getByTestId('qwin-card-other-input').fill('Il nodo con i dati di ieri');
    await page.mouse.move(2, 2);
    await shot(page, `panels-cursor-altro-${scheme}`);
    await app.close();
  });
}
