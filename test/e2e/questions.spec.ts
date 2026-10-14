// E2E of questions with their context and of the user's typing (the user, 2026-10-12): the "Contesto" block of a
// question (the turn's prose, even when the model wrote it only in its reasoning; web and file links; a click on a file
// opens it through app:openPath, recorded in a hidden run), the reasoning before a question shown open in the
// transcript, no "Ti aspettano" strip in the Mosaico, the focus kept when a Corsie tile changes column, and the
// questions window ("Domande in finestra"): it waits while the user types, never takes their field, it is always the one
// modal in the middle (anchored near the top, ADR 0049) (never a second, backdrop-less copy beside the field: the user, 2026-10-14), Ctrl+J brings it,
// 1 answers and the next card takes the keyboard, Esc is "Rispondi dopo" (closed until the queue is opened: a new
// question then waits silently, answer-later.spec.ts covers the queue), any waiting request can be answered first.
// Screenshots: test-results/shots/questions-*.png.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { launchDemo, shot } from './helpers';

type Demo = { __sbDemo: { answers(): { chatId: string }[]; stop(id: string): Promise<void>; ask(id: string, r: object): void; say(id: string, t: string): void; think(id: string, t: string): void; toolDone(id: string, n: string, i: unknown, o?: string): void } };
const demo = <A extends unknown[]>(app: ElectronApplication, fn: (d: Demo['__sbDemo'], ...a: A) => void, ...a: A) =>
  app.evaluate((_e, [src, args]) => { const d = (globalThis as unknown as Demo).__sbDemo; return new Function('d', 'a', `return (${src})(d, ...a)`)(d, args); }, [fn.toString(), a] as const);
const question = (q: string, opts: string[], extra: object = {}) => ({
  type: 'question', tool: 'AskUserQuestion', title: q, detail: q, input: {},
  questions: [{ question: q, header: 'Ok', multiSelect: false, options: opts.map(label => ({ label })) }], ...extra,
});
const opened = (app: ElectronApplication) => app.evaluate(() => [...((globalThis as unknown as { __sbOpened: string[] }).__sbOpened)]);

