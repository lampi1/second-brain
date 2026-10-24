// A Strategist's plan to approve in the questions window (ADR 0121; always on since 2026-10-22): the proposed plan
// opens with a concise scope and yes/no/free-text choices; its complete steps and constraints are expandable; the strip keeps the steps and only points to the window (no second pair of buttons); «Cambia
// qualcosa» opens a box whose text reaches the Strategist; «Approva e parti» starts the plan, the card leaves and the
// strip shows it under way. There is no "Popup" switch any more: the strip never asks by itself. Hidden window (SB_HIDDEN), zero network.
// Screenshots: test-results/shots/strategist-plan-popup-*.png.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { StrategyPlan } from '../../src/shared/strategy';
import type { ChatItem } from '../../src/shared/contract';
import { launchDemo, shot } from './helpers';

const LEAD = 'tree-plan';
const demo = <T,>(app: ElectronApplication, fn: string, ...args: unknown[]): Promise<T> =>
  app.evaluate((_e, [f, a]) => ((globalThis as unknown as { __sbDemo: Record<string, (...x: unknown[]) => unknown> }).__sbDemo[f as string]!)(...(a as unknown[])), [fn, args] as const) as Promise<T>;
const STEPS = [
  { title: 'Trovo dove si calcola lo sconto oggi', detail: 'carrello, ordine e reso', role: 'scout', state: 'todo' },
  { title: 'Applico lo sconto % sul prezzo pieno', detail: 'niente doppio sconto sulle offerte', role: 'artisan', state: 'todo' },
  { title: 'Controllo che i test degli ordini passino', role: 'sentinel', state: 'todo' },
  { title: 'Scrivo le note di rilascio', role: 'herald', state: 'todo' },
] as const;
const proposed = (at: number): StrategyPlan => ({ phase: 'proposed', at, asked: 2, steps: [...STEPS], doneWhen: 'I test ordini passano e le note sono pronte.',
  clarified: [{ q: 'Dove', a: 'Carrello, ordine e reso' }, { q: 'Offerte', a: 'No, solo a prezzo pieno' }] } as StrategyPlan);
const items = (page: Page): Promise<ChatItem[]> => page.evaluate(id => window.sb.invoke('chat:items', { chatId: id }), LEAD);
const userTexts = async (page: Page) => (await items(page)).flatMap(i => (i.kind === 'user' && 'text' in i ? [i.text as string] : []));
const phase = (page: Page) => page.evaluate(id => window.sb.invoke('chat:list', undefined).then(l => l.find(c => c.id === id)?.plan?.phase), LEAD);

