// A Strategist's plan with the user on its strip (ADR 0108), in the demo: under way, its steps as a checklist Claude Code
// style with the role of each; while it asks, its open question right on the collapsed strip, with what is already
// clear and «Basta domande», the answer reaching the chat and joining the clear lines; the short plan with «Cambia
// qualcosa» (the change reaches it) and «Approva e parti» (it starts); with "Popup" on, the question opens in the
// questions window and the strip points to it. Hidden window (SB_HIDDEN).
// Screenshots: test-results/shots/strategist-plan-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { StrategyPlan } from '../../src/shared/strategy';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';
import { launchDemo, shot } from './helpers';

const LEAD = 'tree-plan';
const demo = <T,>(app: ElectronApplication, fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const) as Promise<T>;
const STEPS = [
  { title: 'Trovo dove si calcola lo sconto oggi', role: 'scout', state: 'todo' },
  { title: 'Applico lo sconto % sul prezzo pieno', role: 'artisan', state: 'todo' },
  { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo' },
] as const;
const plan = (p: Partial<StrategyPlan>): StrategyPlan => ({ phase: 'asking', at: Date.now(), clarified: [], steps: [], ...p } as StrategyPlan);
const QUESTION = 'Lo sconto vale anche sui prodotti già in offerta?';
const ask = (app: ElectronApplication) => demo(app, 'ask', LEAD, { type: 'question', tool: 'AskUserQuestion', title: QUESTION, detail: '', input: {},
  questions: [{ header: 'Offerte', question: QUESTION, multiSelect: false, options: [{ label: 'No, solo a prezzo pieno (consigliato)', description: 'niente doppio sconto' }, { label: 'Sì, si sommano' }] }] } satisfies Omit<PendingRequest, 'id' | 'chatId' | 'at'>);
const items = (page: Page): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), LEAD);
const userTexts = async (page: Page) => (await items(page)).flatMap(i => (i.kind === 'user' && 'text' in i ? [i.text as string] : []));
const top = (page: Page) => page.getByTestId(`tile-chat-${LEAD}`).evaluate(el => { el.scrollIntoView({ block: 'start' }); });

test('a Strategist asks, proposes a short plan to approve and shows its steps on its strip', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    const tile = page.getByTestId(`tile-chat-${LEAD}`);
    await expect(tile).toBeVisible({ timeout: 15_000 });

    // under way: the checklist, each step with its role and state, on the collapsed strip
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card).toHaveAttribute('data-phase', 'running');
    await page.getByTestId(`plan-toggle-${LEAD}`).click();
    await expect(page.getByTestId(`plan-steps-${LEAD}-1`)).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId(`plan-steps-${LEAD}-2`)).toHaveAttribute('data-state', 'now');
    await expect(page.getByTestId(`plan-steps-${LEAD}-3`)).toHaveAttribute('data-state', 'todo');
    await expect(page.getByTestId(`plan-steps-${LEAD}-1`)).toContainText('Scout · 5 min');
    await expect(page.getByTestId(`plan-steps-${LEAD}-2`)).toContainText('Artisan · da 10 min');
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await top(page);
    await shot(page, 'strategist-plan-progress-dark');

    // asking: the question on the strip itself, what is already clear under it
    await demo(app, 'plan', LEAD, plan({ clarified: [{ q: 'Dove', a: 'Carrello, ordine e reso' }] }));
    await ask(app);
    await expect(card).toHaveAttribute('data-phase', 'asking');
    await expect(page.getByTestId(`plan-question-n-${LEAD}`)).toHaveText('Domanda 2');
    await expect(card).toContainText(QUESTION);
    await expect(page.getByTestId('plan-known')).toContainText('Dove');
    await expect(page.getByTestId(`plan-enough-${LEAD}`)).toBeVisible();
    await top(page);
    await shot(page, 'strategist-plan-asking-dark');
    // expanded, the question is not shown a second time below
    await page.getByTestId(`chat-expand-${LEAD}`).click();
    await expect(page.getByTestId(`chat-expand-${LEAD}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(tile.getByText(QUESTION, { exact: true })).toHaveCount(1);
    await page.getByTestId(`chat-expand-${LEAD}`).click();
    await card.getByText('No, solo a prezzo pieno', { exact: true }).click();
    await expect.poll(() => demo<{ answer: { answers: Record<string, string> } }[]>(app, 'answers').then(a => a.at(-1)?.answer.answers[QUESTION])).toBe('No, solo a prezzo pieno (consigliato)');
    await expect(page.getByTestId('plan-known')).toContainText('Offerte');
    await expect(page.getByTestId(`plan-enough-${LEAD}`)).toHaveCount(0);

    // «Basta domande» answers the open question for the user
    await ask(app);
    await page.getByTestId(`plan-enough-${LEAD}`).click();
    await expect.poll(() => demo<{ answer: { answers: Record<string, string> } }[]>(app, 'answers').then(a => a.at(-1)?.answer.answers[QUESTION])).toContain('Basta domande');

    // the plan: «Cambia qualcosa» sends the change, «Approva e parti» starts it
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS], doneWhen: 'I test ordini passano e le note sono pronte.' }));
    await expect(card).toHaveAttribute('data-phase', 'proposed');
    // a click inside the card never folds or unfolds the strip
    await card.locator('.sp-title').first().click();
    await expect(page.getByTestId(`chat-expand-${LEAD}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId(`plan-steps-${LEAD}`).locator('li')).toHaveCount(3);
    await expect(card).toContainText('Finito quando: I test ordini passano');
    await top(page);
    await shot(page, 'strategist-plan-proposed-dark');
    await page.getByTestId(`plan-change-${LEAD}`).click();
    await page.getByTestId(`plan-change-text-${LEAD}`).fill('Prima i test');
    await page.getByTestId(`plan-change-send-${LEAD}`).click();
    await expect(card).toHaveAttribute('data-phase', 'revising');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Cambia il piano: Prima i test');
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS] }));
    await page.getByTestId(`plan-approve-${LEAD}`).click();
    await expect(card).toHaveAttribute('data-phase', 'running');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Piano approvato: parti.');
    await expect(page.getByTestId(`plan-steps-${LEAD}-1`)).toHaveAttribute('data-state', 'todo');

    // light theme
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS] }));
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await top(page);
    await shot(page, 'strategist-plan-proposed-light');
  } finally { await app.close(); }
});