test('a question carries its context: the turn\'s prose, the reasoning before it, web and file links', async () => {
  const { app, page } = await launchDemo();
  await expect(page.getByTestId('needs-lane')).toHaveCount(0); // the Mosaico has no "Ti aspettano" strip any more
  await demo(app, (d, id) => {
    d.say(id, 'Ho preparato il report dei rimborsi: [report TC16](file:///C:/progetti/report/tc16.md). La PR è https://dev.azure.com/o/proj/_git/app/pullrequest/27.');
    d.toolDone(id, 'Write', { file_path: 'C:\\progetti\\report\\tc16-screen.png' });
    d.think(id, 'Il commento per Sara è pronto, manca solo il tuo ok per pubblicarlo sul TC16.');
  }, 'qa');
  await demo(app, (d, id, q) => d.ask(id, q), 'qa', question('Pubblico il commento sul TC16?', ['Pubblica', 'Aspetta']));
  const panel = page.locator('[data-testid^="request-qa-req-"][data-request-key]').first();
  await expect(panel).toBeVisible();
  const base = (await panel.getAttribute('data-testid'))!;
  // the reasoning right before the question is open in the transcript, marked
  await expect(page.locator('[data-before-ask]').last()).toContainText('manca solo il tuo ok');
  // in the tile the context is folded (the transcript is above), the links always in sight
  await expect(page.getByTestId(`${base}-ctx-toggle`)).toContainText('manca solo il tuo ok');
  await expect(page.getByTestId(`${base}-ctx-links`)).toContainText('report TC16');
  await expect(page.getByTestId(`${base}-ctx-links`)).toContainText('PR 27');
  await expect(page.getByTestId(`${base}-ctx-links`)).toContainText('tc16-screen.png');
  await page.getByTestId(`${base}-ctx-toggle`).click();
  await expect(page.getByTestId(`${base}-ctx-body`)).toContainText('dal ragionamento della chat');
  await expect(page.getByTestId(`${base}-ctx-body`)).toContainText('Ho preparato il report dei rimborsi');
  await expect(panel).toBeFocused(); // the toggle gives the keyboard back to the panel
  await shot(page, 'questions-context-tile');
  // a file link opens through main (a hidden run only records it); a missing one says so
  await page.getByTestId(`${base}-ctx-links`).getByText('report TC16').click();
  await expect(page.getByText(/Il file non c'è più/)).toBeVisible();
  expect(await opened(app)).toEqual([]);
  await app.close();
});

test('Corsie: the field the user types in keeps the keyboard when its chat starts waiting and changes column', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('view-toggle-corsie').click();
  const field = page.getByTestId('chat-input-fix');
  await field.click();
  await page.keyboard.type('ab');
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', question('Procedo?', ['Sì', 'No']));
  await expect(page.getByTestId('col-waiting').getByTestId('chat-input-fix')).toBeVisible();
  await page.keyboard.type('cd');
  await expect(page.getByTestId('chat-input-fix')).toBeFocused();
  await expect(page.getByTestId('chat-input-fix')).toHaveValue('abcd');
  await app.close();
});

test('the questions window: waits while the user types, never takes the field, Ctrl+J brings it, 1 answers, Esc is "Rispondi dopo"', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('topbar-qwin').click();
  await expect(page.getByTestId('topbar-qwin')).toHaveAttribute('aria-pressed', 'true');
  // the open requests of the demo (Regia, QA, Feedback) are in the window now; the tiles keep one line
  await expect(page.getByTestId('qwin')).toBeVisible();
  await expect(page.getByTestId('chat-in-window-qa')).toBeVisible();
  await expect(page.getByTestId('qwin-card')).toBeFocused(); // nobody was typing: it takes the keyboard
  await expect(page.getByTestId('qwin-count')).toHaveText('3'); // the rail: every waiting request, this one too
  await expect(page.getByTestId('qwin-pick')).toHaveCount(2); // the other two, each a button
  await shot(page, 'questions-window');
  await page.keyboard.press('Escape'); // "Rispondi dopo": closed, no pill, the top bar counts them
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('qwin-pill')).toHaveCount(0);
  await expect(page.getByTestId('topbar-next')).toContainText('Da rispondere');
  await expect(page.getByTestId('topbar-next-count')).toHaveText('3');
  await expect(page.getByTestId('chat-queued-qa')).toBeVisible();
  await page.keyboard.press('Control+J'); // the queue: open again, quiet mode over
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(page.getByTestId('topbar-next')).not.toContainText('Da rispondere');
  for (const id of ['regia', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id); // their requests leave
  await expect(page.getByTestId('qwin')).toHaveCount(0);

  // typing in a chat: a new question waits as a pill, the field keeps the keyboard and the text
  const field = page.getByTestId('chat-input-fix');
  await field.click();
  await page.keyboard.type('sto scri');
  await demo(app, (d, id, q) => d.ask(id, q), 'fix', question('Procedo con il commit?', ['Sì', 'No']));
  await expect(page.getByTestId('qwin-pill')).toContainText('compare quando smetti di scrivere');
  await page.keyboard.type('vendo');
  await expect(field).toHaveValue('sto scrivendo');
  // stopped typing: the window shows, the same modal in the middle, the keyboard stays in the field (a note says so)
  await expect(page.getByTestId('qwin')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('qwin-chat')).toHaveText('Fix totale ordine');
  await expect(page.getByTestId('qwin-elsewhere')).toBeVisible();
  await expect(field).toBeFocused();
  await expect(page.locator('.qwin-backdrop')).toHaveCount(1);
  const vp = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const wb = (await page.getByTestId('qwin').boundingBox())!;
  expect(Math.abs(wb.x + wb.width / 2 - vp.width / 2)).toBeLessThan(4); // centered, whatever the field and the Regia
  // anchored near the top like a command palette (ADR 0049): content that loads late grows downward, nothing jumps
  expect(Math.abs(wb.y - Math.min(88, Math.max(20, vp.height * 0.07)))).toBeLessThan(2);
  await page.keyboard.type('!');
  await expect(field).toHaveValue('sto scrivendo!');
  await shot(page, 'questions-window-typing');
  // a click on the backdrop (or the window) gives the card the keyboard and closes nothing; Esc gives it back
  await page.mouse.click(8, vp.height / 2);
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(page.getByTestId('qwin')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(field).toBeFocused(); // the keyboard went back to the field it came from
  // "Rispondi dopo" is on: another question waits silently (no window, no pill), only the counter grows
  await demo(app, (d, id, q) => d.ask(id, q), 'mappa', question('Pubblico la mappa?', ['Sì', 'No']));
  await expect(page.getByTestId('topbar-next-count')).toHaveText('2');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('qwin-pill')).toHaveCount(0);
  // Ctrl+J: the queue, the keyboard to the window; 1 answers, the next card takes the keyboard
  await page.keyboard.press('Control+J');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await page.keyboard.press('1');
  await expect(page.getByTestId('qwin-chat')).not.toHaveText('Fix totale ordine');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(field).toHaveValue('sto scrivendo!'); // the draft is still there
  // off again from the window itself (the top bar is under it): the panels go back to the tiles
  await page.getByTestId('qwin-off').click();
  await expect(page.getByTestId('topbar-qwin')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  await expect(page.getByTestId('chat-in-window-qa')).toHaveCount(0);
  await app.close();
});

test('the questions window, two questions in a row: the second shows once, with its own reasoning, and says it is asked again', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('topbar-qwin').click();
  await expect(page.getByTestId('qwin')).toBeVisible();
  for (const id of ['regia', 'qa', 'feedback']) await demo(app, (d, c) => d.stop(c), id); // the demo's requests leave: only the new ones show
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  const q = question('Il pezzo 1 ti è chiaro?', ['Chiaro, vai avanti', 'Rispiegamelo diverso']);
  await demo(app, (d, id, req) => { d.think(id, 'Pezzo 1: la casella di posta passa i messaggi tra le chat.'); d.ask(id, req); }, 'fix', q);
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  // the why in two lines, folded (ADR 0049): here the reasoning before the question
  await expect(page.getByTestId('qwin-card-ctx-toggle')).toContainText('la casella di posta');
  await expect(page.getByTestId('qwin-card-ctx-again')).toHaveCount(0);
  await page.keyboard.press('1');
  await expect(page.getByTestId('qwin')).toHaveCount(0);
  // the chat replies to a free answer only in its reasoning and asks the same question again (transcript of 2026-10-10)
  await demo(app, (d, id, req) => {
    d.toolDone(id, 'AskUserQuestion', { questions: [{ question: 'Il pezzo 1 ti è chiaro?' }] }, 'The user answered: "Il pezzo 1 ti è chiaro?"="su tutte le piattaforme?". Read the answers carefully');
    d.think(id, 'Solo su questo PC: Claude e Cursor, non il telefono.');
    d.ask(id, req);
  }, 'fix', q);
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(page.getByTestId('qwin-queue')).toHaveCount(0); // one card, not two: no rail
  await expect(page.getByTestId('qwin-card-ctx-again')).toContainText('avevi risposto «su tutte le piattaforme?»');
  await page.getByTestId('qwin-card-ctx-toggle').click(); // "Contesto completo": the whole prose, the keyboard stays on the card
  await expect(page.getByTestId('qwin-card-ctx-body')).toContainText('Solo su questo PC');
  await expect(page.getByTestId('qwin-card-ctx-body')).not.toContainText('la casella di posta'); // never the previous question's reasoning
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await shot(page, 'questions-window-asked-again');
  await app.close();
});