test('the plan to approve opens in the questions window with its steps; approving it starts the plan', async () => {
  const { app, page } = await launchDemo({ questions: true });
  try {
    await demo(app, 'tree');
    await expect(page.getByTestId(`tile-chat-${LEAD}`)).toBeVisible({ timeout: 15_000 });
    const at = Date.now();
    await demo(app, 'plan', LEAD, proposed(at));

    // the window lists it with the demo's other open requests, in the order they came; a click on the rail shows it
    await expect(page.getByTestId('qwin-backdrop')).toBeVisible();
    const pick = page.locator(`[data-testid="qwin-pick"][data-key="${LEAD}/plan@${at}"]`);
    await expect(pick).toContainText('Piano da approvare');
    await pick.click();
    await expect(page.getByTestId('qwin-current')).toContainText('Piano da approvare');

    // The decision card (ADR 0150): every step, who does it and what is known always open, then what Sì / No do.
    const card = page.getByTestId('qwin-plan');
    await expect(page.getByTestId('qwin-backdrop')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Piano da approvare');
    await expect(card).toContainText('Approvi questo piano?');
    await expect(page.getByTestId('qwin-plan-count')).toHaveText('4 step');
    await expect(page.getByTestId('qwin-plan-approve')).toHaveText('SìConsigliata');
    await expect(page.getByTestId('qwin-plan-reject')).toHaveText('No');
    await expect(page.getByTestId('qwin-plan-effects')).toContainText('Se Sì');
    await shot(page, 'strategist-plan-popup-compact-dark');
    await expect(page.getByTestId('qwin-plan-steps').locator('li')).toHaveCount(4);
    await expect(page.getByTestId('qwin-plan-step-1')).toContainText('Trovo dove si calcola lo sconto oggi');
    await expect(page.getByTestId('qwin-plan-step-1')).toContainText('carrello, ordine e reso');
    await expect(page.getByTestId('qwin-plan-step-1')).toContainText('Scout');
    await expect(page.getByTestId('qwin-plan-step-2')).toContainText('Artisan');
    await expect(page.getByTestId('qwin-plan-step-3')).toContainText('Sentinel');
    await expect(page.getByTestId('qwin-plan-step-4')).toContainText('Herald');
    await expect(page.getByTestId('qwin-plan-done-when')).toContainText('I test ordini passano');
    await expect(page.getByTestId('qwin-plan-known')).toContainText('Offerte');
    // the strip keeps the steps and points to the window: no second pair of buttons
    await expect(page.getByTestId(`plan-${LEAD}`)).toHaveAttribute('data-phase', 'proposed');
    await expect(page.getByTestId(`plan-in-window-${LEAD}`)).toBeAttached();
    await expect(page.getByTestId(`plan-approve-${LEAD}`)).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await shot(page, 'strategist-plan-popup-dark');

    // «Cambia qualcosa»: a box for what to change; the text reaches the Strategist, the plan is revised
    await page.getByTestId('qwin-plan-change').click();
    await expect(page.getByTestId('qwin-plan-change-text')).toBeFocused();
    await page.getByTestId('qwin-plan-change-text').fill('Prima i test, poi lo sconto');
    await shot(page, 'strategist-plan-popup-change-dark');
    await page.getByTestId('qwin-plan-change-send').click();
    await expect.poll(() => phase(page)).toBe('revising');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Cambia il piano: Prima i test, poi lo sconto');
    await expect(page.getByTestId('qwin-plan')).toHaveCount(0);

    // No requires no explanation and only asks for a revised plan: it never starts the proposed work.
    const rejectedAt = Date.now();
    await demo(app, 'plan', LEAD, proposed(rejectedAt));
    await page.locator(`[data-testid="qwin-pick"][data-key="${LEAD}/plan@${rejectedAt}"]`).click();
    await page.getByTestId('qwin-plan-reject').click();
    await expect.poll(() => phase(page)).toBe('revising');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toContain('Non approvo questo piano. Non avviare i passi proposti.');
    await expect(page.getByTestId('qwin-plan')).toHaveCount(0);

    // a new proposal opens again; light theme
    const again = Date.now();
    await demo(app, 'plan', LEAD, proposed(again));
    const pick2 = page.locator(`[data-testid="qwin-pick"][data-key="${LEAD}/plan@${again}"]`);
    await expect(page.getByTestId('qwin-backdrop')).toBeVisible();
    await pick2.click();
    await page.evaluate(() => window.sb.invoke('settings:set', { theme: 'light' }));
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await expect(page.getByTestId('qwin-plan')).toBeVisible();
    await shot(page, 'strategist-plan-popup-light');

    // «Approva e parti»: the plan runs, the card leaves, the strip shows the steps under way
    await page.getByTestId('qwin-plan-approve').click();
    await expect.poll(() => phase(page)).toBe('running');
    await expect.poll(() => userTexts(page).then(t => t.at(-1))).toBe('Piano approvato: parti.');
    await expect(page.getByTestId('qwin-plan')).toHaveCount(0);
    await expect(page.getByTestId(`plan-${LEAD}`)).toHaveAttribute('data-phase', 'running');
  } finally { await app.close(); }
});
