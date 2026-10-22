// E2E of generative UI (ADR 0033) on the demo: show_ui's five catalog components drawn in a chat (one screenshot each,
// test-results/shots/genui-<component>.png), the full-width view (click, Esc closes), a wrong call answered with a clear
// error; a visual attached to the chat's next question (hidden in the list until the question comes, then on the panel;
// an option preview's ```sb-ui fence drawn in the context) that never answers it: keys 1-9 still do; with no question in
// time it falls back to a card; a visual sent to the Orchestrator shows in the Orchestrator widget with the sender's name.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { expandChats, launchDemo, shot } from './helpers';

type Demo = { __sbDemo: { show(id: string, a: object): string; ask(id: string, r: object): void } };
const show = (app: ElectronApplication, chatId: string, args: object) =>
  app.evaluate((_e, [c, a]) => (globalThis as unknown as Demo).__sbDemo.show(c, a), [chatId, args] as const);
const ask = (app: ElectronApplication, chatId: string, req: object) =>
  app.evaluate((_e, [c, r]) => { (globalThis as unknown as Demo).__sbDemo.ask(c, r); }, [chatId, req] as const);

const VISUALS = {
  table: { title: 'Test case rimborsi', summary: '6 passati, 1 fallito, 2 da fare.', props: { columns: ['Test case', 'Ambiente', 'Nota'], rows: [
    { cells: ['TC 1 · Rimborso totale', 'test-3', 'ok al primo giro'], status: 'ok', link: { label: 'evidenza', href: 'C:\\progetti\\report\\tc1.png' } },
    { cells: ['TC 7 · Rimborso parziale', 'test-3', 'totale sbagliato'], status: 'fail', link: { label: 'bug', href: 'https://tracker.example.com/bug/4721' } },
    { cells: ['TC 8 · Buono regalo', 'test-3', 'manca il modulo'], status: 'blocked' },
    { cells: ['TC 9 · Storno', '—', ''], status: 'todo' },
  ] } },
  cards: { title: 'Come correggo il totale', summary: 'Consiglio A: piccolo e coperto dai test.', props: { options: [
    { title: 'A · Arrotonda alla fine', summary: 'Un solo punto nel calcolo.', pros: ['1 file', 'test esistenti'], cons: ['non copre gli sconti'], effort: '30 min', risk: 'low', recommended: true },
    { title: 'B · Riscrivi il calcolo', pros: ['copre tutto'], cons: ['tocca 6 file', 'nuovi test'], effort: '1 giorno', risk: 'high' },
  ] } },
  board: { title: 'QA rimborsi', summary: 'Passati 2, falliti 1, bloccati 1.', props: { lanes: [
    { title: 'Passati', status: 'ok', items: [{ title: 'TC 1 · Rimborso totale' }, { title: 'TC 2 · Doppio clic' }] },
    { title: 'Falliti', status: 'fail', items: [{ title: 'TC 7 · Rimborso parziale', detail: 'Totale 12,40 invece di 12,39', links: [{ label: 'bug 4721', href: 'https://tracker.example.com/bug/4721' }, { label: 'screenshot', href: 'C:\\progetti\\report\\tc7.png' }] }] },
    { title: 'Bloccati', status: 'blocked', items: [{ title: 'TC 8 · Buono regalo', detail: 'Funzione spenta in test-3' }] },
  ] } },
  diffList: { title: 'File cambiati', summary: '4 file in 2 aree.', props: { groups: [
    { area: 'Calcolo', files: [{ path: 'src/order/total.ts', why: 'arrotonda una volta sola, alla fine', added: 12, removed: 5 }, { path: 'src/order/discount.ts', why: 'usa il totale arrotondato', added: 3, removed: 3 }] },
    { area: 'Test', files: [{ path: 'test/order/total.test.ts', why: 'i 3 casi del TC 7', added: 40, removed: 0 }, { path: 'C:\\progetti\\report\\pr-27.md', why: 'descrizione della PR' }] },
  ] } },
  barChart: { title: 'Costo per chat oggi', summary: 'QA rimborsi la più cara: 1,84 $.', props: { unit: '$', bars: [
    { label: 'Orchestrator', value: 4.12 }, { label: 'QA · Rimborsi', value: 1.84 }, { label: 'Fix totale ordine', value: 0.92 }, { label: 'App · Feedback', value: 0.35, note: 'Sonnet' },
  ] } },
} as const;

