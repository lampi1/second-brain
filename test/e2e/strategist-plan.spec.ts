// A Strategist's plan with the user (ADR 0108), in the demo: under way, one line on its strip (a dot per step, the
// count, «apri mappa») and its steps on its map (ADR 0343); while it asks, its question is a row in the Orchestrator's column (ADR 0269) and a card there points
// to it, with what is already clear and «Basta domande», the answer reaching the chat and, between questions, no card
// (#351); the plan to approve is a row with «Apri la mappa»: on its map «Cambia il piano» asks for another plan and
// «Approva e parti» starts it. Hidden window (SB_HIDDEN).
// Screenshots: test-results/shots/strategist-plan-*.png.
import type { PlanStep } from '../../src/shared/plan-steps';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { StrategyPlan } from '../../src/shared/strategy';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';
import { goPage, launchDemo, openAsk, shot } from './helpers';

const LEAD = 'tree-plan';
const demo = <T,>(app: ElectronApplication, fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const) as Promise<T>;
const STEPS: PlanStep[] = [
  { id: 's1', title: 'Trovo dove si calcola lo sconto oggi', role: 'scout', state: 'todo' },
  { id: 's2', title: 'Applico lo sconto % sul prezzo pieno', role: 'artisan', state: 'todo', after: ['s1'] },
  { id: 's3', title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo', after: ['s2'] },
];
const plan = (p: Partial<StrategyPlan>): StrategyPlan => ({ phase: 'asking', at: Date.now(), clarified: [], steps: [], ...p } as StrategyPlan);
const QUESTION = 'Lo sconto vale anche sui prodotti già in offerta?';
const ask = (app: ElectronApplication) => demo(app, 'ask', LEAD, { type: 'question', tool: 'AskUserQuestion', title: QUESTION, detail: '', input: {},
  questions: [{ header: 'Offerte', question: QUESTION, multiSelect: false, options: [{ label: 'No, solo a prezzo pieno (consigliato)', description: 'niente doppio sconto' }, { label: 'Sì, si sommano' }] }] } satisfies Omit<PendingRequest, 'id' | 'chatId' | 'at'>);
const items = (page: Page): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), LEAD);
const userTexts = async (page: Page) => (await items(page)).flatMap(i => (i.kind === 'user' && 'text' in i ? [i.text as string] : []));
/** The plan's map, from the strip's «apri mappa». */
async function openPlan(page: Page) {
  await page.getByTestId(`plan-map-${LEAD}`).click();
  await expect(page.getByTestId('pl-map')).toBeVisible();
}
/** Back to the Grindhouse from the map. */
async function leaveMap(page: Page) {
  await goPage(page, 'home');
  await expect(page.getByTestId(`tile-chat-${LEAD}`)).toBeVisible();
}
const phase = (page: Page) => page.evaluate(id => window.sb.invoke('chat:list', undefined).then(l => l.find(c => c.id === id)?.plan?.phase), LEAD);
const top = (page: Page) => page.getByTestId(`tile-chat-${LEAD}`).evaluate(el => { el.scrollIntoView({ block: 'start' }); });