test('the questions window answers in any order: a waiting request is one click away, the others stay', async () => {
  const { app, page } = await launchDemo();
  await page.getByTestId('topbar-qwin').click(); // "Domande in finestra": the Regia's question first, QA and Feedback under it
  await expect(page.getByTestId('qwin-chat')).toHaveText('Regia');
  const picks = page.getByTestId('qwin-pick');
  await expect(picks).toHaveCount(2);
  await expect(picks.nth(0)).toContainText('QA · Rimborsi');
  await expect(picks.nth(1)).toContainText('App · Feedback');
  await page.mouse.move(2, 2);
  await shot(page, 'questions-any-order');
  // a free answer half written on the Regia's, then QA now: its card, with the keyboard; the Regia's waits among the others
  await page.keyboard.press('3');
  await page.getByTestId('qwin-card-other-input').fill('ci penso');
  await picks.nth(0).click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('QA · Rimborsi');
  await expect(page.getByTestId('qwin-card')).toBeFocused();
  await expect(picks).toHaveCount(2);
  await expect(picks.nth(0)).toContainText('Regia');
  await page.keyboard.press('1');
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Demo).__sbDemo.answers().map(a => a.chatId))).toEqual(['qa']);
  // answered: back to the oldest still waiting, the Regia's, with the half-written answer; Feedback can still go first
  await expect(page.getByTestId('qwin-chat')).toHaveText('Regia');
  await expect(page.getByTestId('qwin-card-other-input')).toHaveValue('ci penso');
  await expect(picks).toHaveCount(1);
  await picks.click();
  await expect(page.getByTestId('qwin-chat')).toHaveText('App · Feedback');
  await expect(picks).toContainText('Regia');
  await app.close();
});