test('show_ui: each catalog component drawn in the chat, the full view, a wrong call explained', async () => {
  const { app, page } = await launchDemo({ width: 1600, height: 1100 });
  for (const [component, v] of Object.entries(VISUALS)) {
    expect(await show(app, 'fix', { id: component, component, ...v })).toContain('Mostrato in questa chat');
  }
  expect(await show(app, 'fix', { title: 'x', summary: 'y', component: 'table', props: { columns: ['a'], rows: [{ cells: ['1', '2'] }] } }))
    .toBe('Error: table props.rows[0].cells: 2 cells for 1 columns. Fix the props and call show_ui again (the shapes are in the tool\'s description).');
  await page.getByTestId('chat-max-fix').click();
  for (const component of Object.keys(VISUALS)) {
    const card = page.getByTestId(`artifact-${component}`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-component', component);
    await card.screenshot({ path: `test-results/shots/genui-${component}.png` });
  }
  await expect(page.getByTestId('artifact-table').locator('.gu-status.gu-fail')).toContainText('Fallito');
  // Copia: the visual as markdown text on the clipboard
  await page.getByTestId('artifact-copy-table').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('| Fallito | TC 7');
  await expect(page.getByTestId('artifact-cards')).toContainText('Consigliata');
  await expect(page.getByTestId('artifact-barChart').locator('table')).toContainText('QA · Rimborsi');
  await expect(page.getByTestId('artifact-barChart').locator('table')).toContainText('1.84 $');
  // the same id replaces the visual in place
  await show(app, 'fix', { id: 'board', component: 'board', ...VISUALS.board, title: 'QA rimborsi · aggiornata' });
  await expect(page.getByTestId('artifact-board')).toHaveCount(1);
  await expect(page.getByTestId('artifact-board')).toContainText('aggiornata');
  // full width: a click, Esc closes and the keyboard goes back
  await page.getByTestId('artifact-expand-board').click();
  await expect(page.getByTestId('artifact-full-board')).toBeVisible();
  await shot(page, 'genui-full-board');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('artifact-full-board')).toHaveCount(0);
  await expect(page.getByTestId('artifact-expand-board')).toBeFocused();
  await app.close();
});

test('next-ask: the visual waits for the chat\'s question, rides on its panel, never answers it; else a card', async () => {
  const { app, page } = await launchDemo({ env: { SB_ASK_WAIT_MS: '1500' } });
  expect(await show(app, 'fix', { id: 'opzioni', component: 'cards', target: 'next-ask', ...VISUALS.cards })).toContain('sulla tua prossima domanda');
  await expect(page.getByTestId('artifact-opzioni')).toHaveCount(0); // not in the list while it waits
  const fence = '```sb-ui\n' + JSON.stringify({ component: 'barChart', title: 'Tempo stimato', props: { unit: 'h', bars: [{ label: 'A', value: 0.5 }, { label: 'B', value: 8 }] } }) + '\n```';
  await ask(app, 'fix', { type: 'question', tool: 'AskUserQuestion', title: 'Quale correzione?', detail: 'Quale correzione?', input: {},
    questions: [{ question: 'Quale correzione?', header: 'Fix', multiSelect: false, options: [{ label: 'A · Arrotonda alla fine (consigliato)', preview: `Piccola.\n\n${fence}` }, { label: 'B · Riscrivi il calcolo' }] }] });
  await expandChats(page, 'fix'); // the request's panel is on the open strip
  const panel = page.locator('[data-testid^="request-fix-"][data-request-key]').first();
  await expect(panel).toBeVisible();
  const base = (await panel.getAttribute('data-testid'))!;
  await expect(page.getByTestId(`${base}-visuals`).getByTestId('artifact-opzioni')).toBeVisible();
  // the option's preview: its sb-ui fence drawn as a chart
  await page.getByTestId(`${base}-ctx-toggle`).click();
  await expect(page.getByTestId(`${base}-ctx-body`).getByTestId('preview-visual')).toHaveAttribute('data-component', 'barChart');
  await panel.screenshot({ path: 'test-results/shots/genui-question-panel.png' });
  // opening the visual answers nothing; its Esc closes only the view
  await page.getByTestId(`${base}-visuals`).getByTestId('artifact-expand-opzioni').click();
  const full = page.getByTestId('artifact-full-opzioni');
  await expect(full).toBeVisible();
  // the view takes the keyboard as it opens (Modal in ui.tsx): the keys below are typed inside it
  await expect.poll(() => full.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('1');
  // a click on its content and Shift+Tab keep the keyboard inside the view (the review's case)
  await full.locator('.gu-sum').click();
  await page.keyboard.press('Shift+Tab');
  expect(await full.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('1');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('artifact-full-opzioni')).toHaveCount(0);
  await expect(panel).toBeVisible();
  // the keys still answer: 1 picks the first option
  await panel.focus();
  await page.keyboard.press('1');
  await expect(panel).toHaveCount(0);
  // the visual stays in the chat's history, marked as the question's
  await expect(page.getByTestId('artifact-opzioni')).toContainText('sulla domanda');

  // no question in time: a card in the chat
  await show(app, 'fix', { id: 'tardi', component: 'table', target: 'next-ask', ...VISUALS.table });
  await expect(page.getByTestId('artifact-tardi')).toHaveCount(0);
  await expect(page.getByTestId('artifact-tardi')).toBeVisible({ timeout: 10_000 });
  await app.close();
});

test('target orchestrator: the visual shows in the Orchestrator widget, with the chat that sent it', async () => {
  const { app, page } = await launchDemo({ orchestrator: true, width: 1600, height: 1000 });
  expect(await show(app, 'qa', { id: 'stato-qa', component: 'board', target: 'orchestrator', ...VISUALS.board })).toContain('Mostrato nell’Orchestrator:'); // one Orchestrator: no name to tell it apart
  const card = page.getByTestId('tile-orchestrator').getByTestId('artifact-stato-qa');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('artifact-from-stato-qa')).toHaveText('da «QA · Rimborsi»');
  await expect(page.getByTestId('tile-chat-qa').getByTestId('artifact-stato-qa')).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'genui-orchestrator');
  await app.close();
});