test('a Strategist asks, proposes a plan approved on its map and shows one line on its strip', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    const tile = page.getByTestId(`tile-chat-${LEAD}`);
    await expect(tile).toBeVisible({ timeout: 15_000 });

    // under way: one line on the strip, the steps with their role and state on the map
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card).toHaveAttribute('data-phase', 'running');
    await expect(card).toContainText('1/4');
    await expect(card.locator('li')).toHaveCount(0);
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await top(page);
    await shot(page, 'strategist-plan-strip-dark');
    await openPlan(page);
    await expect(page.getByTestId('pl-map')).toHaveAttribute('data-state', 'running');
    await expect(page.getByTestId('pl-box-1')).toHaveAttribute('data-s', 'done');
    await expect(page.getByTestId('pl-box-2')).toHaveAttribute('data-s', 'now');
    await expect(page.getByTestId('pl-box-3')).toHaveAttribute('data-s', 'todo');
    await expect(page.getByTestId('pl-box-who-1')).toContainText('Scout');
    await expect(page.getByTestId('pl-box-who-2')).toContainText('Artisan');
    await shot(page, 'strategist-plan-progress-dark');
    await leaveMap(page);

    // asking: the question is a row in the Orchestrator, the strip says where it is and what is already clear
    await demo(app, 'plan', LEAD, plan({ clarified: [{ q: 'Dove', a: 'Carrello, ordine e reso' }] }));
    await ask(app);
    await expect(card).toHaveAttribute('data-phase', 'asking');
    await openAsk(page, `${LEAD}/`);
    await expect(page.getByTestId('qwin-card-q')).toHaveText(QUESTION);
    await expect(page.getByTestId(`plan-question-n-${LEAD}`)).toHaveText('Domanda 2');
    await expect(card).not.toContainText(QUESTION);
    await expect(page.getByTestId(`plan-in-window-${LEAD}`)).toBeAttached();
    await expect(page.getByTestId('plan-known')).toContainText('Dove');
    await expect(page.getByTestId(`plan-enough-${LEAD}`)).toBeAttached();
    await shot(page, 'strategist-plan-asking-dark');
    await page.getByTestId('qwin-card-opt-1').click();
    await expect.poll(() => demo<{ answer: { answers: Record<string, string> } }[]>(app, 'answers').then(a => a.at(-1)?.answer.answers[QUESTION])).toBe('No, solo a prezzo pieno (consigliato)');
    // answered: no question open, so no «Prima di partire» card until the next one (#351)
    await expect(card).toHaveCount(0);

    // «Basta domande» on the strip answers the open question for the user (its row set aside first)
    await ask(app);
    await openAsk(page, `${LEAD}/`);
    await expect(page.getByTestId('qwin-card-q')).toHaveText(QUESTION);
    await expect(page.getByTestId('plan-known')).toContainText('Lo sconto vale anche sui prodotti già in offerta?');
    await page.getByTestId('qwin-later').click();
    await page.getByTestId(`plan-enough-${LEAD}`).click();
    await expect.poll(() => demo<{ answer: { answers: Record<string, string> } }[]>(app, 'answers').then(a => a.at(-1)?.answer.answers[QUESTION])).toContain('Basta domande');

    // the plan to approve is one row in the Orchestrator: its card names the job and opens the map, no step in it
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS], doneWhen: 'I test ordini passano e le note sono pronte.' }));
    await openAsk(page, `${LEAD}/plan@`);
    await expect(page.getByTestId('qwin-plan')).toBeVisible();
    await expect(page.getByTestId('qwin-plan-title')).toHaveText('Sconti in percentuale');
    await expect(page.getByTestId('qwin-plan-count')).toContainText('3 step');
    await expect(page.getByTestId('qwin-plan').locator('li')).toHaveCount(0);
    await expect(page.getByTestId(`chat-expand-${LEAD}`)).toHaveAttribute('aria-expanded', 'false');
    await top(page);
    await shot(page, 'strategist-plan-proposed-dark');
    await page.getByTestId('qwin-later').click(); // set aside: it folds into «1 da rispondere dopo» and comes back from there
    await expect(page.getByTestId('qwin')).toHaveCount(0);
    await page.getByTestId('orchestrator-asks-later').click();
    await openAsk(page, `${LEAD}/plan@`);
    await expect(page.getByTestId('orchestrator-input')).toBeVisible(); // a typed ok still counts (ADR 0274)
    // on the map: the steps, when it is done, the buttons; a change in his own words reaches the Strategist
    await page.getByTestId('qwin-plan-map').click();
    const map = page.getByTestId('pl-map');
    await expect(map).toHaveAttribute('data-state', 'toApprove');
    await expect(map.locator('.pl-box')).toHaveCount(3);
    await expect(map).toContainText('I test ordini passano');
    await map.getByTestId('pl-do-replan').click();
    await map.getByTestId('pl-replan-text').fill('Prima i test, poi lo sconto');
    await shot(page, 'strategist-plan-change-dark');
    await map.getByTestId('pl-replan-send').click();
    await expect.poll(() => phase(page)).toBe('revising');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Cambia il piano: Prima i test, poi lo sconto');
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS] }));
    // the new plan is a row of its own, and the open map shows it
    await expect(page.locator(`[data-testid="orchestrator-ask"][data-ask-row^="${LEAD}/plan@"]`)).toBeVisible();
    await expect(map).toHaveAttribute('data-state', 'toApprove');
    await map.getByTestId('pl-do-approve').click();
    await expect.poll(() => phase(page)).toBe('running');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Piano approvato: parti.');
    await leaveMap(page);
    await expect(card).toHaveAttribute('data-phase', 'running');
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0'); // its line on the bench: none done yet

    // light theme
    await demo(app, 'plan', LEAD, plan({ phase: 'proposed', steps: [...STEPS] }));
    await openAsk(page, `${LEAD}/plan@`);
    await page.getByTestId('qwin-plan-map').click();
    await expect(page.getByTestId('pl-do-approve')).toBeVisible();
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await shot(page, 'strategist-plan-proposed-light');
  } finally { await app.close(); }
});

