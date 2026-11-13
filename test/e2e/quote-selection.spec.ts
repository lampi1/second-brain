// E2E of quoting what is on screen (ADR 0300), on the frozen demo: a right click on a selected text puts it, as «> »
// lines, in a prompt field, not sent. A text of the Orchestrator goes in the Orchestrator's field, a text of an open
// work chat in that chat's own field, a text of a brain page in the Orchestrator's. With no selection under the
// pointer the right click stays what it was: a little person still gets its whack of the stick (ADR 0297), also while
// a text is selected somewhere else. A text in a dialog over the field is quoted with a notice, the keyboard stays in
// the dialog. Screenshot in test-results/shots/quote-selection-*.png.
import { expect, test, type Locator } from '@playwright/test';
import { expandChats, launchDemo, shot } from './helpers';

/** Selects the whole text of the element, as a drag over it would; returns what is selected. */
const select = (el: Locator): Promise<string> => el.evaluate(node => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const s = getSelection()!;
  s.removeAllRanges();
  s.addRange(range);
  return s.toString();
});

test('a right click on a selected text quotes it in the prompt field', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 900, orchestrator: true });
  try {
    // the Orchestrator: its own text goes in its own field, under what was already written
    const orch = page.getByTestId('tile-orchestrator'), input = page.getByTestId('orchestrator-input');
    await input.fill('su questo punto:');
    const said = orch.locator('.msg-assistant .md p').last();
    const text = (await select(said)).trim();
    expect(text.length).toBeGreaterThan(3);
    await said.click({ button: 'right' });
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\n`);
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe(''); // the selection is spent
    await shot(page, 'quote-selection-orchestrator');
    // typing goes on under the quote
    await page.keyboard.type('non mi torna');
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\nnon mi torna`);

    // an open work chat: its text goes in its own field, the Orchestrator's stays as it is
    await expandChats(page, 'sms');
    const chat = page.getByTestId('tile-chat-sms'), chatInput = page.getByTestId('chat-input-sms');
    const line = chat.locator('.msg-assistant .md p, .bubble').last();
    const chatText = (await select(line)).trim();
    await line.click({ button: 'right' });
    await expect(chatInput).toHaveValue(`> ${chatText}\n\n`);
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\nnon mi torna`);

    // a text selected somewhere else never takes another thing's right click: the little person gets its whack
    await select(said);
    const person = page.getByTestId('tile-chat-mappa').locator('.strip-face .agent-sprite');
    await person.evaluate(el => new MutationObserver(() => { if (el.getAttribute('data-react') === 'whack') el.setAttribute('data-whacked', ''); }).observe(el, { attributes: true, attributeFilter: ['data-react'] }));
    await person.click({ button: 'right' });
    await expect(person).toHaveAttribute('data-whacked', '');
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\nnon mi torna`);

    // a right click in the field itself, with its text selected, is not a quote
    await input.selectText();
    await input.click({ button: 'right' });
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\nnon mi torna`);

    // a text in a dialog that covers the field (here a paragraph put in the palette's dialog): quoted without taking
    // the keyboard out of the dialog, and a notice says where it went
    await page.keyboard.press('Control+k');
    const dialog = page.getByTestId('palette');
    await expect(dialog).toBeVisible();
    await dialog.evaluate(el => { const p = document.createElement('p'); p.className = 'md'; p.id = 'quote-probe'; p.textContent = 'testo in una finestra'; el.append(p); });
    const probe = page.locator('#quote-probe');
    await select(probe);
    await probe.click({ button: 'right', position: { x: 20, y: 8 } }); // on its words, not on the empty rest of the line
    await expect(input).toHaveValue(`su questo punto:\n\n> ${text}\n\nnon mi torna\n\n> testo in una finestra\n\n`);
    await expect(input).not.toBeFocused();
    await expect(page.getByText('Citato nel campo dell’Orchestrator')).toBeVisible();
    await expect(dialog).toBeVisible();
  } finally { await app.close(); }
});
