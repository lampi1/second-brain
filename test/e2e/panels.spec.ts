// E2E of the question and permission panels (frozen demo, dark and light): the recommended option highlighted with its
// badge, descriptions under the labels, "Altro…" always last with its own digit (a box: Enter sends, Esc goes back),
// multi-select as checkboxes with a counted "Conferma", several questions as "1 di 2", the same panel in the lane and
// in the Orchestrator; Cursor questions get "Altro…" too, with a note on how Cursor receives it. Screenshots in test-results/shots/panels-*.png (looked at for every change of RequestPanel.tsx).
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, openRegia, shot } from './helpers';

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
    const { app, page } = await launchDemo({ scheme });
    if (scheme === 'light') await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    // a single-choice question with a recommended option and descriptions (Claude)
    await page.getByTestId('chat-max-qa').click();
    const qa = page.getByTestId('request-qa-qa-q1');
    await expect(qa.getByText('Consigliata')).toBeVisible();
    await expect(qa.locator('.gu-choice.rec')).toHaveCount(1);
    await expect(page.getByTestId('request-qa-qa-q1-other')).toContainText('Altro…');
    await shot(page, `panels-question-${scheme}`);
    // "Altro…" by its digit (3 options → 4): a box, Esc goes back to the choices, the text is kept out
    await qa.focus();
    await page.keyboard.press('4');
    const input = page.getByTestId('request-qa-qa-q1-other-input');
    await expect(input).toBeFocused();
    await input.fill('Prima ricontrollo i dati del test case 7');
    await shot(page, `panels-altro-${scheme}`);
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(qa).toBeFocused();
    await page.getByTestId('chat-max-qa').click(); // back to the grid

    // multi-select, two questions: checkboxes, a counted Conferma, then "2 di 2"
    await ask(app, 'fix', multi);
    await page.getByTestId('chat-max-fix').click();
    const panel = page.getByTestId('maximized').locator('[data-request-key^="fix/"]');
    await expect(panel).toContainText('Quali controlli');
    const base = (await panel.getAttribute('data-testid'))!;
    await expect(page.getByTestId(`${base}-confirm`)).toBeDisabled();
    await panel.focus();
    await page.keyboard.press('Enter'); // nothing ticked: Enter sends nothing
    await expect(page.getByTestId(`${base}-step`)).toHaveText('1 di 2');
    await page.getByTestId(`${base}-opt-1`).click();
    await page.getByTestId(`${base}-opt-2`).click();
    await expect(page.getByTestId(`${base}-opt-2`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`${base}-count`)).toContainText('2 scelte');
    await shot(page, `panels-multi-${scheme}`);
    await page.keyboard.press('Enter'); // after a click on an option the panel has the keyboard: Enter confirms
    await expect(page.getByTestId(`${base}-step`)).toHaveText('2 di 2');
    // "Altro…" on a middle step would leave the keyboard nowhere: the panel takes it back
    await expect(panel).toBeFocused();
    await page.getByTestId('chat-max-fix').click();

    // a tile and the Orchestrator: chips with the recommended one marked and "Altro…" last
    await expect(page.getByTestId('request-qa-qa-q1-other')).toBeVisible();
    await openRegia(page);
    await expect(page.getByTestId('request-regia-regia-q1-other')).toBeVisible();
    await shot(page, `panels-lane-regia-${scheme}`);
    await page.getByTestId('request-qa-qa-q1-other').click();
    await expect(page.getByTestId('request-qa-qa-q1-other-input')).toBeFocused();
    await page.getByTestId('request-qa-qa-q1-other-input').fill('scrivo io');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('request-qa-qa-q1')).toHaveCount(0);

    // a permission: Tab to "Rifiuta" then Enter is that button (it refuses), never the panel's Enter (allow)
    await page.getByTestId('chat-max-feedback').click();
    await page.getByTestId('request-feedback-feedback-p1-opt-3').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tile-chat-feedback')).toContainText('non lancio i test');
    await page.getByTestId('chat-max-feedback').click();

    // Cursor: the same panel, "Altro…" included, with its note
    await ask(app, 'sms', { type: 'question', tool: 'AskQuestion', title: 'Quale ambiente uso?', detail: '', input: {}, questions: [{ header: 'Ambiente', question: 'Quale ambiente uso?', multiSelect: false, options: [{ label: 'Test 2 (consigliato)' }, { label: 'Test 3' }] }] });
    await page.getByTestId('chat-max-sms').click();
    const cur = page.getByTestId('maximized').locator('[data-request-key^="sms/"]');
    await expect(cur).toContainText('Quale ambiente uso?');
    await cur.focus();
    await page.keyboard.press('3');
    await expect(cur.locator('[data-testid$="-other-note"]')).toBeVisible();
    await cur.locator('textarea').fill('Il nodo con i dati di ieri');
    await shot(page, `panels-cursor-altro-${scheme}`);
    await app.close();
  });
}