test('with "Popup" on, a Strategist\'s question opens in the questions window, not on its strip', async () => {
  const { app, page } = await launchDemo({ config: { questionsModal: true } });
  try {
    await demo(app, 'tree');
    await expect(page.getByTestId(`tile-chat-${LEAD}`)).toBeVisible({ timeout: 15_000 });
    await demo(app, 'plan', LEAD, plan({ clarified: [{ q: 'Dove', a: 'Carrello' }] }));
    await ask(app);
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card).toHaveAttribute('data-phase', 'asking');
    await expect(page.getByTestId('qwin-backdrop')).toBeVisible();
    await expect(page.getByTestId('qwin-backdrop')).toContainText(QUESTION);
    await expect(card).not.toContainText(QUESTION);
    // the strip says where the question is, opens it again, and still offers «Basta domande»
    await expect(page.getByTestId(`plan-in-window-${LEAD}`)).toBeVisible();
    await expect(page.getByTestId(`plan-enough-${LEAD}`)).toBeVisible();
    await expect(page.getByTestId('plan-known')).toContainText('Dove');
  } finally { await app.close(); }
});

// Execution completion and result quality remain distinct in the compact summary.
test('a finished partial plan is complete, compact and expandable, with named parent links', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    await demo(app, 'plan', LEAD, plan({ phase: 'done', steps: STEPS.map(s => ({ ...s, state: 'done', outcome: 'partial' })) }));
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    await expect(card).toContainText('risultato parziale');
    await expect(page.getByTestId(`plan-steps-${LEAD}`)).toBeHidden();
    await page.getByTestId(`plan-toggle-${LEAD}`).click();
    await expect(page.getByTestId(`plan-steps-${LEAD}`)).toBeVisible();
    await expect(page.locator('[data-testid^="delegation-parent-"]').first()).toContainText('Delegato da');
    await top(page);
    await shot(page, 'strategist-plan-partial-complete');
  } finally { await app.close(); }
});

// A blocked result must not be presented as a merely partial result in the collapsed view.
test('a compact plan distinguishes blocked execution from an unavailable final result', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    await demo(app, 'plan', LEAD, plan({ phase: 'running', steps: STEPS.map(s => ({ ...s, state: 'blocked', outcome: 'blocked' })) }));
    const toggle = page.getByTestId(`plan-toggle-${LEAD}`);
    await expect(toggle).toContainText('bloccato');
    await expect(toggle).not.toContainText('risultato parziale');
    await expect(page.getByTestId(`plan-steps-${LEAD}`)).toBeHidden();
    await demo(app, 'plan', LEAD, plan({ phase: 'done', steps: STEPS.map(s => ({ ...s, state: 'done', outcome: 'blocked' })) }));
    await expect(toggle).toContainText('risultato non ottenuto');
    await expect(toggle).not.toContainText('risultato parziale');
    await top(page);
    await shot(page, 'strategist-plan-blocked-complete');
  } finally { await app.close(); }
});