test('a Strategist\'s question is a row in the Orchestrator, not on its strip', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    await expect(page.getByTestId(`tile-chat-${LEAD}`)).toBeVisible({ timeout: 15_000 });
    await demo(app, 'plan', LEAD, plan({ clarified: [{ q: 'Dove', a: 'Carrello' }] }));
    await ask(app);
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card).toHaveAttribute('data-phase', 'asking');
    const row = page.locator(`[data-testid="orchestrator-ask"][data-ask-row^="${LEAD}/"]`);
    await expect(row).toContainText(QUESTION);
    await expect(row.getByTestId('qwin')).toHaveCount(0); // a short row: nothing opens by itself (ADR 0269)
    await expect(card).not.toContainText(QUESTION);
    // the strip says where the question is, opens it as the full card, and still offers «Basta domande»
    await expect(page.getByTestId(`plan-in-window-${LEAD}`)).toBeVisible();
    await page.getByTestId(`plan-open-window-${LEAD}`).click();
    await expect(row.getByTestId('qwin-card-q')).toHaveText(QUESTION);
    await expect(page.getByTestId(`plan-enough-${LEAD}`)).toBeVisible();
    await expect(page.getByTestId('plan-known')).toContainText('Dove');
  } finally { await app.close(); }
});

// Execution completion and result quality remain distinct in the compact summary.
test('a finished partial plan is one line on its strip and its map says what is partial', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    await demo(app, 'plan', LEAD, plan({ phase: 'done', steps: STEPS.map(s => ({ ...s, state: 'partial', proof: { at: 1, by: 'report', text: 'ok' } })) }));
    const card = page.getByTestId(`plan-${LEAD}`);
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    await expect(card).toContainText('risultato parziale');
    await expect(card.locator('li')).toHaveCount(0);
    await openPlan(page);
    await expect(page.getByTestId('pl-box-1')).toContainText('parziale');
    await shot(page, 'strategist-plan-partial-complete');
  } finally { await app.close(); }
});

// A blocked result must not be presented as a merely partial result in the collapsed view.
test('a compact plan distinguishes blocked execution from an unavailable final result', async () => {
  const { app, page } = await launchDemo();
  try {
    await demo(app, 'tree');
    await demo(app, 'plan', LEAD, plan({ phase: 'running', steps: STEPS.map(s => ({ ...s, state: 'blocked' })) }));
    const line = page.getByTestId(`plan-${LEAD}`);
    await expect(line).toContainText('bloccato');
    await expect(line).not.toContainText('risultato parziale');
    await demo(app, 'plan', LEAD, plan({ phase: 'done', steps: STEPS.map(s => ({ ...s, state: 'blocked' })) }));
    await expect(line).toContainText('risultato non ottenuto');
    await expect(line).not.toContainText('risultato parziale');
    await top(page);
    await shot(page, 'strategist-plan-blocked-complete');
  } finally { await app.close(); }
});
